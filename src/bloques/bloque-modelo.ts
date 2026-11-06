import { ESQUEMA_ABAP, type TipoObjeto, type UriMinimo } from '../bridge/adt-uri';
import type { Rango, SimboloDocumento } from '../tree/objeto-modelo';

export const ESQUEMA_BLOQUE = 'abap-navigator-bloque';
export type TipoBloque = 'method' | 'form';

export interface RutaBloque {
  rutaOrigen: string;
  nombre: string;
  tipo: TipoBloque;
}

const PATRON_ARCHIVO_BLOQUE = /^(.+)\.(method|form)\.abap$/;
const TIPOS_CON_METODOS: readonly TipoObjeto[] = ['clase', 'interfaz'];
const TIPOS_CON_FORMS: readonly TipoObjeto[] = ['programa', 'include', 'grupoFunciones'];

/** Un nombre con espacio de nombres (`/NS/IF~M`) no debe partir la ruta: `/` y `%` se escapan. */
function codificarNombre(nombre: string): string {
  return nombre.replace(/%/g, '%25').replace(/\//g, '%2F');
}

function decodificarNombre(nombre: string): string {
  return nombre.replace(/%(25|2F)/gi, (_, codigo: string) => (codigo === '25' ? '%' : '/'));
}

/** `<ruta del archivo origen>/<NOMBRE>.<tipo>.abap`: la pestaña se titula con el nombre del bloque. */
export function rutaDeBloque(rutaOrigen: string, nombre: string, tipo: TipoBloque): string {
  return `${rutaOrigen}/${codificarNombre(nombre)}.${tipo}.abap`;
}

export function analizarRutaBloque(path: string): RutaBloque | undefined {
  const corte = path.lastIndexOf('/');
  const rutaOrigen = path.slice(0, corte);
  const coincidencia = PATRON_ARCHIVO_BLOQUE.exec(path.slice(corte + 1));
  if (corte <= 0 || coincidencia === null) {
    return undefined;
  }
  return { rutaOrigen, nombre: decodificarNombre(coincidencia[1]), tipo: coincidencia[2] as TipoBloque };
}

export function tipoBloqueDe(nombreKind: string, tipoObjeto: TipoObjeto): TipoBloque | undefined {
  if (nombreKind === 'Method' && TIPOS_CON_METODOS.includes(tipoObjeto)) {
    return 'method';
  }
  if (nombreKind === 'Function' && TIPOS_CON_FORMS.includes(tipoObjeto)) {
    return 'form';
  }
  return undefined;
}

function conNombre(simbolos: SimboloDocumento[], nombreKind: string, nombre: string): SimboloDocumento | undefined {
  const buscado = nombre.toUpperCase();
  return simbolos.find((s) => s.nombreKind === nombreKind && s.nombre.toUpperCase() === buscado);
}

function ultimo(simbolos: SimboloDocumento[], nombreKind: string): SimboloDocumento | undefined {
  return simbolos.filter((s) => s.nombreKind === nombreKind).at(-1);
}

/**
 * Rango completo del bloque. Un método se busca en la última `Class` de primer nivel (la implementación;
 * la primera es la definición); sin `Class`, entre los `Method` de primer nivel o los de la última `Interface`.
 * Un FORM es una `Function` de primer nivel.
 */
export function buscarBloque(simbolos: SimboloDocumento[], nombre: string, tipo: TipoBloque): Rango | undefined {
  if (tipo === 'form') {
    return conNombre(simbolos, 'Function', nombre)?.rango;
  }
  const implementacion = ultimo(simbolos, 'Class');
  if (implementacion !== undefined) {
    return conNombre(implementacion.hijos, 'Method', nombre)?.rango;
  }
  const interfaz = ultimo(simbolos, 'Interface');
  return (conNombre(simbolos, 'Method', nombre) ?? conNombre(interfaz?.hijos ?? [], 'Method', nombre))?.rango;
}

function iniciosDeLinea(texto: string): number[] {
  const inicios = [0];
  for (let i = texto.indexOf('\n'); i !== -1; i = texto.indexOf('\n', i + 1)) {
    inicios.push(i + 1);
  }
  return inicios;
}

/** Posiciones como las da VS Code: línea y columna 0-based, columna final exclusiva. */
export function textoDeRango(texto: string, rango: Rango): string {
  const inicios = iniciosDeLinea(texto);
  const desplazamiento = (linea: number, columna: number): number => {
    const inicio = inicios[linea];
    if (inicio === undefined) {
      return texto.length;
    }
    const siguiente = inicios[linea + 1];
    let fin = siguiente === undefined ? texto.length : siguiente - 1;
    if (fin > inicio && texto[fin - 1] === '\r') {
      fin--;
    }
    return Math.min(inicio + columna, fin);
  };
  return texto.slice(desplazamiento(rango[0], rango[1]), desplazamiento(rango[2], rango[3]));
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `vigente`: el rango abarca exactamente el bloque. `desplazado`: la primera línea no nombra el bloque.
 * `redimensionado`: empieza bien pero no acaba en su cierre o contiene otro bloque (el bloque creció o encogió
 * y los símbolos aún describen el texto anterior).
 */
export type EstadoBloque = 'vigente' | 'desplazado' | 'redimensionado';

const CIERRE: Record<TipoBloque, RegExp> = {
  method: /(?:^|[\s.:])ENDMETHOD\s*\.$/i,
  // NO VERIFICADO: que un módulo de función (FUNCTION … ENDFUNCTION) llegue como `Function` a un bloque form.
  form: /(?:^|[\s.:])END(?:FORM|FUNCTION)\s*\.$/i,
};

/**
 * Sentencia que abre otro bloque: la palabra clave seguida de un nombre. `form = 'ZF'` o `method = 'POST'`
 * (parámetros de CALL FUNCTION o componentes en un VALUE) no abren nada.
 */
const APERTURA: Record<TipoBloque, RegExp> = {
  method: /^METHOD\s+(?!=)\S/i,
  // NO VERIFICADO: FUNCTION, igual que en el cierre.
  form: /^(?:FORM|FUNCTION)\s+(?!=)\S/i,
};

/** La línea hasta la columna final sin comentario: `*` al inicio la anula entera y `"` corta el resto. */
function cierreSinComentario(linea: string, columna: number): string | undefined {
  const cierre = linea.slice(0, columna);
  return cierre.trimStart().startsWith('*') ? undefined : cierre.split('"')[0].trimEnd();
}

/**
 * Comprueba que el rango de los símbolos corresponde al texto actual: la primera línea nombra el bloque
 * (`METHOD m.`, `FORM f USING …`), la última acaba, en la columna final, con su cierre (`ENDMETHOD.`,
 * `ENDFORM.`) y ninguna línea intermedia abre otro bloque. Si no, leer o escribir con ese rango tocaría otro
 * código (por ejemplo, al guardar dos veces seguidas un bloque que cambió de tamaño).
 */
export function comprobarBloque(texto: string, rango: Rango, nombre: string, tipo: TipoBloque): EstadoBloque {
  const lineas = texto.split(/\r?\n/);
  const primera = lineas[rango[0]];
  const patron = new RegExp(`(?<![\\w/~])${escaparRegex(nombre)}(?![\\w/~])`, 'i');
  if (primera === undefined || !patron.test(primera)) {
    return 'desplazado';
  }
  const ultima = lineas[rango[2]];
  if (ultima === undefined || rango[3] > ultima.length) {
    return 'redimensionado';
  }
  const cierre = cierreSinComentario(ultima, rango[3]);
  if (cierre === undefined || !CIERRE[tipo].test(cierre)) {
    return 'redimensionado';
  }
  const intermedias = lineas.slice(rango[0] + 1, rango[2]);
  return intermedias.some((linea) => APERTURA[tipo].test(linea.trim())) ? 'redimensionado' : 'vigente';
}

/** Un salto final que el bloque del origen no tenía se quita: si no, cada guardado añadiría una línea en blanco. */
export function ajustarSaltoFinal(nuevo: string, actual: string): string {
  const salto = /\r?\n$/;
  return salto.test(nuevo) && !salto.test(actual) ? nuevo.replace(salto, '') : nuevo;
}

/** El documento al que representa un uri: un bloque cuenta como su archivo `abap:` de origen. */
export function uriOrigenDe(uri: UriMinimo): UriMinimo;
export function uriOrigenDe(uri: UriMinimo | undefined): UriMinimo | undefined;
export function uriOrigenDe(uri: UriMinimo | undefined): UriMinimo | undefined {
  if (uri?.scheme !== ESQUEMA_BLOQUE) {
    return uri;
  }
  const ruta = analizarRutaBloque(uri.path);
  return ruta === undefined ? uri : { scheme: ESQUEMA_ABAP, path: ruta.rutaOrigen };
}
