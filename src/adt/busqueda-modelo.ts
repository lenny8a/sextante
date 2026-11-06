export interface ResultadoBusqueda {
  nombre: string;
  tipo: string;
  descripcion: string;
  paquete: string;
  uriAdt: string;
}

export interface FiltroTipo {
  id: string;
  etiqueta: string;
  tipoAdt: string;
  prefijos: readonly string[];
  icono: string;
}

export interface Consulta {
  patron: string;
  filtro?: FiltroTipo;
}

/** Los diez tipoAdt existen en el catálogo `objecttypes` del servidor (tipos.xml). */
export const FILTROS_TIPO: readonly FiltroTipo[] = [
  { id: 'clase', etiqueta: 'Clase', tipoAdt: 'CLAS/OC', prefijos: ['clas', 'class'], icono: '$(symbol-class)' },
  { id: 'interfaz', etiqueta: 'Interfaz', tipoAdt: 'INTF/OI', prefijos: ['intf'], icono: '$(symbol-interface)' },
  { id: 'programa', etiqueta: 'Programa', tipoAdt: 'PROG/P', prefijos: ['prog', 'rep'], icono: '$(symbol-file)' },
  { id: 'include', etiqueta: 'Include', tipoAdt: 'PROG/I', prefijos: ['incl'], icono: '$(file-code)' },
  { id: 'funcion', etiqueta: 'Módulo de función', tipoAdt: 'FUGR/FF', prefijos: ['func', 'fm'], icono: '$(symbol-method)' },
  { id: 'grupo-funciones', etiqueta: 'Grupo de funciones', tipoAdt: 'FUGR/F', prefijos: ['fugr'], icono: '$(symbol-namespace)' },
  { id: 'tabla', etiqueta: 'Tabla', tipoAdt: 'TABL/DT', prefijos: ['tabl', 'tab'], icono: '$(symbol-structure)' },
  { id: 'cds', etiqueta: 'CDS', tipoAdt: 'DDLS/DF', prefijos: ['cds', 'ddls'], icono: '$(symbol-field)' },
  { id: 'transaccion', etiqueta: 'Transacción', tipoAdt: 'TRAN/T', prefijos: ['tran', 'tcode'], icono: '$(play)' },
  { id: 'paquete', etiqueta: 'Paquete', tipoAdt: 'DEVC/K', prefijos: ['devc', 'paq'], icono: '$(package)' },
];

const TIPO_TRANSACCION = 'TRAN/T';
const TIPO_PAQUETE = 'DEVC/K';
const TIPO_FUNCION = 'FUGR/FF';

const ENTIDADES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function descodificarEntidades(texto: string): string {
  return texto.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (entidad, dec, hex, nombre) => {
    if (nombre) {
      return ENTIDADES[nombre as string];
    }
    try {
      return String.fromCodePoint(dec ? Number(dec) : parseInt(hex as string, 16));
    } catch {
      return entidad;
    }
  });
}

/** Un segmento de uri con `%` mal formado se devuelve tal cual: una uri rara no debe tumbar la lista. */
export function descodificarSegmento(segmento: string): string {
  try {
    return decodeURIComponent(segmento);
  } catch {
    return segmento;
  }
}

const ELEMENTO_REFERENCIA =
  /<adtcore:objectReference((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g;
const ATRIBUTO = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function leerAtributos(cadena: string): Map<string, string> {
  const atributos = new Map<string, string>();
  for (const m of cadena.matchAll(ATRIBUTO)) {
    atributos.set(m[1], descodificarEntidades(m[2] ?? m[3] ?? ''));
  }
  return atributos;
}

export function analizarRespuestaBusqueda(xml: string): ResultadoBusqueda[] {
  const sinComentarios = xml.replace(/<!--[\s\S]*?-->/g, '');
  return Array.from(sinComentarios.matchAll(ELEMENTO_REFERENCIA), (m) => {
    const a = leerAtributos(m[1]);
    return {
      nombre: a.get('adtcore:name') ?? '',
      tipo: a.get('adtcore:type') ?? '',
      descripcion: a.get('adtcore:description') ?? '',
      paquete: a.get('adtcore:packageName') ?? '',
      uriAdt: a.get('adtcore:uri') ?? '',
    };
  });
}

function normalizarPatron(texto: string): string {
  const patron = texto.trim().toUpperCase();
  return patron === '' || patron.endsWith('*') ? patron : `${patron}*`;
}

export function interpretarConsulta(texto: string, filtroActivo?: FiltroTipo): Consulta {
  const limpio = texto.trim();
  const m = /^([A-Za-z]+)(?:\s+|\s*:\s*)(\S.*)$/.exec(limpio);
  if (m) {
    const prefijo = m[1].toLowerCase();
    const filtro = FILTROS_TIPO.find((f) => f.prefijos.includes(prefijo));
    if (filtro) {
      return { patron: normalizarPatron(m[2]), filtro };
    }
  }
  return { patron: normalizarPatron(limpio), filtro: filtroActivo };
}

/**
 * Plantilla del discovery: `{?operation,query,useSearchProvider,noDescription,maxResults}{&objectType*}…`.
 * Con `objectType` la respuesta solo trae uri, tipo y nombre, sin paquete ni descripción (busq-clas.xml).
 */
export function parametrosBusqueda(consulta: Consulta, maxResults: number): Record<string, string> {
  const parametros: Record<string, string> = {
    operation: 'quickSearch',
    query: consulta.patron,
    maxResults: String(maxResults),
  };
  if (consulta.filtro) {
    parametros.objectType = consulta.filtro.tipoAdt;
  }
  return parametros;
}

export function etiquetaDe(r: ResultadoBusqueda): string {
  return r.nombre;
}

/** El grupo sale de la uri /sap/bc/adt/functions/groups/<GRUPO>/fmodules/<FM> (busq-fugr.xml). */
function grupoDeFuncion(uriAdt: string): string {
  const m = /\/functions\/groups\/([^/]+)\//i.exec(uriAdt);
  return m ? descodificarSegmento(m[1]).toUpperCase() : '';
}

export function descripcionDe(r: ResultadoBusqueda): string {
  const etiquetaTipo = FILTROS_TIPO.find((f) => f.tipoAdt === r.tipo)?.etiqueta ?? r.tipo;
  const ubicacion = r.tipo === TIPO_FUNCION ? grupoDeFuncion(r.uriAdt) || r.paquete : r.paquete;
  return [etiquetaTipo, ubicacion, r.descripcion].filter((p) => p !== '').join(' · ');
}

export function esTransaccion(r: ResultadoBusqueda): boolean {
  return r.tipo === TIPO_TRANSACCION;
}

export function esPaquete(r: ResultadoBusqueda): boolean {
  return r.tipo === TIPO_PAQUETE;
}
