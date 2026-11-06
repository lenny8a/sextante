import * as assert from 'node:assert/strict';
import { ConexionAdt } from '../../src/adt/conexion-adt';
import type { ResultadoSesion, SesionesAdt } from '../../src/adt/sesiones';
import type { Destino } from '../../src/config/destinos';
import {
  conexionDiccionario,
  crearCableadoDiccionario,
  idiomaDiccionario,
  mensajeSinRfc,
  motivoSinDiccionario,
} from '../../src/diccionario/cableado';

const CONEXION = new ConexionAdt({ peticion: async () => ({ estado: 200, cuerpo: '' }) });

function destino(extra: Partial<Destino> = {}): Destino {
  return {
    id: 'DEST', protocolo: 'rfc', ssoActivado: false, usuario: 'USUARIO',
    servidorAplicacion: 'host.local', numeroSistema: '00', ...extra,
  };
}

function uriDe(id: string): { scheme: string; path: string } {
  return { scheme: 'abap', path: `/repotree-v1/${id}/System Library/ZPAQ1/Programas/Programas/ZR_EJEMPLO/zr_ejemplo.prog.abap` };
}

type ViaFalsa = 'rfc' | 'http' | 'oficial';

type SesionesFalsas = Pick<SesionesAdt, 'sesion' | 'sesionSilenciosa' | 'viaDe' | 'alCambiarVia'> & {
  llamadas: string[];
  vias: Map<string, ViaFalsa>;
  avisar(id: string): void;
};

function sesionesFalsas(silenciosa: ResultadoSesion, conDialogo: ResultadoSesion = silenciosa): SesionesFalsas {
  const oyentes: Array<(id: string) => void> = [];
  const llamadas: string[] = [];
  const vias = new Map<string, ViaFalsa>();
  return {
    llamadas,
    vias,
    sesion: async (id) => {
      llamadas.push(`sesion ${id}`);
      return conDialogo;
    },
    sesionSilenciosa: async (id) => {
      llamadas.push(`silenciosa ${id}`);
      return silenciosa;
    },
    viaDe: (id) => vias.get(id),
    alCambiarVia: (cb) => {
      oyentes.push(cb);
    },
    avisar: (id) => {
      for (const o of oyentes) {
        o(id);
      }
    },
  };
}

const OK_RFC: ResultadoSesion = { estado: 'ok', via: 'rfc', conexion: CONEXION };
const OK_HTTP: ResultadoSesion = { estado: 'ok', via: 'http', conexion: CONEXION };

suite('Cableado del diccionario', () => {
  test('motivoSinDiccionario: solo un destino rfc sin SSO ni SNC tiene diccionario', () => {
    assert.equal(motivoSinDiccionario(destino()), undefined);
    assert.equal(motivoSinDiccionario(destino({ tipoSnc: '0' })), undefined, 'SNC "0" es SNC desactivado');
    assert.equal(motivoSinDiccionario(destino({ tipoSnc: '' })), undefined);
    assert.equal(motivoSinDiccionario(undefined), 'sinDestino');
    assert.equal(motivoSinDiccionario(destino({ protocolo: 'http' })), 'noRfc');
    assert.equal(motivoSinDiccionario(destino({ ssoActivado: true })), 'sso');
    assert.equal(motivoSinDiccionario(destino({ tipoSnc: 'snc' })), 'snc');
  });

  test('motivoSinDiccionario: un destino rfc sin puente disponible da sinPuente; los motivos del destino van antes', () => {
    const sinPuente = { disponible: () => ({ ok: false as const, motivo: 'falta Java' }) };
    const conPuente = { disponible: () => ({ ok: true as const }) };
    assert.equal(motivoSinDiccionario(destino(), sinPuente), 'sinPuente');
    assert.equal(motivoSinDiccionario(destino(), conPuente), undefined);
    assert.equal(motivoSinDiccionario(destino({ protocolo: 'http' }), sinPuente), 'noRfc');
    assert.equal(motivoSinDiccionario(destino({ ssoActivado: true }), sinPuente), 'sso');
    assert.equal(motivoSinDiccionario(undefined, sinPuente), 'sinDestino');
  });

  test('destinoDe sin puente disponible: ni hover ni «Conéctate» y una sola línea de registro', () => {
    const lineas: string[] = [];
    let ok = false;
    const cableado = crearCableadoDiccionario({
      sesiones: sesionesFalsas(OK_RFC),
      credenciales: { guardada: async () => false },
      destinoPorId: () => destino(),
      puente: { disponible: () => (ok ? { ok: true } : { ok: false, motivo: 'falta Java' }) },
      registrar: (m) => lineas.push(m),
    });
    assert.equal(cableado.destinoDe(uriDe('DEST')), undefined);
    assert.equal(cableado.destinoDe(uriDe('DEST')), undefined);
    assert.deepEqual(lineas, ['Diccionario: desactivado para un destino (sinPuente)']);
    ok = true;
    assert.equal(cableado.destinoDe(uriDe('DEST')), 'DEST');
  });

  test('mensajeSinRfc: el aviso de «Conectar» sin vía RFC dice el motivo en palabras', () => {
    assert.equal(mensajeSinRfc('sinVia'), 'El diccionario necesita la conexión RFC: el puente RFC no está disponible');
    assert.equal(mensajeSinRfc('sso'), 'El diccionario necesita la conexión RFC: el destino usa SSO');
    assert.equal(mensajeSinRfc('snc'), 'El diccionario necesita la conexión RFC: el destino usa SNC');
    assert.equal(mensajeSinRfc('sinServidor'), 'El diccionario necesita la conexión RFC: el destino no tiene servidor de aplicación');
  });

  test('conexionDiccionario: solo una sesión silenciosa ok por RFC; nunca abre la sesión con diálogo', async () => {
    const rfc = sesionesFalsas(OK_RFC);
    assert.equal(await conexionDiccionario(rfc, 'DEST'), CONEXION);
    assert.equal(await conexionDiccionario(sesionesFalsas(OK_HTTP), 'DEST'), undefined);
    assert.equal(await conexionDiccionario(sesionesFalsas({ estado: 'sinContrasena' }), 'DEST'), undefined);
    assert.equal(await conexionDiccionario(sesionesFalsas({ estado: 'error', mensaje: 'x' }), 'DEST'), undefined);
    assert.deepEqual(rfc.llamadas, ['silenciosa DEST']);
  });

  test('idiomaDiccionario: el código ISO del destino convertido a la clave SAP, o E', () => {
    assert.equal(idiomaDiccionario(destino({ idioma: 'ES' })), 'S');
    assert.equal(idiomaDiccionario(destino({ idioma: 'es' })), 'S');
    assert.equal(idiomaDiccionario(destino({ idioma: 'D' })), 'D');
    assert.equal(idiomaDiccionario(destino({ idioma: 'ZZ' })), 'E');
    assert.equal(idiomaDiccionario(destino()), 'E');
    assert.equal(idiomaDiccionario(undefined), 'E');
  });

  test('destinoDe: el destino de un URI abap: con diccionario; nada para otros esquemas o destinos sin RFC posible', () => {
    const destinos = new Map<string, Destino>([
      ['DEV-X', destino({ id: 'DEV-X' })],
      ['HTTP-X', destino({ id: 'HTTP-X', protocolo: 'http' })],
      ['SSO-X', destino({ id: 'SSO-X', ssoActivado: true })],
      ['SNC-X', destino({ id: 'SNC-X', tipoSnc: 'snc' })],
    ]);
    const lineas: string[] = [];
    const cableado = crearCableadoDiccionario({
      sesiones: sesionesFalsas(OK_RFC),
      credenciales: { guardada: async () => true },
      destinoPorId: (id) => destinos.get(id),
      registrar: (m) => lineas.push(m),
    });
    assert.equal(cableado.destinoDe(uriDe('DEV-X')), 'DEV-X');
    assert.equal(cableado.destinoDe({ scheme: 'untitled', path: 'Untitled-1' }), undefined);
    assert.equal(cableado.destinoDe({ scheme: 'file', path: '/c:/zr_ejemplo.abap' }), undefined);
    for (const id of ['HTTP-X', 'SSO-X', 'SNC-X', 'NOEXISTE-X']) {
      assert.equal(cableado.destinoDe(uriDe(id)), undefined, id);
      assert.equal(cableado.destinoDe(uriDe(id)), undefined, id);
    }
    assert.deepEqual(lineas, [
      'Diccionario: desactivado para un destino (noRfc)',
      'Diccionario: desactivado para un destino (sso)',
      'Diccionario: desactivado para un destino (snc)',
      'Diccionario: desactivado para un destino (sinDestino)',
    ], 'una línea por destino, sin su id');
  });

  test('el servicio consulta con la conexión silenciosa RFC', async () => {
    const pedidas: string[] = [];
    const conexion = new ConexionAdt({
      peticion: async (p) => {
        pedidas.push(`${p.metodo} ${p.ruta}`);
        return { estado: 404, cuerpo: '' };
      },
    });
    const sesiones = sesionesFalsas({ estado: 'ok', via: 'rfc', conexion });
    const cableado = crearCableadoDiccionario({
      sesiones, credenciales: { guardada: async () => true }, destinoPorId: () => destino({ idioma: 'ES' }),
    });
    assert.equal(await cableado.servicio.objeto('DEST', 'ZT_EJEMPLO'), undefined);
    assert.ok(pedidas.length > 0);
    assert.ok(pedidas.every((p) => p.startsWith('GET /sap/bc/adt/ddic/')), pedidas.join('\n'));
    assert.ok(sesiones.llamadas.every((l) => l.startsWith('silenciosa ')), sesiones.llamadas.join('\n'));
  });

  test('credencialGuardada delega en Credenciales.guardada sin pedir nada', async () => {
    const preguntados: string[] = [];
    const cableado = crearCableadoDiccionario({
      sesiones: sesionesFalsas(OK_RFC),
      credenciales: {
        guardada: async (d) => {
          preguntados.push(d);
          return d === 'DEST';
        },
      },
      destinoPorId: () => destino(),
    });
    assert.equal(await cableado.credencialGuardada('DEST'), true);
    assert.equal(await cableado.credencialGuardada('OTRO'), false);
    assert.deepEqual(preguntados, ['DEST', 'OTRO']);
  });

  test('conectar abre la sesión con diálogo y vacía la caché de ese destino', async () => {
    const sesiones = sesionesFalsas({ estado: 'sinContrasena' }, OK_RFC);
    const lineas: string[] = [];
    const cableado = crearCableadoDiccionario({
      sesiones, credenciales: { guardada: async () => false }, destinoPorId: () => destino(), registrar: (m) => lineas.push(m),
    });
    const vaciados: Array<string | undefined> = [];
    cableado.servicio.vaciar = (d?: string) => {
      vaciados.push(d);
    };
    cableado.firmas.vaciar = (d?: string) => {
      vaciados.push(`firmas ${d}`);
    };
    const resultado = await cableado.conectar('DEST');
    assert.equal(resultado.estado, 'ok');
    assert.deepEqual(sesiones.llamadas, ['sesion DEST']);
    assert.deepEqual(vaciados, ['DEST', 'firmas DEST']);
    assert.deepEqual(lineas, ['Diccionario: conectar → ok (rfc)']);
  });

  test('conectar por una vía que no es RFC lo registra sin el destino', async () => {
    const lineas: string[] = [];
    const cableado = crearCableadoDiccionario({
      sesiones: sesionesFalsas({ estado: 'sinContrasena' }, OK_HTTP),
      credenciales: { guardada: async () => false },
      destinoPorId: () => destino(),
      registrar: (m) => lineas.push(m),
    });
    await cableado.conectar('DEST');
    await cableado.conectar('DEST');
    assert.deepEqual(lineas, ['Diccionario: conectar → ok (http)', 'Diccionario: conectar → ok (http)']);
  });

  test('al olvidar la sesión de un destino (vía sin resolver) se vacían sus cachés de diccionario y firmas; al resolverse, no', () => {
    const sesiones = sesionesFalsas(OK_RFC);
    const cableado = crearCableadoDiccionario({ sesiones, credenciales: { guardada: async () => true }, destinoPorId: () => destino() });
    const vaciados: Array<string | undefined> = [];
    cableado.servicio.vaciar = (d?: string) => {
      vaciados.push(d);
    };
    cableado.firmas.vaciar = (d?: string) => {
      vaciados.push(`firmas ${d}`);
    };
    sesiones.vias.set('DEST', 'rfc');
    sesiones.avisar('DEST');
    assert.deepEqual(vaciados, []);
    sesiones.vias.delete('DEST');
    sesiones.avisar('DEST');
    assert.deepEqual(vaciados, ['DEST', 'firmas DEST']);
  });
});
