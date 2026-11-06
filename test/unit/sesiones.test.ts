import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buscar, RUTA_BUSQUEDA } from '../../src/adt/busqueda-cliente';
import { ConexionAdt, ErrorAdt } from '../../src/adt/conexion-adt';
import { TransporteHttp } from '../../src/adt/transporte-http';
import { AlmacenSecretos, Credenciales, PREFIJO_SECRETO } from '../../src/adt/credenciales';
import { ErrorDelPuente, type ConexionRfc, type ErrorPuente, type RespuestaPuente } from '../../src/adt/puente-rfc';
import {
  esNoAutorizado,
  SesionesAdt,
  type PuenteSesiones,
  type ResultadoSesion,
  VENTANA_SILENCIOSA_MS,
} from '../../src/adt/sesiones';
import type { PeticionAdt } from '../../src/adt/transporte';
import { RUTA_DATA_PREVIEW } from '../../src/adt/transaccion';
import { ErrorSoloLectura } from '../../src/adt/transporte-rfc';
import type { Destino } from '../../src/config/destinos';
import type { RolSistema } from '../../src/config/navegador-config';

const ID = 'DEST';
const USUARIO = 'USUARIO';
const CANDIDATO_HTTPS = 'https://servidor:44300';
const CANDIDATO_HTTP = 'http://servidor:8000';
const AUTORIZACION_VACIA = `Basic ${Buffer.from(':').toString('base64')}`;

type RespuestaServidor = number | 'caido' | { estado: number; cuerpo: string };
type Servidor = (url: URL, credencial: string | undefined) => RespuestaServidor;

interface PeticionVista { url: URL; credencial: string | undefined; accept: string | null }

function destinoDePrueba(parcial: Partial<Destino> = {}): Destino {
  return {
    id: ID,
    protocolo: 'RFC',
    mandante: '100',
    idioma: 'ES',
    usuario: USUARIO,
    servidorAplicacion: 'servidor',
    numeroSistema: '00',
    ssoActivado: false,
    ...parcial,
  };
}

function credencialDe(cabeceras: Headers): string | undefined {
  const autorizacion = cabeceras.get('authorization');
  if (!autorizacion || autorizacion === AUTORIZACION_VACIA) {
    return undefined;
  }
  return Buffer.from(autorizacion.slice('Basic '.length), 'base64').toString();
}

function crearFetch(servidor: Servidor): { fetchFn: typeof fetch; peticiones: PeticionVista[] } {
  const peticiones: PeticionVista[] = [];
  const fetchFn = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = new URL(String(entrada));
    const cabeceras = new Headers(init?.headers);
    const credencial = credencialDe(cabeceras);
    peticiones.push({ url, credencial, accept: cabeceras.get('accept') });
    const respuesta = servidor(url, credencial);
    if (respuesta === 'caido') {
      throw new TypeError('fetch failed');
    }
    const { estado, cuerpo } = typeof respuesta === 'number' ? { estado: respuesta, cuerpo: '' } : respuesta;
    return new Response(cuerpo, { status: estado, headers: { 'x-csrf-token': 'token' } });
  }) as typeof fetch;
  return { fetchFn, peticiones };
}

interface LogonVisto { destino: string; conexion: ConexionRfc; usuario: string; contrasena: string }

interface PuenteFalso extends PuenteSesiones {
  logons: LogonVisto[];
  preparados: number;
  peticiones: PeticionAdt[];
}

interface OpcionesPuente {
  motivoNoDisponible?: string;
  errores?: Array<ErrorPuente | undefined>;
  erroresPeticion?: Array<ErrorPuente | undefined>;
}

/** Puente sin proceso Java: `errores` se consume en orden, uno por logon (`undefined` = logon correcto); `erroresPeticion`, uno por petición. */
function crearPuente(opciones: OpcionesPuente = {}): PuenteFalso {
  const errores = [...(opciones.errores ?? [])];
  const erroresPeticion = [...(opciones.erroresPeticion ?? [])];
  const puente: PuenteFalso = {
    logons: [],
    preparados: 0,
    peticiones: [],
    disponible: () => (opciones.motivoNoDisponible === undefined
      ? { ok: true }
      : { ok: false, motivo: opciones.motivoNoDisponible }),
    preparar: async () => {
      puente.preparados += 1;
    },
    logon: async (destino, conexion, usuario, contrasena) => {
      puente.logons.push({ destino, conexion, usuario, contrasena });
      const error = errores.shift();
      if (error) {
        throw new ErrorDelPuente(error);
      }
      return { sistema: 'DEV', release: '758' };
    },
    peticion: async (_destino, p): Promise<RespuestaPuente> => {
      puente.peticiones.push(p);
      const error = erroresPeticion.shift();
      if (error) {
        throw new ErrorDelPuente(error);
      }
      return { estado: 200, razon: 'OK', cabeceras: { 'content-type': 'application/xml' }, cuerpo: Buffer.from('<x/>') };
    },
    olvidar: async () => undefined,
  };
  return puente;
}

class AlmacenEnMemoria implements AlmacenSecretos {
  readonly valores = new Map<string, string>();
  borrados = 0;

  async get(k: string): Promise<string | undefined> { return this.valores.get(k); }
  async store(k: string, v: string): Promise<void> { this.valores.set(k, v); }
  async delete(k: string): Promise<void> {
    this.borrados += 1;
    this.valores.delete(k);
  }
}

interface OpcionesEntorno {
  servidor: Servidor;
  destino?: Destino | null;
  urlGuardada?: string;
  contrasenas?: Array<string | undefined>;
  confirmarInseguro?: boolean;
  puente?: PuenteSesiones;
  rol?: RolSistema;
  reloj?: { ahora: number };
}

function crearEntorno(opciones: OpcionesEntorno) {
  const { fetchFn, peticiones } = crearFetch(opciones.servidor);
  const almacen = new AlmacenEnMemoria();
  const guardadas = new Map<string, string>();
  if (opciones.urlGuardada) { guardadas.set(ID, opciones.urlGuardada); }
  const contrasenas = [...(opciones.contrasenas ?? ['buena'])];
  const contador = { contrasenasPedidas: 0, urlGuardadas: 0, httpConfirmado: 0 };
  const registro: string[] = [];
  const credenciales = new Credenciales(almacen, async () => {
    contador.contrasenasPedidas += 1;
    return contrasenas.shift();
  });
  const destino = opciones.destino === null ? undefined : opciones.destino ?? destinoDePrueba();
  const confirmados: Array<[string, string]> = [];
  const confirmarInseguro = opciones.confirmarInseguro === undefined
    ? undefined
    : async (url: string, destino: string): Promise<boolean> => {
      contador.httpConfirmado += 1;
      confirmados.push([url, destino]);
      return opciones.confirmarInseguro ?? false;
    };
  const sesiones = new SesionesAdt({
    destinoDe: (id) => (id === ID ? destino : undefined),
    urlDe: (id) => guardadas.get(id),
    guardarUrl: async (id, url) => {
      contador.urlGuardadas += 1;
      guardadas.set(id, url);
    },
    confirmarInseguro,
    credenciales,
    fetchFn,
    registrar: (m) => registro.push(m),
    puente: opciones.puente,
    rolDe: (id) => (id === ID ? opciones.rol : undefined),
    ...(opciones.reloj ? { ahora: () => opciones.reloj?.ahora ?? 0 } : {}),
  });
  const avisosVia: string[] = [];
  sesiones.alCambiarVia((id) => avisosVia.push(id));
  return { sesiones, peticiones, almacen, guardadas, contador, registro, confirmados, avisosVia };
}

const aceptaBuena: Servidor = (_url, credencial) => (credencial === `${USUARIO}:buena` ? 200 : 401);

function conexionDe(resultado: ResultadoSesion): ConexionAdt {
  assert.equal(resultado.estado, 'ok', `se esperaba ok y llegó ${JSON.stringify(resultado)}`);
  return (resultado as { conexion: ConexionAdt }).conexion;
}

suite('SesionesAdt', () => {
  test('usa la URL guardada sin deducir', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: 'https://guardada:1234' });
    conexionDe(await entorno.sesiones.sesion(ID));
    assert.ok(entorno.peticiones.length > 0);
    assert.ok(entorno.peticiones.every((p) => p.url.origin === 'https://guardada:1234'));
    assert.ok(entorno.peticiones.every((p) => p.url.searchParams.get('sap-client') === '100'));
    assert.equal(entorno.contador.urlGuardadas, 0);
    assert.equal(entorno.contador.httpConfirmado, 0);
  });

  test('deduce y guarda la primera URL que responde, aunque sea con 401', async () => {
    const entorno = crearEntorno({
      confirmarInseguro: true,
      servidor: (url, credencial) => {
        if (url.origin === CANDIDATO_HTTPS) { return 'caido'; }
        return credencial === undefined ? 401 : aceptaBuena(url, credencial);
      },
    });
    conexionDe(await entorno.sesiones.sesion(ID));
    assert.equal(entorno.guardadas.get(ID), CANDIDATO_HTTP);
    const sondeos = entorno.peticiones.filter((p) => p.credencial === undefined);
    assert.deepEqual(sondeos.map((p) => p.url.origin), [CANDIDATO_HTTPS, CANDIDATO_HTTP]);
  });

  test('origen http con confirmación aceptada → procede a autenticar', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTP, confirmarInseguro: true });
    conexionDe(await entorno.sesiones.sesion(ID));
    assert.equal(entorno.contador.httpConfirmado, 1);
    assert.deepEqual(entorno.confirmados, [[CANDIDATO_HTTP, ID]]);
    assert.ok(entorno.peticiones.some((p) => p.credencial === `${USUARIO}:buena`));
  });

  test('ningún candidato responde → sinRest sinVia sin preguntar nada ni pedir contraseña', async () => {
    const entorno = crearEntorno({ servidor: () => 'caido' });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'sinRest', motivo: 'sinVia' });
    assert.equal(entorno.contador.contrasenasPedidas, 0);
    assert.equal(entorno.contador.httpConfirmado, 0);
    assert.equal(entorno.guardadas.size, 0);
    assert.ok(entorno.peticiones.every((p) => p.credencial === undefined));
    assert.ok(entorno.registro.includes('Sesión ADT: ningún candidato respondió (2); se usa la búsqueda oficial'));
  });

  test('solo responde el candidato http y no se confirma → se registra y sinRest sinVia sin enviar credenciales', async () => {
    const entorno = crearEntorno({
      confirmarInseguro: false,
      servidor: (url) => (url.origin === CANDIDATO_HTTPS ? 'caido' : 401),
    });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'sinRest', motivo: 'sinVia' });
    assert.deepEqual(entorno.confirmados, [[CANDIDATO_HTTP, ID]]);
    assert.equal(entorno.contador.contrasenasPedidas, 0);
    assert.equal(entorno.guardadas.size, 0);
    assert.ok(entorno.peticiones.every((p) => p.credencial === undefined));
    assert.ok(entorno.registro.includes('Sesión ADT: origen http sin confirmar; no se envían credenciales'));
  });

  test('solo responde el candidato http y no hay confirmación disponible → sinRest sinVia sin guardar la URL', async () => {
    const entorno = crearEntorno({ servidor: (url) => (url.origin === CANDIDATO_HTTPS ? 'caido' : 401) });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'sinRest', motivo: 'sinVia' });
    assert.equal(entorno.contador.contrasenasPedidas, 0);
    assert.equal(entorno.guardadas.size, 0);
  });

  test('origen http guardado con confirmación rechazada → sinRest sinVia sin enviar credenciales', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTP, confirmarInseguro: false });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'sinRest', motivo: 'sinVia' });
    assert.equal(entorno.contador.httpConfirmado, 1);
    assert.equal(entorno.contador.contrasenasPedidas, 0);
    assert.ok(entorno.peticiones.every((p) => p.credencial === undefined));
  });

  test('origen http guardado sin confirmación disponible → sinRest sinVia sin enviar credenciales', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTP });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'sinRest', motivo: 'sinVia' });
    assert.equal(entorno.contador.contrasenasPedidas, 0);
    assert.ok(entorno.peticiones.every((p) => p.credencial === undefined));
  });

  test('401 → olvida, pide otra contraseña una vez y queda ok', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS, contrasenas: ['mala', 'buena'] });
    conexionDe(await entorno.sesiones.sesion(ID));
    assert.equal(entorno.contador.contrasenasPedidas, 2);
    assert.equal(entorno.almacen.borrados, 1);
    assert.equal(entorno.almacen.valores.get(`${PREFIJO_SECRETO}${ID}`), 'buena');
  });

  test('dos 401 → noAutorizado y olvidar llamado dos veces', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS, contrasenas: ['mala', 'peor', 'buena'] });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'noAutorizado' });
    assert.equal(entorno.contador.contrasenasPedidas, 2);
    assert.equal(entorno.almacen.borrados, 2);
    assert.equal(entorno.almacen.valores.size, 0);
  });

  test('contraseña cancelada → sinContrasena', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS, contrasenas: [undefined] });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'sinContrasena' });
    assert.equal(entorno.peticiones.length, 0);
  });

  test('SSO → sinRest sin tocar fetch ni pedir nada', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, destino: destinoDePrueba({ ssoActivado: true }) });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'sinRest', motivo: 'sso' });
    assert.equal(entorno.peticiones.length, 0);
    assert.equal(entorno.contador.contrasenasPedidas, 0);
  });

  test('destino ausente → error', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, destino: null });
    const resultado = await entorno.sesiones.sesion(ID);
    assert.equal(resultado.estado, 'error');
    assert.equal(entorno.peticiones.length, 0);
  });

  test('destino sin usuario → error sin tocar fetch', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, destino: destinoDePrueba({ usuario: undefined }) });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'error', mensaje: 'El destino no tiene usuario' });
    assert.equal(entorno.peticiones.length, 0);
  });

  test('otro estado HTTP → error con estado y ruta, sin cuerpo ni contraseña', async () => {
    const entorno = crearEntorno({
      servidor: () => ({ estado: 500, cuerpo: 'DATOS_DE_NEGOCIO' }),
      urlGuardada: CANDIDATO_HTTPS,
    });
    const resultado = await entorno.sesiones.sesion(ID);
    assert.equal(resultado.estado, 'error');
    const { mensaje } = resultado as { mensaje: string };
    assert.match(mensaje, /500/);
    assert.match(mensaje, /\/sap\/bc\/adt\/discovery/);
    assert.doesNotMatch(mensaje, /DATOS_DE_NEGOCIO|buena/);
  });

  test('la segunda llamada usa la caché y no vuelve a pedir nada', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena });
    const primera = conexionDe(await entorno.sesiones.sesion(ID));
    const peticiones = entorno.peticiones.length;
    const segunda = conexionDe(await entorno.sesiones.sesion(ID));
    assert.equal(segunda, primera);
    assert.equal(entorno.peticiones.length, peticiones);
    assert.equal(entorno.contador.contrasenasPedidas, 1);
    assert.equal(entorno.contador.urlGuardadas, 1);
  });

  test('llamadas simultáneas comparten una sola petición de contraseña', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS });
    const [a, b] = await Promise.all([entorno.sesiones.sesion(ID), entorno.sesiones.sesion(ID)]);
    assert.equal(conexionDe(a), conexionDe(b));
    assert.equal(entorno.contador.contrasenasPedidas, 1);
  });

  test('un resultado fallido no se cachea', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS, contrasenas: [undefined, 'buena'] });
    assert.equal((await entorno.sesiones.sesion(ID)).estado, 'sinContrasena');
    conexionDe(await entorno.sesiones.sesion(ID));
  });

  test('invalidar descarta la conexión cacheada', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS });
    const primera = conexionDe(await entorno.sesiones.sesion(ID));
    entorno.sesiones.invalidar(ID);
    const segunda = conexionDe(await entorno.sesiones.sesion(ID));
    assert.notEqual(segunda, primera);
    assert.equal(entorno.contador.contrasenasPedidas, 1);
  });

  test('esNoAutorizado solo reconoce un ErrorAdt 401', () => {
    assert.equal(esNoAutorizado(new ErrorAdt('x', 401, '/r')), true);
    assert.equal(esNoAutorizado(new ErrorAdt('x', 403, '/r')), false);
    assert.equal(esNoAutorizado(new Error('401')), false);
  });

  test('el registro nunca contiene la contraseña ni el id del destino', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, contrasenas: ['mala', 'buena'] });
    conexionDe(await entorno.sesiones.sesion(ID));
    assert.ok(entorno.registro.length > 0);
    for (const linea of entorno.registro) {
      assert.doesNotMatch(linea, /mala|buena|DEST/);
    }
  });
});

suite('SesionesAdt por RFC', () => {
  const ERROR_LOGON: ErrorPuente = { clase: 'logon', mensaje: 'Name or password is incorrect' };
  const nadaPorHttp: Servidor = () => {
    throw new Error('no debía llamarse a fetch');
  };

  function destinoRfc(parcial: Partial<Destino> = {}): Destino {
    return destinoDePrueba({ protocolo: 'rfc', ...parcial });
  }

  function viaDeResultado(resultado: ResultadoSesion): string | undefined {
    return resultado.estado === 'ok' ? resultado.via : undefined;
  }

  test('destino rfc con puente disponible → ok vía rfc, logon con usuario y contraseña y sin fetch', async () => {
    const puente = crearPuente();
    const entorno = crearEntorno({
      servidor: nadaPorHttp,
      destino: destinoRfc({ rutaRouter: '/H/router', systemId: 'DEV' }),
      puente,
    });
    const resultado = await entorno.sesiones.sesion(ID);
    assert.equal(resultado.estado, 'ok');
    assert.equal(viaDeResultado(resultado), 'rfc');
    assert.deepEqual(resultado.estado === 'ok' ? resultado.sistema : undefined, { id: 'DEV', release: '758' });
    assert.equal(entorno.peticiones.length, 0);
    assert.equal(puente.preparados, 1);
    assert.deepEqual(puente.logons, [{
      destino: ID,
      conexion: { ashost: 'servidor', sysnr: '00', client: '100', lang: 'ES', saprouter: '/H/router', sysid: 'DEV' },
      usuario: USUARIO,
      contrasena: 'buena',
    }]);
    assert.equal(entorno.contador.contrasenasPedidas, 1);
    await conexionDe(resultado).get('/sap/bc/adt/ejemplo');
    assert.deepEqual(puente.peticiones.map((p) => [p.metodo, p.ruta]), [['GET', '/sap/bc/adt/ejemplo']]);
    assert.ok(entorno.registro.includes('Sesión ADT: vía RFC (puente disponible)'));
    assert.ok(entorno.registro.includes('Sesión ADT RFC abierta (intento 1)'));
  });

  test('logon rechazado una vez → olvida la contraseña una vez y el segundo logon abre la sesión', async () => {
    const puente = crearPuente({ errores: [ERROR_LOGON] });
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoRfc(), puente, contrasenas: ['mala', 'buena'] });
    const resultado = await entorno.sesiones.sesion(ID);
    assert.equal(viaDeResultado(resultado), 'rfc');
    assert.equal(entorno.almacen.borrados, 1);
    assert.deepEqual(puente.logons.map((l) => l.contrasena), ['mala', 'buena']);
    assert.equal(entorno.contador.contrasenasPedidas, 2);
    assert.ok(entorno.registro.includes('Sesión ADT RFC: logon rechazado en el intento 1; se olvida la contraseña'));
    assert.ok(entorno.registro.includes('Sesión ADT RFC abierta (intento 2)'));
    for (const linea of entorno.registro) {
      assert.doesNotMatch(linea, /mala|buena|DEST|incorrect/);
    }
  });

  test('dos logon rechazados → noAutorizado y la contraseña olvidada dos veces', async () => {
    const puente = crearPuente({ errores: [ERROR_LOGON, ERROR_LOGON] });
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoRfc(), puente, contrasenas: ['mala', 'peor'] });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'noAutorizado' });
    assert.equal(entorno.almacen.borrados, 2);
    assert.equal(puente.logons.length, 2);
  });

  test('error de comunicación del puente → error con el mensaje para el usuario; el registro solo lleva la clase', async () => {
    const puente = crearPuente({ errores: [{ clase: 'comunicacion', mensaje: 'partner servidor not reached' }] });
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoRfc(), puente });
    const resultado = await entorno.sesiones.sesion(ID);
    assert.equal(resultado.estado, 'error');
    assert.match(resultado.estado === 'error' ? resultado.mensaje : '', /partner servidor not reached/);
    assert.equal(entorno.almacen.borrados, 0);
    assert.equal(puente.logons.length, 1);
    assert.ok(entorno.registro.includes('Sesión ADT RFC: error comunicacion'));
    for (const linea of entorno.registro) {
      assert.doesNotMatch(linea, /partner|servidor/);
    }
  });

  test('contraseña cancelada → sinContrasena sin logon', async () => {
    const puente = crearPuente();
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoRfc(), puente, contrasenas: [undefined] });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'sinContrasena' });
    assert.equal(puente.logons.length, 0);
  });

  test('puente no disponible → registra el motivo y sigue por HTTP con la URL deducida', async () => {
    const puente = crearPuente({ motivoNoDisponible: 'falta Java' });
    const entorno = crearEntorno({ servidor: aceptaBuena, destino: destinoRfc(), puente });
    const resultado = await entorno.sesiones.sesion(ID);
    assert.equal(viaDeResultado(resultado), 'http');
    assert.ok(entorno.peticiones.length > 0);
    assert.equal(entorno.peticiones[0].url.origin, CANDIDATO_HTTPS);
    assert.equal(puente.logons.length, 0);
    assert.ok(entorno.registro.includes('Sesión ADT: puente RFC no disponible (falta Java); se sigue por HTTP'));
  });

  test('destino rfc sin puente y URL guardada que responde → vía http sin preguntar nada', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, destino: destinoRfc(), urlGuardada: CANDIDATO_HTTPS });
    assert.equal(viaDeResultado(await entorno.sesiones.sesion(ID)), 'http');
    assert.ok(entorno.peticiones.every((p) => p.url.origin === CANDIDATO_HTTPS));
    assert.equal(entorno.contador.contrasenasPedidas, 1);
    assert.equal(entorno.contador.httpConfirmado, 0);
    assert.equal(entorno.contador.urlGuardadas, 0);
  });

  test('destino rfc sin puente, sin URL y ningún candidato responde → sinRest sinVia sin pedir contraseña', async () => {
    const entorno = crearEntorno({ servidor: () => 'caido', destino: destinoRfc() });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'sinRest', motivo: 'sinVia' });
    assert.equal(entorno.contador.contrasenasPedidas, 0);
    assert.equal(entorno.guardadas.size, 0);
  });

  test('destino rfc con SSO → sinRest sso sin logon ni contraseña', async () => {
    const puente = crearPuente();
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoRfc({ ssoActivado: true }), puente });
    assert.deepEqual(await entorno.sesiones.sesion(ID), { estado: 'sinRest', motivo: 'sso' });
    assert.equal(puente.logons.length, 0);
    assert.equal(entorno.contador.contrasenasPedidas, 0);
  });

  test('destino rfc sin servidor de aplicación → error sin pedir contraseña', async () => {
    const puente = crearPuente();
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoRfc({ servidorAplicacion: undefined }), puente });
    assert.deepEqual(await entorno.sesiones.sesion(ID), {
      estado: 'error',
      mensaje: 'El destino no tiene servidor de aplicación',
    });
    assert.equal(entorno.contador.contrasenasPedidas, 0);
  });

  test('rol PRD → la conexión rechaza post con ErrorSoloLectura sin llegar al puente', async () => {
    const puente = crearPuente();
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoRfc(), puente, rol: 'PRD' });
    const conexion = conexionDe(await entorno.sesiones.sesion(ID));
    await assert.rejects(conexion.post('/sap/bc/adt/oo/classes/x', '<x/>', 'application/xml'), ErrorSoloLectura);
    assert.equal(puente.peticiones.length, 0);
    await conexion.post(RUTA_DATA_PREVIEW, 'SELECT 1', 'text/plain');
    assert.equal(puente.peticiones.length, 1);
  });

  test('rol marcado PRD después de abrir la sesión → el post siguiente se rechaza sin llegar al puente', async () => {
    const puente = crearPuente();
    const opciones: OpcionesEntorno = { servidor: nadaPorHttp, destino: destinoRfc(), puente };
    const entorno = crearEntorno(opciones);
    const conexion = conexionDe(await entorno.sesiones.sesion(ID));
    await conexion.post('/sap/bc/adt/ejemplo', '<x/>', 'application/xml');
    opciones.rol = 'PRD';
    await assert.rejects(conexion.post('/sap/bc/adt/ejemplo', '<x/>', 'application/xml'), ErrorSoloLectura);
    assert.deepEqual(puente.peticiones.map((p) => p.metodo), ['POST']);
  });

  test('puente reiniciado (error proceso en una petición) → la petición falla y la siguiente sesión repite el logon sin pedir contraseña', async () => {
    const puente = crearPuente({ erroresPeticion: [{ clase: 'proceso', mensaje: 'el puente RFC se reinició' }] });
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoRfc(), puente });
    const conexion = conexionDe(await entorno.sesiones.sesion(ID));
    await assert.rejects(
      conexion.get('/sap/bc/adt/ejemplo'),
      (e: unknown) => e instanceof ErrorAdt && e.estado === 0 && !esNoAutorizado(e),
    );
    const segunda = await entorno.sesiones.sesion(ID);
    assert.equal(viaDeResultado(segunda), 'rfc');
    assert.equal(puente.logons.length, 2);
    assert.deepEqual(puente.logons.map((l) => l.contrasena), ['buena', 'buena']);
    assert.equal(entorno.contador.contrasenasPedidas, 1);
    await conexionDe(segunda).get('/sap/bc/adt/ejemplo');
    assert.equal(puente.peticiones.length, 2);
  });

  test('error del puente que no es de proceso → la sesión se conserva sin nuevo logon', async () => {
    const puente = crearPuente({ erroresPeticion: [{ clase: 'comunicacion', mensaje: 'timeout' }] });
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoRfc(), puente });
    const primera = await entorno.sesiones.sesion(ID);
    await assert.rejects(conexionDe(primera).get('/sap/bc/adt/ejemplo'), ErrorAdt);
    assert.equal(await entorno.sesiones.sesion(ID), primera);
    assert.equal(puente.logons.length, 1);
  });

  test('sin rol → la conexión deja hacer post', async () => {
    const puente = crearPuente();
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoRfc(), puente });
    const conexion = conexionDe(await entorno.sesiones.sesion(ID));
    await conexion.post('/sap/bc/adt/ejemplo', '<x/>', 'application/xml');
    assert.deepEqual(puente.peticiones.map((p) => p.metodo), ['POST']);
  });
});

suite('SesionesAdt: vía resuelta', () => {
  const nadaPorHttp: Servidor = () => {
    throw new Error('no debía llamarse a fetch');
  };

  test('RFC con puente → viaDe rfc y un aviso con el id', async () => {
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoDePrueba({ protocolo: 'rfc' }), puente: crearPuente() });
    assert.equal(entorno.sesiones.viaDe(ID), undefined);
    conexionDe(await entorno.sesiones.sesion(ID));
    assert.equal(entorno.sesiones.viaDe(ID), 'rfc');
    assert.deepEqual(entorno.avisosVia, [ID]);
  });

  test('HTTP con URL guardada → viaDe http y un aviso con el id', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, destino: destinoDePrueba({ protocolo: 'rfc' }), urlGuardada: CANDIDATO_HTTPS });
    conexionDe(await entorno.sesiones.sesion(ID));
    assert.equal(entorno.sesiones.viaDe(ID), 'http');
    assert.deepEqual(entorno.avisosVia, [ID]);
  });

  test('sin vía → viaDe oficial y un aviso con el id', async () => {
    const entorno = crearEntorno({ servidor: () => 'caido', destino: destinoDePrueba({ protocolo: 'rfc' }) });
    assert.equal((await entorno.sesiones.sesion(ID)).estado, 'sinRest');
    assert.equal(entorno.sesiones.viaDe(ID), 'oficial');
    assert.deepEqual(entorno.avisosVia, [ID]);
  });

  test('SSO → viaDe oficial', async () => {
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoDePrueba({ ssoActivado: true }) });
    await entorno.sesiones.sesion(ID);
    assert.equal(entorno.sesiones.viaDe(ID), 'oficial');
    assert.deepEqual(entorno.avisosVia, [ID]);
  });

  test('la sesión cacheada no vuelve a avisar', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS });
    await entorno.sesiones.sesion(ID);
    await entorno.sesiones.sesion(ID);
    assert.deepEqual(entorno.avisosVia, [ID]);
  });

  test('contraseña cancelada no resuelve la vía ni avisa', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS, contrasenas: [undefined] });
    assert.equal((await entorno.sesiones.sesion(ID)).estado, 'sinContrasena');
    assert.equal(entorno.sesiones.viaDe(ID), undefined);
    assert.deepEqual(entorno.avisosVia, []);
  });

  test('sin vía se recuerda en la ventana: la segunda búsqueda no vuelve a confirmar ni a sondear', async () => {
    const entorno = crearEntorno({
      confirmarInseguro: false,
      servidor: (url) => (url.origin === CANDIDATO_HTTPS ? 'caido' : 401),
    });
    const primera = await entorno.sesiones.sesion(ID);
    assert.deepEqual(primera, { estado: 'sinRest', motivo: 'sinVia' });
    const peticiones = entorno.peticiones.length;
    assert.equal(await entorno.sesiones.sesion(ID), primera);
    assert.equal(entorno.contador.httpConfirmado, 1);
    assert.equal(entorno.peticiones.length, peticiones);
    assert.deepEqual(entorno.avisosVia, [ID]);
  });

  test('sin respuesta de ningún candidato se sondea una sola vez en la ventana', async () => {
    const entorno = crearEntorno({ servidor: () => 'caido' });
    await entorno.sesiones.sesion(ID);
    await entorno.sesiones.sesion(ID);
    assert.deepEqual(entorno.peticiones.map((p) => p.url.origin), [CANDIDATO_HTTPS, CANDIDATO_HTTP]);
  });

  test('SSO se recuerda igual que sin vía', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, destino: destinoDePrueba({ ssoActivado: true }) });
    const primera = await entorno.sesiones.sesion(ID);
    assert.equal(await entorno.sesiones.sesion(ID), primera);
    assert.deepEqual(entorno.avisosVia, [ID]);
  });

  test('invalidar olvida la vía, avisa al árbol y la siguiente sesión vuelve a decidir', async () => {
    const entorno = crearEntorno({ servidor: () => 'caido' });
    await entorno.sesiones.sesion(ID);
    entorno.sesiones.invalidar(ID);
    assert.equal(entorno.sesiones.viaDe(ID), undefined);
    assert.deepEqual(entorno.avisosVia, [ID, ID]);
    await entorno.sesiones.sesion(ID);
    assert.equal(entorno.peticiones.length, 4);
    assert.equal(entorno.sesiones.viaDe(ID), 'oficial');
    assert.deepEqual(entorno.avisosVia, [ID, ID, ID]);
  });

  test('invalidar sin vía resuelta no avisa', () => {
    const entorno = crearEntorno({ servidor: aceptaBuena });
    entorno.sesiones.invalidar(ID);
    assert.deepEqual(entorno.avisosVia, []);
  });

  test('un destino distinto no tiene vía', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS });
    await entorno.sesiones.sesion(ID);
    assert.equal(entorno.sesiones.viaDe('OTRO'), undefined);
  });
});

suite('SesionesAdt: sesión silenciosa', () => {
  const nadaPorHttp: Servidor = () => {
    throw new Error('no debía llamarse a fetch');
  };

  function guardarContrasena(entorno: ReturnType<typeof crearEntorno>, contrasena: string): void {
    entorno.almacen.valores.set(`${PREFIJO_SECRETO}${ID}`, contrasena);
  }

  test('RFC sin contraseña guardada → sinContrasena sin pedirla ni hacer logon', async () => {
    const puente = crearPuente();
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoDePrueba({ protocolo: 'rfc' }), puente });
    assert.deepEqual(await entorno.sesiones.sesionSilenciosa(ID), { estado: 'sinContrasena' });
    assert.equal(entorno.contador.contrasenasPedidas, 0);
    assert.equal(puente.logons.length, 0);
  });

  test('HTTP sin contraseña guardada → sinContrasena sin pedirla ni enviar credenciales', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS });
    assert.deepEqual(await entorno.sesiones.sesionSilenciosa(ID), { estado: 'sinContrasena' });
    assert.equal(entorno.contador.contrasenasPedidas, 0);
    assert.ok(entorno.peticiones.every((p) => p.credencial === undefined));
  });

  test('con contraseña guardada abre la sesión RFC sin pedir nada y queda en caché para sesion()', async () => {
    const puente = crearPuente();
    const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoDePrueba({ protocolo: 'rfc' }), puente });
    guardarContrasena(entorno, 'buena');
    const resultado = await entorno.sesiones.sesionSilenciosa(ID);
    conexionDe(resultado);
    assert.equal(entorno.contador.contrasenasPedidas, 0);
    assert.equal(puente.logons.length, 1);
    assert.equal(await entorno.sesiones.sesion(ID), resultado);
    assert.equal(puente.logons.length, 1);
  });

  test('con contraseña guardada abre la sesión HTTP sin pedir nada', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS });
    guardarContrasena(entorno, 'buena');
    conexionDe(await entorno.sesiones.sesionSilenciosa(ID));
    assert.equal(entorno.contador.contrasenasPedidas, 0);
  });

  test('una contraseña guardada rechazada se olvida y no se pide otra', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS });
    guardarContrasena(entorno, 'mala');
    assert.deepEqual(await entorno.sesiones.sesionSilenciosa(ID), { estado: 'sinContrasena' });
    assert.equal(entorno.contador.contrasenasPedidas, 0);
    assert.equal(entorno.almacen.valores.size, 0);
  });

  test('sesion() después de un sinContrasena silencioso sí pide la contraseña', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS });
    assert.deepEqual(await entorno.sesiones.sesionSilenciosa(ID), { estado: 'sinContrasena' });
    conexionDe(await entorno.sesiones.sesion(ID));
    assert.equal(entorno.contador.contrasenasPedidas, 1);
  });

  test('sesion() mientras una silenciosa está en curso espera y, sin contraseña, la pide', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS });
    const silenciosa = entorno.sesiones.sesionSilenciosa(ID);
    const normal = entorno.sesiones.sesion(ID);
    assert.deepEqual(await silenciosa, { estado: 'sinContrasena' });
    conexionDe(await normal);
    assert.equal(entorno.contador.contrasenasPedidas, 1);
  });

  test('sesionSilenciosa mientras sesion() está en curso comparte su resultado', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTPS });
    const normal = entorno.sesiones.sesion(ID);
    const silenciosa = entorno.sesiones.sesionSilenciosa(ID);
    assert.equal(await silenciosa, await normal);
    assert.equal(entorno.contador.contrasenasPedidas, 1);
  });

  test('origen http que necesita confirmación → error sin preguntar, sin caché y sin decidir la vía', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, urlGuardada: CANDIDATO_HTTP, confirmarInseguro: true });
    guardarContrasena(entorno, 'buena');
    const resultado = await entorno.sesiones.sesionSilenciosa(ID);
    assert.equal(resultado.estado, 'error');
    assert.equal(entorno.contador.httpConfirmado, 0);
    assert.equal(entorno.sesiones.viaDe(ID), undefined);
    conexionDe(await entorno.sesiones.sesion(ID));
    assert.equal(entorno.contador.httpConfirmado, 1);
  });

  test('SSO → sinRest igual que sesion()', async () => {
    const entorno = crearEntorno({ servidor: aceptaBuena, destino: destinoDePrueba({ ssoActivado: true }) });
    assert.equal((await entorno.sesiones.sesionSilenciosa(ID)).estado, 'sinRest');
    assert.equal(entorno.contador.contrasenasPedidas, 0);
  });

  suite('resultado negativo recordado (VENTANA_SILENCIOSA_MS)', () => {
    const LINEA_VIA_RFC = 'Sesión ADT: vía RFC (puente disponible)';
    const ERROR_COMUNICACION: ErrorPuente = { clase: 'comunicacion', mensaje: 'sin red' };

    function entornoRfc(errores: Array<ErrorPuente | undefined> = []) {
      const puente = crearPuente({ errores });
      const reloj = { ahora: 1_000 };
      const entorno = crearEntorno({ servidor: nadaPorHttp, destino: destinoDePrueba({ protocolo: 'rfc' }), puente, reloj });
      return { ...entorno, puente, reloj };
    }

    const lineasVia = (registro: string[]): number => registro.filter((l) => l === LINEA_VIA_RFC).length;

    test('constante de 30 s', () => {
      assert.equal(VENTANA_SILENCIOSA_MS, 30_000);
    });

    test('dos silenciosas con un logon fallido dentro de la ventana: un solo logon y una sola línea de vía', async () => {
      const entorno = entornoRfc([ERROR_COMUNICACION, ERROR_COMUNICACION]);
      guardarContrasena(entorno, 'buena');
      assert.equal((await entorno.sesiones.sesionSilenciosa(ID)).estado, 'error');
      entorno.reloj.ahora += VENTANA_SILENCIOSA_MS - 1;
      assert.equal((await entorno.sesiones.sesionSilenciosa(ID)).estado, 'error');
      assert.equal(entorno.puente.logons.length, 1);
      assert.equal(lineasVia(entorno.registro), 1);
    });

    test('sin contraseña guardada: dos silenciosas, una sola línea de vía', async () => {
      const entorno = entornoRfc();
      assert.deepEqual(await entorno.sesiones.sesionSilenciosa(ID), { estado: 'sinContrasena' });
      const lineas = entorno.registro.length;
      assert.deepEqual(await entorno.sesiones.sesionSilenciosa(ID), { estado: 'sinContrasena' });
      assert.equal(entorno.registro.length, lineas);
      assert.equal(lineasVia(entorno.registro), 1);
    });

    test('pasada la ventana vuelve a intentarlo, sin repetir la línea de vía', async () => {
      const entorno = entornoRfc([ERROR_COMUNICACION, ERROR_COMUNICACION]);
      guardarContrasena(entorno, 'buena');
      await entorno.sesiones.sesionSilenciosa(ID);
      entorno.reloj.ahora += VENTANA_SILENCIOSA_MS;
      await entorno.sesiones.sesionSilenciosa(ID);
      assert.equal(entorno.puente.logons.length, 2);
      assert.equal(lineasVia(entorno.registro), 1);
    });

    test('tras invalidar vuelve a intentarlo dentro de la ventana', async () => {
      const entorno = entornoRfc([ERROR_COMUNICACION]);
      guardarContrasena(entorno, 'buena');
      assert.equal((await entorno.sesiones.sesionSilenciosa(ID)).estado, 'error');
      entorno.sesiones.invalidar(ID);
      conexionDe(await entorno.sesiones.sesionSilenciosa(ID));
      assert.equal(entorno.puente.logons.length, 2);
    });

    test('sesion() no silenciosa ignora el negativo recordado y lo borra', async () => {
      const entorno = entornoRfc();
      assert.deepEqual(await entorno.sesiones.sesionSilenciosa(ID), { estado: 'sinContrasena' });
      const resultado = await entorno.sesiones.sesion(ID);
      conexionDe(resultado);
      assert.equal(entorno.contador.contrasenasPedidas, 1);
      assert.equal(await entorno.sesiones.sesionSilenciosa(ID), resultado);
    });

    test('noAutorizado silencioso también se recuerda', async () => {
      const ERROR_LOGON: ErrorPuente = { clase: 'logon', mensaje: 'Name or password is incorrect' };
      const entorno = entornoRfc([ERROR_LOGON]);
      guardarContrasena(entorno, 'mala');
      assert.deepEqual(await entorno.sesiones.sesionSilenciosa(ID), { estado: 'sinContrasena' });
      await entorno.sesiones.sesionSilenciosa(ID);
      assert.equal(entorno.puente.logons.length, 1);
    });

    test('la línea de vía RFC se registra siempre en sesion() no silenciosa', async () => {
      const entorno = entornoRfc([ERROR_COMUNICACION, ERROR_COMUNICACION]);
      await entorno.sesiones.sesionSilenciosa(ID);
      await entorno.sesiones.sesion(ID);
      await entorno.sesiones.sesion(ID);
      assert.equal(lineasVia(entorno.registro), 3);
    });
  });
});

suite('Credenciales', () => {
  test('guardada y obtenerSinPreguntar leen el secreto sin pedir nada', async () => {
    const almacen = new AlmacenEnMemoria();
    let pedidas = 0;
    const credenciales = new Credenciales(almacen, async () => {
      pedidas += 1;
      return 'pedida';
    });
    assert.equal(await credenciales.guardada(ID), false);
    assert.equal(await credenciales.obtenerSinPreguntar(ID), undefined);
    almacen.valores.set(`${PREFIJO_SECRETO}${ID}`, 'secreta');
    assert.equal(await credenciales.guardada(ID), true);
    assert.equal(await credenciales.obtenerSinPreguntar(ID), 'secreta');
    assert.equal(pedidas, 0);
  });

  test('guarda lo que pide y no guarda una contraseña vacía', async () => {
    const almacen = new AlmacenEnMemoria();
    const respuestas = ['', 'secreta'];
    const credenciales = new Credenciales(almacen, async () => respuestas.shift());
    assert.equal(await credenciales.obtener(ID, USUARIO), undefined);
    assert.equal(almacen.valores.size, 0);
    assert.equal(await credenciales.obtener(ID, USUARIO), 'secreta');
    assert.equal(almacen.valores.get(`${PREFIJO_SECRETO}${ID}`), 'secreta');
  });
});

suite('buscar', () => {
  test('consulta la ruta de búsqueda y analiza la respuesta', async () => {
    const xml = fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real/busq-xml.xml'), 'utf8');
    const { fetchFn, peticiones } = crearFetch(() => ({ estado: 200, cuerpo: xml }));
    const conexion = new ConexionAdt(new TransporteHttp({ url: CANDIDATO_HTTPS, credenciales: { usuario: USUARIO, contrasena: 'buena' }, fetchFn }));
    const resultados = await buscar(conexion, { patron: 'Z*' });
    assert.equal(resultados.length, 10);
    assert.equal(resultados[0].nombre, 'Z');
    const { url, accept } = peticiones[0];
    assert.equal(url.pathname, RUTA_BUSQUEDA);
    assert.equal(url.searchParams.get('operation'), 'quickSearch');
    assert.equal(url.searchParams.get('query'), 'Z*');
    assert.equal(url.searchParams.get('maxResults'), '50');
    assert.equal(accept, 'application/xml');
  });
});
