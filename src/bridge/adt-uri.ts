export const ESQUEMA_ABAP = 'abap';
export const RAIZ_REPOTREE = 'repotree-v1';

export interface UriMinimo {
  scheme: string;
  path: string;
}

export const BIBLIOTECA_SISTEMA = 'System Library';
export const BIBLIOTECA_LOCAL = 'Local Objects ($TMP)';

export type TipoObjeto =
  | 'clase'
  | 'interfaz'
  | 'programa'
  | 'include'
  | 'cds'
  | 'tabla'
  | 'estructura'
  | 'grupoFunciones'
  | 'desconocido';

export interface ObjetoRepotree {
  biblioteca: string;
  paquete: string;
  categoria: string;
  tipoCarpeta: string;
  nombre: string;
}

export interface UriAbap {
  destino: string;
  /** Cadena de carpetas del repotree entre el destino y el archivo. */
  carpetas: string[];
  archivo?: string;
  /** Presente solo cuando las carpetas llegan exactamente hasta la carpeta de un objeto. */
  objeto?: ObjetoRepotree;
}

export interface NombreAff {
  nombre: string;
  tipo: string;
  extension: string;
}

function segmentosDeRuta(path: string): string[] {
  return path.split('/').filter((segmento) => segmento.length > 0);
}

const SEGMENTOS_OBJETO = 5;

export function objetoDeCarpetas(carpetas: string[]): ObjetoRepotree | undefined {
  if (carpetas.length !== SEGMENTOS_OBJETO) {
    return undefined;
  }
  const [biblioteca, paquete, categoria, tipoCarpeta, nombre] = carpetas;
  return { biblioteca, paquete, categoria, tipoCarpeta, nombre };
}

export function analizarUriAbap(uri: UriMinimo): UriAbap | undefined {
  if (uri.scheme !== ESQUEMA_ABAP) {
    return undefined;
  }
  const segmentos = segmentosDeRuta(uri.path);
  if (segmentos[0] !== RAIZ_REPOTREE || segmentos.length < 2) {
    return undefined;
  }
  const destino = segmentos[1];
  const resto = segmentos.slice(2);
  const ultimo = resto[resto.length - 1];
  const tieneArchivo = ultimo !== undefined && analizarNombreAff(ultimo) !== undefined;
  const carpetas = tieneArchivo ? resto.slice(0, -1) : resto;
  const resultado: UriAbap = { destino, carpetas };
  if (tieneArchivo) {
    resultado.archivo = ultimo;
  }
  const objeto = objetoDeCarpetas(carpetas);
  if (objeto !== undefined) {
    resultado.objeto = objeto;
  }
  return resultado;
}

export function rutaDeObjeto(destino: string, objeto: ObjetoRepotree, archivo?: string): string {
  const { biblioteca, paquete, categoria, tipoCarpeta, nombre } = objeto;
  const segmentos = [RAIZ_REPOTREE, destino, biblioteca, paquete, categoria, tipoCarpeta, nombre];
  if (archivo !== undefined) {
    segmentos.push(archivo);
  }
  return `/${segmentos.join('/')}`;
}

/**
 * Carpetas de tipo bajo la categoría de código. La categoría se llama `Source Library` en ECC y
 * `Source Code Library` en S/4HANA; ambas conviven y aquí solo cuenta la carpeta de tipo.
 * Las tablas y estructuras cuelgan de `Dictionary` solo en S/4 (en ECC la oficial no las expone).
 */
const TIPO_POR_CARPETA: Record<string, TipoObjeto> = {
  Classes: 'clase',
  Interfaces: 'interfaz',
  Programs: 'programa',
  Includes: 'include',
  'ABAP DDL Sources': 'cds',
  'Database Tables': 'tabla',
  Structures: 'estructura',
  'Function Groups': 'grupoFunciones',
};

/** Una tabla y una estructura comparten AFF `tabl`: solo la carpeta las distingue. */
const TIPO_POR_AFF: Record<string, TipoObjeto> = {
  clas: 'clase',
  intf: 'interfaz',
  prog: 'programa',
  ddls: 'cds',
  tabl: 'tabla',
  fugr: 'grupoFunciones',
};

export function tipoObjetoDe(tipoCarpeta: string | undefined, tipoAff: string | undefined): TipoObjeto {
  const porCarpeta = tipoCarpeta === undefined ? undefined : TIPO_POR_CARPETA[tipoCarpeta];
  if (porCarpeta !== undefined) {
    return porCarpeta;
  }
  return (tipoAff === undefined ? undefined : TIPO_POR_AFF[tipoAff]) ?? 'desconocido';
}

function esJson(extension: string): boolean {
  return extension === 'json' || extension === 'jsonc' || extension.endsWith('.json') || extension.endsWith('.jsonc');
}

/** `<grupo>.fugr.sapl<grupo>.reps.abap`: el programa principal de un grupo de funciones. */
function esPrincipalFugr(extension: string): boolean {
  return extension.endsWith('reps.abap') && extension.startsWith('sapl');
}

/**
 * Archivo que representa al objeto: el fuente de tres partes (`.clas.abap`, `.prog.abap`…), el `.acds`
 * de una CDS, el `.ddic` de una tabla o estructura, el SAPL de un grupo de funciones y, si no, cualquier
 * `.abap` o cualquier archivo que no sea de metadatos JSON.
 */
export function archivoPrincipal(archivos: string[]): string | undefined {
  const validos = archivos.flatMap((archivo) => {
    const aff = analizarNombreAff(archivo);
    return aff === undefined ? [] : [{ archivo, extension: aff.extension }];
  });
  const primero = (acepta: (extension: string) => boolean): string | undefined =>
    validos.find((entrada) => acepta(entrada.extension))?.archivo;
  return (
    primero((e) => e === 'abap') ??
    primero((e) => e === 'acds') ??
    primero((e) => e === 'ddic') ??
    primero(esPrincipalFugr) ??
    primero((e) => e.endsWith('abap')) ??
    primero((e) => !esJson(e))
  );
}

export interface ArchivoGrupoFunciones {
  archivo: string;
  clase: 'moduloFuncion' | 'include' | 'principal' | 'otro';
  nombre: string;
}

/**
 * Clasifica un archivo de la carpeta de un grupo de funciones (layout S/4):
 * `<grupo>.fugr.<módulo>.func.abap`, `<grupo>.fugr.sapl<grupo>.reps.abap` (principal),
 * `<grupo>.fugr.<include>.reps.abap` y sus `.json` de metadatos (que no se muestran).
 */
export function clasificarArchivoFugr(archivo: string): ArchivoGrupoFunciones | undefined {
  const aff = analizarNombreAff(archivo);
  if (aff === undefined || esJson(aff.extension)) {
    return undefined;
  }
  const [intermedia, ...resto] = aff.extension.split('.');
  const sufijo = resto.join('.');
  const nombre = intermedia.toUpperCase();
  if (sufijo === 'func.abap') {
    return { archivo, clase: 'moduloFuncion', nombre };
  }
  if (sufijo === 'reps.abap') {
    return { archivo, clase: esPrincipalFugr(aff.extension) ? 'principal' : 'include', nombre };
  }
  return { archivo, clase: 'otro', nombre: archivo };
}

export function rutaRaizDestino(destino: string): string {
  return `/${RAIZ_REPOTREE}/${destino}`;
}

export function rutaConDestino(path: string, destino: string): string | undefined {
  const segmentos = segmentosDeRuta(path);
  if (segmentos[0] !== RAIZ_REPOTREE || segmentos.length < 2) {
    return undefined;
  }
  return `/${[RAIZ_REPOTREE, destino, ...segmentos.slice(2)].join('/')}`;
}

export function analizarNombreAff(archivo: string): NombreAff | undefined {
  const partes = archivo.split('.');
  if (partes.length < 3) {
    return undefined;
  }
  const [nombre, tipo] = partes;
  if (nombre.length === 0 || tipo.length === 0) {
    return undefined;
  }
  return { nombre, tipo, extension: partes.slice(2).join('.') };
}
