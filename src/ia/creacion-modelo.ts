import type { ResultadoBusqueda } from '../adt/busqueda-modelo';
import { segmentoAdt } from '../adt/fuente-adt';
import type { EstadoOrden } from '../adt/transportes-modelo';
import { BIBLIOTECA_LOCAL, analizarUriAbap, type ObjetoRepotree, type UriMinimo } from '../bridge/adt-uri';

/** Solo informativo en el modo asistente: el usuario elige el tipo real en el asistente de la oficial. */
export const TIPOS_CREABLES = ['PROG', 'INCL', 'CLAS', 'INTF', 'FUGR', 'TABL', 'DDLS'] as const;
export type TipoCreable = (typeof TIPOS_CREABLES)[number];

export interface PeticionCreacion {
  tipo?: TipoCreable;
  nombre: string;
  descripcion: string;
  /** Solo con tipo INCL: el include se crea directo en el paquete y la orden de este programa. */
  programaPrincipal?: string;
}

/** Un include de un programa que ya existe, con el paquete (y la orden) del programa ya resueltos. */
export interface PeticionInclude {
  nombre: string;
  descripcion: string;
  programaPrincipal: string;
  paquete: string;
  orden?: string;
}

export type ValidacionCreacion = { ok: true; peticion: PeticionCreacion } | { ok: false; motivo: string };

/** Lo que `crear_objeto` espera a que el objeto nuevo aparezca en un editor antes de responder pendiente. */
export const ESPERA_CREACION_MS = 60_000;

export const INDICACION_CREADO = 'escribe el código con proponer_cambio y textoCompleto';
/**
 * Mientras una creación lanzada es más joven que esto, otra llamada para el mismo destino y nombre no relanza el
 * asistente: solo vuelve a esperar el objeto.
 */
export const VIGENCIA_CREACION_MS = 10 * 60_000;

export const INDICACION_PENDIENTE =
  'el usuario sigue en el asistente de SAP (o lo canceló). Vuelve a llamar a crear_objeto con el mismo nombre para ' +
  'seguir esperando: no relanza el asistente. Si el usuario dice que lo canceló, no insistas. Si el usuario cerró el ' +
  'asistente y quiere repetir, llama con relanzar: true';

// La spec escribe ^[A-Z][A-Z0-9_/]{0,39}$ pero también exige namespaces (/ABC/X): el "/" solo vale como prefijo de namespace.
const PATRON_NOMBRE = /^(?:\/[A-Z0-9_]{1,10}\/[A-Z0-9_]+|[A-Z][A-Z0-9_]*)$/;
const MAX_NOMBRE = 40;
const MAX_DESCRIPCION = 60;
const PAQUETE_TMP = '$TMP';
const PREFIJO_PAQUETE_LOCAL = '$';
const TIPO_ADT_INCLUDE = 'PROG/I';

// Verificado contra un sistema real el 2026-11-04 (test/fixtures/adt/real/creacion), con paquete local.
export const RUTA_INCLUDES = '/sap/bc/adt/programs/includes';
// Verificado contra un sistema real el 2026-11-04: ADT acepta este tipo como Content-Type y como Accept.
export const CONTENT_TYPE_INCLUDE = 'application/vnd.sap.adt.programs.includes.v2+xml';
/** Tipo ADT de un programa en la búsqueda (busq-prog.xml, busq-sin-desc.xml). */
export const TIPO_ADT_PROGRAMA = 'PROG/P';

const ETIQUETAS_TIPO: Readonly<Record<TipoCreable, string>> = {
  PROG: 'programa',
  INCL: 'include',
  CLAS: 'clase',
  INTF: 'interfaz',
  FUGR: 'grupo de funciones',
  TABL: 'tabla',
  DDLS: 'vista CDS',
};

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/** Un `(NS)X` del repotree es `/NS/X`. */
function deshacerNamespace(segmento: string): string {
  return segmento.replace(/^\(([^)]+)\)(?=.)/, '/$1/');
}

function esTipoCreable(valor: string): valor is TipoCreable {
  return (TIPOS_CREABLES as readonly string[]).includes(valor);
}

export function validarCreacion(args: Record<string, unknown>): ValidacionCreacion {
  const tipo = texto(args.tipo)?.trim().toUpperCase();
  if (tipo !== undefined && !esTipoCreable(tipo)) {
    return { ok: false, motivo: `el tipo debe ser uno de ${TIPOS_CREABLES.join(', ')}` };
  }
  const nombre = texto(args.nombre)?.trim().toUpperCase() ?? '';
  if (nombre.length > MAX_NOMBRE || !PATRON_NOMBRE.test(nombre)) {
    return {
      ok: false,
      motivo: 'el nombre debe tener hasta 40 caracteres, empezar por letra (o por un namespace /NS/) y usar solo A-Z, 0-9 y _',
    };
  }
  const descripcion = texto(args.descripcion)?.trim() ?? '';
  if (descripcion.length < 1 || descripcion.length > MAX_DESCRIPCION || /[\r\n]/.test(descripcion)) {
    return { ok: false, motivo: `la descripción debe tener de 1 a ${MAX_DESCRIPCION} caracteres y ningún salto de línea` };
  }
  const peticion: PeticionCreacion = { ...(tipo !== undefined ? { tipo } : {}), nombre, descripcion };
  const principal = texto(args.programaPrincipal)?.trim().toUpperCase();
  if (!principal) {
    return { ok: true, peticion };
  }
  if (tipo === undefined) {
    return { ok: false, motivo: 'programaPrincipal solo vale para includes: indica tipo INCL' };
  }
  if (tipo !== 'INCL') {
    return { ok: false, motivo: 'programaPrincipal solo vale para includes' };
  }
  if (principal.length > MAX_NOMBRE || !PATRON_NOMBRE.test(principal)) {
    return { ok: false, motivo: 'el programa principal no tiene un nombre válido' };
  }
  return { ok: true, peticion: { ...peticion, programaPrincipal: principal } };
}

/** Los paquetes locales (`$TMP`, `$ZDEMO`…) no se transportan. */
export function necesitaOrden(paquete: string): boolean {
  return !paquete.startsWith(PREFIJO_PAQUETE_LOCAL);
}

/**
 * La única orden modificable en la que está el programa (como «Orden del objeto»). Ninguna, varias o una lista
 * truncada → undefined: el usuario elige la orden en el asistente.
 */
export function ordenUnicaModificable(
  resultado: { ordenes: readonly { numero: string; estado: EstadoOrden }[]; truncado?: unknown } | undefined,
): string | undefined {
  if (resultado === undefined || resultado.truncado !== undefined) {
    return undefined;
  }
  const abiertas = new Set(resultado.ordenes.filter((o) => o.estado === 'modificable').map((o) => o.numero));
  return abiertas.size === 1 ? [...abiertas][0] : undefined;
}

export function mensajeRechazoCreacion(estado: number, texto: string): string {
  return estado > 0 ? `SAP rechazó la creación (HTTP ${estado}): ${texto}` : `SAP rechazó la creación: ${texto}`;
}

export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Cuerpo del POST de un include. Verificado contra un sistema real el 2026-11-04 para paquete local
 * (crear-incl.enviado.xml). Sin `contextRef`: SAP lo acepta pero no lo guarda (get-incl-ctx, contextRefCount="0").
 */
export function cuerpoInclude(p: PeticionInclude, usuario: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<include:abapInclude xmlns:include="http://www.sap.com/adt/programs/includes"',
    `    xmlns:adtcore="http://www.sap.com/adt/core" adtcore:type="${TIPO_ADT_INCLUDE}" adtcore:name="${escaparXml(p.nombre)}"`,
    `    adtcore:description="${escaparXml(p.descripcion)}" adtcore:responsible="${escaparXml(usuario)}">`,
    `  <adtcore:packageRef adtcore:name="${escaparXml(p.paquete)}"/>`,
    '</include:abapInclude>',
  ].join('\n');
}

// NO VERIFICADO: `corrNr` con un paquete transportable (la prueba real usó $TMP); se confirma en F5.
export function parametrosInclude(p: PeticionInclude): Record<string, string> | undefined {
  return p.orden ? { corrNr: p.orden } : undefined;
}

/** Cuadro modal previo al POST: qué se crea, dónde y con qué orden. */
export function textoConfirmacionInclude(p: PeticionInclude, sistema: string): { mensaje: string; detalle: string } {
  const transporte =
    p.orden === undefined ? 'Objeto local: sin orden de transporte.' : `Orden de transporte: ${p.orden} (la del programa).`;
  return {
    mensaje: `El agente pide crear el include ${p.nombre} «${p.descripcion}» en ${sistema}.`,
    detalle: `Paquete: ${p.paquete} (el del programa ${p.programaPrincipal}).\n${transporte}`,
  };
}

/** Lo que `abrir_objeto` abriría para el include recién creado. */
export function resultadoBusquedaInclude(p: PeticionInclude): ResultadoBusqueda {
  return {
    nombre: p.nombre,
    tipo: TIPO_ADT_INCLUDE,
    descripcion: p.descripcion,
    paquete: p.paquete,
    uriAdt: `${RUTA_INCLUDES}/${segmentoAdt(p.nombre)}`,
  };
}

export function indicacionIncludeCreado(principal: string, abierto: boolean): string {
  const siguiente = abierto ? INDICACION_CREADO : 'ábrelo con abrir_objeto en unos segundos';
  return `${siguiente}; recuerda añadir la sentencia INCLUDE en ${principal} si falta`;
}

export function indicacionAsistenteInclude(principal: string): string {
  return (
    `el programa ${principal} no está en una única orden abierta: crea el include con crear_objeto sin ` +
    'programaPrincipal para que el usuario elija la orden en el asistente de SAP'
  );
}

/** Cuadro previo al asistente: qué se va a crear y qué pedirá el asistente de SAP, en orden. */
export function textoGuiaCreacion(p: PeticionCreacion, sistema: string): { mensaje: string; detalle: string } {
  const etiqueta = p.tipo === undefined ? undefined : ETIQUETAS_TIPO[p.tipo];
  const sufijo = etiqueta === undefined ? '' : ` (aquí: ${etiqueta})`;
  return {
    mensaje: `El agente pide crear ${etiqueta ?? 'el objeto'} ${p.nombre} «${p.descripcion}» en ${sistema}.`,
    // NO VERIFICADO: el orden de los campos dentro del paso 2 lo define el backend de SAP
    detalle: [
      'Se abrirá el asistente de SAP y te pedirá, en este orden:',
      `1. Tipo de objeto: elige el que corresponde${sufijo}.`,
      '2. Datos del objeto: nombre (ya está en el portapapeles: pégalo con Ctrl+V), descripción y paquete (escribe para buscar; $TMP es local).',
      '3. Orden de transporte: elige una tuya o «Create New Transport Request…». Los objetos locales no la piden.',
    ].join('\n'),
  };
}

/**
 * Paquete de un objeto según su carpeta del repotree. Bajo `Local Objects ($TMP)` el segmento del repotree es el
 * usuario, no el paquete; un `(NS)X` del repotree es el paquete `/NS/X`.
 */
export function paqueteDeObjeto(objeto: ObjetoRepotree): string {
  if (objeto.biblioteca === BIBLIOTECA_LOCAL) {
    return PAQUETE_TMP;
  }
  return deshacerNamespace(objeto.paquete);
}

/**
 * El objeto de la carpeta de `uri` si es de `destino` y se llama `nombre` (sin distinguir mayúsculas).
 * NO VERIFICADO: cómo nombra la oficial la carpeta de un objeto con namespace; se acepta `(NS)X` como en los paquetes.
 */
export function objetoPedidoEn(uri: UriMinimo, destino: string, nombre: string): ObjetoRepotree | undefined {
  const analisis = analizarUriAbap(uri);
  if (analisis?.destino !== destino || analisis.objeto === undefined) {
    return undefined;
  }
  return deshacerNamespace(analisis.objeto.nombre).toUpperCase() === nombre.toUpperCase() ? analisis.objeto : undefined;
}

/**
 * Clave de objeto de una uri abap: destino y carpeta del objeto, sin el archivo: el `.abap` y el `.json` de un mismo
 * objeto dan la misma clave. undefined si la uri no es de la carpeta de un objeto.
 */
export function claveObjeto(uri: UriMinimo): string | undefined {
  const analisis = analizarUriAbap(uri);
  if (analisis?.objeto === undefined) {
    return undefined;
  }
  return [analisis.destino, ...analisis.carpetas].join('/').toUpperCase();
}

/** Clave del registro de creaciones en curso: destino y nombre, sin distinguir mayúsculas. */
export function claveCreacion(destino: string, nombre: string): string {
  return `${destino}|${nombre}`.toUpperCase();
}

export function creacionVigente(lanzado: number, ahora: number): boolean {
  return ahora - lanzado < VIGENCIA_CREACION_MS;
}
