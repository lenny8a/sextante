import { descodificarEntidades, leerAtributos } from '../adt/busqueda-modelo';

export type TipoDiccionario = 'tabla' | 'estructura' | 'elementoDatos' | 'dominio';

export interface ObjetoDiccionario {
  nombre: string;
  tipo: TipoDiccionario;
  tipoAdt: string;
  descripcion: string;
  paquete?: string;
  uriAdt: string;
}

export interface CampoDiccionario {
  posicion: number;
  nombre: string;
  clave: boolean;
  elementoDatos: string;
  tipo: string;
  longitud: number;
  decimales: number;
  texto: string;
  include?: string;
}

export interface ElementoDatos {
  nombre: string;
  descripcion: string;
  dominio?: string;
  tipo: string;
  longitud: number;
  decimales: number;
  etiquetas: { corta: string; media: string; larga: string; cabecera: string };
  ayudaBusqueda?: string;
}

export interface Dominio {
  nombre: string;
  descripcion: string;
  tipo: string;
  longitud: number;
  tablaValores?: string;
  /** Con `valorAlto`, el valor es un intervalo `valor`–`valorAlto` (DD07V.DOMVALUE_H). */
  valores: { valor: string; texto: string; valorAlto?: string }[];
}

export interface Mensaje {
  clase: string;
  numero: string;
  texto: string;
  idioma: string;
}

export const RUTAS_DDIC: Record<TipoDiccionario, string> = {
  tabla: '/sap/bc/adt/ddic/tables',
  estructura: '/sap/bc/adt/ddic/structures',
  elementoDatos: '/sap/bc/adt/ddic/dataelements',
  dominio: '/sap/bc/adt/ddic/domains',
};

/** adtcore:type de tabla-mara.xml, estructura-bapiret2.xml, dtel-matnr.xml y doma-mtart.xml. */
const TIPO_POR_TIPO_ADT: Readonly<Record<string, TipoDiccionario>> = {
  'TABL/DT': 'tabla',
  'TABL/DS': 'estructura',
  'DTEL/DE': 'elementoDatos',
  'DOMA/DD': 'dominio',
};

const PATRON_NOMBRE = /^[A-Z0-9_/]{1,30}$/;
/** Clave de idioma SAP de un carácter: letras y también dígitos (1 = ZH, 2 = TH, 3 = KO, …). */
const PATRON_IDIOMA = /^[A-Z0-9]$/;
/** Código ISO 639-1, opcionalmente con región (`es`, `es_ES`, `es-ES`). */
const PATRON_IDIOMA_ISO = /^([A-Z]{2})(?:[_-][A-Z0-9]+)?$/;
/** ISO 639-1 → clave SAP (tabla T002); solo las claves de un carácter en mayúscula o dígito. */
const CLAVE_SAP_POR_ISO: Readonly<Record<string, string>> = {
  ES: 'S', EN: 'E', DE: 'D', FR: 'F', IT: 'I', PT: 'P', NL: 'N', JA: 'J', ZH: '1', ZF: 'M',
  RU: 'R', PL: 'L', TR: 'T', CS: 'C', DA: 'K', SV: 'V', FI: 'U', NO: 'O', HU: 'H', EL: 'G',
  HE: 'B', KO: '3', TH: '2', RO: '4', SL: '5', HR: '6', UK: '8', ET: '9', BG: 'W', SK: 'Q',
  AR: 'A', LT: 'X', LV: 'Y', SR: '0',
};
const PATRON_NUMERO_MENSAJE = /^[0-9]{3}$/;
const LISTA_ATRIBUTOS = String.raw`((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)`;
const ELEMENTO_RAIZ = new RegExp(String.raw`<[A-Za-z_][\w.:-]*${LISTA_ATRIBUTOS}\s*\/?>`);
const REFERENCIA_PAQUETE = new RegExp(String.raw`<adtcore:packageRef${LISTA_ATRIBUTOS}\s*\/?>`);
const REFERENCIA_TABLA_VALORES = new RegExp(String.raw`<doma:valueTableRef${LISTA_ATRIBUTOS}\s*\/?>`);

export function nombreValido(nombre: string): boolean {
  return PATRON_NOMBRE.test(nombre.toUpperCase());
}

function exigirNombre(nombre: string): string {
  if (!nombreValido(nombre)) {
    throw new Error('nombre no válido');
  }
  return nombre.toUpperCase();
}

/** La clave SAP de un carácter para una clave ya válida o un código ISO 639-1; `undefined` si no se reconoce. */
export function claveIdiomaSap(idioma: string | undefined): string | undefined {
  const mayus = idioma?.trim().toUpperCase() ?? '';
  if (PATRON_IDIOMA.test(mayus)) {
    return mayus;
  }
  const iso = PATRON_IDIOMA_ISO.exec(mayus)?.[1];
  return iso === undefined ? undefined : CLAVE_SAP_POR_ISO[iso];
}

function exigirIdioma(idioma: string): string {
  if (!PATRON_IDIOMA.test(idioma)) {
    throw new Error('idioma no válido');
  }
  return idioma;
}

function listaIdiomas(idiomas: string[]): string {
  if (idiomas.length === 0) {
    throw new Error('idioma no válido');
  }
  return idiomas.map((i) => `'${exigirIdioma(i)}'`).join(',');
}

// Verificado 2026-10-31: DD03VT no tiene DECIMALS (los decimales salen de DD03L); DD03L sí tiene DECIMALS, COMPTYPE y PRECFIELD.
/** Varios idiomas en una sola consulta; `camposDe(filas, idiomas)` elige la fila de cada campo. */
export function consultaCampos(tabla: string, idiomas: string[]): string {
  return (
    'SELECT POSITION, FIELDNAME, KEYFLAG, ROLLNAME, DATATYPE, LENG, DDLANGUAGE, DDTEXT FROM DD03VT ' +
    `WHERE TABNAME = '${exigirNombre(tabla)}' AND DDLANGUAGE IN (${listaIdiomas(idiomas)}) ORDER BY POSITION`
  );
}

export function consultaCamposSinTexto(tabla: string): string {
  return (
    'SELECT POSITION, FIELDNAME, KEYFLAG, ROLLNAME, DOMNAME, DATATYPE, LENG, DECIMALS, CHECKTABLE, COMPTYPE, PRECFIELD ' +
    `FROM DD03L WHERE TABNAME = '${exigirNombre(tabla)}' AND AS4LOCAL = 'A' ORDER BY POSITION`
  );
}

export function consultaTextoTabla(tabla: string, idiomas: string[]): string {
  return `SELECT TABNAME, DDLANGUAGE, DDTEXT FROM DD02T WHERE TABNAME = '${exigirNombre(tabla)}' AND DDLANGUAGE IN (${listaIdiomas(idiomas)})`;
}

export function consultaTextosElemento(de: string, idiomas: string[]): string {
  return (
    'SELECT ROLLNAME, DDLANGUAGE, DDTEXT, SCRTEXT_S, SCRTEXT_M, SCRTEXT_L FROM DD04T ' +
    `WHERE ROLLNAME = '${exigirNombre(de)}' AND DDLANGUAGE IN (${listaIdiomas(idiomas)})`
  );
}

/** Varios idiomas en una sola consulta; `valoresDe(filas, idiomas)` elige la fila de cada valor. */
// Verificado 2026-10-31 (sistema real por RFC): DD07V expone DOMVALUE_H; la consulta con la columna responde 200.
export function consultaValoresDominio(dominio: string, idiomas: string[]): string {
  return `SELECT DOMVALUE_L, DOMVALUE_H, DDLANGUAGE, DDTEXT FROM DD07V WHERE DOMNAME = '${exigirNombre(dominio)}' AND DDLANGUAGE IN (${listaIdiomas(idiomas)})`;
}

export function consultaMensaje(clase: string, numero: string, idiomas: string[]): string {
  const claseValida = exigirNombre(clase);
  if (!PATRON_NUMERO_MENSAJE.test(numero)) {
    throw new Error('número de mensaje no válido');
  }
  return `SELECT SPRSL, ARBGB, MSGNR, TEXT FROM T100 WHERE ARBGB = '${claseValida}' AND MSGNR = '${numero}' AND SPRSL IN (${listaIdiomas(idiomas)})`;
}

function aNumero(valor: string | undefined): number {
  const n = Number(valor ?? '');
  return Number.isFinite(n) ? n : 0;
}

/**
 * Por cada clave, la fila del primer idioma de la lista que tenga una (la regla de `mensajeDe`);
 * las filas de idiomas fuera de la lista se descartan. Conserva el orden de la primera aparición.
 */
function elegirPorIdioma(
  filas: Record<string, string>[], idiomas: string[], clave: (f: Record<string, string>) => string,
): Record<string, string>[] {
  const elegidas = new Map<string, { fila: Record<string, string>; rango: number }>();
  for (const fila of filas) {
    const rango = idiomas.indexOf(fila.DDLANGUAGE ?? '');
    if (rango < 0) {
      continue;
    }
    const k = clave(fila);
    const actual = elegidas.get(k);
    if (!actual || rango < actual.rango) {
      elegidas.set(k, { fila, rango });
    }
  }
  return Array.from(elegidas.values(), (e) => e.fila);
}

/**
 * Filas de `analizarDataPreview` sobre DD03VT o DD03L; el `include` y, para DD03VT, los decimales los completa el servicio.
 * Con `idiomas` (DD03VT de `consultaCampos`) queda una fila por campo, la del primer idioma disponible.
 * Los pseudocampos `.INCLUDE`/`.APPEND` no son columnas: no se listan ni se piden en «Ver datos».
 */
export function camposDe(filas: Record<string, string>[], idiomas?: string[]): CampoDiccionario[] {
  const reales = filas.filter((f) => !(f.FIELDNAME ?? '').startsWith('.'));
  const elegidas = idiomas ? elegirPorIdioma(reales, idiomas, (f) => `${f.POSITION ?? ''}|${f.FIELDNAME ?? ''}`) : reales;
  return elegidas.map((f) => ({
    posicion: aNumero(f.POSITION),
    nombre: f.FIELDNAME ?? '',
    clave: f.KEYFLAG === 'X',
    elementoDatos: f.ROLLNAME ?? '',
    tipo: f.DATATYPE ?? '',
    longitud: aNumero(f.LENG),
    decimales: aNumero(f.DECIMALS),
    texto: f.DDTEXT ?? '',
  }));
}

/** Decimales por nombre de campo (en mayúsculas) de las filas de DD03L de `consultaCamposSinTexto`. */
export function decimalesPorCampo(filas: Record<string, string>[]): Map<string, number> {
  const decimales = new Map<string, number>();
  for (const f of filas) {
    const nombre = (f.FIELDNAME ?? '').toUpperCase();
    if (nombre !== '' && !nombre.startsWith('.')) {
      decimales.set(nombre, aNumero(f.DECIMALS));
    }
  }
  return decimales;
}

function sinRuido(xml: string): string {
  return xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
}

function atributosRaiz(xml: string): Map<string, string> | undefined {
  const raiz = ELEMENTO_RAIZ.exec(sinRuido(xml));
  return raiz ? leerAtributos(raiz[1]) : undefined;
}

function textoDe(xml: string, etiqueta: string): string | undefined {
  const m = new RegExp(`<${etiqueta}(?:\\s[^>]*?)?(?:\\/>|>([\\s\\S]*?)<\\/${etiqueta}>)`).exec(xml);
  return m ? descodificarEntidades(m[1] ?? '') : undefined;
}

function bloqueDe(xml: string, etiqueta: string): string {
  return textoDe(xml, etiqueta) ?? '';
}

function vacioAIndefinido(valor: string | undefined): string | undefined {
  return valor ? valor : undefined;
}

function segmentoUri(nombre: string): string {
  return nombre.toLowerCase().replace(/\//g, '%2f');
}

export function analizarMetadatosDdic(xml: string): ObjetoDiccionario | undefined {
  const atributos = atributosRaiz(xml);
  const tipoAdt = atributos?.get('adtcore:type') ?? '';
  const nombre = atributos?.get('adtcore:name') ?? '';
  const tipo = TIPO_POR_TIPO_ADT[tipoAdt];
  if (!atributos || !tipo || !nombre) {
    return undefined;
  }
  const paquete = REFERENCIA_PAQUETE.exec(xml);
  return {
    nombre,
    tipo,
    tipoAdt,
    descripcion: atributos.get('adtcore:description') ?? '',
    ...(paquete ? { paquete: leerAtributos(paquete[1]).get('adtcore:name') } : {}),
    uriAdt: `${RUTAS_DDIC[tipo]}/${segmentoUri(nombre)}`,
  };
}

function objetoDelTipo(xml: string, tipo: TipoDiccionario): ObjetoDiccionario | undefined {
  const objeto = analizarMetadatosDdic(xml);
  return objeto?.tipo === tipo ? objeto : undefined;
}

/** Elementos `dtel:*` de dtel-matnr.xml. */
export function analizarElementoDatos(xml: string): ElementoDatos | undefined {
  const objeto = objetoDelTipo(xml, 'elementoDatos');
  const cuerpo = textoDe(xml, 'dtel:dataElement');
  if (!objeto || cuerpo === undefined) {
    return undefined;
  }
  // NO VERIFICADO: typeKind distinto de `domain` (tipo predefinido o referencia); solo hay fixture con dominio.
  const dominio = textoDe(cuerpo, 'dtel:typeKind') === 'domain' ? vacioAIndefinido(textoDe(cuerpo, 'dtel:typeName')) : undefined;
  const ayudaBusqueda = vacioAIndefinido(textoDe(cuerpo, 'dtel:searchHelp'));
  return {
    nombre: objeto.nombre,
    descripcion: objeto.descripcion,
    ...(dominio ? { dominio } : {}),
    tipo: textoDe(cuerpo, 'dtel:dataType') ?? '',
    longitud: aNumero(textoDe(cuerpo, 'dtel:dataTypeLength')),
    decimales: aNumero(textoDe(cuerpo, 'dtel:dataTypeDecimals')),
    etiquetas: {
      corta: textoDe(cuerpo, 'dtel:shortFieldLabel') ?? '',
      media: textoDe(cuerpo, 'dtel:mediumFieldLabel') ?? '',
      larga: textoDe(cuerpo, 'dtel:longFieldLabel') ?? '',
      cabecera: textoDe(cuerpo, 'dtel:headingFieldLabel') ?? '',
    },
    ...(ayudaBusqueda ? { ayudaBusqueda } : {}),
  };
}

// NO VERIFICADO: doma-mtart.xml trae `<doma:fixValues/>` vacío; la forma doma:fixValue/low/text es supuesta.
function valoresFijos(xml: string): { valor: string; texto: string }[] {
  const lista = bloqueDe(xml, 'doma:fixValues');
  return Array.from(lista.matchAll(/<doma:fixValue>([\s\S]*?)<\/doma:fixValue>/g), (m) => ({
    valor: textoDe(m[1], 'doma:low') ?? '',
    texto: textoDe(m[1], 'doma:text') ?? '',
  }));
}

/** Elementos `doma:*` de doma-mtart.xml; sin valores fijos en el XML los da DD07V. */
export function analizarDominio(xml: string): Dominio | undefined {
  const objeto = objetoDelTipo(xml, 'dominio');
  if (!objeto) {
    return undefined;
  }
  const tipos = bloqueDe(xml, 'doma:typeInformation');
  const tablaValores = REFERENCIA_TABLA_VALORES.exec(xml);
  const nombreTabla = tablaValores ? vacioAIndefinido(leerAtributos(tablaValores[1]).get('adtcore:name')) : undefined;
  return {
    nombre: objeto.nombre,
    descripcion: objeto.descripcion,
    tipo: textoDe(tipos, 'doma:datatype') ?? '',
    longitud: aNumero(textoDe(tipos, 'doma:length')),
    ...(nombreTabla ? { tablaValores: nombreTabla } : {}),
    valores: valoresFijos(xml),
  };
}

/**
 * Filas de DD07V de `consultaValoresDominio`: un valor por DOMVALUE_L, con el texto del primer idioma disponible;
 * con DOMVALUE_H no vacío, un intervalo.
 */
export function valoresDe(filas: Record<string, string>[], idiomas: string[]): Dominio['valores'] {
  return elegirPorIdioma(filas, idiomas, (f) => f.DOMVALUE_L ?? '').map((f) => {
    const valorAlto = vacioAIndefinido(f.DOMVALUE_H?.trim());
    return { valor: f.DOMVALUE_L ?? '', texto: f.DDTEXT ?? '', ...(valorAlto ? { valorAlto } : {}) };
  });
}

/** Filas de T100 (t100-00-001.xml): el primer idioma de la lista que tenga texto. */
export function mensajeDe(filas: Record<string, string>[], idiomas: string[]): Mensaje | undefined {
  for (const idioma of idiomas) {
    const fila = filas.find((f) => f.SPRSL === idioma);
    if (fila) {
      return { clase: fila.ARBGB ?? '', numero: fila.MSGNR ?? '', texto: fila.TEXT ?? '', idioma };
    }
  }
  return undefined;
}
