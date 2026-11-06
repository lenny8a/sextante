import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NuevaEntrada } from '../../src/ia/diario-modelo';
import { ESPERA_CREACION_MS, VIGENCIA_CREACION_MS } from '../../src/ia/creacion-modelo';
import type { ResultadoBusqueda } from '../../src/adt/busqueda-modelo';
import type { ConexionAdt } from '../../src/adt/conexion-adt';
import type { ResultadoSesion } from '../../src/adt/sesiones';
import { ErrorAdt, type RespuestaAdt } from '../../src/adt/transporte';
import type { RolSistema } from '../../src/config/navegador-config';
import {
  FILAS_CVERS,
  INDICACION_SIN_CONEXION,
  SQL_CVERS,
  VENTANA_FALLO_CVERS_MS,
  type FalloCvers,
  type InfoCacheada,
  type InfoSistema,
} from '../../src/ia/sistema-modelo';
import {
  ORDEN_SISTEMA,
  crearCatalogoSistema,
  releaseDe,
  type DependenciasSistema,
} from '../../src/ia/herramientas-sistema';

const CONEXION = {} as ConexionAdt;
const FILAS = [
  { COMPONENT: 'SAP_BASIS', RELEASE: '754', EXTRELEASE: '0005' },
  { COMPONENT: 'S4CORE', RELEASE: '104', EXTRELEASE: '0005' },
];

interface Espias {
  consultas: number;
  sesiones: number;
  /** Rol que devuelve `rolDe`; se puede cambiar entre llamadas. */
  rol: RolSistema | undefined;
  /** Instante que devuelve `ahora`. */
  ahora: number;
}

function dependencias(
  sesion: () => Promise<ResultadoSesion>,
  opciones: { filas?: () => Promise<Record<string, string>[]>; sistemaPorDefecto?: string } = {},
): { deps: DependenciasSistema; espias: Espias } {
  const espias: Espias = { consultas: 0, sesiones: 0, rol: 'DEV', ahora: 1_000_000 };
  const deps: DependenciasSistema = {
    sistemaPorDefecto: () => opciones.sistemaPorDefecto,
    rolDe: () => espias.rol,
    viaDe: () => 'rfc',
    sesionSilenciosa: async () => {
      espias.sesiones++;
      return sesion();
    },
    consultarSql: async (_c, sql, filas) => {
      espias.consultas++;
      assert.equal(sql, SQL_CVERS);
      assert.equal(filas, FILAS_CVERS);
      return opciones.filas === undefined ? FILAS : opciones.filas();
    },
    cache: new Map<string, InfoCacheada>(),
    fallosCvers: new Map<string, FalloCvers>(),
    ahora: () => espias.ahora,
    copiar: async () => undefined,
    confirmarGuia: async () => true,
    lanzarAsistente: async () => ({ ok: true }),
    instantaneaObjetos: () => new Set<string>(),
    esperarObjeto: async () => undefined,
    usuarioDe: () => 'USUARIO',
    paqueteDePrograma: async () => undefined,
    ordenAbiertaDe: async () => undefined,
    confirmarCreacion: async () => false,
    crear: async () => ({ estado: 200, cuerpo: '' }),
    abrirCreado: async () => undefined,
    esperar: async () => undefined,
  };
  return { deps, espias };
}

const rfc = async (): Promise<ResultadoSesion> => ({ estado: 'ok', conexion: CONEXION, via: 'rfc', sistema: { id: 'DEV', release: '754' } });
const rest = async (): Promise<ResultadoSesion> => ({ estado: 'ok', conexion: CONEXION, via: 'http' });

async function llamar(deps: DependenciasSistema, args: Record<string, unknown> = {}) {
  const herramienta = crearCatalogoSistema(deps).find((h) => h.nombre === 'info_sistema');
  assert.ok(herramienta);
  const r = await herramienta.ejecutar(args);
  return { r, json: r.esError ? undefined : (JSON.parse(r.texto) as InfoSistema) };
}

suite('IA: info_sistema', () => {
  test('el orden y el catálogo', () => {
    assert.deepEqual([...ORDEN_SISTEMA], ['info_sistema', 'crear_objeto']);
    const { deps } = dependencias(rfc);
    assert.deepEqual(crearCatalogoSistema(deps).map((h) => h.nombre), ['info_sistema', 'crear_objeto']);
  });

  test('sesión rfc: release del logon, componentes y fuente rfc; la segunda llamada usa la caché', async () => {
    const { deps, espias } = dependencias(rfc, { sistemaPorDefecto: 'DEV' });
    const { json } = await llamar(deps);
    assert.deepEqual(json, {
      sistema: 'DEV',
      rol: 'DEV',
      via: 'rfc',
      release: '754',
      componentes: [
        { componente: 'SAP_BASIS', release: '754', nivel: '0005' },
        { componente: 'S4CORE', release: '104', nivel: '0005' },
      ],
      fuente: 'rfc',
    });
    await llamar(deps, { sistema: 'DEV' });
    assert.equal(espias.consultas, 1);
    assert.equal(espias.sesiones, 1);
  });

  test('la caché no guarda rol ni vía: un rol cambiado se ve sin volver a consultar', async () => {
    const { deps, espias } = dependencias(rfc);
    await llamar(deps, { sistema: 'DEV' });
    assert.deepEqual(Object.keys(deps.cache.get('DEV') ?? {}).sort(), ['componentes', 'fuente', 'release']);
    espias.rol = 'QAS';
    const { json } = await llamar(deps, { sistema: 'DEV' });
    assert.equal(json?.rol, 'QAS');
    assert.equal(espias.consultas, 1);
  });

  test('sesión REST sin release: lo toma de SAP_BASIS y fuente rest', async () => {
    const { deps } = dependencias(rest);
    const { json } = await llamar(deps, { sistema: 'DEV' });
    assert.equal(json?.release, '754');
    assert.equal(json?.componentes?.length, 2);
    assert.equal(json?.fuente, 'rest');
  });

  test('sinContrasena: no disponible con indicación, sin lanzar ni cachear', async () => {
    const { deps } = dependencias(async () => ({ estado: 'sinContrasena' }));
    const { json } = await llamar(deps, { sistema: 'DEV' });
    assert.equal(json?.fuente, 'no disponible');
    assert.equal(json?.indicacion, INDICACION_SIN_CONEXION);
    assert.equal(deps.cache.size, 0);
  });

  test('noAutorizado: la indicación añade que la credencial fue rechazada', async () => {
    const { deps } = dependencias(async () => ({ estado: 'noAutorizado' }));
    const { json } = await llamar(deps, { sistema: 'DEV' });
    assert.equal(json?.fuente, 'no disponible');
    assert.ok(json?.indicacion?.includes('la credencial guardada fue rechazada'));
    assert.ok(json?.indicacion?.includes(INDICACION_SIN_CONEXION));
    assert.equal(deps.cache.size, 0);
  });

  test('error de sesión también es no disponible', async () => {
    const { deps } = dependencias(async () => ({ estado: 'error', mensaje: 'x' }));
    const { json } = await llamar(deps, { sistema: 'DEV' });
    assert.equal(json?.fuente, 'no disponible');
  });

  test('error de CVERS: conserva el release del logon e indica CVERS', async () => {
    const { deps } = dependencias(rfc, {
      filas: async () => {
        throw new Error('sin autorización');
      },
    });
    const { json } = await llamar(deps, { sistema: 'DEV' });
    assert.equal(json?.release, '754');
    assert.equal(json?.componentes, undefined);
    assert.ok(json?.indicacion?.includes('CVERS'));
    assert.ok(json?.indicacion?.includes('sin autorización'));
    assert.equal(json?.fuente, 'rfc');
  });

  test('error de CVERS: dentro de la ventana no vuelve a consultar y repite el aviso; tras la ventana sí', async () => {
    const { deps, espias } = dependencias(rfc, {
      filas: async () => {
        throw new Error('timeout');
      },
    });
    const primera = (await llamar(deps, { sistema: 'DEV' })).json;
    espias.ahora += VENTANA_FALLO_CVERS_MS - 1;
    const segunda = (await llamar(deps, { sistema: 'DEV' })).json;
    assert.equal(espias.consultas, 1);
    assert.deepEqual(segunda, primera);
    assert.equal(deps.cache.size, 0);
    espias.ahora += 1;
    await llamar(deps, { sistema: 'DEV' });
    assert.equal(espias.consultas, 2);
  });

  test('sin sistema ni por defecto: error', async () => {
    const { deps } = dependencias(rfc);
    const { r } = await llamar(deps);
    assert.equal(r.esError, true);
    assert.ok(r.texto.includes('indica el sistema o abre un objeto'));
  });

  test('releaseDe: caché, sesión rfc que cachea, sin credencial y rechazo', async () => {
    const a = dependencias(rfc);
    a.deps.cache.set('DEV', { release: '999', fuente: 'rfc' });
    assert.equal(await releaseDe(a.deps, 'DEV'), '999');
    assert.equal(a.espias.sesiones, 0);

    const b = dependencias(rfc);
    assert.equal(await releaseDe(b.deps, 'DEV'), '754');
    assert.deepEqual(b.deps.cache.get('DEV'), { release: '754', fuente: 'rfc' });

    const c = dependencias(async () => ({ estado: 'sinContrasena' }));
    assert.equal(await releaseDe(c.deps, 'DEV'), undefined);

    const d = dependencias(async () => {
      throw new Error('boom');
    });
    assert.equal(await releaseDe(d.deps, 'DEV'), undefined);
  });

  test('releaseDe con release del logon (RFC) no consulta CVERS; info_sistema después sí', async () => {
    const { deps, espias } = dependencias(rfc);
    assert.equal(await releaseDe(deps, 'DEV'), '754');
    assert.equal(await releaseDe(deps, 'DEV'), '754');
    assert.equal(espias.consultas, 0);
    assert.equal(espias.sesiones, 1);
    const { json } = await llamar(deps, { sistema: 'DEV' });
    assert.equal(espias.consultas, 1);
    assert.equal(json?.componentes?.length, 2);
    assert.equal(json?.release, '754');
  });

  test('releaseDe sin release del logon (REST) consulta CVERS y cachea los componentes', async () => {
    const { deps, espias } = dependencias(rest);
    assert.equal(await releaseDe(deps, 'DEV'), '754');
    assert.equal(espias.consultas, 1);
    assert.equal(deps.cache.get('DEV')?.componentes?.length, 2);
    await llamar(deps, { sistema: 'DEV' });
    assert.equal(espias.consultas, 1);
  });

  test('releaseDe REST con CVERS fallido respeta la ventana de fallo', async () => {
    const { deps, espias } = dependencias(rest, {
      filas: async () => {
        throw new Error('timeout');
      },
    });
    assert.equal(await releaseDe(deps, 'DEV'), undefined);
    assert.equal(await releaseDe(deps, 'DEV'), undefined);
    assert.equal(espias.consultas, 1);
  });
});


interface OpcionesMontaje {
  rol?: 'DEV' | 'QAS' | 'PRD';
  lanzamiento?: { ok: true } | { ok: false; motivo: string };
  /** Respuesta del usuario al cuadro guía; por defecto acepta. */
  aceptaGuia?: boolean;
  /** Sustituye la respuesta al cuadro guía (por ejemplo, una promesa que no se resuelve aún). */
  respuestaGuia?: () => Promise<boolean>;
  /** Lo que devuelve cada espera, en orden; agotada la lista, `creado`. */
  creados?: ({ uri: string; paquete: string } | undefined)[];
  creado?: { uri: string; paquete: string };
  sinDiario?: boolean;
  diarioFalla?: boolean;
  /** Las esperas quedan abiertas hasta resolverlas con `Montaje.resolverEsperas`. */
  esperasManuales?: boolean;
  copiarFalla?: boolean;
}

type Hallado = { uri: string; paquete: string } | undefined;

interface Montaje {
  deps: DependenciasSistema;
  /** Se pueden cambiar entre llamadas. */
  opciones: OpcionesMontaje;
  reloj: { ahora: number };
  /** Con `esperasManuales`: resuelve las esperas abiertas con ese resultado. */
  resolverEsperas(resultado: Hallado): void;
  llamadas: {
    orden: string[];
    copiado: string[];
    guias: { mensaje: string; detalle: string }[];
    lanzados: string[];
    instantaneas: ReadonlySet<string>[];
    esperas: { destino: string; nombre: string; limiteMs: number; previos: ReadonlySet<string> }[];
    diario: { uri: string; entrada: NuevaEntrada }[];
  };
}

const URI_CREADO = 'abap:/repotree-v1/DEV/System Library/ZPAQ1/Source Code Library/Programs/ZTEST_NUEVO/ztest_nuevo.prog.abap';

function montaje(opciones: OpcionesMontaje = {}): Montaje {
  const llamadas: Montaje['llamadas'] = { orden: [], copiado: [], guias: [], lanzados: [], instantaneas: [], esperas: [], diario: [] };
  const reloj = { ahora: 5_000_000 };
  const abiertas: ((resultado: Hallado) => void)[] = [];
  const resolverEsperas = (resultado: Hallado): void => {
    for (const resolver of abiertas.splice(0)) resolver(resultado);
  };
  const base = dependencias(rfc, { sistemaPorDefecto: 'DEV' }).deps;
  const deps: DependenciasSistema = {
    ...base,
    ahora: () => reloj.ahora,
    rolDe: () => ('rol' in opciones ? opciones.rol : 'DEV'),
    copiar: async (texto) => {
      llamadas.orden.push('copiar');
      llamadas.copiado.push(texto);
      if (opciones.copiarFalla) throw new Error('portapapeles');
    },
    confirmarGuia: async (mensaje, detalle) => {
      llamadas.orden.push('guia');
      llamadas.guias.push({ mensaje, detalle });
      return opciones.respuestaGuia !== undefined ? opciones.respuestaGuia() : (opciones.aceptaGuia ?? true);
    },
    lanzarAsistente: async (destino) => {
      llamadas.orden.push('lanzar');
      llamadas.lanzados.push(destino);
      return opciones.lanzamiento ?? { ok: true };
    },
    instantaneaObjetos: () => {
      const foto = new Set([`PREVIO-${llamadas.instantaneas.length + 1}`]);
      llamadas.instantaneas.push(foto);
      return foto;
    },
    esperarObjeto: async (destino, nombre, limiteMs, previos) => {
      llamadas.orden.push('esperar');
      llamadas.esperas.push({ destino, nombre, limiteMs, previos });
      if (opciones.esperasManuales) return new Promise<Hallado>((resolver) => abiertas.push(resolver));
      return opciones.creados !== undefined && opciones.creados.length > 0 ? opciones.creados.shift() : opciones.creado;
    },
    ...(opciones.sinDiario
      ? {}
      : {
          anotarDiario: async (uri: string, entrada: NuevaEntrada) => {
            llamadas.diario.push({ uri, entrada });
            if (opciones.diarioFalla) throw new Error('disco');
          },
        }),
  };
  return { deps, opciones, reloj, resolverEsperas, llamadas };
}

const ARGS = { tipo: 'PROG', nombre: 'ztest_nuevo', descripcion: 'Informe de prueba' };
const INDICACION_PENDIENTE =
  'el usuario sigue en el asistente de SAP (o lo canceló). Vuelve a llamar a crear_objeto con el mismo nombre para seguir esperando: no relanza el asistente. Si el usuario dice que lo canceló, no insistas. Si el usuario cerró el asistente y quiere repetir, llama con relanzar: true';

/** Un catálogo por juego de dependencias, como en el cableado: el registro de creaciones en curso vive en él. */
const catalogos = new WeakMap<DependenciasSistema, ReturnType<typeof crearCatalogoSistema>>();

async function crearObjeto(deps: DependenciasSistema, args: Record<string, unknown>) {
  const catalogo = catalogos.get(deps) ?? crearCatalogoSistema(deps);
  catalogos.set(deps, catalogo);
  const herramienta = catalogo.find((h) => h.nombre === 'crear_objeto');
  assert.ok(herramienta);
  const r = await herramienta.ejecutar(args);
  return { r, json: r.esError ? undefined : (JSON.parse(r.texto) as Record<string, unknown>) };
}

suite('IA: crear_objeto', () => {
  test('rol QAS, PRD o sin rol: rechazado sin portapapeles, aviso ni asistente', async () => {
    for (const rol of ['QAS', 'PRD', undefined] as const) {
      const m = montaje({ rol });
      const { r } = await crearObjeto(m.deps, ARGS);
      assert.ok(r.esError);
      assert.ok(r.texto.startsWith(`rechazado por rol: DEV tiene rol ${rol ?? 'sin asignar'}`), r.texto);
      assert.deepEqual(m.llamadas.orden, []);
    }
  });

  test('sin sistema ni por defecto: error', async () => {
    const m = montaje();
    const { r } = await crearObjeto({ ...m.deps, sistemaPorDefecto: () => undefined }, ARGS);
    assert.ok(r.esError);
    assert.equal(r.texto, 'indica el sistema o abre un objeto');
    assert.deepEqual(m.llamadas.orden, []);
  });

  test('petición inválida: error con el motivo, sin tocar nada', async () => {
    for (const args of [
      { ...ARGS, nombre: '1ABC' },
      { ...ARGS, descripcion: '' },
      { ...ARGS, tipo: 'XSLT' },
    ]) {
      const m = montaje();
      const { r } = await crearObjeto(m.deps, args);
      assert.ok(r.esError, JSON.stringify(args));
      assert.deepEqual(m.llamadas.orden, []);
    }
  });

  test('el asistente no se puede lanzar: error con su motivo, sin portapapeles, espera ni diario', async () => {
    const m = montaje({ lanzamiento: { ok: false, motivo: 'falta la extensión oficial' } });
    const { r } = await crearObjeto(m.deps, ARGS);
    assert.ok(r.esError);
    assert.equal(r.texto, 'falta la extensión oficial');
    assert.deepEqual(m.llamadas.lanzados, ['DEV']);
    assert.deepEqual(m.llamadas.copiado, []);
    assert.equal(m.llamadas.esperas.length, 0);
    assert.equal(m.llamadas.guias.length, 1);
    assert.equal(m.llamadas.diario.length, 0);
  });

  test('el usuario cancela el cuadro guía: cancelado, sin lanzar, copiar ni registrar', async () => {
    const m = montaje({ aceptaGuia: false });
    const { r, json } = await crearObjeto(m.deps, ARGS);
    assert.ok(!r.esError, r.texto);
    assert.deepEqual(json, { estado: 'cancelado', nombre: 'ZTEST_NUEVO' });
    assert.deepEqual(m.llamadas.orden, ['guia']);
    assert.equal(m.llamadas.instantaneas.length, 0);
    m.opciones.aceptaGuia = true;
    await crearObjeto(m.deps, ARGS);
    assert.deepEqual(m.llamadas.lanzados, ['DEV'], 'la cancelación no dejó nada registrado');
    assert.equal(m.llamadas.guias.length, 2);
  });

  test('el objeto aparece: creado con uri y paquete, portapapeles, aviso exacto y diario', async () => {
    const m = montaje({ creado: { uri: URI_CREADO, paquete: 'ZPAQ1' } });
    const { r, json } = await crearObjeto(m.deps, { ...ARGS, sistema: 'DEV' });
    assert.ok(!r.esError, r.texto);
    assert.deepEqual(json, {
      estado: 'creado',
      uri: URI_CREADO,
      nombre: 'ZTEST_NUEVO',
      paquete: 'ZPAQ1',
      indicacion: 'escribe el código con proponer_cambio y textoCompleto',
    });
    assert.deepEqual(m.llamadas.orden, ['guia', 'lanzar', 'copiar', 'esperar']);
    assert.deepEqual(m.llamadas.copiado, ['ZTEST_NUEVO']);
    assert.equal(m.llamadas.guias.length, 1);
    assert.equal(m.llamadas.guias[0].mensaje, 'El agente pide crear programa ZTEST_NUEVO «Informe de prueba» en DEV.');
    assert.ok(m.llamadas.guias[0].detalle.includes('1. Tipo de objeto: elige el que corresponde (aquí: programa).'));
    assert.deepEqual(m.llamadas.esperas, [
      { destino: 'DEV', nombre: 'ZTEST_NUEVO', limiteMs: ESPERA_CREACION_MS, previos: m.llamadas.instantaneas[0] },
    ]);
    assert.equal(ESPERA_CREACION_MS, 60_000);
    assert.deepEqual(m.llamadas.diario, [
      { uri: URI_CREADO, entrada: { tipo: 'creado', descripcion: 'Informe de prueba', paquete: 'ZPAQ1' } },
    ]);
  });

  test('el objeto no aparece: pendiente con la indicación exacta y sin diario', async () => {
    const m = montaje();
    const { r, json } = await crearObjeto(m.deps, ARGS);
    assert.ok(!r.esError, r.texto);
    assert.deepEqual(json, { estado: 'pendiente', nombre: 'ZTEST_NUEVO', indicacion: INDICACION_PENDIENTE });
    assert.equal(m.llamadas.esperas.length, 1);
    assert.equal(m.llamadas.diario.length, 0);
  });

  test('sin tipo: el cuadro guía habla de «el objeto»', async () => {
    const m = montaje({ creado: { uri: URI_CREADO, paquete: '$TMP' } });
    const { r } = await crearObjeto(m.deps, { nombre: 'ztest_nuevo', descripcion: 'Informe de prueba' });
    assert.ok(!r.esError, r.texto);
    assert.equal(m.llamadas.guias[0].mensaje, 'El agente pide crear el objeto ZTEST_NUEVO «Informe de prueba» en DEV.');
    assert.ok(m.llamadas.guias[0].detalle.includes('1. Tipo de objeto: elige el que corresponde.'));
  });

  test('sin diario o con el diario fallando: la creación sigue respondiendo creado', async () => {
    for (const opciones of [{ sinDiario: true }, { diarioFalla: true }]) {
      const m = montaje({ ...opciones, creado: { uri: URI_CREADO, paquete: 'ZPAQ1' } });
      const { r, json } = await crearObjeto(m.deps, ARGS);
      assert.ok(!r.esError, r.texto);
      assert.equal(json?.estado, 'creado');
    }
  });

  suite('creación en curso', () => {
    test('segunda llamada dentro de la vigencia: sin cuadro guía, no relanza ni copia y espera con la misma instantánea', async () => {
      const m = montaje();
      const primera = await crearObjeto(m.deps, ARGS);
      m.reloj.ahora += VIGENCIA_CREACION_MS - 1;
      const segunda = await crearObjeto(m.deps, { ...ARGS, tipo: 'INCL', descripcion: 'Otra' });
      for (const { json } of [primera, segunda]) {
        assert.deepEqual(json, { estado: 'pendiente', nombre: 'ZTEST_NUEVO', indicacion: INDICACION_PENDIENTE });
      }
      assert.deepEqual(m.llamadas.lanzados, ['DEV']);
      assert.equal(m.llamadas.copiado.length, 1);
      assert.equal(m.llamadas.guias.length, 1);
      assert.deepEqual(m.llamadas.orden, ['guia', 'lanzar', 'copiar', 'esperar', 'esperar']);
      assert.equal(m.llamadas.instantaneas.length, 1);
      assert.equal(m.llamadas.esperas.length, 2);
      assert.equal(m.llamadas.esperas[1].limiteMs, ESPERA_CREACION_MS);
      assert.strictEqual(m.llamadas.esperas[1].previos, m.llamadas.esperas[0].previos);
      assert.equal(m.llamadas.diario.length, 0);
    });

    test('encontrado en la segunda llamada: creado, diario una vez con su descripción y la tercera relanza', async () => {
      const m = montaje({ creados: [undefined, { uri: URI_CREADO, paquete: 'ZPAQ1' }] });
      await crearObjeto(m.deps, ARGS);
      const { json } = await crearObjeto(m.deps, { ...ARGS, descripcion: 'Segunda descripción' });
      assert.equal(json?.estado, 'creado');
      assert.equal(json?.uri, URI_CREADO);
      assert.deepEqual(m.llamadas.diario, [
        { uri: URI_CREADO, entrada: { tipo: 'creado', descripcion: 'Segunda descripción', paquete: 'ZPAQ1' } },
      ]);
      assert.deepEqual(m.llamadas.lanzados, ['DEV']);
      await crearObjeto(m.deps, ARGS);
      assert.deepEqual(m.llamadas.lanzados, ['DEV', 'DEV']);
      assert.equal(m.llamadas.instantaneas.length, 2);
    });

    test('pasada la vigencia de 10 minutos se relanza el asistente', async () => {
      assert.equal(VIGENCIA_CREACION_MS, 10 * 60_000);
      const m = montaje();
      await crearObjeto(m.deps, ARGS);
      m.reloj.ahora += VIGENCIA_CREACION_MS;
      await crearObjeto(m.deps, ARGS);
      assert.deepEqual(m.llamadas.lanzados, ['DEV', 'DEV']);
      assert.equal(m.llamadas.copiado.length, 2);
      assert.equal(m.llamadas.guias.length, 2);
      assert.notStrictEqual(m.llamadas.esperas[1].previos, m.llamadas.esperas[0].previos);
    });

    test('otro nombre u otro destino: lanzamiento independiente; el nombre no distingue mayúsculas', async () => {
      const m = montaje();
      await crearObjeto(m.deps, ARGS);
      await crearObjeto(m.deps, { ...ARGS, nombre: 'ZTEST_NUEVO' });
      await crearObjeto(m.deps, { ...ARGS, nombre: 'ztest_otro' });
      await crearObjeto(m.deps, { ...ARGS, sistema: 'DEV2' });
      assert.deepEqual(m.llamadas.lanzados, ['DEV', 'DEV', 'DEV2']);
    });

    test('un lanzamiento fallido no deja nada registrado', async () => {
      const m = montaje({ lanzamiento: { ok: false, motivo: 'sin conexión' } });
      const { r } = await crearObjeto(m.deps, ARGS);
      assert.ok(r.esError);
      m.opciones.lanzamiento = { ok: true };
      await crearObjeto(m.deps, ARGS);
      assert.deepEqual(m.llamadas.lanzados, ['DEV', 'DEV']);
      assert.equal(m.llamadas.copiado.length, 1);
    });

    test('pendiente + relanzar: true → vuelve el cuadro, relanza y toma una instantánea nueva', async () => {
      const m = montaje();
      await crearObjeto(m.deps, ARGS);
      const { json } = await crearObjeto(m.deps, { ...ARGS, relanzar: true });
      assert.equal(json?.estado, 'pendiente');
      assert.equal(m.llamadas.guias.length, 2);
      assert.deepEqual(m.llamadas.lanzados, ['DEV', 'DEV']);
      assert.equal(m.llamadas.copiado.length, 2);
      assert.equal(m.llamadas.instantaneas.length, 2);
      assert.strictEqual(m.llamadas.esperas[1].previos, m.llamadas.instantaneas[1]);
      await crearObjeto(m.deps, ARGS);
      assert.deepEqual(m.llamadas.lanzados, ['DEV', 'DEV'], 'tras relanzar, la creación vuelve a estar en curso');
    });

    test('relanzar: true sin creación en curso → igual que una primera llamada', async () => {
      const m = montaje();
      await crearObjeto(m.deps, { ...ARGS, relanzar: true });
      assert.deepEqual(m.llamadas.orden, ['guia', 'lanzar', 'copiar', 'esperar']);
    });

    test('relanzar cancelado en el cuadro: cancelado y ya no hay creación en curso', async () => {
      const m = montaje();
      await crearObjeto(m.deps, ARGS);
      m.opciones.aceptaGuia = false;
      const { json } = await crearObjeto(m.deps, { ...ARGS, relanzar: true });
      assert.deepEqual(json, { estado: 'cancelado', nombre: 'ZTEST_NUEVO' });
      assert.deepEqual(m.llamadas.lanzados, ['DEV']);
      m.opciones.aceptaGuia = true;
      await crearObjeto(m.deps, ARGS);
      assert.deepEqual(m.llamadas.lanzados, ['DEV', 'DEV']);
    });

    test('llamada simultánea con el cuadro abierto → pendiente al momento, sin segundo cuadro ni espera', async () => {
      let responder: (acepta: boolean) => void = () => undefined;
      const m = montaje({ respuestaGuia: () => new Promise<boolean>((resolver) => (responder = resolver)) });
      const primera = crearObjeto(m.deps, ARGS);
      await new Promise<void>((resolver) => setImmediate(resolver));
      const segunda = await crearObjeto(m.deps, ARGS);
      assert.deepEqual(segunda.json, { estado: 'pendiente', nombre: 'ZTEST_NUEVO', indicacion: INDICACION_PENDIENTE });
      assert.equal(m.llamadas.guias.length, 1);
      assert.equal(m.llamadas.esperas.length, 0);
      const conRelanzar = await crearObjeto(m.deps, { ...ARGS, relanzar: true });
      assert.equal(conRelanzar.json?.estado, 'pendiente', 'relanzar no abre otro cuadro mientras hay uno abierto');
      assert.equal(m.llamadas.guias.length, 1);
      responder(true);
      assert.equal((await primera).json?.estado, 'pendiente');
      assert.deepEqual(m.llamadas.lanzados, ['DEV']);
      await crearObjeto(m.deps, ARGS);
      assert.deepEqual(m.llamadas.lanzados, ['DEV'], 'aceptado el cuadro, la marca pasa a creación en curso');
      assert.equal(m.llamadas.esperas.length, 2);
    });

    test('llamada simultánea y el cuadro se cancela: la marca se quita', async () => {
      let responder: (acepta: boolean) => void = () => undefined;
      const m = montaje({ respuestaGuia: () => new Promise<boolean>((resolver) => (responder = resolver)) });
      const primera = crearObjeto(m.deps, ARGS);
      await new Promise<void>((resolver) => setImmediate(resolver));
      responder(false);
      assert.equal((await primera).json?.estado, 'cancelado');
      m.opciones.respuestaGuia = undefined;
      await crearObjeto(m.deps, ARGS);
      assert.equal(m.llamadas.guias.length, 2);
      assert.deepEqual(m.llamadas.lanzados, ['DEV']);
    });

    test('dos esperas solapadas que encuentran el mismo objeto: las dos responden creado y el diario se anota una vez', async () => {
      const m = montaje({ esperasManuales: true });
      const primera = crearObjeto(m.deps, ARGS);
      await new Promise<void>((resolver) => setImmediate(resolver));
      const segunda = crearObjeto(m.deps, ARGS);
      await new Promise<void>((resolver) => setImmediate(resolver));
      assert.equal(m.llamadas.esperas.length, 2);
      m.resolverEsperas({ uri: URI_CREADO, paquete: 'ZPAQ1' });
      const resultados = await Promise.all([primera, segunda]);
      assert.deepEqual(resultados.map(({ json }) => json?.estado), ['creado', 'creado']);
      assert.equal(m.llamadas.diario.length, 1);
    });

    test('una espera antigua y otra de relanzar que encuentran el objeto: diario una vez', async () => {
      const m = montaje({ esperasManuales: true });
      const antigua = crearObjeto(m.deps, ARGS);
      await new Promise<void>((resolver) => setImmediate(resolver));
      const relanzada = crearObjeto(m.deps, { ...ARGS, relanzar: true });
      await new Promise<void>((resolver) => setImmediate(resolver));
      assert.deepEqual(m.llamadas.lanzados, ['DEV', 'DEV']);
      m.resolverEsperas({ uri: URI_CREADO, paquete: 'ZPAQ1' });
      await Promise.all([antigua, relanzada]);
      assert.equal(m.llamadas.diario.length, 1);
    });

    test('una creación nueva tras una encontrada vuelve a anotar el diario', async () => {
      const m = montaje({ creado: { uri: URI_CREADO, paquete: 'ZPAQ1' } });
      await crearObjeto(m.deps, ARGS);
      await crearObjeto(m.deps, ARGS);
      assert.deepEqual(m.llamadas.lanzados, ['DEV', 'DEV']);
      assert.equal(m.llamadas.diario.length, 2);
    });

    test('si el portapapeles falla tras lanzar, la herramienta sigue esperando', async () => {
      const m = montaje({ copiarFalla: true, creado: { uri: URI_CREADO, paquete: 'ZPAQ1' } });
      const { r, json } = await crearObjeto(m.deps, ARGS);
      assert.ok(!r.esError, r.texto);
      assert.equal(json?.estado, 'creado');
      assert.deepEqual(m.llamadas.orden, ['guia', 'lanzar', 'copiar', 'esperar']);
    });
  });
});

interface OpcionesDirecto {
  rol?: 'DEV' | 'QAS' | 'PRD';
  sesion?: () => Promise<ResultadoSesion>;
  usuario?: string;
  sinUsuario?: boolean;
  /** Paquete real del programa principal; sin él, el programa no existe. */
  paquete?: string;
  /** Orden única abierta del programa principal; sin ella, ninguna o varias. */
  ordenAbierta?: string;
  acepta?: boolean;
  crear?: () => Promise<RespuestaAdt>;
  abrir?: () => Promise<string | undefined>;
  sinDiario?: boolean;
  diarioFalla?: boolean;
}

interface MontajeDirecto {
  deps: DependenciasSistema;
  llamadas: {
    /** Secuencia de todas las dependencias con efecto, incluidas las del asistente (que no deben aparecer). */
    secuencia: string[];
    paquetes: { conexion: ConexionAdt; nombre: string }[];
    ordenes: { destino: string; programa: string }[];
    confirmaciones: { mensaje: string; detalle: string }[];
    crear: { conexion: ConexionAdt; ruta: string; cuerpo: string; contentType: string; parametros?: Record<string, string> }[];
    abrir: { r: ResultadoBusqueda; destino: string }[];
    esperas: number[];
    diario: { uri: string; entrada: NuevaEntrada }[];
  };
}

const URI_INCLUDE = 'abap:/repotree-v1/DEV/Local Objects ($TMP)/USUARIO/Source Code Library/Includes/ZTEST_TOP/ztest_top.prog.abap';

function montajeDirecto(opciones: OpcionesDirecto = {}): MontajeDirecto {
  const llamadas: MontajeDirecto['llamadas'] = {
    secuencia: [],
    paquetes: [],
    ordenes: [],
    confirmaciones: [],
    crear: [],
    abrir: [],
    esperas: [],
    diario: [],
  };
  const { secuencia } = llamadas;
  const base = dependencias(opciones.sesion ?? rfc, { sistemaPorDefecto: 'DEV' }).deps;
  const deps: DependenciasSistema = {
    ...base,
    rolDe: () => ('rol' in opciones ? opciones.rol : 'DEV'),
    sesionSilenciosa: async () => {
      secuencia.push('sesion');
      return (opciones.sesion ?? rfc)();
    },
    copiar: async () => {
      secuencia.push('copiar');
    },
    confirmarGuia: async () => {
      secuencia.push('guia');
      return true;
    },
    lanzarAsistente: async () => {
      secuencia.push('lanzar');
      return { ok: true };
    },
    esperarObjeto: async () => {
      secuencia.push('esperarObjeto');
      return undefined;
    },
    usuarioDe: () => (opciones.sinUsuario ? undefined : (opciones.usuario ?? 'USUARIO')),
    paqueteDePrograma: async (conexion, nombre) => {
      secuencia.push('paquete');
      llamadas.paquetes.push({ conexion, nombre });
      return opciones.paquete;
    },
    ordenAbiertaDe: async (destino, programa) => {
      secuencia.push('orden');
      llamadas.ordenes.push({ destino, programa });
      return opciones.ordenAbierta;
    },
    confirmarCreacion: async (mensaje, detalle) => {
      secuencia.push('confirmar');
      llamadas.confirmaciones.push({ mensaje, detalle });
      return opciones.acepta ?? true;
    },
    crear: async (conexion, ruta, cuerpo, contentType, parametros) => {
      secuencia.push('crear');
      llamadas.crear.push({ conexion, ruta, cuerpo, contentType, ...(parametros ? { parametros } : {}) });
      return opciones.crear ? opciones.crear() : { estado: 200, cuerpo: '' };
    },
    abrirCreado: async (r, destino) => {
      secuencia.push('abrir');
      llamadas.abrir.push({ r, destino });
      return opciones.abrir ? opciones.abrir() : URI_INCLUDE;
    },
    esperar: async (ms) => {
      llamadas.esperas.push(ms);
    },
    ...(opciones.sinDiario
      ? {}
      : {
          anotarDiario: async (uri: string, entrada: NuevaEntrada) => {
            secuencia.push('diario');
            llamadas.diario.push({ uri, entrada });
            if (opciones.diarioFalla) throw new Error('disco');
          },
        }),
  };
  return { deps, llamadas };
}

const ARGS_INCLUDE = { tipo: 'INCL', nombre: 'ztest_top', descripcion: 'Datos globales', programaPrincipal: 'ztest' };
const INDICACION_INCLUDE = 'escribe el código con proponer_cambio y textoCompleto; recuerda añadir la sentencia INCLUDE en ZTEST si falta';

function fixtureCreacion(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real/creacion', nombre), 'utf8');
}

function normalizarXml(xml: string): string {
  return xml.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
}

suite('IA: crear_objeto directo (include de un programa que ya existe)', () => {
  test('rol QAS, PRD o sin rol: rechazado antes de abrir sesión, buscar ni preguntar', async () => {
    for (const rol of ['QAS', 'PRD', undefined] as const) {
      const m = montajeDirecto({ rol, paquete: '$TMP' });
      const { r } = await crearObjeto(m.deps, ARGS_INCLUDE);
      assert.ok(r.esError);
      assert.ok(r.texto.startsWith(`rechazado por rol: DEV tiene rol ${rol ?? 'sin asignar'}`), r.texto);
      assert.deepEqual(m.llamadas.secuencia, []);
    }
  });

  test('programaPrincipal con un tipo que no es INCL, sin tipo o mal formado: error de validación sin tocar nada', async () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ ...ARGS_INCLUDE, tipo: 'PROG' }, 'programaPrincipal solo vale para includes'],
      [{ nombre: 'ztest_top', descripcion: 'Datos globales', programaPrincipal: 'ztest' }, 'programaPrincipal solo vale para includes: indica tipo INCL'],
      [{ ...ARGS_INCLUDE, programaPrincipal: '1abc' }, 'el programa principal no tiene un nombre válido'],
    ];
    for (const [args, motivo] of casos) {
      const m = montajeDirecto({ paquete: '$TMP' });
      const { r } = await crearObjeto(m.deps, args);
      assert.ok(r.esError);
      assert.equal(r.texto, motivo);
      assert.deepEqual(m.llamadas.secuencia, []);
    }
  });

  test('sin conexión ADT propia: error exacto, sin buscar el programa ni preguntar', async () => {
    for (const estado of ['sinContrasena', 'noAutorizado'] as const) {
      const m = montajeDirecto({ sesion: async () => ({ estado }), paquete: '$TMP' });
      const { r } = await crearObjeto(m.deps, { ...ARGS_INCLUDE, sistema: 'DEV' });
      assert.ok(r.esError);
      assert.equal(r.texto, 'Sin conexión ADT propia con DEV: conéctate (o busca una vez) y vuelve a intentarlo');
      assert.deepEqual(m.llamadas.secuencia, ['sesion']);
    }
  });

  test('sin usuario conocido del destino: error, sin buscar el programa', async () => {
    const m = montajeDirecto({ sinUsuario: true, paquete: '$TMP' });
    const { r } = await crearObjeto(m.deps, ARGS_INCLUDE);
    assert.ok(r.esError);
    assert.equal(r.texto, 'no se conoce el usuario de DEV');
    assert.deepEqual(m.llamadas.secuencia, ['sesion']);
  });

  test('el programa principal no existe: error exacto, sin órdenes, cuadro ni POST', async () => {
    const m = montajeDirecto();
    const { r } = await crearObjeto(m.deps, ARGS_INCLUDE);
    assert.ok(r.esError);
    assert.equal(r.texto, 'no existe el programa ZTEST en DEV: créalo antes (crear_objeto sin programaPrincipal) o revisa el nombre');
    assert.deepEqual(m.llamadas.secuencia, ['sesion', 'paquete']);
    assert.deepEqual(m.llamadas.paquetes, [{ conexion: CONEXION, nombre: 'ZTEST' }]);
  });

  test('paquete local: sin orden, cuadro exacto, POST con el cuerpo real, abre, diario y creado', async () => {
    const m = montajeDirecto({ paquete: '$TMP' });
    const args = {
      tipo: 'incl',
      nombre: 'zprog_ejemplo_top',
      descripcion: 'Ejemplo Sextante: include sin contexto',
      programaPrincipal: 'zprog_ejemplo',
      sistema: 'DEV',
    };
    const { r, json } = await crearObjeto(m.deps, args);
    assert.ok(!r.esError, r.texto);
    assert.deepEqual(m.llamadas.secuencia, ['sesion', 'paquete', 'confirmar', 'crear', 'abrir', 'diario']);
    assert.deepEqual(m.llamadas.confirmaciones, [
      {
        mensaje: 'El agente pide crear el include ZPROG_EJEMPLO_TOP «Ejemplo Sextante: include sin contexto» en DEV.',
        detalle: 'Paquete: $TMP (el del programa ZPROG_EJEMPLO).\nObjeto local: sin orden de transporte.',
      },
    ]);
    assert.equal(m.llamadas.crear.length, 1);
    const [post] = m.llamadas.crear;
    assert.strictEqual(post.conexion, CONEXION);
    assert.equal(post.ruta, '/sap/bc/adt/programs/includes');
    assert.equal(post.contentType, 'application/vnd.sap.adt.programs.includes.v2+xml');
    assert.equal('parametros' in post, false);
    assert.equal(normalizarXml(post.cuerpo), normalizarXml(fixtureCreacion('crear-incl.enviado.xml')));
    assert.deepEqual(m.llamadas.abrir, [
      {
        r: {
          nombre: 'ZPROG_EJEMPLO_TOP',
          tipo: 'PROG/I',
          descripcion: 'Ejemplo Sextante: include sin contexto',
          paquete: '$TMP',
          uriAdt: '/sap/bc/adt/programs/includes/zprog_ejemplo_top',
        },
        destino: 'DEV',
      },
    ]);
    assert.deepEqual(m.llamadas.diario, [
      { uri: URI_INCLUDE, entrada: { tipo: 'creado', descripcion: 'Ejemplo Sextante: include sin contexto', paquete: '$TMP' } },
    ]);
    assert.deepEqual(json, {
      estado: 'creado',
      uri: URI_INCLUDE,
      nombre: 'ZPROG_EJEMPLO_TOP',
      paquete: '$TMP',
      programaPrincipal: 'ZPROG_EJEMPLO',
      indicacion:
        'escribe el código con proponer_cambio y textoCompleto; recuerda añadir la sentencia INCLUDE en ZPROG_EJEMPLO si falta',
    });
  });

  test('otro paquete local ($ZDEMO): tampoco consulta órdenes', async () => {
    const m = montajeDirecto({ paquete: '$ZDEMO' });
    const { json } = await crearObjeto(m.deps, ARGS_INCLUDE);
    assert.equal(json?.estado, 'creado');
    assert.equal(json?.paquete, '$ZDEMO');
    assert.equal(m.llamadas.ordenes.length, 0);
    assert.ok(m.llamadas.crear[0].cuerpo.includes('<adtcore:packageRef adtcore:name="$ZDEMO"/>'));
  });

  test('paquete transportable con una orden abierta: corrNr, cuadro con la orden y orden en el resultado', async () => {
    const m = montajeDirecto({ paquete: 'ZPAQ1', ordenAbierta: 'DEVK900001' });
    const { r, json } = await crearObjeto(m.deps, ARGS_INCLUDE);
    assert.ok(!r.esError, r.texto);
    assert.deepEqual(m.llamadas.secuencia, ['sesion', 'paquete', 'orden', 'confirmar', 'crear', 'abrir', 'diario']);
    assert.deepEqual(m.llamadas.ordenes, [{ destino: 'DEV', programa: 'ZTEST' }]);
    assert.deepEqual(m.llamadas.confirmaciones, [
      {
        mensaje: 'El agente pide crear el include ZTEST_TOP «Datos globales» en DEV.',
        detalle: 'Paquete: ZPAQ1 (el del programa ZTEST).\nOrden de transporte: DEVK900001 (la del programa).',
      },
    ]);
    assert.deepEqual(m.llamadas.crear[0].parametros, { corrNr: 'DEVK900001' });
    assert.ok(m.llamadas.crear[0].cuerpo.includes('<adtcore:packageRef adtcore:name="ZPAQ1"/>'));
    assert.deepEqual(m.llamadas.diario[0].entrada, { tipo: 'creado', descripcion: 'Datos globales', paquete: 'ZPAQ1' });
    assert.deepEqual(json, {
      estado: 'creado',
      uri: URI_INCLUDE,
      nombre: 'ZTEST_TOP',
      paquete: 'ZPAQ1',
      orden: 'DEVK900001',
      programaPrincipal: 'ZTEST',
      indicacion: INDICACION_INCLUDE,
    });
  });

  test('paquete transportable sin una única orden abierta: asistente, sin cuadro ni POST', async () => {
    const m = montajeDirecto({ paquete: 'ZPAQ1' });
    const { r, json } = await crearObjeto(m.deps, ARGS_INCLUDE);
    assert.ok(!r.esError, r.texto);
    assert.deepEqual(json, {
      estado: 'asistente',
      nombre: 'ZTEST_TOP',
      indicacion:
        'el programa ZTEST no está en una única orden abierta: crea el include con crear_objeto sin programaPrincipal para que el usuario elija la orden en el asistente de SAP',
    });
    assert.deepEqual(m.llamadas.secuencia, ['sesion', 'paquete', 'orden']);
  });

  test('cancelar el cuadro: cancelado sin POST, apertura ni diario', async () => {
    const m = montajeDirecto({ paquete: '$TMP', acepta: false });
    const { r, json } = await crearObjeto(m.deps, ARGS_INCLUDE);
    assert.ok(!r.esError, r.texto);
    assert.deepEqual(json, { estado: 'cancelado', nombre: 'ZTEST_TOP' });
    assert.deepEqual(m.llamadas.secuencia, ['sesion', 'paquete', 'confirmar']);
  });

  test('SAP rechaza con <message>: HTTP y texto legible, sin abrir ni diario', async () => {
    const m = montajeDirecto({
      paquete: '$TMP',
      crear: async () => {
        throw new ErrorAdt(
          'x',
          400,
          '/ruta',
          '<?xml version="1.0"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><exc:message lang="EN">Nombre &quot;ZTEST_TOP&quot; ya existe</exc:message></exc:exception>',
        );
      },
    });
    const { r } = await crearObjeto(m.deps, ARGS_INCLUDE);
    assert.ok(r.esError);
    assert.equal(r.texto, 'SAP rechazó la creación (HTTP 400): Nombre "ZTEST_TOP" ya existe');
    assert.deepEqual(m.llamadas.secuencia, ['sesion', 'paquete', 'confirmar', 'crear']);
  });

  test('SAP rechaza sin <message>: etiquetas fuera y 300 caracteres; sin cuerpo ni estado: el mensaje sin HTTP', async () => {
    const largo = montajeDirecto({
      paquete: '$TMP',
      crear: async () => {
        throw new ErrorAdt('x', 500, '/ruta', `<a><b>${'y'.repeat(400)}</b></a>`);
      },
    });
    assert.equal((await crearObjeto(largo.deps, ARGS_INCLUDE)).r.texto, `SAP rechazó la creación (HTTP 500): ${'y'.repeat(300)}`);
    const sinRed = montajeDirecto({
      paquete: '$TMP',
      crear: async () => {
        throw new ErrorAdt('sin red', 0, '/ruta');
      },
    });
    assert.equal((await crearObjeto(sinRed.deps, ARGS_INCLUDE)).r.texto, 'SAP rechazó la creación: sin red');
  });

  test('otro error al crear lo recoge la protección común', async () => {
    const m = montajeDirecto({
      paquete: '$TMP',
      crear: async () => {
        throw new Error('boom');
      },
    });
    const { r } = await crearObjeto(m.deps, ARGS_INCLUDE);
    assert.ok(r.esError);
    assert.equal(m.llamadas.abrir.length, 0);
  });

  test('la apertura falla 3 veces: creado sin uri, 2 esperas de 1 s, indicación alternativa y sin diario', async () => {
    let intentos = 0;
    const m = montajeDirecto({
      paquete: '$TMP',
      abrir: async () => {
        intentos++;
        return undefined;
      },
    });
    const { json } = await crearObjeto(m.deps, ARGS_INCLUDE);
    assert.equal(intentos, 3);
    assert.deepEqual(m.llamadas.esperas, [1000, 1000]);
    assert.deepEqual(json, {
      estado: 'creado',
      nombre: 'ZTEST_TOP',
      paquete: '$TMP',
      programaPrincipal: 'ZTEST',
      indicacion: 'ábrelo con abrir_objeto en unos segundos; recuerda añadir la sentencia INCLUDE en ZTEST si falta',
    });
    assert.equal(m.llamadas.diario.length, 0);
  });

  test('la apertura funciona al segundo intento: una sola espera', async () => {
    let intentos = 0;
    const m = montajeDirecto({ paquete: '$TMP', abrir: async () => (++intentos < 2 ? undefined : URI_INCLUDE) });
    const { json } = await crearObjeto(m.deps, ARGS_INCLUDE);
    assert.equal(json?.uri, URI_INCLUDE);
    assert.deepEqual(m.llamadas.esperas, [1000]);
  });

  test('sin diario o con el diario fallando: sigue respondiendo creado', async () => {
    for (const opciones of [{ sinDiario: true }, { diarioFalla: true }]) {
      const m = montajeDirecto({ ...opciones, paquete: '$TMP' });
      const { json } = await crearObjeto(m.deps, ARGS_INCLUDE);
      assert.equal(json?.estado, 'creado');
    }
  });

  test('el modo directo no deja creación en curso: una llamada sin programaPrincipal muestra el cuadro guía', async () => {
    const m = montajeDirecto({ paquete: '$TMP' });
    await crearObjeto(m.deps, ARGS_INCLUDE);
    await crearObjeto(m.deps, { tipo: 'INCL', nombre: 'ztest_top', descripcion: 'Datos globales' });
    assert.deepEqual(m.llamadas.secuencia.slice(-4), ['guia', 'lanzar', 'copiar', 'esperarObjeto']);
  });
});
