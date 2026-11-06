import type { ResultadoBusqueda } from '../adt/busqueda-modelo';
import type { ConexionAdt } from '../adt/conexion-adt';
import type { ResultadoSesion } from '../adt/sesiones';
import { ErrorAdt, type RespuestaAdt } from '../adt/transporte';
import type { Lanzamiento } from '../commands/crear-objeto-modelo';
import type { RolSistema } from '../config/navegador-config';
import {
  CONTENT_TYPE_INCLUDE,
  ESPERA_CREACION_MS,
  INDICACION_CREADO,
  INDICACION_PENDIENTE,
  RUTA_INCLUDES,
  claveCreacion,
  creacionVigente,
  cuerpoInclude,
  indicacionAsistenteInclude,
  indicacionIncludeCreado,
  mensajeRechazoCreacion,
  necesitaOrden,
  parametrosInclude,
  resultadoBusquedaInclude,
  textoConfirmacionInclude,
  textoGuiaCreacion,
  validarCreacion,
  type PeticionCreacion,
  type PeticionInclude,
} from './creacion-modelo';
import type { NuevaEntrada } from './diario-modelo';
import { ESQUEMAS } from './esquemas';
import { argTexto, envolverConProteccion, resultadoError, resultadoJson } from './herramientas';
import type { HerramientaMcp, ResultadoHerramienta } from './mcp-modelo';
import {
  FILAS_CVERS,
  SQL_CVERS,
  componentesDe,
  falloVigente,
  infoDe,
  infoSinConexion,
  releaseDeComponentes,
  type FalloCvers,
  type InfoCacheada,
  type InfoSistema,
} from './sistema-modelo';

export const ORDEN_SISTEMA = ['info_sistema', 'crear_objeto'] as const;

export interface DependenciasSistema {
  sistemaPorDefecto(): string | undefined;
  rolDe(id: string): RolSistema | undefined;
  viaDe(id: string): string | undefined;
  /** `SesionesAdt.sesionSilenciosa`: nunca pide contraseña. */
  sesionSilenciosa(id: string): Promise<ResultadoSesion>;
  /** Data Preview por la conexión: devuelve las filas ya analizadas. */
  consultarSql(conexion: ConexionAdt, sql: string, filas: number): Promise<Record<string, string>[]>;
  /** Caché por destino, sin rol ni vía: se leen frescos en cada llamada. */
  cache: Map<string, InfoCacheada>;
  /** Último fallo de CVERS por destino (caché negativa corta). */
  fallosCvers: Map<string, FalloCvers>;
  ahora?(): number;
  /** Deja el nombre del objeto nuevo en el portapapeles. */
  copiar(texto: string): Promise<void>;
  /** Cuadro modal con lo que se va a crear y los pasos del asistente: true si el usuario lo abre. */
  confirmarGuia(mensaje: string, detalle: string): Promise<boolean>;
  /** Lanza el asistente de la oficial con el destino preseleccionado; no espera a que el usuario termine. */
  lanzarAsistente(destino: string): Promise<Lanzamiento>;
  /** Claves (`claveObjeto`) de los objetos abiertos ahora: se toma una vez, antes de lanzar el asistente. */
  instantaneaObjetos(): ReadonlySet<string>;
  /**
   * Espera hasta `limiteMs` a que haya un editor abap: de `destino` con el objeto `nombre` cuyo objeto no esté en
   * `previos` (ya estaba abierto antes de lanzar el asistente).
   */
  esperarObjeto(
    destino: string,
    nombre: string,
    limiteMs: number,
    previos: ReadonlySet<string>,
  ): Promise<{ uri: string; paquete: string } | undefined>;
  anotarDiario?(uri: string, entrada: NuevaEntrada): Promise<void>;
  /** Modo directo (include de un programa que ya existe): usuario SAP del destino, para `adtcore:responsible`. */
  usuarioDe(id: string): string | undefined;
  /** Paquete real del programa con ese nombre exacto según la búsqueda ADT; undefined si no existe. */
  paqueteDePrograma(conexion: ConexionAdt, nombre: string): Promise<string | undefined>;
  /** Número de la única orden modificable en la que está el programa; undefined si hay ninguna o varias. */
  ordenAbiertaDe(destino: string, programa: string): Promise<string | undefined>;
  /** Cuadro modal con botón «Crear»: true si el usuario lo pulsa. */
  confirmarCreacion(mensaje: string, detalle: string): Promise<boolean>;
  /** `ConexionAdt.post`. */
  crear(conexion: ConexionAdt, ruta: string, cuerpo: string, contentType: string, parametros?: Record<string, string>): Promise<RespuestaAdt>;
  /** Mismo camino que abrir_objeto; la uri abap: abierta o undefined si la oficial aún no lo ve. */
  abrirCreado(r: ResultadoBusqueda, destino: string): Promise<string | undefined>;
  esperar?(ms: number): Promise<void>;
}

type NombreSistema = (typeof ORDEN_SISTEMA)[number];

/** Una creación lanzada y aún no vista en el editor; `previos`, los objetos abiertos antes de lanzarla. */
interface CreacionEnCurso {
  fase: 'lanzada';
  lanzado: number;
  previos: ReadonlySet<string>;
}

/** El cuadro guía de esa clave está abierto: otra llamada no muestra un segundo cuadro. */
interface CreacionEnConfirmacion {
  fase: 'confirmando';
}
type SesionAbierta = Extract<ResultadoSesion, { estado: 'ok' }>;
type Ejecutor = (args: Record<string, unknown>) => Promise<ResultadoHerramienta>;

const DESCRIPCIONES: Record<NombreSistema, string> = {
  info_sistema:
    'Llama a esta herramienta antes de razonar sobre el release, las sentencias ABAP disponibles o clases estándar: ' +
    'devuelve release y componentes reales del sistema. Nunca asumas el release.',
  crear_objeto:
    'Objeto principal (programa, clase, grupo de funciones…): sin programaPrincipal, va por el asistente de SAP. ' +
    'Include de un programa que ya existe: pasa tipo INCL y programaPrincipal y Sextante lo crea directo en el paquete ' +
    'y la orden del programa tras un clic del usuario; si responde asistente, el programa no está en una única orden ' +
    'abierta: repite sin programaPrincipal. ' +
    'Úsala cuando el usuario pida crear un objeto ABAP: Sextante le muestra al usuario un cuadro con lo que se va a crear ' +
    'y los pasos del asistente; si lo acepta, abre el asistente de la extensión oficial con el sistema elegido y deja el ' +
    'nombre en el portapapeles; el usuario elige ahí el tipo, el paquete y la orden de transporte (puede crear una orden ' +
    'nueva). Devuelve la uri cuando el objeto aparece en el editor; si responde cancelado, el usuario no quiso abrir el ' +
    'asistente; si responde pendiente, vuelve a llamar con el mismo nombre para seguir esperando; no relanza el ' +
    'asistente. Si el usuario cerró el asistente y quiere repetirlo, llama con relanzar: true (vuelve a mostrar el ' +
    'cuadro). Solo DEV. Después escribe el código con proponer_cambio (textoCompleto). Nunca crees ' +
    'objetos por otra vía ni guardes código en archivos locales.',
};

const MSG_SIN_SISTEMA = 'indica el sistema o abre un objeto';
const INDICACION_RECHAZADA = 'la credencial guardada fue rechazada';
const MAX_MENSAJE = 120;
const MAX_TEXTO_SERVIDOR = 300;
const INTENTOS_ABRIR = 3;
const ESPERA_ABRIR_MS = 1000;
const MENSAJE_SERVIDOR = /<(?:[\w.-]+:)?message\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?message>/i;

function esperaReal(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

function desescaparXml(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function mensajeCorto(error: unknown): string {
  const texto = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();
  return texto.length > MAX_MENSAJE ? texto.slice(0, MAX_MENSAJE) + '…' : texto;
}

/** Texto del `<message>` de un error ADT; si no hay, el cuerpo sin etiquetas. Nunca se registra. */
function textoLegible(error: ErrorAdt): string {
  const cuerpo = error.cuerpo ?? '';
  const mensaje = MENSAJE_SERVIDOR.exec(cuerpo)?.[1];
  const crudo = mensaje ?? cuerpo.replace(/<[^>]*>/g, ' ');
  const limpio = desescaparXml(crudo).replace(/\s+/g, ' ').trim();
  return (limpio === '' ? mensajeCorto(error) : limpio).slice(0, MAX_TEXTO_SERVIDOR);
}

function fuenteDe(sesion: SesionAbierta): InfoCacheada['fuente'] {
  return sesion.via === 'rfc' ? 'rfc' : 'rest';
}

function releaseDelLogon(sesion: SesionAbierta): string | undefined {
  return sesion.sistema?.release || undefined;
}

/** Lee CVERS salvo que haya fallado hace poco; solo cachea si la lectura fue bien. */
async function leerCvers(
  deps: DependenciasSistema,
  id: string,
  sesion: SesionAbierta,
): Promise<{ datos: InfoCacheada; indicacion?: string }> {
  const fuente = fuenteDe(sesion);
  const delLogon = releaseDelLogon(sesion);
  const soloLogon: InfoCacheada = { ...(delLogon ? { release: delLogon } : {}), fuente };
  const ahora = (deps.ahora ?? Date.now)();
  const fallo = deps.fallosCvers.get(id);
  if (falloVigente(fallo, ahora)) return { datos: soloLogon, indicacion: fallo.indicacion };
  deps.fallosCvers.delete(id);
  try {
    const componentes = componentesDe(await deps.consultarSql(sesion.conexion, SQL_CVERS, FILAS_CVERS));
    const release = delLogon ?? releaseDeComponentes(componentes);
    const datos: InfoCacheada = { ...(release ? { release } : {}), componentes, fuente };
    deps.cache.set(id, datos);
    return { datos };
  } catch (error) {
    const indicacion = `no se pudo leer CVERS: ${mensajeCorto(error)}`;
    deps.fallosCvers.set(id, { instante: ahora, indicacion });
    return { datos: soloLogon, indicacion };
  }
}

async function leerInfo(deps: DependenciasSistema, id: string): Promise<InfoSistema> {
  const rol = deps.rolDe(id);
  const via = deps.viaDe(id);
  const cacheada = deps.cache.get(id);
  if (cacheada?.componentes !== undefined) return infoDe(id, rol, via, cacheada);
  const sesion = await deps.sesionSilenciosa(id);
  if (sesion.estado !== 'ok') {
    const sin = infoSinConexion(id, rol, via);
    if (sesion.estado === 'noAutorizado') {
      return { ...sin, indicacion: `${INDICACION_RECHAZADA}; ${sin.indicacion ?? ''}` };
    }
    return sin;
  }
  const { datos, indicacion } = await leerCvers(deps, id, sesion);
  return infoDe(id, rol, via, datos, indicacion);
}

/**
 * Para contexto_actual: release en caché, el del logon RFC (sin consultar CVERS) o, solo por REST, el de CVERS.
 * undefined si no hay. Nunca rechaza.
 */
export async function releaseDe(deps: DependenciasSistema, id: string): Promise<string | undefined> {
  try {
    const cacheada = deps.cache.get(id);
    if (cacheada !== undefined) return cacheada.release;
    const sesion = await deps.sesionSilenciosa(id);
    if (sesion.estado !== 'ok') return undefined;
    const delLogon = releaseDelLogon(sesion);
    if (delLogon !== undefined) {
      deps.cache.set(id, { release: delLogon, fuente: fuenteDe(sesion) });
      return delLogon;
    }
    return (await leerCvers(deps, id, sesion)).datos.release;
  } catch {
    return undefined;
  }
}

export function crearCatalogoSistema(deps: DependenciasSistema): HerramientaMcp[] {
  const infoSistema: Ejecutor = async (args) => {
    const id = argTexto(args, 'sistema') ?? deps.sistemaPorDefecto();
    if (id === undefined) return resultadoError(MSG_SIN_SISTEMA);
    return resultadoJson(await leerInfo(deps, id));
  };

  const anotarCreado = async (uri: string, descripcion: string, paquete: string): Promise<void> => {
    if (deps.anotarDiario === undefined) return;
    try {
      await deps.anotarDiario(uri, { tipo: 'creado', descripcion, paquete });
    } catch {
      // el diario es un extra: no debe estropear una creación ya hecha
    }
  };

  const esperar = deps.esperar ?? esperaReal;

  const abrirConReintentos = async (r: ResultadoBusqueda, destino: string): Promise<string | undefined> => {
    for (let intento = 1; intento <= INTENTOS_ABRIR; intento++) {
      const uri = await deps.abrirCreado(r, destino);
      if (uri !== undefined) return uri;
      if (intento < INTENTOS_ABRIR) await esperar(ESPERA_ABRIR_MS);
    }
    return undefined;
  };

  /** El paquete del programa principal y, si es transportable, su única orden abierta; o por qué no se crea directo. */
  const resolverDestinoInclude = async (
    destino: string,
    sesion: SesionAbierta,
    peticion: PeticionCreacion,
    principal: string,
  ): Promise<{ include: PeticionInclude } | { fallo: ResultadoHerramienta }> => {
    const paquete = await deps.paqueteDePrograma(sesion.conexion, principal);
    if (paquete === undefined) {
      return {
        fallo: resultadoError(
          `no existe el programa ${principal} en ${destino}: créalo antes (crear_objeto sin programaPrincipal) o revisa el nombre`,
        ),
      };
    }
    const include: PeticionInclude = { nombre: peticion.nombre, descripcion: peticion.descripcion, programaPrincipal: principal, paquete };
    if (!necesitaOrden(paquete)) return { include };
    const orden = await deps.ordenAbiertaDe(destino, principal);
    if (orden === undefined) {
      return { fallo: resultadoJson({ estado: 'asistente', nombre: peticion.nombre, indicacion: indicacionAsistenteInclude(principal) }) };
    }
    return { include: { ...include, orden } };
  };

  /** Modo directo: un include de un programa que ya existe, en su paquete y su orden, tras el clic en «Crear». */
  const crearIncludeDirecto = async (destino: string, peticion: PeticionCreacion, principal: string): Promise<ResultadoHerramienta> => {
    const sesion = await deps.sesionSilenciosa(destino);
    if (sesion.estado !== 'ok') {
      return resultadoError(`Sin conexión ADT propia con ${destino}: conéctate (o busca una vez) y vuelve a intentarlo`);
    }
    const usuario = deps.usuarioDe(destino);
    if (usuario === undefined) return resultadoError(`no se conoce el usuario de ${destino}`);
    const resuelto = await resolverDestinoInclude(destino, sesion, peticion, principal);
    if ('fallo' in resuelto) return resuelto.fallo;
    const { include } = resuelto;
    const { mensaje, detalle } = textoConfirmacionInclude(include, destino);
    if (!(await deps.confirmarCreacion(mensaje, detalle))) return resultadoJson({ estado: 'cancelado', nombre: include.nombre });
    try {
      await deps.crear(sesion.conexion, RUTA_INCLUDES, cuerpoInclude(include, usuario), CONTENT_TYPE_INCLUDE, parametrosInclude(include));
    } catch (error) {
      if (error instanceof ErrorAdt) return resultadoError(mensajeRechazoCreacion(error.estado, textoLegible(error)));
      throw error;
    }
    const uri = await abrirConReintentos(resultadoBusquedaInclude(include), destino);
    if (uri !== undefined) await anotarCreado(uri, include.descripcion, include.paquete);
    return resultadoJson({
      estado: 'creado',
      ...(uri !== undefined ? { uri } : {}),
      nombre: include.nombre,
      paquete: include.paquete,
      ...(include.orden !== undefined ? { orden: include.orden } : {}),
      programaPrincipal: principal,
      indicacion: indicacionIncludeCreado(principal, uri !== undefined),
    });
  };

  const enCurso = new Map<string, CreacionEnCurso | CreacionEnConfirmacion>();
  /**
   * Claves cuyo objeto ya se encontró desde el último lanzamiento: varias esperas solapadas (una antigua que sigue
   * esperando, una de `relanzar`) responden `creado`, pero el diario se anota una sola vez.
   */
  const anotados = new Set<string>();
  const ahora = (): number => (deps.ahora ?? Date.now)();

  /** Cuadro guía con la clave marcada «en confirmación»: true si el usuario lo acepta. La marca se quita siempre. */
  const confirmar = async (clave: string, destino: string, peticion: PeticionCreacion): Promise<boolean> => {
    const marca: CreacionEnConfirmacion = { fase: 'confirmando' };
    enCurso.set(clave, marca);
    try {
      const { mensaje, detalle } = textoGuiaCreacion(peticion, destino);
      return await deps.confirmarGuia(mensaje, detalle);
    } finally {
      if (enCurso.get(clave) === marca) enCurso.delete(clave);
    }
  };

  /**
   * Si ya hay una creación vigente para esa clave (y no se pide `relanzar`), la devuelve sin mostrar nada; si su cuadro
   * guía sigue abierto, responde `enConfirmacion`. Si no, muestra el cuadro y, si el usuario lo acepta, lanza el
   * asistente y copia el nombre.
   */
  const lanzarSiHaceFalta = async (
    clave: string,
    destino: string,
    peticion: PeticionCreacion,
    relanzar: boolean,
  ): Promise<CreacionEnCurso | { motivo: string } | { cancelado: true } | { enConfirmacion: true }> => {
    const actual = enCurso.get(clave);
    if (actual?.fase === 'confirmando') return { enConfirmacion: true };
    if (actual !== undefined && !relanzar && creacionVigente(actual.lanzado, ahora())) return actual;
    enCurso.delete(clave);
    if (!(await confirmar(clave, destino, peticion))) return { cancelado: true };
    // Se registra antes de lanzar para que una llamada simultánea espere en vez de abrir otro asistente.
    const nueva: CreacionEnCurso = { fase: 'lanzada', lanzado: ahora(), previos: deps.instantaneaObjetos() };
    enCurso.set(clave, nueva);
    anotados.delete(clave);
    const lanzamiento = await deps.lanzarAsistente(destino);
    if (!lanzamiento.ok) {
      if (enCurso.get(clave) === nueva) enCurso.delete(clave);
      return { motivo: lanzamiento.motivo };
    }
    try {
      await deps.copiar(peticion.nombre);
    } catch {
      // el asistente ya está abierto y el cuadro guía mostró el nombre: sin portapapeles se sigue esperando
    }
    return nueva;
  };

  const crearObjeto: Ejecutor = async (args) => {
    const destino = argTexto(args, 'sistema') ?? deps.sistemaPorDefecto();
    if (destino === undefined) return resultadoError(MSG_SIN_SISTEMA);
    const rol = deps.rolDe(destino);
    if (rol !== 'DEV') {
      return resultadoError(`rechazado por rol: ${destino} tiene rol ${rol ?? 'sin asignar'}; en QAS, PRD o sin rol el agente solo analiza`);
    }
    const validacion = validarCreacion(args);
    if (!validacion.ok) return resultadoError(validacion.motivo);
    const { peticion } = validacion;
    if (peticion.programaPrincipal !== undefined) return crearIncludeDirecto(destino, peticion, peticion.programaPrincipal);
    const clave = claveCreacion(destino, peticion.nombre);
    const pendiente = resultadoJson({ estado: 'pendiente', nombre: peticion.nombre, indicacion: INDICACION_PENDIENTE });
    const entrada = await lanzarSiHaceFalta(clave, destino, peticion, args.relanzar === true);
    if ('motivo' in entrada) return resultadoError(entrada.motivo);
    if ('cancelado' in entrada) return resultadoJson({ estado: 'cancelado', nombre: peticion.nombre });
    if ('enConfirmacion' in entrada) return pendiente;
    const creado = await deps.esperarObjeto(destino, peticion.nombre, ESPERA_CREACION_MS, entrada.previos);
    if (creado === undefined) return pendiente;
    if (enCurso.get(clave) === entrada) enCurso.delete(clave);
    if (!anotados.has(clave)) {
      anotados.add(clave);
      await anotarCreado(creado.uri, peticion.descripcion, creado.paquete);
    }
    return resultadoJson({ estado: 'creado', uri: creado.uri, nombre: peticion.nombre, paquete: creado.paquete, indicacion: INDICACION_CREADO });
  };

  const ejecutores: Record<NombreSistema, Ejecutor> = { info_sistema: infoSistema, crear_objeto: crearObjeto };

  return ORDEN_SISTEMA.map((nombre) => ({
    nombre,
    descripcion: DESCRIPCIONES[nombre],
    inputSchema: ESQUEMAS[nombre],
    ejecutar: envolverConProteccion(nombre, ejecutores[nombre]),
  }));
}
