import assert from 'node:assert/strict';
import { analizarUriAbap } from '../../src/bridge/adt-uri';
import {
  argumentoAsistente,
  decidirCrear,
  destinoDeRuta,
  destinoParaCrear,
  lanzamientoDe,
} from '../../src/commands/crear-objeto-modelo';

suite('crear-objeto-modelo', () => {
  suite('destinoDeRuta', () => {
    test('extrae el destino de una ruta repotree', () => {
      assert.strictEqual(
        destinoDeRuta('/repotree-v1/DEST/System Library/ZPAQ1/Programas/Programa/ZPROG_EJEMPLO'),
        'DEST',
      );
    });

    test('conserva los espacios del destino', () => {
      assert.strictEqual(destinoDeRuta('/repotree-v1/DEST X/System Library'), 'DEST X');
    });

    test('devuelve undefined sin ruta o con una ruta ajena', () => {
      assert.strictEqual(destinoDeRuta(undefined), undefined);
      assert.strictEqual(destinoDeRuta('/otra/cosa'), undefined);
    });
  });

  suite('destinoParaCrear', () => {
    test('prioriza nodo, luego objeto abierto y luego sistema activo', () => {
      assert.strictEqual(destinoParaCrear({ nodo: 'A', objetoAbierto: 'B', sistemaActivo: 'C' }), 'A');
      assert.strictEqual(destinoParaCrear({ objetoAbierto: 'B', sistemaActivo: 'C' }), 'B');
      assert.strictEqual(destinoParaCrear({ sistemaActivo: 'C' }), 'C');
    });

    test('devuelve undefined si no hay candidatos', () => {
      assert.strictEqual(destinoParaCrear({}), undefined);
    });
  });

  suite('argumentoAsistente', () => {
    test('uri abap: de la raíz del destino, con el destino como tercer segmento', () => {
      const uri = argumentoAsistente('DEST X');
      assert.deepStrictEqual(uri, { scheme: 'abap', path: '/repotree-v1/DEST X' });
      assert.strictEqual(uri.path.split('/')[2], 'DEST X');
      assert.strictEqual(analizarUriAbap(uri)?.destino, 'DEST X');
    });
  });

  suite('lanzamientoDe', () => {
    test('lanzado → ok', () => {
      assert.deepStrictEqual(lanzamientoDe('lanzado', 'DEV'), { ok: true });
    });

    test('los demás resultados dan un motivo para el agente', () => {
      assert.deepStrictEqual(lanzamientoDe('sinOficial', 'DEV'), {
        ok: false,
        motivo: 'falta la extensión oficial de SAP (ABAP Development Tools for VS Code): pide al usuario que la instale y vuelve a llamar',
      });
      assert.deepStrictEqual(lanzamientoDe('sinConexion', 'DEV'), {
        ok: false,
        motivo: 'DEV no está conectado: pide al usuario que se conecte (vista Sistemas) y vuelve a llamar',
      });
      for (const resultado of ['sinSistema', 'protegido'] as const) {
        const r = lanzamientoDe(resultado, 'DEV');
        assert.ok(!r.ok && r.motivo.length > 0, resultado);
      }
    });
  });

  suite('decidirCrear', () => {
    test('ejecuta en DEV y sin rol', () => {
      assert.deepStrictEqual(decidirCrear('DEV'), { ejecutar: true });
      assert.deepStrictEqual(decidirCrear(undefined), { ejecutar: true });
    });

    test('no ejecuta en QAS ni PRD', () => {
      assert.deepStrictEqual(decidirCrear('QAS'), {
        ejecutar: false,
        motivo: 'Sistema QAS: no se crean objetos en solo lectura',
      });
      assert.deepStrictEqual(decidirCrear('PRD'), {
        ejecutar: false,
        motivo: 'Sistema PRD: no se crean objetos en solo lectura',
      });
    });
  });
});
