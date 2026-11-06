import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analizarDataPreview } from '../../src/adt/transaccion';
import {
  componentesDe,
  falloVigente,
  infoDe,
  infoSinConexion,
  INDICACION_SIN_CONEXION,
  releaseDeComponentes,
  TIEMPO_CVERS_MS,
  VENTANA_FALLO_CVERS_MS,
} from '../../src/ia/sistema-modelo';

suite('IA: modelo de info del sistema', () => {
  test('componentesDe lee las claves en mayúsculas', () => {
    const c = componentesDe([
      { COMPONENT: 'SAP_BASIS', RELEASE: '754', EXTRELEASE: '0005' },
      { COMPONENT: 'S4CORE', RELEASE: '104', EXTRELEASE: '0005' },
    ]);
    assert.deepEqual(c[0], { componente: 'SAP_BASIS', release: '754', nivel: '0005' });
    assert.equal(c.length, 2);
  });
  test('componentesDe acepta claves en minúsculas y nivel vacío sin EXTRELEASE', () => {
    const c = componentesDe([{ component: 'SAP_ABA', release: '754' }]);
    assert.deepEqual(c, [{ componente: 'SAP_ABA', release: '754', nivel: '' }]);
  });
  test('componentesDe descarta filas sin componente', () => {
    assert.deepEqual(componentesDe([{ RELEASE: '1' }]), []);
  });
  test('releaseDeComponentes devuelve el de SAP_BASIS', () => {
    const c = componentesDe([
      { COMPONENT: 'S4CORE', RELEASE: '104' },
      { COMPONENT: 'SAP_BASIS', RELEASE: '754' },
    ]);
    assert.equal(releaseDeComponentes(c), '754');
  });
  test('releaseDeComponentes sin SAP_BASIS → undefined', () => {
    assert.equal(releaseDeComponentes(componentesDe([{ COMPONENT: 'S4CORE', RELEASE: '104' }])), undefined);
  });
  test('infoSinConexion no inventa datos', () => {
    assert.deepEqual(infoSinConexion('DEV', 'DEV', 'rest'), {
      sistema: 'DEV',
      rol: 'DEV',
      via: 'rest',
      fuente: 'no disponible',
      indicacion: INDICACION_SIN_CONEXION,
    });
  });
  test('infoSinConexion omite rol y vía desconocidos', () => {
    const i = infoSinConexion('X', undefined, undefined);
    assert.ok(!('rol' in i) && !('via' in i));
  });
  test('constantes de tiempo de CVERS', () => {
    assert.equal(TIEMPO_CVERS_MS, 10_000);
    assert.equal(VENTANA_FALLO_CVERS_MS, 60_000);
  });
  test('falloVigente: dentro de la ventana sí, en el límite y después no, sin fallo no', () => {
    const fallo = { instante: 1000, indicacion: 'x' };
    assert.equal(falloVigente(fallo, 1000), true);
    assert.equal(falloVigente(fallo, 1000 + VENTANA_FALLO_CVERS_MS - 1), true);
    assert.equal(falloVigente(fallo, 1000 + VENTANA_FALLO_CVERS_MS), false);
    assert.equal(falloVigente(undefined, 1000), false);
  });
  test('infoDe compone rol y vía frescos con lo cacheado y la indicación', () => {
    const componentes = [{ componente: 'SAP_BASIS', release: '754', nivel: '0005' }];
    assert.deepEqual(infoDe('DEV', 'QAS', 'rfc', { release: '754', componentes, fuente: 'rfc' }), {
      sistema: 'DEV',
      rol: 'QAS',
      via: 'rfc',
      release: '754',
      componentes,
      fuente: 'rfc',
    });
    assert.deepEqual(infoDe('X', undefined, undefined, { fuente: 'rest' }, 'aviso'), {
      sistema: 'X',
      fuente: 'rest',
      indicacion: 'aviso',
    });
  });

  test('CVERS real (2026-11-04): SAP_BASIS 752', () => {
    const xml = fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real/creacion/cvers.body.xml'), 'utf8');
    const componentes = componentesDe(analizarDataPreview(xml));
    const basis = componentes.find((c) => c.componente === 'SAP_BASIS');
    assert.equal(basis?.release, '752');
    assert.equal(releaseDeComponentes(componentes), '752');
  });
});
