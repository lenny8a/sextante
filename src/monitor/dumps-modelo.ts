import { descodificarEntidades, descodificarSegmento, leerAtributos, ResultadoBusqueda } from '../adt/busqueda-modelo';

export interface PosicionDump {
  /** Uri ADT sin el prefijo `adt://<sid>`, p. ej. `/sap/bc/adt/programs/programs/ztest/source/main`. */
  uriAdt: string;
  linea: number;
}

export interface MarcoPila {
  evento: string;
  programa: string;
  include: string;
  linea: number;
}

export interface Dump {
  id: string;
  publicado: string;
  usuario: string;
  errorEjecucion: string;
  programa: string;
  textoCorto: string;
  posicion?: PosicionDump;
  marco?: MarcoPila;
  /** `atom:summary` descodificado una vez: HTML crudo. */
  resumenHtml: string;
}

export interface OpcionesConsultaDumps {
  usuario?: string;
  desde: Date;
  top: number;
}

export const RUTA_DUMPS = '/sap/bc/adt/runtime/dumps';
export const ACCEPT_DUMPS = 'application/atom+xml;type=feed';
export const TOP_DUMPS = 50;
// NO VERIFICADO: `$top` mayor que 50 (solo se observó el valor por defecto de la oficial).
export const TOP_MAXIMO = 1000;

const USUARIO_VALIDO = /^[A-Z0-9_]{1,12}$/;

export function usuarioValido(usuario: string | undefined): usuario is string {
  return usuario !== undefined && USUARIO_VALIDO.test(usuario);
}

function dos(n: number): string {
  return String(n).padStart(2, '0');
}

export function marcaUtc(fecha: Date): string {
  return (
    String(fecha.getUTCFullYear()).padStart(4, '0') +
    dos(fecha.getUTCMonth() + 1) +
    dos(fecha.getUTCDate()) +
    dos(fecha.getUTCHours()) +
    dos(fecha.getUTCMinutes()) +
    dos(fecha.getUTCSeconds())
  );
}

export function medianocheLocal(ahora: Date): Date {
  return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
}

// NO VERIFICADO: `from` a medianoche local convertido a UTC; solo se observó con marcas del feed de la oficial.
export function rutaDumps(opciones: OpcionesConsultaDumps): string {
  const partes: string[] = [];
  if (usuarioValido(opciones.usuario)) {
    // NO VERIFICADO: sintaxis del `$query` por usuario.
    partes.push(`$query=and%20(%20equals%20(%20user%20,%20${opciones.usuario}%20)%20)`);
  }
  partes.push(`from=${marcaUtc(opciones.desde)}`, `$top=${opciones.top}`);
  return `${RUTA_DUMPS}?${partes.join('&')}`;
}

const ENTRADA = /<atom:entry>([\s\S]*?)<\/atom:entry>/g;
const CATEGORIA = /<atom:category\b([^>]*?)\/?>/g;

function etiqueta(entrada: string, nombre: string): string {
  const m = new RegExp(`<atom:${nombre}\\b[^>]*>([\\s\\S]*?)</atom:${nombre}>`).exec(entrada);
  return m ? descodificarEntidades(m[1]) : '';
}

function categoria(entrada: string, etiquetaCategoria: string): string {
  for (const m of entrada.matchAll(CATEGORIA)) {
    const atributos = leerAtributos(m[1]);
    if (atributos.get('label') === etiquetaCategoria) {
      return atributos.get('term') ?? '';
    }
  }
  return '';
}

export function analizarFeedDumps(xml: string): Dump[] {
  const dumps: Dump[] = [];
  for (const m of xml.matchAll(ENTRADA)) {
    const entrada = m[1];
    const autor = /<atom:author>\s*<atom:name>([\s\S]*?)<\/atom:name>/.exec(entrada);
    const resumenHtml = etiqueta(entrada, 'summary');
    dumps.push({
      id: etiqueta(entrada, 'id'),
      publicado: etiqueta(entrada, 'published'),
      usuario: autor ? descodificarEntidades(autor[1]) : '',
      errorEjecucion: categoria(entrada, 'ABAP runtime error'),
      programa: categoria(entrada, 'Terminated ABAP program'),
      textoCorto: etiqueta(entrada, 'title'),
      posicion: posicionDe(resumenHtml),
      marco: marcoDe(resumenHtml),
      resumenHtml,
    });
  }
  return dumps;
}

export function posicionDe(resumenHtml: string): PosicionDump | undefined {
  const m = /href="adt:\/\/[^/"]+(\/sap\/bc\/adt\/[^"#]+)#start=(\d+)"/.exec(resumenHtml);
  return m ? { uriAdt: m[1], linea: Number(m[2]) } : undefined;
}

function quitarEtiquetas(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function aTextoPlano(html: string): string {
  return descodificarEntidades(quitarEtiquetas(html).replace(/&nbsp;/g, ' '))
    .replace(/ /g, ' ')
    .trim();
}

function celdasDe(fila: string): string[] {
  return [...fila.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1]);
}

export interface MarcoPilaFeed extends MarcoPila {
  nr: string;
  /** Uri ADT sin el prefijo `adt://<sid>`; ausente si la fila del feed no trae enlace. */
  uriAdt?: string;
}

export function marcosDe(resumenHtml: string): MarcoPilaFeed[] {
  const inicio = resumenHtml.indexOf('id="STACK"');
  if (inicio < 0) {
    return [];
  }
  const tabla = /<table\b[^>]*>([\s\S]*?)<\/table>/.exec(resumenHtml.slice(inicio));
  if (!tabla) {
    return [];
  }
  const marcos: MarcoPilaFeed[] = [];
  for (const fila of tabla[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    if (/<th\b/.test(fila[1])) {
      continue;
    }
    const celdas = celdasDe(fila[1]).map(aTextoPlano);
    if (celdas.length >= 5) {
      const enlace = /href="adt:\/\/[^/"]+(\/sap\/bc\/adt\/[^"#]+)#start=\d+"/.exec(fila[1]);
      marcos.push({
        nr: celdas[0],
        evento: celdas[1],
        programa: celdas[2],
        include: celdas[3],
        linea: Number(celdas[4]),
        ...(enlace ? { uriAdt: enlace[1] } : {}),
      });
    }
  }
  return marcos;
}

export function marcoDe(resumenHtml: string): MarcoPila | undefined {
  const [primero] = marcosDe(resumenHtml);
  return primero
    ? { evento: primero.evento, programa: primero.programa, include: primero.include, linea: primero.linea }
    : undefined;
}

export function esDeHoy(dump: Dump, ahora: Date): boolean {
  const fecha = new Date(dump.publicado);
  return (
    fecha.getFullYear() === ahora.getFullYear() &&
    fecha.getMonth() === ahora.getMonth() &&
    fecha.getDate() === ahora.getDate()
  );
}

export function horaLocal(iso: string): string {
  const f = new Date(iso);
  return `${dos(f.getHours())}:${dos(f.getMinutes())}`;
}

export function horaArchivo(iso: string): string {
  const f = new Date(iso);
  return `${dos(f.getHours())}-${dos(f.getMinutes())}-${dos(f.getSeconds())}`;
}

export function fechaHoraLocal(iso: string): string {
  const f = new Date(iso);
  return `${dos(f.getDate())}/${dos(f.getMonth() + 1)}/${f.getFullYear()} ${horaLocal(iso)}:${dos(f.getSeconds())}`;
}

function textoDeExtracto(tabla: string): string {
  const primera = /class="linenumber[^>]*>\s*(\d+)\s*</.exec(tabla);
  let numero = primera ? Number(primera[1]) : 1;
  const lineas: string[] = [];
  for (const div of tabla.matchAll(/<div class="sourceline([^"]*)">([\s\S]*?)<\/div>/g)) {
    const marca = div[1].includes('highlight') ? '>' : ' ';
    lineas.push(`${String(numero).padStart(4)} ${marca} ${quitarEtiquetas(div[2])}`);
    numero++;
  }
  return lineas.join('\n') + '\n';
}

function textoDeTabla(tabla: string): string {
  const filas: string[] = [];
  for (const fila of tabla.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const crudas = celdasDe(fila[1]);
    const celdas = crudas.map((c) => quitarEtiquetas(c).trim());
    if (!/<th\b/.test(fila[1]) && celdas.length === 2 && /<b>/.test(crudas[0])) {
      filas.push(`${celdas[0]}: ${celdas[1]}`);
    } else {
      filas.push(celdas.join(' | '));
    }
  }
  return filas.join('\n') + '\n';
}

export function textoDeResumen(resumenHtml: string): string {
  const html = resumenHtml
    .replace(/<style\b[\s\S]*?<\/style>/g, '')
    .replace(/<p\b[^>]*>[\s\S]*?<\/p>/g, (p) => (p.includes('Show in SAP GUI') ? '' : p))
    .replace(/<h4 id="OVERVIEW">[\s\S]*?(?=<h4)/, '')
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/g, (_, t: string) => `\n\n${quitarEtiquetas(t).trim().toUpperCase()}\n`)
    .replace(/<table\b[^>]*>[\s\S]*?<\/table>/g, (tabla) =>
      /<table\b[^>]*id="sourcetable"/.test(tabla) ? textoDeExtracto(tabla) : textoDeTabla(tabla),
    )
    .replace(/<br\s*\/?>/g, '\n');
  return descodificarEntidades(quitarEtiquetas(html).replace(/&nbsp;/g, ' '))
    .replace(/ /g, ' ')
    .split('\n')
    .map((linea) => linea.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// NO VERIFICADO: solo se observó la uri de programas en un dump real; includes, clases y módulos de función siguen el patrón ADT habitual.
const TIPOS_POSICION: readonly { patron: RegExp; tipo: string }[] = [
  { patron: /^(\/sap\/bc\/adt\/programs\/programs\/([^/]+))/, tipo: 'PROG/P' },
  { patron: /^(\/sap\/bc\/adt\/programs\/includes\/([^/]+))/, tipo: 'PROG/I' },
  { patron: /^(\/sap\/bc\/adt\/oo\/classes\/([^/]+))/, tipo: 'CLAS/OC' },
  { patron: /^(\/sap\/bc\/adt\/functions\/groups\/[^/]+\/fmodules\/([^/]+))/, tipo: 'FUGR/FF' },
];

export function resultadoDePosicion(posicion: PosicionDump, programa: string): ResultadoBusqueda | undefined {
  for (const { patron, tipo } of TIPOS_POSICION) {
    const m = patron.exec(posicion.uriAdt);
    if (m) {
      const nombre = descodificarSegmento(m[2]).toUpperCase() || programa;
      return { nombre, tipo, descripcion: '', paquete: '', uriAdt: m[1] };
    }
  }
  return undefined;
}
