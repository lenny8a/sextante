import { descodificarEntidades, leerAtributos } from './busqueda-modelo';
import type { ConexionAdt } from './conexion-adt';

export interface FilaTstc {
  tcode: string;
  pgmna: string;
  dypno: string;
  cinfo: string;
}

export interface FilaTstcp {
  tcode: string;
  param: string;
}

export type DestinoTransaccion =
  | { clase: 'programa'; programa: string; dynpro?: string }
  | { clase: 'metodo'; claseAbap: string; metodo: string }
  | { clase: 'vista'; vista: string }
  | { clase: 'transaccion'; tcode: string }
  | { clase: 'desconocido'; detalle?: 'query' };

export const RUTA_DATA_PREVIEW = '/sap/bc/adt/datapreview/freestyle';
/** Con `application/xml` el Data Preview responde 406 (dp-tstc-sin-csrf.xml). */
export const ACCEPT_DATA_PREVIEW = 'application/vnd.sap.adt.datapreview.table.v1+xml';

const SALTOS_POR_DEFECTO = 3;
const FILAS_MAXIMAS = 1;
const DYNPROS_SIN_PANTALLA = ['', '0000', '1000'];
const PATRON_TCODE = /^[A-Z0-9_/]{1,20}$/;
const BLOQUE_COLUMNA = /<dataPreview:columns>([\s\S]*?)<\/dataPreview:columns>/g;
const METADATOS = /<dataPreview:metadata((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/;
const DATO = /<dataPreview:data(?:\s*\/>|>([\s\S]*?)<\/dataPreview:data>)/g;
/** Filas que devolvería la consulta sin `rowNumber` (e071-meth.xml: 9986 con 5 pedidas). */
const TOTAL_FILAS = /<dataPreview:totalRows>\s*(\d+)\s*<\/dataPreview:totalRows>/;
const COMENTARIO_XML = /<!--[\s\S]*?-->/g;

export interface TablaDataPreview {
  filas: Record<string, string>[];
  /** `undefined` si la respuesta no trae `totalRows`. */
  total?: number;
}

export function tcodeValido(t: string): boolean {
  return PATRON_TCODE.test(t);
}

function exigirTcode(tcode: string): string {
  if (!tcodeValido(tcode)) {
    throw new Error('Código de transacción no válido');
  }
  return tcode;
}

export function consultaTstc(tcode: string): string {
  return `SELECT TCODE, PGMNA, DYPNO, CINFO FROM TSTC WHERE TCODE = '${exigirTcode(tcode)}'`;
}

export function consultaTstcp(tcode: string): string {
  return `SELECT TCODE, PARAM FROM TSTCP WHERE TCODE = '${exigirTcode(tcode)}'`;
}

export function analizarDataPreview(xml: string): Record<string, string>[] {
  const sinComentarios = xml.replace(COMENTARIO_XML, '');
  const filas: Record<string, string>[] = [];
  for (const bloque of sinComentarios.matchAll(BLOQUE_COLUMNA)) {
    const metadatos = METADATOS.exec(bloque[1]);
    const nombre = metadatos ? leerAtributos(metadatos[1]).get('dataPreview:name') : undefined;
    if (!nombre) {
      continue;
    }
    Array.from(bloque[1].matchAll(DATO), (m) => descodificarEntidades(m[1] ?? '')).forEach((valor, indice) => {
      (filas[indice] ??= {})[nombre.toUpperCase()] = valor;
    });
  }
  return filas;
}

/** Las mismas filas que `analizarDataPreview` y, si viene, el total de filas de la consulta para detectar un corte. */
export function analizarDataPreviewConTotal(xml: string): TablaDataPreview {
  const filas = analizarDataPreview(xml);
  const total = TOTAL_FILAS.exec(xml.replace(COMENTARIO_XML, ''));
  return total ? { filas, total: Number(total[1]) } : { filas };
}

/** Transacción OO: `\CLASS=<clase>\METHOD=<método>` (tstcp-method.xml). */
const PARAMETRO_METODO = /^\\CLASS=([^\\\s]+)\\METHOD=([^\\\s]+)/;
/** Transacción de parámetros: `/*<tcode> CAMPO=valor;CAMPO=valor;` (dp-tstcp-*.xml). */
const PARAMETRO_TRANSACCION = /^\/\*(\S+)\s*(.*)$/;
const CAMPO_PROGRAMA_SA38 = 'RS38M-PROGRAMM';
const CAMPO_VISTA_SM30 = 'VIEWNAME';
const TCODE_VISTA = 'SM30';
const TCODE_QUERY = 'START_REPORT';

/** `porTstcp`: el destino está en TSTCP-PARAM (transacción de parámetros u OO). */
type TipoPorCinfo = 'porTstcp' | 'dialogo' | 'report';

/** Solo los valores de TSTC-CINFO vistos en un sistema real; cualquier otro usa las reglas genéricas. */
const TIPO_POR_CINFO: Readonly<Record<string, TipoPorCinfo>> = {
  '02': 'porTstcp', // parámetros: tstc-param-ej.xml (SA38PARAMETER), dp-tstc-z.xml
  '04': 'dialogo', // diálogo: tstc-dialogo.xml (SE93: SAPLSEUK 0390)
  '08': 'porTstcp', // OO: tstc-oo.xml (/FMP/MP_COMPARE…)
  '0C': 'porTstcp', // OO: tstc-oo.xml (/BOBF/CUST_UI)
  '80': 'report', // report: tstc-variante.xml (SE16N), dp-tstc-z.xml
  '84': 'report', // report: dp-tstc-se38.xml (SE38)
};

function camposDe(texto: string): Map<string, string> {
  const campos = new Map<string, string>();
  for (const par of texto.split(';')) {
    const igual = par.indexOf('=');
    if (igual > 0) {
      campos.set(par.slice(0, igual).trim().toUpperCase(), par.slice(igual + 1).trim());
    }
  }
  return campos;
}

function interpretarParametro(param: string): DestinoTransaccion {
  const metodo = PARAMETRO_METODO.exec(param);
  if (metodo) {
    return { clase: 'metodo', claseAbap: metodo[1], metodo: metodo[2] };
  }
  const transaccion = PARAMETRO_TRANSACCION.exec(param);
  if (!transaccion) {
    return { clase: 'desconocido' };
  }
  const [, tcode, resto] = transaccion;
  const campos = camposDe(resto);
  const programa = campos.get(CAMPO_PROGRAMA_SA38);
  if (programa) {
    return { clase: 'programa', programa };
  }
  const vista = campos.get(CAMPO_VISTA_SM30);
  if (tcode === TCODE_VISTA && vista) {
    return { clase: 'vista', vista };
  }
  if (tcode === TCODE_QUERY) {
    return { clase: 'desconocido', detalle: 'query' };
  }
  return { clase: 'transaccion', tcode };
}

function programaDe(tstc: FilaTstc | undefined, conDynpro: boolean): DestinoTransaccion | undefined {
  const programa = tstc?.pgmna.trim() ?? '';
  if (programa === '') {
    return undefined;
  }
  const dynpro = tstc?.dypno.trim() ?? '';
  return conDynpro && !DYNPROS_SIN_PANTALLA.includes(dynpro) ? { clase: 'programa', programa, dynpro } : { clase: 'programa', programa };
}

export function interpretarTransaccion(tstc: FilaTstc | undefined, tstcp: FilaTstcp | undefined): DestinoTransaccion {
  const param = tstcp?.param.trim() ?? '';
  switch (TIPO_POR_CINFO[tstc?.cinfo.trim().toUpperCase() ?? '']) {
    case 'porTstcp':
      return interpretarParametro(param);
    case 'dialogo':
      return programaDe(tstc, true) ?? { clase: 'desconocido' };
    case 'report':
      return programaDe(tstc, false) ?? { clase: 'desconocido' };
    default: {
      const destino = interpretarParametro(param);
      return destino.clase !== 'desconocido' ? destino : (programaDe(tstc, true) ?? destino);
    }
  }
}

async function consultar(conexion: ConexionAdt, sql: string): Promise<Record<string, string> | undefined> {
  const parametros = { rowNumber: String(FILAS_MAXIMAS) };
  const respuesta = await conexion.post(RUTA_DATA_PREVIEW, sql, 'text/plain', ACCEPT_DATA_PREVIEW, undefined, parametros);
  return analizarDataPreview(respuesta.cuerpo)[0];
}

async function leerFilas(
  conexion: ConexionAdt,
  tcode: string,
): Promise<{ tstc: FilaTstc | undefined; tstcp: FilaTstcp | undefined }> {
  const [c, p] = await Promise.all([consultar(conexion, consultaTstc(tcode)), consultar(conexion, consultaTstcp(tcode))]);
  return {
    tstc: c && { tcode: c.TCODE ?? '', pgmna: c.PGMNA ?? '', dypno: c.DYPNO ?? '', cinfo: c.CINFO ?? '' },
    tstcp: p && { tcode: p.TCODE ?? '', param: p.PARAM ?? '' },
  };
}

export async function resolverTransaccion(
  conexion: ConexionAdt,
  tcode: string,
  saltos = SALTOS_POR_DEFECTO,
): Promise<DestinoTransaccion> {
  let actual = tcode;
  for (let salto = 0; salto <= saltos; salto++) {
    if (!tcodeValido(actual)) {
      return { clase: 'desconocido' };
    }
    const { tstc, tstcp } = await leerFilas(conexion, actual);
    const destino = interpretarTransaccion(tstc, tstcp);
    if (destino.clase !== 'transaccion') {
      return destino;
    }
    actual = destino.tcode;
  }
  return { clase: 'desconocido' };
}
