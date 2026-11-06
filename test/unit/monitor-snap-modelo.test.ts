import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LONGITUD_MAXIMA_CONDICION, type ResultadoTabla } from '../../src/adt/tablas-legibles';
import {
  claveDeDump,
  COLUMNAS_SNAP,
  condicionesSnap,
  consultasSnap,
  dumpCompletoDe,
  reensamblarFilas,
  registrosDe,
} from '../../src/monitor/snap-modelo';

interface FixtureSnap { dump: string; origen: string; respuestas: ResultadoTabla[] }

function leerSnap(nombre: string): FixtureSnap {
  const ruta = path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre);
  return JSON.parse(fs.readFileSync(ruta, 'utf8')) as FixtureSnap;
}

function registrosDeFixture(nombre: string): ReturnType<typeof registrosDe> {
  return registrosDe(reensamblarFilas(leerSnap(nombre).respuestas));
}

const PREFIJO = '/sap/bc/adt/vit/runtime/dumps/';
const ID = `${PREFIJO}20261103170949HOST_1_DEV_10%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20USUARIO_1%20%20%20100%20%20%20%20%20%20%2017`;

suite('monitor snap-modelo', () => {
  test('claveDeDump: id real → clave', () => {
    assert.deepEqual(claveDeDump(ID), {
      fecha: '20261103',
      hora: '170949',
      host: 'HOST_1_DEV_10',
      usuario: 'USUARIO_1',
      mandante: '100',
      modno: '17',
    });
  });

  test('claveDeDump: host con punto y guion, usuario numérico', () => {
    const id = `${PREFIJO}20261103170949host-1.red_DEV_10%20%20%2012345%20%20100%20%205`;
    assert.deepEqual(claveDeDump(id), {
      fecha: '20261103',
      hora: '170949',
      host: 'host-1.red_DEV_10',
      usuario: '12345',
      mandante: '100',
      modno: '5',
    });
  });

  test('claveDeDump: usuario con punto, guion y arroba', () => {
    const id = ID.replace('USUARIO_1', 'NOMBRE.APE-1');
    assert.equal(claveDeDump(id)?.usuario, 'NOMBRE.APE-1');
  });

  test('claveDeDump: ids rotos → undefined', () => {
    const rotos = ['', `${PREFIJO}2026`, ID.replace('100', '1OO'), ID.replace('%2017', ''), ID.replace('USUARIO_1', "US'1")];
    for (const malo of rotos) {
      assert.equal(claveDeDump(malo), undefined, malo);
    }
  });

  test('condicionesSnap: cuatro condiciones de ≤ 72 con los valores de la clave', () => {
    const clave = claveDeDump(ID);
    assert.ok(clave);
    const condiciones = condicionesSnap(clave);
    assert.deepEqual(condiciones, [
      "DATUM EQ '20261103' AND UZEIT EQ '170949'",
      "AND MODNO EQ 17 AND MANDT EQ '100'",
      "AND AHOST EQ 'HOST_1_DEV_10'",
      "AND UNAME EQ 'USUARIO_1'",
    ]);
    for (const condicion of condiciones) {
      assert.ok(condicion.length <= LONGITUD_MAXIMA_CONDICION, condicion);
    }
  });

  test('consultasSnap: ocho consultas sobre SNAP con SEQNO y cada columna', () => {
    const clave = claveDeDump(ID);
    assert.ok(clave);
    const consultas = consultasSnap(clave);
    assert.equal(consultas.length, 8);
    assert.deepEqual(consultas.map((consulta) => consulta.campos[1]), [...COLUMNAS_SNAP]);
    for (const consulta of consultas) {
      assert.equal(consulta.tabla, 'SNAP');
      assert.equal(consulta.filasMax, undefined);
      assert.deepEqual(consulta.campos[0], 'SEQNO');
      assert.deepEqual(consulta.condiciones, condicionesSnap(clave));
    }
  });

  test('reensamblarFilas: una cadena de 1600 por SEQNO, en orden, con las columnas rellenadas', () => {
    const { respuestas } = leerSnap('snap-itab.json');
    const filas = reensamblarFilas(respuestas);
    assert.equal(filas.length, 16);
    for (const fila of filas) {
      assert.equal(fila.length, 1600);
    }
    assert.ok(filas[0].startsWith('FC019ITAB_LINE_NOT_FOUND'));
    const recortadas = respuestas.map((respuesta, indice) =>
      indice === 2
        ? { ...respuesta, filas: respuesta.filas.map(([seq, trozo]) => (seq === '002' ? [seq, trozo.trimEnd()] : [seq, trozo])) }
        : respuesta,
    );
    assert.deepEqual(reensamblarFilas(recortadas), filas);
  });

  test('reensamblarFilas: falta una fila en una columna → esa columna va en blanco', () => {
    const { respuestas } = leerSnap('snap-itab.json');
    const sin = respuestas.map((respuesta, indice) =>
      indice === 7 ? { ...respuesta, filas: respuesta.filas.filter(([seq]) => seq !== '003') } : respuesta,
    );
    const filas = reensamblarFilas(sin);
    assert.equal(filas.length, 16);
    assert.equal(filas[3].slice(1400), ' '.repeat(200));
  });

  test('registrosDe: fixtures reales', () => {
    const itab = registrosDeFixture('snap-itab.json');
    assert.equal(itab.registros.length, 268);
    assert.equal(itab.incompleto, false);
    assert.equal(itab.registros.filter((r) => r.id === 'ES').length, 1);
    const rfc = registrosDeFixture('snap-rfc.json');
    assert.equal(rfc.registros.length, 271);
    assert.equal(rfc.registros.filter((r) => r.id === 'ES').length, 2);
  });

  test('registrosDe: %A, longitud inválida y %M en mitad de la fila', () => {
    const abierto = registrosDe(['FC004ABCD%A'.padEnd(1600)]);
    assert.equal(abierto.registros.length, 1);
    assert.equal(abierto.incompleto, true);
    const roto = registrosDe(['FC0X4ABCD'.padEnd(1600)]);
    assert.equal(roto.registros.length, 0);
    assert.equal(roto.incompleto, true);
    const cero = registrosDe(['FC000'.padEnd(1600)]);
    assert.equal(cero.incompleto, true);
    const corte = registrosDe(['FC001A%MFC001B'.padEnd(1600), 'AP001C%E'.padEnd(1600)]);
    assert.deepEqual(corte.registros, [
      { id: 'FC', valor: 'A' },
      { id: 'AP', valor: 'C' },
    ]);
    assert.equal(corte.incompleto, false);
  });

  test('dumpCompletoDe: ITAB_LINE_NOT_FOUND', () => {
    const dump = dumpCompletoDe(registrosDeFixture('snap-itab.json').registros);
    assert.equal(dump.excepcion, 'CX_SY_ITAB_LINE_NOT_FOUND');
    assert.equal(dump.programa, 'ZTEST');
    assert.equal(dump.include, 'ZTEST');
    assert.equal(dump.linea, 13);
    assert.equal(dump.evento, 'START-OF-SELECTION');
    assert.deepEqual(dump.pila, [
      { nr: '1', tipo: 'EVENT', programa: 'ZTEST', include: 'ZTEST', linea: 13, nombre: 'START-OF-SELECTION' },
    ]);
    assert.equal(dump.variables.length, 2);
    assert.equal(dump.variables[0].titulo, 'De la sentencia que falló');
    assert.equal(dump.variables[0].variables.length, 1);
    const [lt] = dump.variables[0].variables;
    assert.equal(lt.nombre, 'LT_MARA');
    assert.equal(lt.valor, undefined);
    assert.equal(lt.tabla?.cabecera, 'Table IT_13[3x3526]');
    assert.equal(lt.tabla?.filas.length, 3);
    for (const fila of lt.tabla?.filas ?? []) {
      assert.ok(fila.startsWith('100MATERIAL_EJEMPLO_'), fila);
    }
    assert.equal(dump.variables[1].titulo, 'Nivel 1 · EVENT START-OF-SELECTION · ZTEST');
    const nivel = dump.variables[1].variables;
    assert.equal(nivel.find((v) => v.nombre === 'SY-LDBPG')?.valor, 'SAPDB__S');
    assert.ok(nivel.find((v) => v.nombre === 'LT_MARA')?.tabla);
    assert.equal(nivel.some((v) => v.nombre.startsWith('%_')), false);
    assert.equal(dump.camposSistema.length, 24);
    assert.deepEqual(dump.camposSistema[0], { nombre: 'SY-SUBRC', valor: '0' });
    assert.equal(dump.camposSistema.find((c) => c.nombre === 'SY-DBCNT')?.valor, '3');
    assert.equal(dump.camposSistema.find((c) => c.nombre === 'SY-MSGID')?.valor, '');
    assert.deepEqual(dump.parametros, ['INDEX', '5']);
    assert.equal(dump.usuario, 'USUARIO_1');
    assert.equal(dump.mandante, '100');
    assert.equal(dump.idioma, 'S');
    assert.equal(dump.terminal, 'TERMINAL');
    assert.equal(dump.transaccion, 'SE38');
    assert.equal(dump.programaPantalla, 'SAPMSSY0');
    assert.equal(dump.dynpro, '1000');
    assert.equal(dump.rfc, undefined);
    assert.equal(dump.entorno.release, '752');
    assert.equal(dump.entorno.servidor, 'HOST_1');
    assert.equal(dump.entorno.baseDatos, 'HDB');
    assert.equal(dump.entorno.kernel, '754');
    assert.equal(dump.entorno.parche, '33');
    assert.equal(dump.entorno.archivo, 'abtrea.c');
    assert.equal(dump.entorno.funcion, 'TreaContext::LineNotFound');
    assert.equal(dump.entorno.generado, '20261103170947');
    assert.deepEqual(dump.conteos, { opcodes: 20, programasCargados: 65, pilaKernel: 18 });
    assert.equal(dump.incompleto, false);
  });

  test('dumpCompletoDe: CALL_FUNCTION_NOT_REMOTE', () => {
    const dump = dumpCompletoDe(registrosDeFixture('snap-rfc.json').registros);
    assert.equal(dump.excepcion, undefined);
    assert.equal(dump.pila.length, 2);
    assert.equal(dump.pila[0].nr, '2');
    assert.equal(dump.pila[0].tipo, 'FORM');
    assert.equal(dump.pila[0].linea, 594);
    assert.equal(dump.pila[0].nombre, 'REMOTE_FUNCTION_CALL');
    assert.equal(dump.pila[1].nr, '1');
    assert.equal(dump.pila[1].tipo, 'MODULE (PBO)');
    assert.equal(dump.pila[1].linea, 35);
    assert.equal(dump.pila[1].nombre, '%_RFC_START');
    assert.equal(dump.variables.length, 2);
    assert.equal(dump.variables[0].variables.find((v) => v.nombre === 'L_SYXFORM')?.valor, 'RS_ST22_GET_FT');
    assert.equal(dump.variables[1].variables.find((v) => v.nombre === 'RFCTYPE_INTERNAL')?.valor, '3');
    assert.deepEqual(dump.rfc, {
      funcion: 'RS_ST22_GET_FT',
      destino: 'DEST',
      desde: '10.0.0.2',
      usuario: 'TERMINAL',
      programa: 'SAPJCo31',
    });
    assert.equal(dump.transaccion, undefined);
    assert.deepEqual(dump.parametros, ['RS_ST22_GET_FT']);
  });

  test('dumpCompletoDe: un ES con clase', () => {
    const valor =
      ' ' + '1'.padEnd(5) + 'ZTEST'.padEnd(40) + 'ZTEST'.padEnd(40) + ' '.repeat(5) + '00012' + 'METHOD'.padEnd(12) + 'EJECUTAR'.padEnd(61) + 'ZCL_EJEMPLO_1'.padEnd(30);
    assert.equal(valor.length, 199);
    const dump = dumpCompletoDe([{ id: 'ES', valor }]);
    assert.equal(dump.pila[0].clase, 'ZCL_EJEMPLO_1');
    assert.equal(dump.pila[0].nombre, 'EJECUTAR');
    assert.equal(dump.pila[0].linea, 12);
  });
});
