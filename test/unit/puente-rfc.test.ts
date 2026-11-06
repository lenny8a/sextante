import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import type { PiezasOficial } from '../../src/adt/puente-piezas';
import { ErrorDelPuente, PuenteRfc, type OpcionesPuente, type ProcesoHijo } from '../../src/adt/puente-rfc';
import type { ConsultaTabla } from '../../src/adt/tablas-legibles';
import type { PeticionAdt } from '../../src/adt/transporte';

type Mensaje = Record<string, unknown>;

const CONTRASENA = 'Cl4ve-Secreta!';
const DESTINO = 'DEST_RESERVADO';

class ProcesoFalso extends EventEmitter implements ProcesoHijo {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly recibidas: Mensaje[] = [];
  readonly lineasCrudas: string[] = [];
  matado = false;
  private resto = '';
  private readonly esperas: Array<(m: Mensaje) => void> = [];
  private readonly sinConsumir: Mensaje[] = [];

  constructor() {
    super();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (trozo: string) => this.leer(trozo));
  }

  siguiente(): Promise<Mensaje> {
    return new Promise((resolver) => {
      const sinLeer = this.sinConsumir.shift();
      if (sinLeer) {
        resolver(sinLeer);
      } else {
        this.esperas.push(resolver);
      }
    });
  }

  responder(objeto: Mensaje): void {
    this.stdout.write(`${JSON.stringify(objeto)}\n`);
  }

  salir(codigo: number | null): void {
    this.emit('exit', codigo);
  }

  kill(): void {
    this.matado = true;
    this.salir(null);
  }

  private leer(trozo: string): void {
    this.resto += trozo;
    let corte = this.resto.indexOf('\n');
    while (corte >= 0) {
      const linea = this.resto.slice(0, corte);
      this.resto = this.resto.slice(corte + 1);
      const mensaje = JSON.parse(linea) as Mensaje;
      this.lineasCrudas.push(linea);
      this.recibidas.push(mensaje);
      const espera = this.esperas.shift();
      if (espera) {
        espera(mensaje);
      } else {
        this.sinConsumir.push(mensaje);
      }
      corte = this.resto.indexOf('\n');
    }
  }
}

interface Entorno {
  puente: PuenteRfc;
  procesos: ProcesoFalso[];
  lanzamientos: Array<{ comando: string; args: string[] }>;
  registro: string[];
  carpetaLib: string;
  piezas: PiezasOficial;
}

let temporal: string | undefined;
let abiertos: PuenteRfc[] = [];

function crearEntorno(extra: Partial<OpcionesPuente> = {}): Entorno {
  assert.ok(temporal);
  const plugins = path.join(temporal, 'plugins');
  fs.mkdirSync(plugins, { recursive: true });
  const jarJco = path.join(plugins, 'com.sap.conn.jco_3.1.14.jar');
  fs.writeFileSync(jarJco, 'jar-de-prueba');
  const piezas: PiezasOficial = {
    java: path.join(temporal, 'jre', 'bin', 'java.exe'),
    jarJco,
    fragmentoNativo: path.join(plugins, 'com.sap.conn.jco.win32.x86_64_3.1.14.jar'),
    raiz: temporal,
  };
  const carpetaLib = path.join(temporal, 'almacen', 'lib');
  const procesos: ProcesoFalso[] = [];
  const lanzamientos: Array<{ comando: string; args: string[] }> = [];
  const registro: string[] = [];
  const puente = new PuenteRfc({
    piezas,
    carpetaLib,
    clasesPuente: path.join(temporal, 'out', 'puente-rfc'),
    lanzar: (comando, args) => {
      lanzamientos.push({ comando, args });
      const proceso = new ProcesoFalso();
      procesos.push(proceso);
      return proceso;
    },
    registrar: (m) => registro.push(m),
    ...extra,
  });
  abiertos.push(puente);
  return { puente, procesos, lanzamientos, registro, carpetaLib, piezas };
}

async function esperarProceso(entorno: Entorno, indice: number): Promise<ProcesoFalso> {
  for (let intento = 0; intento < 400 && entorno.procesos.length <= indice; intento++) {
    await new Promise((resolver) => setTimeout(resolver, 5));
  }
  const proceso = entorno.procesos[indice];
  assert.ok(proceso, `no se lanzó el proceso ${indice}`);
  return proceso;
}

/** Contesta el `preparar` del proceso `indice` y devuelve ese proceso. */
async function prepararListo(entorno: Entorno, indice = 0): Promise<ProcesoFalso> {
  const promesa = entorno.puente.preparar();
  const proceso = await esperarProceso(entorno, indice);
  const preparar = await proceso.siguiente();
  proceso.responder({ id: preparar.id, ok: true, versionJco: '3.1.14' });
  await promesa;
  return proceso;
}

async function logonListo(entorno: Entorno, proceso: ProcesoFalso): Promise<void> {
  const promesa = entorno.puente.logon(DESTINO, { ashost: 'host-oculto', sysnr: '10', client: '100' }, 'USUARIO', CONTRASENA);
  const logon = await proceso.siguiente();
  proceso.responder({ id: logon.id, ok: true, sistema: 'DEV', release: '758' });
  await promesa;
}

function obtener(ruta: string, extra: Partial<PeticionAdt> = {}): PeticionAdt {
  return { metodo: 'GET', ruta, cabeceras: {}, ...extra };
}

async function rechazoDelPuente(promesa: Promise<unknown>): Promise<ErrorDelPuente> {
  try {
    await promesa;
  } catch (error) {
    assert.ok(error instanceof ErrorDelPuente, `se esperaba ErrorDelPuente y llegó ${String(error)}`);
    return error;
  }
  assert.fail('la promesa debía rechazar');
}

suite('PuenteRfc (cliente del proceso Java)', () => {
  setup(() => {
    temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'puente-rfc-'));
  });

  teardown(() => {
    for (const puente of abiertos.splice(0)) {
      puente.cerrar();
    }
    abiertos = [];
    if (temporal) {
      fs.rmSync(temporal, { recursive: true, force: true });
      temporal = undefined;
    }
  });

  test('preparar copia el JAR con guion, lanza el java de la oficial, manda la línea esperada y resuelve con la respuesta', async () => {
    const entorno = crearEntorno();
    const promesa = entorno.puente.preparar();
    const otra = entorno.puente.preparar();
    const proceso = await esperarProceso(entorno, 0);
    const preparar = await proceso.siguiente();

    assert.deepEqual(preparar, {
      id: preparar.id, tipo: 'preparar', fragmentoJar: entorno.piezas.fragmentoNativo, carpetaLib: entorno.carpetaLib,
    });
    assert.equal(typeof preparar.id, 'number');
    const jarCopiado = path.join(entorno.carpetaLib, 'com.sap.conn.jco-3.1.14.jar');
    assert.equal(fs.readFileSync(jarCopiado, 'utf8'), 'jar-de-prueba');
    assert.deepEqual(entorno.lanzamientos, [{
      comando: entorno.piezas.java,
      args: [
        `-Djava.library.path=${entorno.carpetaLib}`,
        '-cp', `${path.join(temporal ?? '', 'out', 'puente-rfc')}${path.delimiter}${jarCopiado}`,
        'PuenteRfc',
      ],
    }]);

    proceso.responder({ id: preparar.id, ok: true, versionJco: '3.1.14' });
    await Promise.all([promesa, otra]);
    await entorno.puente.preparar();
    assert.equal(entorno.lanzamientos.length, 1, 'preparar es idempotente');
    assert.equal(proceso.recibidas.length, 1, 'solo una línea preparar');
  });

  test('dos peticiones concurrentes con respuestas en orden inverso resuelven cada una con la suya', async () => {
    const entorno = crearEntorno();
    const proceso = await prepararListo(entorno);
    await logonListo(entorno, proceso);

    const primera = entorno.puente.peticion(DESTINO, obtener('/sap/bc/adt/uno', { parametros: { a: '1 2', b: 'x&y' } }));
    const segunda = entorno.puente.peticion(DESTINO, {
      metodo: 'POST', ruta: '/sap/bc/adt/dos', cabeceras: { 'content-type': 'application/xml' }, cuerpo: '<ñ/>',
    });
    const lineaUno = await proceso.siguiente();
    const lineaDos = await proceso.siguiente();

    assert.deepEqual(lineaUno, {
      id: lineaUno.id, tipo: 'peticion', destino: DESTINO, metodo: 'GET', uri: '/sap/bc/adt/uno?a=1+2&b=x%26y', cabeceras: {}, cuerpo: '',
    });
    assert.deepEqual(lineaDos, {
      id: lineaDos.id, tipo: 'peticion', destino: DESTINO, metodo: 'POST', uri: '/sap/bc/adt/dos',
      cabeceras: { 'content-type': 'application/xml' }, cuerpo: Buffer.from('<ñ/>', 'utf8').toString('base64'),
    });

    proceso.responder({ id: lineaDos.id, estado: 201, razon: 'Created', cabeceras: { 'Content-Type': 'text/plain' }, cuerpo: Buffer.from('dos').toString('base64') });
    proceso.responder({ id: lineaUno.id, estado: 200, razon: 'OK', cabeceras: {}, cuerpo: Buffer.from('uno').toString('base64') });

    const [respuestaUno, respuestaDos] = await Promise.all([primera, segunda]);
    assert.equal(respuestaUno.estado, 200);
    assert.equal(respuestaUno.cuerpo.toString('utf8'), 'uno');
    assert.equal(respuestaDos.estado, 201);
    assert.equal(respuestaDos.razon, 'Created');
    assert.deepEqual(respuestaDos.cabeceras, { 'Content-Type': 'text/plain' });
    assert.equal(respuestaDos.cuerpo.toString('utf8'), 'dos');
  });

  test('un cuerpo de 1 MB en base64 que llega en muchos trozos se reconstruye íntegro', async () => {
    const entorno = crearEntorno();
    const proceso = await prepararListo(entorno);
    const promesa = entorno.puente.peticion(DESTINO, obtener('/sap/bc/adt/grande'));
    const linea = await proceso.siguiente();

    const datos = randomBytes(1024 * 1024);
    const texto = `${JSON.stringify({ id: linea.id, estado: 200, razon: 'OK', cabeceras: {}, cuerpo: datos.toString('base64') })}\n`;
    const bytes = Buffer.from(texto, 'utf8');
    for (let desde = 0; desde < bytes.length; desde += 7919) {
      proceso.stdout.write(bytes.subarray(desde, desde + 7919));
    }

    const respuesta = await promesa;
    assert.equal(respuesta.cuerpo.length, datos.length);
    assert.ok(respuesta.cuerpo.equals(datos));
  });

  test('una respuesta con texto UTF-8 partido entre trozos se decodifica bien', async () => {
    const entorno = crearEntorno();
    const proceso = await prepararListo(entorno);
    const promesa = entorno.puente.peticion(DESTINO, obtener('/sap/bc/adt/x'));
    const linea = await proceso.siguiente();
    const bytes = Buffer.from(`${JSON.stringify({ id: linea.id, estado: 200, razon: 'Ñandú', cabeceras: {}, cuerpo: '' })}\n`, 'utf8');
    const corte = bytes.indexOf(Buffer.from('Ñ', 'utf8')) + 1;
    proceso.stdout.write(bytes.subarray(0, corte));
    proceso.stdout.write(bytes.subarray(corte));
    assert.equal((await promesa).razon, 'Ñandú');
  });

  test('exit con peticiones pendientes las rechaza a ambas con clase proceso', async () => {
    const entorno = crearEntorno();
    const proceso = await prepararListo(entorno);
    const primera = rechazoDelPuente(entorno.puente.peticion(DESTINO, obtener('/a')));
    const segunda = rechazoDelPuente(entorno.puente.peticion(DESTINO, obtener('/b')));
    await proceso.siguiente();
    await proceso.siguiente();

    proceso.salir(1);

    for (const error of await Promise.all([primera, segunda])) {
      assert.equal(error.detalle.clase, 'proceso');
      assert.equal(error.detalle.mensaje, 'el puente terminó (código 1)');
    }
  });

  test('tras un exit inesperado el siguiente preparar rearranca y una petición de un destino ya abierto pide reabrir la sesión', async () => {
    const entorno = crearEntorno();
    const primero = await prepararListo(entorno);
    await logonListo(entorno, primero);
    primero.salir(null);

    const promesa = rechazoDelPuente(entorno.puente.peticion(DESTINO, obtener('/sap/bc/adt/x')));
    const segundo = await esperarProceso(entorno, 1);
    const preparar = await segundo.siguiente();
    assert.equal(preparar.tipo, 'preparar');
    segundo.responder({ id: preparar.id, ok: true, versionJco: '3.1.14' });

    const error = await promesa;
    assert.equal(error.detalle.clase, 'proceso');
    assert.match(error.detalle.mensaje, /vuelve a buscar/);
    assert.equal(entorno.lanzamientos.length, 2);
    assert.equal(segundo.recibidas.length, 1, 'no se manda la petición al proceso nuevo');

    await logonListo(entorno, segundo);
    const otra = entorno.puente.peticion(DESTINO, obtener('/sap/bc/adt/y'));
    const linea = await segundo.siguiente();
    segundo.responder({ id: linea.id, estado: 200, razon: 'OK', cabeceras: {}, cuerpo: '' });
    assert.equal((await otra).estado, 200);
  });

  test('una respuesta con error se convierte en ErrorDelPuente con su clase y mensaje', async () => {
    const entorno = crearEntorno();
    const proceso = await prepararListo(entorno);
    const promesa = rechazoDelPuente(entorno.puente.logon(DESTINO, { ashost: 'h' }, 'USUARIO', CONTRASENA));
    const logon = await proceso.siguiente();
    proceso.responder({ id: logon.id, error: { clase: 'logon', mensaje: 'Name or password is incorrect' } });

    const error = await promesa;
    assert.deepEqual(error.detalle, { clase: 'logon', mensaje: 'Name or password is incorrect' });
    assert.equal(error.message, 'Name or password is incorrect');
  });

  test('una respuesta sin id se registra por su forma y no rechaza ninguna pendiente', async () => {
    const entorno = crearEntorno();
    const proceso = await prepararListo(entorno);
    const promesa = entorno.puente.peticion(DESTINO, obtener('/a'));
    const linea = await proceso.siguiente();

    proceso.responder({ error: { clase: 'protocolo', mensaje: 'línea ilegible con datos' } });
    proceso.stdout.write('esto no es json\n');
    proceso.responder({ id: linea.id, estado: 204, razon: 'No Content', cabeceras: {}, cuerpo: '' });

    assert.equal((await promesa).estado, 204);
    assert.ok(entorno.registro.includes('puente: respuesta sin id (clase protocolo)'));
    assert.ok(entorno.registro.some((m) => m.startsWith('puente: línea ilegible')));
    assert.ok(!entorno.registro.some((m) => m.includes('datos') || m.includes('esto no es json')));
  });

  test('sin respuesta en el tiempo máximo rechaza con clase tiempo y la respuesta tardía se ignora', async () => {
    const entorno = crearEntorno({ tiempoMs: 30 });
    const proceso = await prepararListo(entorno);
    const promesa = rechazoDelPuente(entorno.puente.peticion(DESTINO, obtener('/lenta')));
    const linea = await proceso.siguiente();

    const error = await promesa;
    assert.deepEqual(error.detalle, { clase: 'tiempo', mensaje: 'sin respuesta en 30 ms' });

    proceso.responder({ id: linea.id, estado: 200, razon: 'OK', cabeceras: {}, cuerpo: '' });
    const siguiente = entorno.puente.peticion(DESTINO, obtener('/rapida'));
    const lineaSiguiente = await proceso.siguiente();
    proceso.responder({ id: lineaSiguiente.id, estado: 200, razon: 'OK', cabeceras: {}, cuerpo: '' });
    assert.equal((await siguiente).estado, 200);
  });

  test('una petición con tiempoMs propio agota su plazo con clase tiempo sin tocar el proceso ni las demás pendientes', async () => {
    const entorno = crearEntorno();
    const proceso = await prepararListo(entorno);
    await logonListo(entorno, proceso);
    const larga = entorno.puente.peticion(DESTINO, obtener('/larga'));
    const lineaLarga = await proceso.siguiente();
    const corta = rechazoDelPuente(entorno.puente.peticion(DESTINO, obtener('/corta', { tiempoMs: 30 })));
    const lineaCorta = await proceso.siguiente();
    assert.equal('tiempoMs' in lineaCorta, false, 'el plazo no viaja al proceso');

    assert.deepEqual((await corta).detalle, { clase: 'tiempo', mensaje: 'sin respuesta en 30 ms' });
    assert.equal(proceso.matado, false);
    assert.ok(entorno.registro.includes(`puente: #${String(lineaCorta.id)} sin respuesta en 30 ms`));

    proceso.responder({ id: lineaLarga.id, estado: 200, razon: 'OK', cabeceras: {}, cuerpo: '' });
    assert.equal((await larga).estado, 200);

    const otra = entorno.puente.peticion(DESTINO, obtener('/otra'));
    const lineaOtra = await proceso.siguiente();
    assert.equal(lineaOtra.tipo, 'peticion', 'el destino sigue abierto tras un tiempo agotado');
    proceso.responder({ id: lineaOtra.id, estado: 204, razon: 'No Content', cabeceras: {}, cuerpo: '' });
    assert.equal((await otra).estado, 204);
    assert.equal(entorno.lanzamientos.length, 1);
  });

  test('la contraseña solo viaja en la línea logon y nunca aparece en lo que se registra', async () => {
    const entorno = crearEntorno();
    const proceso = await prepararListo(entorno);
    const promesa = entorno.puente.logon(DESTINO, { ashost: 'host-oculto', sysnr: '10', client: '100', saprouter: '/H/router-oculto' }, 'USUARIO', CONTRASENA);
    const logon = await proceso.siguiente();
    assert.deepEqual(logon, {
      id: logon.id, tipo: 'logon', destino: DESTINO,
      conexion: { ashost: 'host-oculto', sysnr: '10', client: '100', saprouter: '/H/router-oculto' },
      usuario: 'USUARIO', contrasena: CONTRASENA,
    });
    proceso.responder({ id: logon.id, ok: true, sistema: 'DEV', release: '758' });
    assert.deepEqual(await promesa, { sistema: 'DEV', release: '758' });

    const fallo = rechazoDelPuente(entorno.puente.logon(DESTINO, { ashost: 'host-oculto' }, 'USUARIO', CONTRASENA));
    const otroLogon = await proceso.siguiente();
    proceso.responder({ id: otroLogon.id, error: { clase: 'logon', mensaje: 'clave incorrecta' } });
    await fallo;

    const peticion = entorno.puente.peticion(DESTINO, obtener('/sap/bc/adt/x', { parametros: { q: 'consulta-oculta' }, cabeceras: { authorization: 'cabecera-oculta' } }));
    const linea = await proceso.siguiente();
    proceso.responder({ id: linea.id, estado: 200, razon: 'OK', cabeceras: {}, cuerpo: '' });
    await peticion;
    entorno.puente.cerrar();

    assert.ok(entorno.registro.length > 0, 'el cliente registra algo');
    const lineaLogon = proceso.lineasCrudas.find((l) => l.includes('"logon"')) ?? '';
    for (const mensaje of entorno.registro) {
      for (const prohibido of [CONTRASENA, DESTINO, 'host-oculto', 'router-oculto', 'consulta-oculta', 'cabecera-oculta', 'USUARIO', lineaLogon]) {
        assert.ok(!mensaje.includes(prohibido), `registro con dato prohibido: ${mensaje}`);
      }
    }
    assert.equal(entorno.lanzamientos.flatMap((l) => l.args).some((a) => a.includes(CONTRASENA)), false);
  });

  test('olvidar manda la línea olvidar y el destino deja de recordarse', async () => {
    const entorno = crearEntorno();
    const proceso = await prepararListo(entorno);
    await logonListo(entorno, proceso);

    const promesa = entorno.puente.olvidar(DESTINO);
    const olvidar = await proceso.siguiente();
    assert.deepEqual(olvidar, { id: olvidar.id, tipo: 'olvidar', destino: DESTINO });
    proceso.responder({ id: olvidar.id, ok: true });
    await promesa;

    proceso.salir(0);
    const peticion = entorno.puente.peticion(DESTINO, obtener('/a'));
    const proceso2 = await prepararListo(entorno, 1);
    const linea = await proceso2.siguiente();
    assert.equal(linea.tipo, 'peticion', 'un destino olvidado no pide reabrir la sesión');
    proceso2.responder({ id: linea.id, error: { clase: 'protocolo', mensaje: 'falta logon' } });
    assert.equal((await rechazoDelPuente(peticion)).detalle.clase, 'protocolo');
  });

  test('cerrar manda salir, es seguro llamarlo dos veces y sin haber arrancado', async () => {
    const sinArrancar = crearEntorno();
    sinArrancar.puente.cerrar();
    sinArrancar.puente.cerrar();
    assert.equal(sinArrancar.lanzamientos.length, 0);

    const entorno = crearEntorno();
    const proceso = await prepararListo(entorno);
    const pendiente = rechazoDelPuente(entorno.puente.peticion(DESTINO, obtener('/a')));
    await proceso.siguiente();
    entorno.puente.cerrar();
    const salir = await proceso.siguiente();
    assert.equal(salir.tipo, 'salir');
    assert.equal((await pendiente).detalle.clase, 'proceso');
    proceso.salir(0);
    entorno.puente.cerrar();
    assert.equal(proceso.matado, false);
  });

  test('cerrar mata el proceso si no termina en 2 s', async function (this: Mocha.Context) {
    this.timeout(5_000);
    const entorno = crearEntorno();
    const proceso = await prepararListo(entorno);
    entorno.puente.cerrar();
    assert.equal((await proceso.siguiente()).tipo, 'salir');
    assert.equal(proceso.matado, false);
    await new Promise((resolver) => setTimeout(resolver, 2_200));
    assert.equal(proceso.matado, true);
  });

  suite('tabla', () => {
    const CONSULTA: ConsultaTabla = { tabla: 'SNAP', campos: ['SEQNO', 'FLIST'], condiciones: ["DATUM EQ '20261103'"] };

    test('tabla: envía el mensaje y devuelve columnas y filas', async () => {
      const entorno = crearEntorno();
      const proceso = await prepararListo(entorno);
      await logonListo(entorno, proceso);

      const promesa = entorno.puente.tabla(DESTINO, CONSULTA, 5000);
      const linea = await proceso.siguiente();
      assert.deepEqual(linea, {
        id: linea.id, tipo: 'tabla', destino: DESTINO, tabla: 'SNAP', campos: ['SEQNO', 'FLIST'],
        condiciones: ["DATUM EQ '20261103'"], filasMax: 0,
      });
      const resultado = { columnas: [{ nombre: 'SEQNO', longitud: 3 }], filas: [['000', 'FC004ABCD']] };
      proceso.responder({ id: linea.id, ...resultado });
      assert.deepEqual(await promesa, resultado);
    });

    test('tabla: consulta inválida se rechaza sin tocar el proceso', async () => {
      const entorno = crearEntorno();
      const proceso = await prepararListo(entorno);
      await logonListo(entorno, proceso);
      const antes = proceso.recibidas.length;

      const error = await rechazoDelPuente(entorno.puente.tabla(DESTINO, { ...CONSULTA, campos: [] }));
      assert.equal(error.detalle.clase, 'protocolo');
      assert.equal(error.detalle.mensaje, 'sin campos');
      assert.equal(proceso.recibidas.length, antes);
    });

    test('tabla: respuesta mal formada → protocolo', async () => {
      const entorno = crearEntorno();
      const proceso = await prepararListo(entorno);
      await logonListo(entorno, proceso);

      const promesa = rechazoDelPuente(entorno.puente.tabla(DESTINO, CONSULTA));
      const linea = await proceso.siguiente();
      proceso.responder({ id: linea.id, columnas: [], filas: [['a', 1]] });
      const error = await promesa;
      assert.equal(error.detalle.clase, 'protocolo');
    });

    test('tabla: error abap llega con su clase', async () => {
      const entorno = crearEntorno();
      const proceso = await prepararListo(entorno);
      await logonListo(entorno, proceso);

      const promesa = rechazoDelPuente(entorno.puente.tabla(DESTINO, CONSULTA));
      const linea = await proceso.siguiente();
      proceso.responder({ id: linea.id, error: { clase: 'abap', mensaje: 'NOT_AUTHORIZED' } });
      const error = await promesa;
      assert.deepEqual(error.detalle, { clase: 'abap', mensaje: 'NOT_AUTHORIZED' });
    });
  });
});
