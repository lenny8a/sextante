export type ContextoDiccionario =
  | { clase: 'objeto'; nombre: string }
  /** `expresion`: el texto original de la base al campo (`ls_mara-mtart`), para el CASE del hover. */
  | { clase: 'campo'; tabla: string; campo: string; expresion?: string }
  | { clase: 'mensaje'; claseMensaje: string; numero: string; tipo?: string };

export const LINEAS_ATRAS = 200;

interface Palabra {
  texto: string;
  inicio: number;
  fin: number;
}

interface Declaracion {
  forma: 'tables' | 'variable';
  tabla?: string;
}

interface Documento {
  lineas: string[];
  fila: number;
  /** En la fila del cursor solo cuenta el texto anterior a esta columna. */
  limite: number;
}

export const MAX_LINEAS_SENTENCIA = 20;
const PROFUNDIDAD_LIKE = 2;
const CARACTER_PALABRA = /[A-Za-z0-9_/]/;
export const NOMBRE = /^[A-Z_/][A-Z0-9_/]*$/;
const CONVENCION_VARIABLE = /^[LGIECMRP][STVR]_/;
/** `FROM <tabla>` solo en SELECT (incluye WITH, OPEN CURSOR y subconsultas); en el resto da área o índice. */
const SENTENCIA_SELECT = /\bSELECT(?![\w-])/;
const CLAVE_OBJETO = new RegExp(
  '(?:^|[\\s(:,.])(FROM|JOIN|INTO TABLE|INSERT INTO|UPDATE|INSERT|MODIFY|DELETE FROM|LIKE|TYPE|' +
    'TYPE (?:STANDARD |SORTED |HASHED )?TABLE OF|TYPE LINE OF|INCLUDE STRUCTURE|INCLUDE TYPE)$',
);
const CLAVES_DE_TIPO = /^(?:TYPE|INCLUDE)\b/;
const TIPO_DE_CLASE = /\b(?:(?:CREATE OBJECT\b.*|RAISE EXCEPTION|RAISE RESUMABLE EXCEPTION) TYPE|INHERITING FROM)$/;
const LISTA_TABLES = /^\s*TABLES\b[\s:]*(?:[A-Za-z0-9_/]+\s*,\s*)*$/i;
const MENSAJE_PARENTESIS = /\bMESSAGE\s+([AEISWX])(\d{3})\s*\(\s*([A-Za-z0-9_/]+)\s*\)/gi;
const MENSAJE_ID = /\bMESSAGE\s+ID\s+'([A-Za-z0-9_/]+)'\s+TYPE\s+'([AEISWX])'\s+NUMBER\s+'?(\d{1,3})'?/gi;
const MENSAJE_CORTO = /\bMESSAGE\s+([AEISWX])(\d{3})(?![\w/(])(?!\s*\()/gi;
const MESSAGE_ID = /\bMESSAGE-ID\s+([A-Za-z0-9_/]+)/i;
const NO_SON_OBJETOS = new Set(
  (
    'TABLE TABLES STANDARD SORTED HASHED ANY INDEX LINE LINES REF RANGE OF TO STRUCTURE TYPE INTO FROM SINGLE ' +
    'CORRESPONDING FIELDS ENTITIES ENTITY SCREEN ADJACENT VALUE INITIAL DATA FIELD SET CLIENT USING CONNECTION ' +
    'BEGIN END SY ME C N I P D T X F STRING XSTRING DECFLOAT16 DECFLOAT34 INT1 INT2 INT4 INT8 UTCLONG SIMPLE ' +
    'CLIKE CSEQUENCE XSEQUENCE NUMERIC OBJECT'
  ).split(' '),
);
/** Primera parte de palabras clave con guion (FIELD-SYMBOLS, END-OF-SELECTION, MESSAGE-ID…). */
const CABEZAS_CON_GUION = new Set(
  (
    'FIELD MESSAGE START END SELECTION SELECT TOP LINE NO NON CLASS FUNCTION INTERFACE TYPE READ LOAD LOWER ' +
    'USER NEW PF LIST VALUE HELP LEFT RIGHT ENHANCEMENT SUBROUTINE CHAIN WITH PRINT BYTE EDITOR SYNTAX ' +
    'DISPLAY ABAP INPUT TITLE SY'
  ).split(' '),
);

/** Sustituye por espacios los comentarios y el interior de los literales, conservando las columnas. */
export function enmascarar(linea: string): string {
  if (linea.startsWith('*')) {
    return ' '.repeat(linea.length);
  }
  let salida = '';
  let cierre: string | undefined;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (cierre !== undefined) {
      if (c === cierre && linea[i + 1] === cierre && cierre !== '|') {
        salida += '  ';
        i++;
      } else if (c === cierre) {
        cierre = undefined;
        salida += c;
      } else {
        salida += ' ';
      }
    } else if (c === '"') {
      return salida + ' '.repeat(linea.length - i);
    } else {
      cierre = c === "'" || c === '`' || c === '|' ? c : undefined;
      salida += c;
    }
  }
  return salida;
}

function esLetra(c: string | undefined): boolean {
  return c !== undefined && CARACTER_PALABRA.test(c);
}

export function palabraEn(linea: string, columna: number): Palabra | undefined {
  const posicion = esLetra(linea[columna]) ? columna : esLetra(linea[columna - 1]) ? columna - 1 : -1;
  if (posicion < 0) {
    return undefined;
  }
  let inicio = posicion;
  let fin = posicion + 1;
  while (esLetra(linea[inicio - 1])) inicio--;
  while (esLetra(linea[fin])) fin++;
  return { texto: linea.slice(inicio, fin).toUpperCase(), inicio, fin };
}

function textoDe(doc: Documento, i: number): string {
  const linea = enmascarar(doc.lineas[i]);
  return i === doc.fila ? linea.slice(0, doc.limite) : linea;
}

/** Índices de la fila del cursor hacia atrás, dentro de la ventana. */
function filasAtras(doc: Documento): number[] {
  const filas: number[] = [];
  for (let i = doc.fila; i >= Math.max(0, doc.fila - LINEAS_ATRAS); i--) filas.push(i);
  return filas;
}

function terminaSentencia(linea: string): boolean {
  return /\.\s*$/.test(linea);
}

/** Última fila de la sentencia que pasa por `i`, sin pasar de `ultima`. */
export function finDeSentencia(lineas: string[], i: number, ultima: number): number {
  let fin = i;
  while (fin < ultima && fin - i < MAX_LINEAS_SENTENCIA && !terminaSentencia(enmascarar(lineas[fin]))) fin++;
  return fin;
}

export function inicioDeSentencia(lineas: string[], i: number): number {
  let inicio = i;
  while (inicio > 0 && i - inicio < MAX_LINEAS_SENTENCIA && !terminaSentencia(enmascarar(lineas[inicio - 1]))) inicio--;
  return inicio;
}

function sentenciaDe(lineas: string[], i: number, ultima: number): string {
  const fin = finDeSentencia(lineas, i, ultima);
  return lineas.slice(inicioDeSentencia(lineas, i), fin + 1).map(enmascarar).join(' ').toUpperCase();
}

/** Texto de la sentencia del cursor hasta la palabra (lo que sigue al último punto). */
function sentenciaHasta(doc: Documento): string {
  const filas = Array.from({ length: doc.fila - inicioDeSentencia(doc.lineas, doc.fila) + 1 }, (_, k) => doc.fila - k);
  const texto = filas.reverse().map((i) => textoDe(doc, i)).join(' ');
  return texto.slice(texto.lastIndexOf('.') + 1).toUpperCase();
}

/** Solo una declaración de tipo (TYPES o BEGIN OF) anterior a la sentencia del cursor oculta un tipo del diccionario. */
function declaradoComoTipo(nombre: string, doc: Documento): boolean {
  const patron = new RegExp(`(?:\\bTYPES\\b[\\s:]*|\\bBEGIN\\s+OF\\s+)${nombre}(?![\\w/])`);
  const primera = inicioDeSentencia(doc.lineas, doc.fila) - 1;
  for (let i = primera; i >= Math.max(0, doc.fila - LINEAS_ATRAS); i--) {
    if (patron.test(enmascarar(doc.lineas[i]).toUpperCase())) {
      return true;
    }
  }
  return false;
}

function tablaDeTipo(resto: string, doc: Documento, profundidad: number): string | undefined {
  if (/^TYPE\s+(?:REF\s+TO|RANGE\s+OF|LINE\s+OF)\b/.test(resto) || /\bTABLE\s+OF\s+REF\b/.test(resto)) {
    return undefined;
  }
  const tabla =
    /^TYPE\s+(?:(?:STANDARD|SORTED|HASHED|ANY|INDEX)\s+)?TABLE\s+OF\s+([A-Z0-9_/]+)/.exec(resto) ??
    /^TYPE\s+([A-Z0-9_/]+)(?![-=>~\w/])/.exec(resto);
  if (tabla) {
    return NOMBRE.test(tabla[1]) && !NO_SON_OBJETOS.has(tabla[1]) ? tabla[1] : undefined;
  }
  const dato = /^LIKE\s+(?:LINE\s+OF\s+)?([A-Z0-9_/]+)(?![-=>~\w/])/.exec(resto);
  return dato ? resolverEstructura(dato[1], doc, profundidad - 1) : undefined;
}

function declaracionDe(nombre: string, doc: Documento, profundidad: number): Declaracion | undefined {
  const tipada = new RegExp(`(?:^|[\\s:,(])${nombre}\\)?\\s+((?:TYPE|LIKE)\\s.*)$`);
  const enLinea = new RegExp(`(@?)DATA\\(\\s*${nombre}\\s*\\)`);
  const lista = new RegExp(`[\\s:,]${nombre}(?![\\w/])`);
  const palabraClave = new RegExp(
    '(?:\\b(?:DATA|CONSTANTS|STATICS|PARAMETERS|SELECT-OPTIONS|RANGES|TYPES|FIELD-SYMBOLS)\\b[\\s:]*' +
      `|\\b(?:BEGIN|END)\\s+OF\\s+)${nombre}(?![\\w/])`,
  );
  for (const i of filasAtras(doc)) {
    const linea = textoDe(doc, i).toUpperCase();
    if (/^\s*TABLES\b/.test(linea) && lista.test(linea)) {
      return { forma: 'tables', tabla: nombre };
    }
    const inline = enLinea.exec(linea);
    if (inline) {
      const sentencia = inline[1] === '@' ? sentenciaDe(doc.lineas, i, doc.fila) : '';
      const desde = /\bJOIN\b/.test(sentencia) ? null : /\bFROM\s+([A-Z_/][A-Z0-9_/]*)/.exec(sentencia);
      return { forma: 'variable', tabla: desde?.[1] };
    }
    const tipo = tipada.exec(linea);
    if (tipo) {
      return { forma: 'variable', tabla: tablaDeTipo(tipo[1].replace(/\s+/g, ' '), doc, profundidad) };
    }
    if (palabraClave.test(linea)) {
      return { forma: 'variable' };
    }
  }
  return undefined;
}

/** Tabla a la que pertenece `<x>` en `<x>-campo`, o `undefined` si es una variable sin tabla conocida. */
function resolverEstructura(nombre: string, doc: Documento, profundidad: number): string | undefined {
  if (profundidad <= 0 || CABEZAS_CON_GUION.has(nombre) || NO_SON_OBJETOS.has(nombre) || !NOMBRE.test(nombre)) {
    return undefined;
  }
  const declaracion = declaracionDe(nombre, doc, profundidad);
  if (declaracion) {
    return declaracion.tabla;
  }
  return CONVENCION_VARIABLE.test(nombre) ? undefined : nombre;
}

function resolverAlias(alias: string, doc: Documento): string | undefined {
  const conAlias = new RegExp(`\\b(?:FROM|JOIN)\\s+([A-Z_/][A-Z0-9_/]*)\\s+AS\\s+${alias}(?![\\w/])`);
  const sinAlias = new RegExp(`\\b(?:FROM|JOIN)\\s+${alias}(?![\\w/])`);
  const ultima = finDeSentencia(doc.lineas, doc.fila, doc.lineas.length - 1);
  const delante = Array.from({ length: ultima - doc.fila }, (_, k) => doc.fila + 1 + k);
  for (const i of [doc.fila, ...delante, ...filasAtras(doc).slice(1)]) {
    const linea = enmascarar(doc.lineas[i]).toUpperCase();
    const tabla = conAlias.exec(linea)?.[1] ?? (sinAlias.test(linea) ? alias : undefined);
    if (tabla) {
      return tabla;
    }
  }
  return undefined;
}

function campoEn(linea: string, palabra: Palabra, doc: Documento): ContextoDiccionario | undefined | 'no-es-campo' {
  const separadorAntes = linea[palabra.inicio - 1];
  const separadorDespues = linea[palabra.fin];
  let base: Palabra | undefined;
  let campo: Palabra;
  let separador: string;
  if ((separadorAntes === '-' || separadorAntes === '~') && esLetra(linea[palabra.inicio - 2])) {
    base = palabraEn(linea, palabra.inicio - 2);
    campo = palabra;
    separador = separadorAntes;
  } else if ((separadorDespues === '-' || separadorDespues === '~') && esLetra(linea[palabra.fin + 1])) {
    base = palabra;
    campo = palabraEn(linea, palabra.fin + 1) ?? palabra;
    separador = separadorDespues;
  } else {
    return 'no-es-campo';
  }
  if (!base || '-~>'.includes(linea[base.inicio - 1] ?? ' ') || !NOMBRE.test(campo.texto)) {
    return undefined;
  }
  const docBase = { ...doc, limite: base.inicio };
  const tabla =
    separador === '~' ? resolverAlias(base.texto, docBase) : resolverEstructura(base.texto, docBase, PROFUNDIDAD_LIKE);
  return tabla ? { clase: 'campo', tabla, campo: campo.texto, expresion: doc.lineas[doc.fila].slice(base.inicio, campo.fin) } : undefined;
}

function objetoEn(linea: string, palabra: Palabra, doc: Documento): ContextoDiccionario | undefined {
  const nombre = palabra.texto;
  const siguiente = linea.slice(palabra.fin, palabra.fin + 2);
  if (!NOMBRE.test(nombre) || NO_SON_OBJETOS.has(nombre) || siguiente === '=>' || siguiente === '->') {
    return undefined;
  }
  if (!/^[\s:,]?$/.test(linea[palabra.inicio - 1] ?? '')) {
    return undefined;
  }
  const crudo = linea.slice(0, palabra.inicio);
  const antes = crudo.replace(/\s+/g, ' ').trimEnd().toUpperCase();
  const clave = LISTA_TABLES.test(crudo) ? 'TABLES' : CLAVE_OBJETO.exec(antes)?.[1];
  if (clave === undefined || TIPO_DE_CLASE.test(antes)) {
    return undefined;
  }
  const docObjeto = { ...doc, limite: palabra.inicio };
  if (clave === 'FROM' && !SENTENCIA_SELECT.test(sentenciaHasta(docObjeto))) {
    return undefined;
  }
  if (CLAVES_DE_TIPO.test(clave)) {
    return declaradoComoTipo(nombre, doc) ? undefined : { clase: 'objeto', nombre };
  }
  if (declaracionDe(nombre, docObjeto, PROFUNDIDAD_LIKE)?.forma === 'variable') {
    return undefined;
  }
  return clave !== 'TABLES' && CONVENCION_VARIABLE.test(nombre) ? undefined : { clase: 'objeto', nombre };
}

function claseDeMessageId(doc: Documento): string | undefined {
  for (const i of filasAtras(doc)) {
    const encontrado = MESSAGE_ID.exec(enmascarar(doc.lineas[i]));
    if (encontrado) {
      return encontrado[1].toUpperCase();
    }
  }
  return undefined;
}

function mensajeEn(linea: string, enmascarada: string, columna: number, doc: Documento): ContextoDiccionario | undefined {
  const contiene = (m: RegExpMatchArray): boolean =>
    m.index !== undefined &&
    enmascarada.startsWith(m[0].slice(0, 7), m.index) &&
    columna >= m.index &&
    columna <= m.index + m[0].length;
  const crear = (claseMensaje: string, numero: string, tipo: string): ContextoDiccionario => ({
    clase: 'mensaje',
    claseMensaje: claseMensaje.toUpperCase(),
    numero: numero.padStart(3, '0'),
    tipo: tipo.toUpperCase(),
  });
  for (const m of linea.matchAll(MENSAJE_PARENTESIS)) {
    if (contiene(m)) return crear(m[3], m[2], m[1]);
  }
  for (const m of linea.matchAll(MENSAJE_ID)) {
    if (contiene(m)) return crear(m[1], m[3], m[2]);
  }
  for (const m of linea.matchAll(MENSAJE_CORTO)) {
    if (contiene(m)) {
      const claseMensaje = claseDeMessageId(doc);
      return claseMensaje ? crear(claseMensaje, m[2], m[1]) : undefined;
    }
  }
  return undefined;
}

export function contextoEn(lineas: string[], fila: number, columna: number): ContextoDiccionario | undefined {
  if (fila < 0 || fila >= lineas.length || columna < 0) {
    return undefined;
  }
  const original = lineas[fila];
  const linea = enmascarar(original);
  const doc: Documento = { lineas, fila, limite: columna };
  const mensaje = mensajeEn(original, linea, columna, doc);
  if (mensaje) {
    return mensaje;
  }
  const palabra = palabraEn(linea, columna);
  if (!palabra) {
    return undefined;
  }
  const campo = campoEn(linea, palabra, doc);
  return campo === 'no-es-campo' ? objetoEn(linea, palabra, doc) : campo;
}
