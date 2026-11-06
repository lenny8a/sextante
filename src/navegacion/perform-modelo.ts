import {
  ESQUEMA_ABAP,
  analizarUriAbap,
  archivoPrincipal,
  clasificarArchivoFugr,
  rutaDeObjeto,
  tipoObjetoDe,
  type ObjetoRepotree,
  type TipoObjeto,
  type UriAbap,
} from '../bridge/adt-uri';

/** Archivos que se leen como mucho buscando un FORM (origen, includes e includes de includes). */
export const MAX_ARCHIVOS_FORM = 40;

const NOMBRE = '[A-Za-z0-9_/]+';
const PATRON_PERFORM = new RegExp(`^(\\s*)PERFORM\\b(\\s*:)?`, 'i');
const PATRON_INCLUDE = /^\s*INCLUDE\b(\s*:)?(.*)$/i;
const PATRON_NOMBRE_SUELTO = new RegExp(`^${NOMBRE}$`);
const EXCLUIDOS_INCLUDE = new Set(['TYPE', 'STRUCTURE', 'METHODS']);
const CARPETA_INCLUDES = 'Includes';
const CARPETA_PROGRAMAS = 'Programs';

export interface PosicionForm {
  linea: number;
  columna: number;
}

export interface DestinoForm extends PosicionForm {
  ruta: string;
}

export interface OrigenNavegacion {
  /** Ruta del archivo `abap:` en el que está el PERFORM (el origen de un editor de bloque, no el bloque). */
  ruta: string;
  texto: string;
  /** Archivo principal del programa cuando el PERFORM está en uno de sus includes y el árbol lo conoce. */
  rutaPrincipal?: string;
}

export interface ResultadoLocalizar {
  destino: DestinoForm | undefined;
  /** Archivos cuyo texto se miró, incluido el origen. */
  leidos: number;
}

export type LectorTexto = (ruta: string) => Promise<string | undefined>;

/** Texto de la línea sin su comentario de comillas (una comilla dentro de un literal `'…'` no abre comentario). */
function sinComentario(linea: string): string {
  let enLiteral = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === "'") {
      enLiteral = !enLiteral;
    } else if (c === '"' && !enLiteral) {
      return linea.slice(0, i);
    }
  }
  return linea;
}

function esComentarioDeLinea(linea: string): boolean {
  return linea.startsWith('*');
}

interface Segmento {
  texto: string;
  inicio: number;
}

/** Trozos separados por coma de una sentencia encadenada, con la columna en que empieza cada uno. */
function segmentosEncadenados(resto: string, desde: number): Segmento[] {
  const segmentos: Segmento[] = [];
  let inicio = desde;
  for (const parte of resto.split(',')) {
    segmentos.push({ texto: parte, inicio });
    inicio += parte.length + 1;
  }
  return segmentos;
}

/** Nombre de un `PERFORM <nombre> …` estático y local: sin paréntesis (dinámico o externo) ni `IN PROGRAM`. */
function nombreDePerform(segmento: string): { nombre: string; inicio: number } | undefined {
  const coincidencia = /^(\s*)([^\s.,]+)(.*)$/.exec(segmento);
  if (coincidencia === null) {
    return undefined;
  }
  const [, espacios, nombre, resto] = coincidencia;
  if (!PATRON_NOMBRE_SUELTO.test(nombre) || /^\s*\(/.test(resto) || /\bIN\s+PROGRAM\b/i.test(resto)) {
    return undefined;
  }
  return { nombre: nombre.toUpperCase(), inicio: espacios.length };
}

/**
 * FORM al que llama el `PERFORM` de la línea cuando el cursor está sobre la palabra PERFORM o sobre el nombre.
 * En una lista encadenada (`PERFORM: a, b.`) el cursor decide el nombre; sobre los parámetros no se navega.
 */
export function performEnLinea(linea: string, columna: number): string | undefined {
  if (esComentarioDeLinea(linea)) {
    return undefined;
  }
  const limpia = sinComentario(linea);
  const cabecera = PATRON_PERFORM.exec(limpia);
  if (cabecera === null || columna > limpia.length) {
    return undefined;
  }
  const finCabecera = cabecera[0].length;
  const encadenada = cabecera[2] !== undefined;
  const segmentos = encadenada
    ? segmentosEncadenados(limpia.slice(finCabecera), finCabecera)
    : [{ texto: limpia.slice(finCabecera), inicio: finCabecera }];
  const sobreCabecera = columna >= cabecera[1].length && columna <= finCabecera;
  const segmento = sobreCabecera && !encadenada ? segmentos[0] : segmentos.find((s) => columna >= s.inicio && columna <= s.inicio + s.texto.length);
  if (segmento === undefined) {
    return undefined;
  }
  const perform = nombreDePerform(segmento.texto);
  if (perform === undefined) {
    return undefined;
  }
  const inicioNombre = segmento.inicio + perform.inicio;
  const sobreNombre = columna >= inicioNombre && columna <= inicioNombre + perform.nombre.length;
  return sobreNombre || (sobreCabecera && !encadenada) ? perform.nombre : undefined;
}

function lineasDe(texto: string): string[] {
  return texto.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/** Línea y columna del nombre en `FORM <nombre>` (sentencia completa, no un prefijo del nombre). */
export function lineaDeForm(texto: string, nombre: string): PosicionForm | undefined {
  const patron = new RegExp(`^(\\s*FORM\\s+)${escaparRegex(nombre)}(?=[\\s.]|$)`, 'i');
  const lineas = lineasDe(texto);
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esComentarioDeLinea(linea)) {
      continue;
    }
    const coincidencia = patron.exec(sinComentario(linea));
    if (coincidencia !== null) {
      return { linea: i, columna: coincidencia[1].length };
    }
  }
  return undefined;
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Nombres (en mayúsculas, sin repetir) de las sentencias `INCLUDE <include>.` de un texto, en su orden. */
export function includesDe(texto: string): string[] {
  const nombres: string[] = [];
  for (const linea of lineasDe(texto)) {
    if (esComentarioDeLinea(linea)) {
      continue;
    }
    const coincidencia = PATRON_INCLUDE.exec(sinComentario(linea));
    if (coincidencia === null) {
      continue;
    }
    const [, dosPuntos, resto] = coincidencia;
    const partes = dosPuntos === undefined ? [resto] : resto.split(',');
    for (const parte of partes) {
      const nombre = /^\s*([^\s.]+)/.exec(parte)?.[1]?.toUpperCase();
      if (nombre !== undefined && PATRON_NOMBRE_SUELTO.test(nombre) && !EXCLUIDOS_INCLUDE.has(nombre) && !nombres.includes(nombre)) {
        nombres.push(nombre);
      }
    }
  }
  return nombres;
}

function analisisDe(ruta: string): UriAbap | undefined {
  return analizarUriAbap({ scheme: ESQUEMA_ABAP, path: ruta });
}

/**
 * Ruta del archivo de un include nombrado en `rutaOrigen`. En un programa o include, cuelga de la carpeta
 * `Includes` del mismo paquete; en un grupo de funciones es un `.reps.abap` del propio grupo. Un include de
 * otro paquete no se encuentra por esta vía.
 */
export function rutaDeInclude(rutaOrigen: string, nombreInclude: string): string | undefined {
  const analisis = analisisDe(rutaOrigen);
  const objeto = analisis?.objeto;
  if (analisis === undefined || objeto === undefined) {
    return undefined;
  }
  const nombre = nombreInclude.toUpperCase();
  const tipo = tipoObjetoDe(objeto.tipoCarpeta, undefined);
  if (tipo === 'grupoFunciones') {
    return rutaDeObjeto(analisis.destino, objeto, `${objeto.nombre.toLowerCase()}.fugr.${nombre.toLowerCase()}.reps.abap`);
  }
  if (objeto.tipoCarpeta !== CARPETA_PROGRAMAS && objeto.tipoCarpeta !== CARPETA_INCLUDES) {
    return undefined;
  }
  const carpeta = { ...objeto, tipoCarpeta: CARPETA_INCLUDES, nombre };
  return rutaDeObjeto(analisis.destino, carpeta, `${nombre.toLowerCase()}.prog.abap`);
}

/**
 * Busca `FORM <nombre>` en el origen, luego en sus includes (y los de estos, en anchura) y, si el origen es un
 * include con programa principal conocido, en el principal y los suyos. Se detiene en el primer archivo que lo
 * tiene y nunca lee más de `MAX_ARCHIVOS_FORM` archivos.
 */
export async function localizarForm(nombre: string, origen: OrigenNavegacion, leer: LectorTexto): Promise<ResultadoLocalizar> {
  const visitadas = new Set<string>([origen.ruta]);
  const pendientes: string[] = [];
  const encolar = (rutaBase: string, texto: string): void => {
    for (const include of includesDe(texto)) {
      const ruta = rutaDeInclude(rutaBase, include);
      if (ruta !== undefined && !visitadas.has(ruta)) {
        visitadas.add(ruta);
        pendientes.push(ruta);
      }
    }
  };
  let leidos = 1;
  const posicion = lineaDeForm(origen.texto, nombre);
  if (posicion !== undefined) {
    return { destino: { ruta: origen.ruta, ...posicion }, leidos };
  }
  encolar(origen.ruta, origen.texto);
  if (origen.rutaPrincipal !== undefined && !visitadas.has(origen.rutaPrincipal)) {
    visitadas.add(origen.rutaPrincipal);
    pendientes.push(origen.rutaPrincipal);
  }
  while (pendientes.length > 0 && leidos < MAX_ARCHIVOS_FORM) {
    const ruta = pendientes.shift() as string;
    const texto = await leer(ruta);
    if (texto === undefined) {
      continue;
    }
    leidos++;
    const encontrado = lineaDeForm(texto, nombre);
    if (encontrado !== undefined) {
      return { destino: { ruta, ...encontrado }, leidos };
    }
    encolar(ruta, texto);
  }
  return { destino: undefined, leidos };
}

export interface ObjetoParaPrincipal {
  tipo: TipoObjeto;
  archivos: string[];
  destino: string;
  objeto: ObjetoRepotree;
}

/**
 * Archivo por el que entran los INCLUDE de un objeto con includes propios: el `.prog.abap` de un programa o el
 * `sapl<grupo>` de un grupo de funciones. Para el resto de tipos no hay principal.
 */
export function rutaPrincipalDeObjeto({ tipo, archivos, destino, objeto }: ObjetoParaPrincipal): string | undefined {
  let archivo: string | undefined;
  if (tipo === 'programa') {
    archivo = archivoPrincipal(archivos);
  } else if (tipo === 'grupoFunciones') {
    archivo = archivos.find((a) => clasificarArchivoFugr(a)?.clase === 'principal');
  }
  return archivo === undefined ? undefined : rutaDeObjeto(destino, objeto, archivo);
}
