/**
 * Firmas de módulos de funciones, métodos y clases (mejoras 1: tarea 0).
 * Tipos compartidos (tarea 0), consultas de Data Preview y analizadores de filas y XML (tarea 1).
 */

import { leerAtributos } from '../adt/busqueda-modelo';
import { nombreValido } from '../diccionario/modelo';

export type ClaseParametro = 'importing' | 'exporting' | 'changing' | 'tables' | 'returning';
/** Cómo está tipado: TYPE, LIKE, TYPE REF TO o sin tipo (parámetro genérico). */
export type FormaTipo = 'type' | 'like' | 'refTo' | 'ninguna';
export type Visibilidad = 'publico' | 'protegido' | 'privado';

export interface Parametro {
  /** En mayúsculas, tal como viene del sistema. */
  nombre: string;
  /** La del objeto llamado: en un módulo de funciones 'importing' es lo que el llamador pasa en EXPORTING. */
  clase: ClaseParametro;
  posicion: number;
  /** '' si `formaTipo` es 'ninguna'. */
  tipo: string;
  formaTipo: FormaTipo;
  porValor: boolean;
  opcional: boolean;
  /** Texto literal del sistema (`SY-LANGU`, `' '`, `IF_SALV_C_BOOL_SAP=>FALSE`). */
  porDefecto?: string;
  texto?: string;
}

export interface Excepcion {
  /** En excepciones basadas en clases es la clase (CX_SALV_MSG). */
  nombre: string;
  texto?: string;
}

export interface FirmaFuncion {
  tipo: 'funcion';
  nombre: string;
  /** De TFDIR.PNAME sin el prefijo SAPL. */
  grupo: string;
  /** TFDIR.FMODE === 'R'. */
  rfc: boolean;
  descripcion: string;
  /** Orden: importing, exporting, changing, tables; dentro, por posición. */
  parametros: Parametro[];
  excepciones: Excepcion[];
  /** /sap/bc/adt/functions/groups/<grupo>/fmodules/<fm> (segmentos en minúsculas, '/' → %2f). */
  uriAdt: string;
}

export interface FirmaMetodo {
  tipo: 'metodo';
  /** La clase o interfaz donde está definido el método. */
  clase: string;
  nombre: string;
  descripcion: string;
  estatico: boolean;
  visibilidad: Visibilidad;
  abstracto: boolean;
  /** SEOCOMPODF.MTDNEWEXC === 'X'. */
  excepcionesDeClase: boolean;
  /** Clase antecesora cuando se pidió por una subclase. */
  heredadoDe?: string;
  /** Interfaz cuando se pidió como zif~m o se encontró en una interfaz de la clase. */
  deInterfaz?: string;
  /** Orden: importing, exporting, changing, returning; dentro, por EDITORDER. */
  parametros: Parametro[];
  excepciones: Excepcion[];
  /** /sap/bc/adt/oo/classes/<clase> o /sap/bc/adt/oo/interfaces/<intf>. */
  uriAdt: string;
}

export type Firma = FirmaFuncion | FirmaMetodo;

export interface MetodoResumen {
  nombre: string;
  descripcion: string;
  estatico: boolean;
  origen?: string;
}

export interface ClaseResumen {
  nombre: string;
  esInterfaz: boolean;
  descripcion: string;
  paquete?: string;
  superclase?: string;
  interfaces: string[];
  final: boolean;
  abstracto: boolean;
  /** Públicos propios, del objectstructure. */
  metodos: MetodoResumen[];
  /** Públicos de antecesores e interfaces, con `origen`. */
  heredados: MetodoResumen[];
  uriAdt: string;
}

export type Fila = Record<string, string>;

const PATRON_IDIOMA = /^[A-Z0-9]$/;
const ATRIBUTOS = String.raw`((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)`;
const ELEMENTO_ESTRUCTURA = new RegExp(String.raw`<abapsource:objectStructureElement${ATRIBUTOS}\s*\/?>`, 'g');
const ELEMENTO_RAIZ = new RegExp(String.raw`<(?!\?)[A-Za-z_][\w.:-]*${ATRIBUTOS}\s*\/?>`);
const REFERENCIA_PAQUETE = new RegExp(String.raw`<adtcore:packageRef${ATRIBUTOS}\s*\/?>`);
const ORDEN_CLASES_FUNCION: readonly ClaseParametro[] = ['importing', 'exporting', 'changing', 'tables'];
const ORDEN_CLASES_METODO: readonly ClaseParametro[] = ['importing', 'exporting', 'changing', 'returning'];
const CLASE_POR_PARAMTYPE: Readonly<Record<string, ClaseParametro>> = {
  I: 'importing', E: 'exporting', C: 'changing', T: 'tables',
};
const CLASE_POR_PARDECLTYP: Readonly<Record<string, ClaseParametro>> = {
  '0': 'importing', '1': 'exporting', '2': 'changing', '3': 'returning',
};
const FORMA_POR_TYPTYPE: Readonly<Record<string, FormaTipo>> = {
  '0': 'ninguna', '1': 'type', '2': 'like', '3': 'refTo',
};
const VISIBILIDAD_POR_EXPOSURE: Readonly<Record<string, Visibilidad>> = {
  '0': 'privado', '1': 'protegido', '2': 'publico',
};

function exigirNombre(nombre: string): string {
  if (!nombreValido(nombre)) {
    throw new Error('nombre no válido');
  }
  return nombre.toUpperCase();
}

function listaIdiomas(idiomas: string[]): string {
  if (idiomas.length === 0 || !idiomas.every((i) => PATRON_IDIOMA.test(i))) {
    throw new Error('idioma no válido');
  }
  return idiomas.map((i) => `'${i}'`).join(',');
}

export function consultaParametrosFuncion(fm: string): string {
  return (
    'SELECT PARAMETER, PARAMTYPE, STRUCTURE, DEFAULTVAL, REFERENCE, PPOSITION, OPTIONAL, TYPE, CLASS, REF_CLASS, LINE_OF, TABLE_OF ' +
    `FROM FUPARAREF WHERE FUNCNAME = '${exigirNombre(fm)}' AND R3STATE = 'A'`
  );
}

export function consultaTextosFuncion(fm: string, idiomas: string[]): string {
  return `SELECT PARAMETER, KIND, SPRAS, STEXT FROM FUNCT WHERE FUNCNAME = '${exigirNombre(fm)}' AND SPRAS IN (${listaIdiomas(idiomas)})`;
}

export function consultaTituloFuncion(fm: string, idiomas: string[]): string {
  return `SELECT SPRAS, STEXT FROM TFTIT WHERE FUNCNAME = '${exigirNombre(fm)}' AND SPRAS IN (${listaIdiomas(idiomas)})`;
}

export function consultaGrupoFuncion(fm: string): string {
  return `SELECT FUNCNAME, PNAME, FMODE FROM TFDIR WHERE FUNCNAME = '${exigirNombre(fm)}'`;
}

export function consultaCabeceraMetodo(clase: string, metodo: string): string {
  return (
    'SELECT CMPNAME, EXPOSURE, MTDDECLTYP, MTDABSTRCT, MTDFINAL, MTDNEWEXC, REDEFIN FROM SEOCOMPODF ' +
    `WHERE CLSNAME = '${exigirNombre(clase)}' AND CMPNAME = '${exigirNombre(metodo)}' AND VERSION = '1'`
  );
}

export function consultaParametrosMetodo(clase: string, metodo: string): string {
  return (
    'SELECT SCONAME, EDITORDER, PARDECLTYP, PARPASSTYP, TYPTYPE, TYPE, TABLEOF, PARVALUE, PAROPTIONL, PARPREFERD FROM SEOSUBCODF ' +
    `WHERE CLSNAME = '${exigirNombre(clase)}' AND CMPNAME = '${exigirNombre(metodo)}' AND VERSION = '1'`
  );
}

export function consultaSubcomponentes(clase: string, metodo: string): string {
  return `SELECT SCONAME, SCOTYPE FROM SEOSUBCO WHERE CLSNAME = '${exigirNombre(clase)}' AND CMPNAME = '${exigirNombre(metodo)}'`;
}

export function consultaTextosMetodo(clase: string, metodo: string, idiomas: string[]): string {
  return (
    'SELECT SCONAME, LANGU, DESCRIPT FROM SEOSUBCOTX ' +
    `WHERE CLSNAME = '${exigirNombre(clase)}' AND CMPNAME = '${exigirNombre(metodo)}' AND LANGU IN (${listaIdiomas(idiomas)})`
  );
}

export function consultaTextosComponentes(clase: string, idiomas: string[]): string {
  return `SELECT CMPNAME, LANGU, DESCRIPT FROM SEOCOMPOTX WHERE CLSNAME = '${exigirNombre(clase)}' AND LANGU IN (${listaIdiomas(idiomas)})`;
}

export function consultaComponentes(clase: string): string {
  return `SELECT CMPNAME, CMPTYPE FROM SEOCOMPO WHERE CLSNAME = '${exigirNombre(clase)}'`;
}

export function consultaMetodosPublicos(clase: string): string {
  return `SELECT CMPNAME, MTDDECLTYP, EDITORDER FROM SEOCOMPODF WHERE CLSNAME = '${exigirNombre(clase)}' AND VERSION = '1' AND EXPOSURE = '2'`;
}

export function consultaTextoClase(clase: string, idiomas: string[]): string {
  return `SELECT LANGU, DESCRIPT FROM SEOCLASSTX WHERE CLSNAME = '${exigirNombre(clase)}' AND LANGU IN (${listaIdiomas(idiomas)})`;
}

export function consultaRelaciones(clase: string): string {
  return `SELECT REFCLSNAME, RELTYPE FROM SEOMETAREL WHERE CLSNAME = '${exigirNombre(clase)}' AND VERSION = '1'`;
}

function segmentoUri(nombre: string): string {
  return nombre.toLowerCase().replace(/\//g, '%2f');
}

export function uriFuncion(grupo: string, fm: string): string {
  return `/sap/bc/adt/functions/groups/${segmentoUri(grupo)}/fmodules/${segmentoUri(fm)}`;
}

export function uriClase(nombre: string, esInterfaz: boolean): string {
  return `/sap/bc/adt/oo/${esInterfaz ? 'interfaces' : 'classes'}/${segmentoUri(nombre)}`;
}

export function separarMetodo(texto: string): { interfaz?: string; metodo: string } {
  const mayus = texto.trim().toUpperCase();
  const i = mayus.indexOf('~');
  return i < 0 ? { metodo: mayus } : { interfaz: mayus.slice(0, i), metodo: mayus.slice(i + 1) };
}

function numero(valor: string | undefined): number {
  const n = Number((valor ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Por cada clave, el texto de la fila del primer idioma de la lista que tenga una. */
function textosPorClave(
  filas: Fila[], idiomas: string[], columnaIdioma: string, clave: (f: Fila) => string, columnaTexto: string,
): Map<string, string> {
  const elegidos = new Map<string, { texto: string; rango: number }>();
  for (const fila of filas) {
    const rango = idiomas.indexOf(fila[columnaIdioma] ?? '');
    if (rango < 0) {
      continue;
    }
    const k = clave(fila);
    const actual = elegidos.get(k);
    if (!actual || rango < actual.rango) {
      elegidos.set(k, { texto: fila[columnaTexto] ?? '', rango });
    }
  }
  return new Map(Array.from(elegidos, ([k, v]) => [k, v.texto]));
}

function ordenar(parametros: Parametro[], orden: readonly ClaseParametro[]): Parametro[] {
  return [...parametros].sort((a, b) => orden.indexOf(a.clase) - orden.indexOf(b.clase) || a.posicion - b.posicion);
}

function conTexto<T extends { texto?: string }>(objeto: T, texto: string | undefined): T {
  return texto ? { ...objeto, texto } : objeto;
}

export function firmaFuncionDe(
  nombre: string,
  filas: { parametros: Fila[]; textos: Fila[]; titulo: Fila[]; grupo: Fila[] },
  idiomas: string[],
): FirmaFuncion | undefined {
  const cabecera = filas.grupo[0];
  if (!cabecera) {
    return undefined;
  }
  const textosDe = (clase: string): Map<string, string> =>
    textosPorClave(filas.textos.filter((f) => f.KIND === clase), idiomas, 'SPRAS', (f) => f.PARAMETER ?? '', 'STEXT');
  const textosParametros = textosDe('P');
  const textosExcepciones = textosDe('X');
  const titulo = textosPorClave(filas.titulo, idiomas, 'SPRAS', () => '', 'STEXT').get('') ?? '';
  const parametros: Parametro[] = [];
  for (const f of filas.parametros) {
    const clase = CLASE_POR_PARAMTYPE[f.PARAMTYPE ?? ''];
    if (!clase) {
      continue;
    }
    const tipo = f.STRUCTURE ?? '';
    const porDefecto = f.DEFAULTVAL ? f.DEFAULTVAL : undefined;
    const parametro: Parametro = {
      nombre: f.PARAMETER ?? '',
      clase,
      posicion: numero(f.PPOSITION),
      tipo,
      formaTipo: tipo === '' ? 'ninguna' : f.TYPE === 'X' ? 'type' : 'like',
      porValor: clase !== 'tables' && f.REFERENCE !== 'X',
      opcional: f.OPTIONAL === 'X' || porDefecto !== undefined,
      ...(porDefecto !== undefined ? { porDefecto } : {}),
    };
    parametros.push(conTexto(parametro, textosParametros.get(parametro.nombre)));
  }
  const excepciones = filas.parametros
    .filter((f) => f.PARAMTYPE === 'X')
    .sort((a, b) => numero(a.PPOSITION) - numero(b.PPOSITION))
    .map((f) => conTexto<Excepcion>({ nombre: f.PARAMETER ?? '' }, textosExcepciones.get(f.PARAMETER ?? '')));
  const nombreFm = nombre.toUpperCase();
  const grupo = (cabecera.PNAME ?? '').replace(/^SAPL/, '');
  return {
    tipo: 'funcion',
    nombre: nombreFm,
    grupo,
    rfc: cabecera.FMODE === 'R',
    descripcion: titulo,
    parametros: ordenar(parametros, ORDEN_CLASES_FUNCION),
    excepciones,
    uriAdt: uriFuncion(grupo, nombreFm),
  };
}

export function firmaMetodoDe(
  clase: string,
  nombre: string,
  filas: { cabecera: Fila[]; parametros: Fila[]; subcomponentes: Fila[]; textos: Fila[]; textosComponentes: Fila[] },
  idiomas: string[],
): FirmaMetodo | undefined {
  const cabecera = filas.cabecera[0];
  if (!cabecera) {
    return undefined;
  }
  const nombreMetodo = nombre.toUpperCase();
  const claseMayus = clase.toUpperCase();
  const nombresExcepcion = new Set(filas.subcomponentes.filter((f) => f.SCOTYPE === '1').map((f) => f.SCONAME ?? ''));
  const textos = textosPorClave(filas.textos, idiomas, 'LANGU', (f) => f.SCONAME ?? '', 'DESCRIPT');
  const descripcion =
    textosPorClave(
      filas.textosComponentes.filter((f) => (f.CMPNAME ?? '').toUpperCase() === nombreMetodo),
      idiomas, 'LANGU', () => '', 'DESCRIPT',
    ).get('') ?? '';
  const parametros: Parametro[] = [];
  for (const f of filas.parametros) {
    const clasePar = CLASE_POR_PARDECLTYP[f.PARDECLTYP ?? ''];
    const nombrePar = f.SCONAME ?? '';
    if (!clasePar || nombresExcepcion.has(nombrePar)) {
      continue;
    }
    const formaTipo = FORMA_POR_TYPTYPE[f.TYPTYPE ?? ''] ?? 'ninguna';
    const porDefecto = f.PARVALUE ? f.PARVALUE : undefined;
    const parametro: Parametro = {
      nombre: nombrePar,
      clase: clasePar,
      posicion: numero(f.EDITORDER),
      tipo: formaTipo === 'ninguna' ? '' : f.TYPE ?? '',
      formaTipo,
      porValor: f.PARPASSTYP === '1',
      opcional: f.PAROPTIONL === 'X' || porDefecto !== undefined,
      ...(porDefecto !== undefined ? { porDefecto } : {}),
    };
    parametros.push(conTexto(parametro, textos.get(nombrePar)));
  }
  const excepciones = filas.subcomponentes
    .filter((f) => f.SCOTYPE === '1')
    .map((f) => conTexto<Excepcion>({ nombre: f.SCONAME ?? '' }, textos.get(f.SCONAME ?? '')));
  return {
    tipo: 'metodo',
    clase: claseMayus,
    nombre: nombreMetodo,
    descripcion,
    estatico: cabecera.MTDDECLTYP === '1',
    visibilidad: VISIBILIDAD_POR_EXPOSURE[cabecera.EXPOSURE ?? ''] ?? 'privado',
    abstracto: cabecera.MTDABSTRCT === 'X',
    excepcionesDeClase: cabecera.MTDNEWEXC === 'X',
    parametros: ordenar(parametros, ORDEN_CLASES_METODO),
    excepciones,
    // NO VERIFICADO: para una interfaz el servicio debe sustituirla por uriClase(clase, true); aquí no se sabe si lo es.
    uriAdt: uriClase(claseMayus, false),
  };
}

function atributosRaiz(xml: string): Map<string, string> | undefined {
  const raiz = ELEMENTO_RAIZ.exec(xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, ''));
  return raiz ? leerAtributos(raiz[1]) : undefined;
}

function metodosDeEstructura(xml: string): MetodoResumen[] {
  const metodos: MetodoResumen[] = [];
  for (const m of xml.matchAll(ELEMENTO_ESTRUCTURA)) {
    const a = leerAtributos(m[1]);
    const tipo = a.get('adtcore:type') ?? '';
    const visibilidad = a.get('visibility');
    // NO VERIFICADO: los métodos de interfaz (INTF/IO) y su atributo `visibility` no tienen fixture; solo CLAS/OM.
    const publico = tipo.endsWith('/OM') ? visibilidad === 'public' : tipo.endsWith('/IO') && (visibilidad === undefined || visibilidad === 'public');
    if (publico) {
      metodos.push({
        nombre: a.get('adtcore:name') ?? '',
        descripcion: a.get('description') ?? '',
        estatico: a.get('level') === 'static',
      });
    }
  }
  return metodos;
}

export function claseResumenDe(
  nombre: string,
  xmlMetadatos: string | undefined,
  xmlEstructura: string,
  filas: { texto: Fila[]; relaciones: Fila[] },
  idiomas: string[],
): ClaseResumen | undefined {
  const tipoRaiz = atributosRaiz(xmlEstructura)?.get('adtcore:type');
  if (tipoRaiz !== 'CLAS/OC' && tipoRaiz !== 'INTF/OI') {
    return undefined;
  }
  const esInterfaz = tipoRaiz === 'INTF/OI';
  const metadatos = xmlMetadatos === undefined ? undefined : atributosRaiz(xmlMetadatos);
  const paquete = xmlMetadatos === undefined ? null : REFERENCIA_PAQUETE.exec(xmlMetadatos);
  const nombrePaquete = paquete ? leerAtributos(paquete[1]).get('adtcore:name') : undefined;
  const descripcion =
    textosPorClave(filas.texto, idiomas, 'LANGU', () => '', 'DESCRIPT').get('') ?? metadatos?.get('adtcore:description') ?? '';
  const superclase = filas.relaciones.find((f) => f.RELTYPE === '2')?.REFCLSNAME;
  const nombreClase = nombre.toUpperCase();
  return {
    nombre: nombreClase,
    esInterfaz,
    descripcion,
    ...(nombrePaquete ? { paquete: nombrePaquete } : {}),
    ...(superclase ? { superclase } : {}),
    interfaces: filas.relaciones.filter((f) => f.RELTYPE === '1').map((f) => f.REFCLSNAME ?? ''),
    final: metadatos?.get('class:final') === 'true',
    abstracto: metadatos?.get('class:abstract') === 'true',
    metodos: metodosDeEstructura(xmlEstructura),
    heredados: [],
    uriAdt: uriClase(nombreClase, esInterfaz),
  };
}

export function metodosResumenDe(
  filas: { metodos: Fila[]; componentes: Fila[]; textos: Fila[] },
  idiomas: string[],
  origen: string,
): MetodoResumen[] {
  const esMetodo = new Set(filas.componentes.filter((f) => f.CMPTYPE === '1').map((f) => f.CMPNAME ?? ''));
  const textos = textosPorClave(filas.textos, idiomas, 'LANGU', (f) => f.CMPNAME ?? '', 'DESCRIPT');
  return filas.metodos
    .filter((f) => esMetodo.has(f.CMPNAME ?? ''))
    .sort((a, b) => numero(a.EDITORDER) - numero(b.EDITORDER))
    .map((f) => ({
      nombre: f.CMPNAME ?? '',
      descripcion: textos.get(f.CMPNAME ?? '') ?? '',
      estatico: f.MTDDECLTYP === '1',
      origen,
    }));
}
