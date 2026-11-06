import { analizarNombreAff, analizarUriAbap, tipoObjetoDe, type TipoObjeto } from '../bridge/adt-uri';
import { PATRON_SISTEMA } from './esquemas';
import { rutaDeUriTexto } from './herramientas';

export const MAX_TEXTO_AGENTE = 30_000;

export const CODIGO_POR_TIPO: Record<TipoObjeto, string> = {
  clase: 'CLAS',
  interfaz: 'INTF',
  programa: 'PROG',
  include: 'INCL',
  cds: 'DDLS',
  tabla: 'TABL',
  estructura: 'TABL',
  grupoFunciones: 'FUGR',
  desconocido: 'OBJ',
};

export interface IdentidadDiario {
  destino: string;
  codigo: string;
  nombre: string;
}

const REGEX_DESTINO = new RegExp(PATRON_SISTEMA);

export function esDestinoValido(destino: string): boolean {
  return REGEX_DESTINO.test(destino);
}

export function identidadDe(destino: string, tipo: TipoObjeto, nombre: string): IdentidadDiario {
  if (!esDestinoValido(destino)) {
    throw new Error('destino no válido');
  }
  return { destino, codigo: CODIGO_POR_TIPO[tipo], nombre: nombre.toUpperCase() };
}

/** undefined si la uri no es abap: o no llega a la carpeta de un objeto. */
export function identidadDeUri(uri: string): IdentidadDiario | undefined {
  if (!uri.startsWith('abap:')) {
    return undefined;
  }
  const analizada = analizarUriAbap({ scheme: 'abap', path: rutaDeUriTexto(uri) });
  const objeto = analizada?.objeto;
  if (analizada === undefined || objeto === undefined) {
    return undefined;
  }
  const tipoAff = analizada.archivo === undefined ? undefined : analizarNombreAff(analizada.archivo)?.tipo;
  if (!esDestinoValido(analizada.destino)) {
    return undefined;
  }
  return identidadDe(analizada.destino, tipoObjetoDe(objeto.tipoCarpeta, tipoAff), objeto.nombre);
}

/** Lo que la regla de identidad necesita saber de la vista Objeto. */
export interface VistaObjetoDiario {
  /** La uri es del objeto mostrado o de uno de los includes de su árbol. */
  pertenece(uri: string): boolean;
  /** Uri `abap:` del programa mostrado; undefined si la vista no muestra un programa. */
  programaMostrado(): string | undefined;
}

/**
 * Un include de programa que la vista Objeto muestra como parte del programa abierto va al diario del programa;
 * un include suelto conserva su diario `INCL`. El resto de uris no depende de la vista.
 */
export function identidadSegunVista(uri: string, vista: VistaObjetoDiario): IdentidadDiario | undefined {
  const propia = identidadDeUri(uri);
  if (propia?.codigo !== CODIGO_POR_TIPO.include) {
    return propia;
  }
  const programa = vista.programaMostrado();
  if (programa === undefined || !vista.pertenece(uri)) {
    return propia;
  }
  return identidadDeUri(programa) ?? propia;
}

export function rutaRelativaDiario(id: IdentidadDiario): string {
  return `${id.destino}/${id.codigo}-${encodeURIComponent(id.nombre)}.md`;
}

export function cabeceraDiario(id: IdentidadDiario): string {
  return (
    `# Diario de ${id.nombre} (${id.codigo}) en ${id.destino}\n\n` +
    'Lo escriben Sextante (propuestas aplicadas y rechazadas), el agente de IA (notas) y tú. ' +
    'Puedes editarlo libremente; cada entrada empieza por "## fecha · tipo".\n'
  );
}

const PRINCIPAL = 'principal';
const EXTENSIONES_PRINCIPALES = new Set(['ddic', 'acds']);

export function etiquetaArchivo(nombreObjeto: string, archivo: string | undefined): string {
  if (archivo === undefined) {
    return PRINCIPAL;
  }
  const aff = analizarNombreAff(archivo);
  if (aff === undefined) {
    return archivo;
  }
  if (aff.nombre.toUpperCase() !== nombreObjeto.toUpperCase()) {
    return aff.nombre.toUpperCase();
  }
  const partes = aff.extension.split('.');
  if (partes[partes.length - 1] === 'abap') {
    partes.pop();
  }
  const [primera] = partes;
  return primera === undefined || EXTENSIONES_PRINCIPALES.has(primera) ? PRINCIPAL : primera;
}

export type NuevaEntrada =
  | { tipo: 'aplicado'; resumen: string; archivo: string; porque?: string; sinGuardar?: boolean }
  | { tipo: 'rechazado'; resumen: string; archivo: string; porque?: string; motivo?: string }
  | { tipo: 'nota'; texto: string }
  | { tipo: 'creado'; descripcion: string; paquete: string };

function dos(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatearFecha(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

export function sanearTexto(texto: string): string {
  return texto
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((linea) => (linea.startsWith('## ') ? `#${linea}` : linea))
    .join('\n')
    .trimEnd();
}

function unaLinea(texto: string): string {
  return sanearTexto(texto).replace(/\s*\n\s*/g, ' ');
}

export function formatearEntrada(entrada: NuevaEntrada, fecha: string): string {
  if (entrada.tipo === 'nota') {
    return `## ${fecha} · nota\n${sanearTexto(entrada.texto)}\n`;
  }
  if (entrada.tipo === 'creado') {
    return `## ${fecha} · creado · ${unaLinea(entrada.descripcion)}\nPaquete: ${entrada.paquete}\n`;
  }
  let bloque = `## ${fecha} · ${entrada.tipo} · ${unaLinea(entrada.resumen)}\nArchivo: ${entrada.archivo}\n`;
  if (entrada.porque !== undefined) {
    bloque += `Por qué: ${sanearTexto(entrada.porque)}\n`;
  }
  if (entrada.tipo === 'aplicado') {
    if (entrada.sinGuardar === true) {
      bloque += 'Aviso: quedó aplicado en el editor pero la oficial no guardó en SAP\n';
    }
  } else if (entrada.motivo !== undefined) {
    bloque += `Motivo del usuario: ${sanearTexto(entrada.motivo)}\n`;
  }
  return bloque;
}

export function anadirEntrada(contenido: string | undefined, id: IdentidadDiario, bloque: string): string {
  if (contenido === undefined) {
    return `${cabeceraDiario(id)}\n${bloque}`;
  }
  const previo = contenido.trimEnd();
  return previo === '' ? bloque : `${previo}\n\n${bloque}`;
}

export type TipoEntrada = 'aplicado' | 'rechazado' | 'nota' | 'creado' | 'otro';

export interface EntradaDiario {
  fecha?: string;
  tipo: TipoEntrada;
  resumen?: string;
  /** Bloque completo, incluida la línea `##`. */
  texto: string;
}

const LINEA_ENTRADA = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · (aplicado|rechazado|nota|creado)(?: · (.*))?$/;

function entradaDeBloque(lineas: string[]): EntradaDiario {
  const texto = lineas.join('\n').trimEnd();
  const casa = LINEA_ENTRADA.exec(lineas[0]);
  if (casa === null) {
    return { tipo: 'otro', texto };
  }
  const entrada: EntradaDiario = { fecha: casa[1], tipo: casa[2] as TipoEntrada, texto };
  if (casa[3] !== undefined) {
    entrada.resumen = casa[3];
  }
  return entrada;
}

export function partirEntradas(contenido: string): { cabecera: string; entradas: EntradaDiario[] } {
  const cabecera: string[] = [];
  const bloques: string[][] = [];
  for (const linea of contenido.replace(/\r\n/g, '\n').split('\n')) {
    if (linea.startsWith('## ')) {
      bloques.push([linea]);
    } else if (bloques.length > 0) {
      bloques[bloques.length - 1].push(linea);
    } else {
      cabecera.push(linea);
    }
  }
  return { cabecera: cabecera.join('\n'), entradas: bloques.map(entradaDeBloque) };
}

export interface ResumenDiario {
  entradas: number;
  ultima?: string;
}

export function resumenDe(contenido: string | undefined): ResumenDiario {
  if (contenido === undefined) {
    return { entradas: 0 };
  }
  const { entradas } = partirEntradas(contenido);
  const resumen: ResumenDiario = { entradas: entradas.length };
  const conFecha = entradas.filter((entrada) => entrada.fecha !== undefined);
  const ultima = conFecha[conFecha.length - 1]?.fecha;
  if (ultima !== undefined) {
    resumen.ultima = ultima;
  }
  return resumen;
}

const MARGEN_AVISO = 200;

export function recortarParaAgente(
  contenido: string,
  ruta: string,
  max: number = MAX_TEXTO_AGENTE,
): { texto: string; recortado: boolean } {
  if (contenido.length <= max) {
    return { texto: contenido, recortado: false };
  }
  const { cabecera, entradas } = partirEntradas(contenido);
  const completa = cabecera.trimEnd();
  const inicio = completa.length > max ? `${completa.slice(0, max)}\n(cabecera recortada)` : completa;
  if (entradas.length === 0) {
    return { texto: `${inicio}\n`, recortado: true };
  }
  let presupuesto = max - inicio.length - MARGEN_AVISO - ruta.length;
  const elegidas: string[] = [];
  for (let i = entradas.length - 1; i >= 0; i--) {
    const texto = entradas[i].texto;
    if (elegidas.length > 0 && texto.length + 2 > presupuesto) {
      break;
    }
    elegidas.unshift(texto);
    presupuesto -= texto.length + 2;
  }
  const omitidas = entradas.length - elegidas.length;
  const aviso =
    omitidas > 0 ? `(se omiten ${omitidas} entradas anteriores; el archivo completo está en ${ruta})\n\n` : '';
  return { texto: `${inicio}\n\n${aviso}${elegidas.join('\n\n')}\n`, recortado: true };
}
