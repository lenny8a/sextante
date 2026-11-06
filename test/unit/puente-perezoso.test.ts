import assert from 'node:assert/strict';
import type { ResultadoPiezas, PiezasOficial } from '../../src/adt/puente-piezas';
import { PuentePerezoso, type PuenteCerrable } from '../../src/adt/puente-perezoso';
import type { ConexionRfc, RespuestaPuente } from '../../src/adt/puente-rfc';
import type { PeticionAdt } from '../../src/adt/transporte';

const PIEZAS: PiezasOficial = { java: 'java.exe', jarJco: 'jco.jar', fragmentoNativo: 'nativa.jar', raiz: 'raiz' };
const CONEXION: ConexionRfc = { ashost: 'host.local', sysnr: '00', client: '100' };

interface PuenteFalso extends PuenteCerrable {
  llamadas: string[];
}

function puenteFalso(): PuenteFalso {
  const llamadas: string[] = [];
  return {
    llamadas,
    preparar: async () => {
      llamadas.push('preparar');
    },
    logon: async (destino: string, _conexion: ConexionRfc, usuario: string) => {
      llamadas.push(`logon ${destino} ${usuario}`);
      return { sistema: 'DEV', release: '758' };
    },
    peticion: async (destino: string, p: PeticionAdt): Promise<RespuestaPuente> => {
      llamadas.push(`peticion ${destino} ${p.ruta}`);
      return { estado: 200, razon: 'OK', cabeceras: {}, cuerpo: Buffer.from('') };
    },
    tabla: async (destino: string) => {
      llamadas.push(`tabla ${destino}`);
      return { columnas: [], filas: [] };
    },
    olvidar: async (destino: string) => {
      llamadas.push(`olvidar ${destino}`);
    },
    cerrar: () => {
      llamadas.push('cerrar');
    },
  };
}

interface Montaje {
  perezoso: PuentePerezoso;
  creados: PuenteFalso[];
  localizaciones: () => number;
  fijar: (resultado: ResultadoPiezas) => void;
}

function montar(inicial: ResultadoPiezas): Montaje {
  let resultado = inicial;
  let localizaciones = 0;
  const creados: PuenteFalso[] = [];
  const perezoso = new PuentePerezoso({
    localizar: () => {
      localizaciones++;
      return resultado;
    },
    crearPuente: (piezas) => {
      assert.deepStrictEqual(piezas, PIEZAS);
      const puente = puenteFalso();
      creados.push(puente);
      return puente;
    },
  });
  return { perezoso, creados, localizaciones: () => localizaciones, fijar: (r) => { resultado = r; } };
}

suite('puente RFC perezoso', () => {
  test('sin la oficial no está disponible, da el motivo y preparar rechaza sin crear el puente', async () => {
    const { perezoso, creados } = montar({ ok: false, motivo: 'sinOficial' });
    const disponibilidad = perezoso.disponible();
    assert.strictEqual(disponibilidad.ok, false);
    assert.ok(!disponibilidad.ok && disponibilidad.motivo.includes('extensión oficial'));
    await assert.rejects(perezoso.preparar(), /puente RFC no está disponible/);
    assert.strictEqual(creados.length, 0);
  });

  test('un fallo se vuelve a evaluar: instalar la oficial después funciona sin reiniciar', () => {
    const { perezoso, localizaciones, fijar } = montar({ ok: false, motivo: 'sinJco' });
    assert.strictEqual(perezoso.disponible().ok, false);
    fijar({ ok: true, piezas: PIEZAS });
    assert.strictEqual(perezoso.disponible().ok, true);
    assert.strictEqual(localizaciones(), 2);
  });

  test('un éxito se guarda: no vuelve a buscar las piezas', () => {
    const { perezoso, localizaciones } = montar({ ok: true, piezas: PIEZAS });
    assert.strictEqual(perezoso.disponible().ok, true);
    assert.strictEqual(perezoso.disponible().ok, true);
    assert.strictEqual(localizaciones(), 1);
  });

  test('disponible no crea el puente; el primer uso lo crea una vez y se reutiliza', async () => {
    const { perezoso, creados } = montar({ ok: true, piezas: PIEZAS });
    perezoso.disponible();
    assert.strictEqual(creados.length, 0);
    await perezoso.preparar();
    await perezoso.logon('DEST', CONEXION, 'USUARIO', 'secreto');
    await perezoso.peticion('DEST', { metodo: 'GET', ruta: '/sap/bc/adt/discovery', cabeceras: {} });
    await perezoso.olvidar('DEST');
    assert.strictEqual(creados.length, 1);
    assert.deepStrictEqual(creados[0].llamadas, [
      'preparar',
      'logon DEST USUARIO',
      'peticion DEST /sap/bc/adt/discovery',
      'olvidar DEST',
    ]);
  });

  test('olvidar sin puente creado no lo crea', async () => {
    const { perezoso, creados } = montar({ ok: true, piezas: PIEZAS });
    await perezoso.olvidar('DEST');
    assert.strictEqual(creados.length, 0);
  });

  test('cerrar antes de usarlo no hace nada; después delega en el puente', async () => {
    const { perezoso, creados } = montar({ ok: true, piezas: PIEZAS });
    perezoso.cerrar();
    assert.strictEqual(creados.length, 0);
    await perezoso.preparar();
    perezoso.dispose();
    assert.deepStrictEqual(creados[0].llamadas, ['preparar', 'cerrar']);
  });
});
