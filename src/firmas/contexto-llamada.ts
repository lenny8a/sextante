import {
  LINEAS_ATRAS,
  MAX_LINEAS_SENTENCIA,
  NOMBRE,
  enmascarar,
  inicioDeSentencia,
  palabraEn,
} from '../diccionario/contexto';

export interface LectorLineas {
  total: number;
  linea(i: number): string;
}

export type ContextoLlamada =
  | { clase: 'funcion'; nombre: string }
  | { clase: 'metodo'; objeto: string; metodo: string; receptor: string; viaSuper?: boolean }
  | { clase: 'clase'; nombre: string };

interface Tramo {
  texto: string;
  inicio: number;
  fin: number;
}

/** Lo que se sabe de la fila del cursor; `linea` está enmascarada, `original` no. */
interface Posicion {
  doc: LectorLineas;
  fila: number;
  linea: string;
  original: string;
}

interface ClaseEnvolvente {
  nombre: string;
  fila: number;
}

/** Declaración encontrada; `clase` falta si la variable existe pero no se sabe su clase. */
interface Declaracion {
  clase?: string;
}

/** Palabra clave al inicio de una sentencia: al principio de una fila que empieza sentencia o tras un punto. */
interface PatronSentencia {
  alInicio: RegExp;
  trasPunto: RegExp;
}

interface PatronesDeclaracion {
  referencia: RegExp;
  creacion: RegExp;
  /** `CREATE OBJECT <v> TYPE <c>` con nombre estático; `TYPE (lv_dyn)` no encaja y cae en `declaracion`. */
  creacionObjeto: RegExp;
  declaracion: RegExp;
}

function patronDeSentencia(cuerpo: string): PatronSentencia {
  return { alInicio: new RegExp(`^\\s*${cuerpo}`), trasPunto: new RegExp(`\\.\\s*${cuerpo}`) };
}

const NOMBRE_METODO = /^[A-Z_/][A-Z0-9_/]*(?:~[A-Z_/][A-Z0-9_/]*)?$/;
const IMPLEMENTACION = /^\s*CLASS\s+([A-Z_/][A-Z0-9_/]*)\s+IMPLEMENTATION\b/;
const FIN_DE_CLASE = /^\s*ENDCLASS\b/;
/** Fin de un bloque con declaraciones locales: la ventana del receptor no lo cruza. */
const FIN_DE_BLOQUE = patronDeSentencia('(ENDMETHOD|ENDFORM|ENDFUNCTION|ENDMODULE)\\b');
const FIN_DE_BLOQUE_O_CLASE = patronDeSentencia('(ENDMETHOD|ENDFORM|ENDFUNCTION|ENDMODULE|ENDCLASS)\\b');
/** Sentencia que abre cada bloque, según la que lo cierra. */
const INICIO_DE_BLOQUE: Record<string, PatronSentencia> = {
  ENDMETHOD: patronDeSentencia('METHOD\\b'),
  ENDFORM: patronDeSentencia('FORM\\b'),
  ENDFUNCTION: patronDeSentencia('FUNCTION\\b'),
  ENDMODULE: patronDeSentencia('MODULE\\b'),
  ENDCLASS: patronDeSentencia('CLASS\\s+[A-Z_/][A-Z0-9_/]*\\s+(?:DEFINITION|IMPLEMENTATION)\\b'),
};
const FIN_DE_SENTENCIA = /\.\s*$/;
const PARENTESIS_DE_LLAMADA = /^\((?:[\s)]|$)/;
const CALL_FUNCTION = /(?:^| )CALL FUNCTION$/;
const CALL_METHOD = /(?:^| )CALL METHOD$/;
const CLAVE_CLASE = /(?:^| )(TYPE REF TO|INHERITING FROM|RAISE (?:RESUMABLE )?EXCEPTION TYPE|CREATE OBJECT \S+ TYPE|NEW)$/;
const SEPARADOR_DE_COMPONENTE = /[-~>=]/;
const NO_SON_CLASES = new Set(['DATA', 'OBJECT', 'ME', 'SUPER']);
/** Palabras clave y funciones predefinidas que van seguidas de `(` sin ser llamadas a métodos. */
const NO_SON_METODOS = new Set(
  (
    'IF ELSEIF WHILE CHECK WHEN ASSERT RETURN DATA CASE ' +
    'LINES STRLEN XSDBOOL COND CONV VALUE NEW CAST CORRESPONDING REF EXACT BOOLC CONDENSE TRANSLATE ESCAPE ' +
    'TO_UPPER TO_LOWER SHIFT_LEFT SHIFT_RIGHT SUBSTRING REPEAT REVERSE FIND COUNT MATCH REPLACE CONTAINS ' +
    'MATCHES ABS SIGN CEIL FLOOR TRUNC FRAC NMIN NMAX IPOW SQRT ROUND CONCAT_LINES_OF LINE_INDEX LINE_EXISTS ' +
    'NUMOFCHAR CHARLEN DBMAXLEN XSTRLEN BOOLX CMIN CMAX SEGMENT SWITCH FILTER REDUCE'
  ).split(' '),
);

export function lectorDeLineas(lineas: string[]): LectorLineas {
  return { total: lineas.length, linea: (i) => lineas[i] };
}

function enmascarada(doc: LectorLineas, i: number): string {
  return enmascarar(doc.linea(i)).toUpperCase();
}

function rango(doc: LectorLineas, desde: number, hasta: number): string[] {
  return Array.from({ length: hasta - desde + 1 }, (_, k) => doc.linea(desde + k));
}

/**
 * Fila del punto que cierra la sentencia que pasa por `fila` (para "insertar debajo"), o `undefined` si no
 * aparece un punto en las `LINEAS_ATRAS` filas siguientes.
 */
export function finDeSentenciaEn(doc: LectorLineas, fila: number): number | undefined {
  const ultima = Math.min(doc.total - 1, fila + LINEAS_ATRAS);
  for (let i = fila; i <= ultima; i++) {
    if (FIN_DE_SENTENCIA.test(enmascarar(doc.linea(i)))) {
      return i;
    }
  }
  return undefined;
}

function inicioDeSentenciaEn(doc: LectorLineas, fila: number): number {
  const desde = Math.max(0, fila - MAX_LINEAS_SENTENCIA);
  return desde + inicioDeSentencia(rango(doc, desde, fila), fila - desde);
}

/** Texto enmascarado de la sentencia hasta la columna, en mayúsculas y con los espacios normalizados. */
function sentenciaAntes(doc: LectorLineas, fila: number, columna: number): string {
  const partes: string[] = [];
  for (let i = inicioDeSentenciaEn(doc, fila); i <= fila; i++) {
    const linea = enmascarar(doc.linea(i));
    partes.push(i === fila ? linea.slice(0, columna) : linea);
  }
  const texto = partes.join(' ');
  return texto.slice(texto.lastIndexOf('.') + 1).replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Comillas del literal `'…'` que contiene la columna (en la línea enmascarada solo quedan sus delimitadores). */
function literalBajoCursor(linea: string, columna: number): { inicio: number; fin: number } | undefined {
  let apertura = -1;
  for (let i = 0; i < linea.length; i++) {
    if (linea[i] !== "'") continue;
    if (apertura < 0) {
      apertura = i;
    } else if (columna >= apertura && columna <= i) {
      return { inicio: apertura, fin: i };
    } else {
      apertura = -1;
    }
  }
  return apertura >= 0 && columna >= apertura ? { inicio: apertura, fin: linea.length } : undefined;
}

function funcionEn(pos: Posicion, literal: { inicio: number; fin: number }): ContextoLlamada | undefined {
  if (!CALL_FUNCTION.test(sentenciaAntes(pos.doc, pos.fila, literal.inicio))) {
    return undefined;
  }
  const nombre = pos.original.slice(literal.inicio + 1, literal.fin).toUpperCase();
  return NOMBRE.test(nombre) ? { clase: 'funcion', nombre } : undefined;
}

/** La palabra del cursor junto con su otra mitad si forma `zif~m`. */
function compuestoDe(linea: string, palabra: Tramo): Tramo {
  const antes = /[A-Za-z0-9_/]+~$/.exec(linea.slice(0, palabra.inicio))?.[0].length ?? 0;
  const despues = /^~[A-Za-z0-9_/]+/.exec(linea.slice(palabra.fin))?.[0].length ?? 0;
  const inicio = palabra.inicio - antes;
  const fin = palabra.fin + despues;
  return { texto: linea.slice(inicio, fin).toUpperCase(), inicio, fin };
}

/** Clase del `CLASS <c> IMPLEMENTATION` que envuelve la fila, buscada hacia atrás sin límite. */
function claseEnvolvente(doc: LectorLineas, fila: number): ClaseEnvolvente | undefined {
  for (let i = fila; i >= 0; i--) {
    const linea = enmascarada(doc, i);
    if (FIN_DE_CLASE.test(linea)) {
      return undefined;
    }
    const encontrada = IMPLEMENTACION.exec(linea);
    if (encontrada) {
      return { nombre: encontrada[1], fila: i };
    }
  }
  return undefined;
}

function sentenciaDesde(doc: LectorLineas, fila: number): string {
  return rango(doc, fila, finDeSentenciaEn(doc, fila) ?? fila).map(enmascarar).join(' ').toUpperCase();
}

/** Fila del `CLASS <c> DEFINITION` (no DEFERRED ni LOAD) anterior a `desde`. */
function definicionDe(clase: string, doc: LectorLineas, desde: number): number | undefined {
  const patron = new RegExp(`^\\s*CLASS\\s+${clase}\\s+DEFINITION\\b`);
  for (let i = desde - 1; i >= 0; i--) {
    if (patron.test(enmascarada(doc, i)) && !/\b(?:DEFERRED|LOAD)\b/.test(sentenciaDesde(doc, i))) {
      return i;
    }
  }
  return undefined;
}

function claseValida(nombre: string): string | undefined {
  return NOMBRE.test(nombre) && !NO_SON_CLASES.has(nombre) ? nombre : undefined;
}

/** Clase de un atributo `DATA|CLASS-DATA <nombre> TYPE REF TO <c>` de la clase que envuelve la fila. */
function atributoDeClase(nombre: string, doc: LectorLineas, fila: number): string | undefined {
  const envolvente = claseEnvolvente(doc, fila);
  const inicio = envolvente && definicionDe(envolvente.nombre, doc, envolvente.fila);
  if (inicio === undefined) {
    return undefined;
  }
  const patron = new RegExp(`(?:^|[\\s:,])${nombre}\\s+TYPE\\s+REF\\s+TO\\s+([A-Z_/][A-Z0-9_/]*)`);
  for (let i = inicio + 1; i < doc.total; i++) {
    const linea = enmascarada(doc, i);
    if (FIN_DE_CLASE.test(linea)) {
      return undefined;
    }
    const encontrado = patron.exec(linea);
    if (encontrado && /^\s*(?:CLASS-)?DATA\b/.test(enmascarada(doc, inicioDeSentenciaEn(doc, i)))) {
      return claseValida(encontrado[1]);
    }
  }
  return undefined;
}

function sentenciaEn(doc: LectorLineas, fila: number, linea: string, patron: PatronSentencia): RegExpExecArray | null {
  const trasPunto = patron.trasPunto.exec(linea);
  if (trasPunto) {
    return trasPunto;
  }
  const alInicio = patron.alInicio.exec(linea);
  return alInicio && inicioDeSentenciaEn(doc, fila) === fila ? alInicio : null;
}

function lineaHasta(doc: LectorLineas, i: number, fila: number, limite: number): string {
  return i === fila ? enmascarada(doc, i).slice(0, limite) : enmascarada(doc, i);
}

/** `NEW|CAST <c>( … )->otro( )`: lo asignado es lo que devuelve la cadena, no una instancia de `<c>`. */
function encadenada(doc: LectorLineas, fila: number, columna: number): boolean {
  const resto = sentenciaDesde(doc, fila).slice(columna);
  const punto = resto.indexOf('.');
  return /\)->/.test(punto < 0 ? resto : resto.slice(0, punto));
}

/**
 * Primera declaración de la variable hacia atrás en la ventana, sin cruzar el fin de otro bloque
 * (`ENDMETHOD`, `ENDFORM`…); en la fila del cursor, antes de `limite`.
 */
function declaracionEnVentana(
  patrones: PatronesDeclaracion,
  doc: LectorLineas,
  fila: number,
  limite: number,
): Declaracion | undefined {
  for (let i = fila; i >= Math.max(0, fila - LINEAS_ATRAS); i--) {
    const linea = lineaHasta(doc, i, fila, limite);
    if (sentenciaEn(doc, i, linea, FIN_DE_BLOQUE)) {
      return undefined;
    }
    const declaracion = declaracionEnLinea(patrones, doc, i, linea);
    if (declaracion) {
      return declaracion;
    }
  }
  return undefined;
}

/**
 * Declaración global del programa, hacia atrás sin límite: se saltan enteros los cuerpos de los bloques
 * (`END<X>` hasta su inicio, `ENDCLASS` hasta su `CLASS … DEFINITION|IMPLEMENTATION`), así que nunca se toma
 * una local de otro bloque.
 */
function declaracionGlobal(patrones: PatronesDeclaracion, doc: LectorLineas, fila: number, limite: number): string | undefined {
  let inicioBuscado: PatronSentencia | undefined;
  for (let i = fila; i >= 0; i--) {
    const linea = lineaHasta(doc, i, fila, limite);
    if (inicioBuscado) {
      if (sentenciaEn(doc, i, linea, inicioBuscado)) inicioBuscado = undefined;
      continue;
    }
    const fin = sentenciaEn(doc, i, linea, FIN_DE_BLOQUE_O_CLASE)?.[1];
    if (fin !== undefined) {
      inicioBuscado = INICIO_DE_BLOQUE[fin];
      continue;
    }
    const declaracion = declaracionEnLinea(patrones, doc, i, linea);
    if (declaracion) {
      return declaracion.clase;
    }
  }
  return undefined;
}

function patronesDe(nombre: string): PatronesDeclaracion {
  return {
    referencia: new RegExp(`(?:^|[\\s:,(])${nombre}\\)?\\s+TYPE\\s+REF\\s+TO\\s+([A-Z_/][A-Z0-9_/]*)`),
    creacion: new RegExp(
      `(?:\\bDATA\\(\\s*${nombre}\\s*\\)|(?:^|[\\s:,.])${nombre})\\s*=\\s*(?:NEW|CAST)\\s+([A-Z_/][A-Z0-9_/]*)\\s*\\(`,
    ),
    creacionObjeto: new RegExp(`\\bCREATE\\s+OBJECT\\s+${nombre}\\s+TYPE\\s+([A-Z_/][A-Z0-9_/]*)(?![A-Z0-9_/(])`),
    declaracion: new RegExp(`\\bDATA\\(\\s*${nombre}\\s*\\)|(?:^|[\\s:,(])${nombre}\\)?\\s+(?:TYPE|LIKE)\\b`),
  };
}

function declaracionEnLinea(
  patrones: PatronesDeclaracion,
  doc: LectorLineas,
  fila: number,
  linea: string,
): Declaracion | undefined {
  const tipada = patrones.referencia.exec(linea)?.[1];
  if (tipada !== undefined) {
    return { clase: claseValida(tipada) };
  }
  const creada = patrones.creacion.exec(linea);
  if (creada) {
    return { clase: encadenada(doc, fila, creada.index) ? undefined : claseValida(creada[1]) };
  }
  const objeto = patrones.creacionObjeto.exec(linea)?.[1];
  if (objeto !== undefined) {
    return { clase: claseValida(objeto) };
  }
  return patrones.declaracion.test(linea) ? {} : undefined;
}

/** Ventana del bloque; si no está, atributo de la clase envolvente; si tampoco, global del programa. */
function resolverVariable(nombre: string, doc: LectorLineas, fila: number, limite: number): string | undefined {
  if (!NOMBRE.test(nombre)) {
    return undefined;
  }
  const patrones = patronesDe(nombre);
  const declaracion = declaracionEnVentana(patrones, doc, fila, limite);
  if (declaracion) {
    return declaracion.clase;
  }
  return atributoDeClase(nombre, doc, fila) ?? declaracionGlobal(patrones, doc, fila, limite);
}

/** `(` pegado al método, `CALL METHOD <receptor><m>` o `<receptor><m>.` como sentencia completa. */
function esLlamada(pos: Posicion, metodo: Tramo, inicioReceptor: number): boolean {
  if (pos.linea[metodo.fin] === '(') {
    return true;
  }
  const antes = sentenciaAntes(pos.doc, pos.fila, inicioReceptor);
  return CALL_METHOD.test(antes) || (antes === '' && /^\s*\./.test(pos.linea.slice(metodo.fin)));
}

function llamadaEstatica(pos: Posicion, metodo: Tramo): ContextoLlamada | undefined {
  const delante = /([A-Za-z_/][A-Za-z0-9_/]*)=>$/.exec(pos.linea.slice(0, metodo.inicio));
  const objeto = delante ? claseValida(delante[1].toUpperCase()) : undefined;
  const inicioReceptor = metodo.inicio - (delante?.[0].length ?? 0);
  if (objeto === undefined || !esLlamada(pos, metodo, inicioReceptor)) {
    return undefined;
  }
  const receptor = pos.original.slice(inicioReceptor, metodo.inicio);
  return { clase: 'metodo', objeto, metodo: metodo.texto, receptor };
}

function llamadaDeInstancia(pos: Posicion, metodo: Tramo): ContextoLlamada | undefined {
  const cadena = /((?:[A-Za-z_/][A-Za-z0-9_/]*->)+)$/.exec(pos.linea.slice(0, metodo.inicio))?.[1];
  if (cadena === undefined) {
    return undefined;
  }
  const inicioReceptor = metodo.inicio - cadena.length;
  if (SEPARADOR_DE_COMPONENTE.test(pos.linea[inicioReceptor - 1] ?? '') || !esLlamada(pos, metodo, inicioReceptor)) {
    return undefined;
  }
  const receptor = pos.original.slice(inicioReceptor, metodo.inicio - 2);
  const segmentos = cadena.slice(0, -2).toUpperCase().split('->');
  const llamada = (objeto: string | undefined, viaSuper = false): ContextoLlamada | undefined => {
    if (objeto === undefined) return undefined;
    const base = { clase: 'metodo' as const, objeto, metodo: metodo.texto, receptor };
    return viaSuper ? { ...base, viaSuper } : base;
  };
  if (segmentos.length === 2 && segmentos[0] === 'ME') {
    return llamada(atributoDeClase(segmentos[1], pos.doc, pos.fila));
  }
  if (segmentos.length !== 1) {
    return undefined;
  }
  if (segmentos[0] === 'ME' || segmentos[0] === 'SUPER') {
    return llamada(claseEnvolvente(pos.doc, pos.fila)?.nombre, segmentos[0] === 'SUPER');
  }
  return llamada(resolverVariable(segmentos[0], pos.doc, pos.fila, inicioReceptor));
}

/**
 * `m( ` o `m( )` al inicio de la sentencia (o `CALL METHOD m`): método de la clase envolvente. Sin espacio ni
 * `)` tras el paréntesis no es llamada (`DATA(x)`, `lv_texto(3)`).
 */
function llamadaASolas(pos: Posicion, metodo: Tramo): ContextoLlamada | undefined {
  if (SEPARADOR_DE_COMPONENTE.test(pos.linea[metodo.inicio - 1] ?? '') || NO_SON_METODOS.has(metodo.texto)) {
    return undefined;
  }
  const antes = sentenciaAntes(pos.doc, pos.fila, metodo.inicio);
  const conParentesis = PARENTESIS_DE_LLAMADA.test(pos.linea.slice(metodo.fin));
  const llamada = (antes === '' && conParentesis) || CALL_METHOD.test(antes);
  const objeto = llamada ? claseEnvolvente(pos.doc, pos.fila)?.nombre : undefined;
  return objeto === undefined ? undefined : { clase: 'metodo', objeto, metodo: metodo.texto, receptor: '' };
}

function metodoEn(pos: Posicion, metodo: Tramo): ContextoLlamada | undefined {
  if (!NOMBRE_METODO.test(metodo.texto)) {
    return undefined;
  }
  const previo = pos.linea.slice(Math.max(0, metodo.inicio - 2), metodo.inicio);
  if (previo === '=>') return llamadaEstatica(pos, metodo);
  if (previo === '->') return llamadaDeInstancia(pos, metodo);
  return llamadaASolas(pos, metodo);
}

function claseEn(pos: Posicion, palabra: Tramo): ContextoLlamada | undefined {
  const nombre = claseValida(palabra.texto);
  if (nombre === undefined || SEPARADOR_DE_COMPONENTE.test(pos.linea[palabra.inicio - 1] ?? '')) {
    return undefined;
  }
  if (pos.linea.startsWith('=>', palabra.fin)) {
    return { clase: 'clase', nombre };
  }
  const clave = CLAVE_CLASE.exec(sentenciaAntes(pos.doc, pos.fila, palabra.inicio))?.[1];
  if (clave === undefined || (clave === 'NEW' && pos.linea[palabra.fin] !== '(')) {
    return undefined;
  }
  return { clase: 'clase', nombre };
}

export function contextoLlamadaEn(doc: LectorLineas, fila: number, columna: number): ContextoLlamada | undefined {
  if (fila < 0 || fila >= doc.total || columna < 0) {
    return undefined;
  }
  const original = doc.linea(fila);
  const pos: Posicion = { doc, fila, linea: enmascarar(original), original };
  const literal = literalBajoCursor(pos.linea, columna);
  if (literal) {
    return funcionEn(pos, literal);
  }
  const palabra = palabraEn(pos.linea, columna);
  if (!palabra) {
    return undefined;
  }
  return metodoEn(pos, compuestoDe(pos.linea, palabra)) ?? claseEn(pos, palabra);
}
