import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConexionAdt, ErrorAdt, type RespuestaAdt } from '../../src/adt/conexion-adt';
import type { PeticionAdt, TransporteAdt } from '../../src/adt/transporte';
import { ACCEPT_DUMPS, medianocheLocal, rutaDumps } from '../../src/monitor/dumps-modelo';
import { ACCEPT_INACTIVOS, RUTA_INACTIVOS } from '../../src/monitor/inactivos-modelo';
import { ErrorSinSesion, ServicioMonitor, TIEMPO_MONITOR_MS } from '../../src/monitor/servicio';
import { ErrorDelPuente } from '../../src/adt/puente-rfc';
import type { ConsultaTabla, LectorDeTablas, ResultadoTabla } from '../../src/adt/tablas-legibles';
import type { Dump } from '../../src/monitor/dumps-modelo';
import { COLUMNAS_SNAP, claveDeDump, condicionesSnap } from '../../src/monitor/snap-modelo';

function leerFixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function entorno(
  respuesta: Partial<RespuestaAdt> & { cuerpo: string },
  ahora?: () => Date,
  registros: string[] = [],
  sinConexion = false,
): { servicio: ServicioMonitor; peticiones: PeticionAdt[] } {
  const peticiones: PeticionAdt[] = [];
  const transporte: TransporteAdt = {
    peticion: async (p) => {
      peticiones.push(p);
      return { estado: 200, ...respuesta };
    },
  };
  const conexion = new ConexionAdt(transporte);
  const servicio = new ServicioMonitor({
    conexionDe: async () => (sinConexion ? undefined : conexion),
    registrar: (m) => registros.push(m),
    ahora,
  });
  return { servicio, peticiones };
}

suite('monitor servicio', () => {
  test('dumps: ruta con from de la medianoche local, accept del feed, tiempo máximo y llena', async () => {
    const ahora = new Date(2026, 9, 30, 21, 45, 8);
    const { servicio, peticiones } = entorno({ cuerpo: leerFixture('dumps.xml') }, () => ahora);
    const r = await servicio.dumps('DEST', { usuario: 'USUARIO_1' });
    assert.equal(peticiones[0].metodo, 'GET');
    assert.equal(peticiones[0].ruta, rutaDumps({ usuario: 'USUARIO_1', desde: medianocheLocal(ahora), top: 50 }));
    assert.equal(peticiones[0].parametros, undefined);
    assert.equal(peticiones[0].cabeceras?.accept, ACCEPT_DUMPS);
    assert.equal(peticiones[0].tiempoMs, TIEMPO_MONITOR_MS);
    assert.equal(r.dumps.length, 1);
    assert.equal(r.llena, false);
    assert.equal(r.top, 50);
  });
  test('dumps: top explícito, tope 1000 y llena cuando llegan tantas como top', async () => {
    const { servicio, peticiones } = entorno({ cuerpo: leerFixture('dumps.xml') });
    const r = await servicio.dumps('DEST', { usuario: 'USUARIO_1', top: 1 });
    assert.ok(peticiones[0].ruta.endsWith('&$top=1'));
    assert.equal(r.llena, true);
    await servicio.dumps('DEST', { top: 5000 });
    assert.ok(peticiones[1].ruta.endsWith('&$top=1000'));
  });
  test('dumps: usuario inválido → sin $query', async () => {
    const { servicio, peticiones } = entorno({ cuerpo: leerFixture('dumps-vacio.xml') });
    await servicio.dumps('DEST', { usuario: 'mal usuario' });
    assert.ok(!peticiones[0].ruta.includes('$query'));
  });
  test('inactivos: ruta, accept y análisis', async () => {
    const { servicio, peticiones } = entorno({ cuerpo: leerFixture('inactivos.xml') });
    const o = await servicio.inactivos('DEST');
    assert.equal(peticiones[0].ruta, RUTA_INACTIVOS);
    assert.equal(peticiones[0].cabeceras?.accept, ACCEPT_INACTIVOS);
    assert.equal(o.length, 4);
  });
  test('sin sesión → ErrorSinSesion; error ADT se propaga; log solo con conteos', async () => {
    const registros: string[] = [];
    const { servicio } = entorno({ cuerpo: leerFixture('dumps.xml') }, undefined, registros, /*sinConexion*/ true);
    await assert.rejects(servicio.dumps('DEST', {}), ErrorSinSesion);
    const { servicio: s2 } = entorno({ estado: 500, cuerpo: '' }, undefined, registros);
    await assert.rejects(s2.inactivos('DEST'), ErrorAdt);
    const { servicio: s3 } = entorno({ cuerpo: leerFixture('dumps.xml') }, undefined, registros);
    await s3.dumps('DEST', { usuario: 'USUARIO_1' });
    assert.ok(registros.some((m) => /^Monitor: dumps → ok \(1 entradas, \d de hoy\)$/.test(m)));
    assert.ok(registros.some((m) => m === 'Monitor: inactivos → error ErrorAdt'));
    assert.ok(registros.every((m) => !m.includes('Z_EJEMPLO') && !m.includes('USUARIO_1')));
  });

  suite('dumpCompleto', () => {
    const ID = '/sap/bc/adt/vit/runtime/dumps/20261103170949HOST_1_DEV_10%20%20%20USUARIO_1%20%20%20100%20%20%2017';
    const dump: Dump = { id: ID, publicado: '', usuario: 'USUARIO_1', errorEjecucion: '', programa: '', textoCorto: '', resumenHtml: '' };
    const fixture = JSON.parse(leerFixture('snap-itab.json')) as { respuestas: ResultadoTabla[] };

    function montar(opciones: {
      respuestas?: ResultadoTabla[];
      alConsultar?: (indice: number) => Promise<void>;
      sinConexion?: boolean;
      sinLector?: boolean;
      tiempoMs?: number;
    } = {}): { servicio: ServicioMonitor; consultas: ConsultaTabla[]; registros: string[] } {
      const consultas: ConsultaTabla[] = [];
      const registros: string[] = [];
      const respuestas = opciones.respuestas ?? fixture.respuestas;
      const lector: LectorDeTablas = {
        tabla: async (_destino, consulta) => {
          consultas.push(consulta);
          const indice = COLUMNAS_SNAP.indexOf(consulta.campos[1] as (typeof COLUMNAS_SNAP)[number]);
          await opciones.alConsultar?.(consultas.length);
          return respuestas[indice];
        },
      };
      const servicio = new ServicioMonitor({
        conexionDe: async () => (opciones.sinConexion ? undefined : new ConexionAdt({ peticion: async () => ({ estado: 200, cuerpo: '' }) })),
        registrar: (m) => registros.push(m),
        lector: opciones.sinLector ? undefined : lector,
        tiempoMs: opciones.tiempoMs,
      });
      return { servicio, consultas, registros };
    }

    test('ocho consultas sobre SNAP con la clave del id y resultado ok', async () => {
      const { servicio, consultas, registros } = montar();
      const r = await servicio.dumpCompleto('DEST', dump);
      assert.equal(consultas.length, 8);
      assert.deepEqual(consultas.map((c) => c.campos[1]), [...COLUMNAS_SNAP]);
      const clave = claveDeDump(ID);
      assert.ok(clave);
      assert.ok(consultas.every((c) => c.tabla === 'SNAP'));
      assert.deepEqual(consultas[0].condiciones, condicionesSnap(clave));
      assert.equal(r.clase, 'ok');
      assert.equal(r.clase === 'ok' && r.completo.linea, 13);
      assert.ok(registros.includes('Monitor: SNAP → ok (16 filas, 268 registros, 1 niveles)'), registros.join('\n'));
    });
    test('asegura la sesión RFC antes de leer', async () => {
      const { servicio, consultas } = montar({ sinConexion: true });
      assert.deepEqual(await servicio.dumpCompleto('DEST', dump), { clase: 'error', motivo: 'sin sesión RFC' });
      assert.equal(consultas.length, 0);
    });
    test('sin lector → sin puente RFC; id irreconocible → id no reconocido', async () => {
      assert.deepEqual(await montar({ sinLector: true }).servicio.dumpCompleto('DEST', dump), { clase: 'error', motivo: 'sin puente RFC' });
      const r = await montar().servicio.dumpCompleto('DEST', { ...dump, id: 'x' });
      assert.deepEqual(r, { clase: 'error', motivo: 'id del dump no reconocido' });
    });
    test('NOT_AUTHORIZED → motivo de autorización y registro por clase', async () => {
      const { servicio, registros } = montar({
        alConsultar: async (n) => {
          if (n === 3) {
            throw new ErrorDelPuente({ clase: 'abap', mensaje: 'NOT_AUTHORIZED' });
          }
        },
      });
      assert.deepEqual(await servicio.dumpCompleto('DEST', dump), { clase: 'error', motivo: 'sin autorización para leer SNAP en este sistema' });
      assert.ok(registros.includes('Monitor: SNAP → error abap'));
    });
    test('respuesta sin filas → el dump ya no está en SNAP', async () => {
      const respuestas = fixture.respuestas.map((r, i) => (i === 2 ? { ...r, filas: [] } : r));
      const r = await montar({ respuestas }).servicio.dumpCompleto('DEST', dump);
      assert.deepEqual(r, { clase: 'error', motivo: 'el dump ya no está en SNAP' });
    });
    test('tiempo global agotado', async () => {
      const inicio = Date.now();
      const { servicio } = montar({ tiempoMs: 20, alConsultar: (n) => (n === 4 ? new Promise<void>(() => undefined) : Promise.resolve()) });
      assert.deepEqual(await servicio.dumpCompleto('DEST', dump), { clase: 'error', motivo: 'tiempo agotado leyendo SNAP' });
      assert.ok(Date.now() - inicio < 1000);
    });
    test('dump incompleto → ok con completo.incompleto true', async () => {
      const respuestas = fixture.respuestas.map((r, i) =>
        i === 0 ? { ...r, filas: r.filas.map((f, j) => (j === r.filas.length - 1 ? [f[0], f[1].replace('%E', '%A')] : f)) } : r,
      );
      const r = await montar({ respuestas }).servicio.dumpCompleto('DEST', dump);
      assert.equal(r.clase, 'ok');
      assert.equal(r.clase === 'ok' && r.completo.incompleto, true);
    });
  });
});
