import {
  analizarNombreAff,
  archivoPrincipal,
  clasificarArchivoFugr,
  type ArchivoGrupoFunciones,
  type TipoObjeto,
} from '../bridge/adt-uri';
import { iconoDeKind, iconoDeTipo } from './iconos';

export type Rango = [number, number, number, number];

export interface SimboloDocumento {
  nombre: string;
  kind: number;
  nombreKind: string;
  rango: Rango;
  rangoSeleccion?: Rango;
  detalle?: string;
  hijos: SimboloDocumento[];
}

export type ClaseNodo = 'raiz' | 'seccion' | 'simbolo' | 'archivo' | 'include' | 'aviso' | 'diario';

export interface NodoObjeto {
  id: string;
  clase: ClaseNodo;
  etiqueta: string;
  descripcion?: string;
  icono: string;
  archivo?: string;
  /** Path absoluto del archivo cuando el símbolo está en un include abierto fuera de la carpeta del objeto. */
  ruta?: string;
  rango?: Rango;
  /** Solo en nodos `simbolo`: el kind del símbolo (`Method`, `Function`…). */
  nombreKind?: string;
  /** Solo en nodos `include`: nombre del include tal como aparece en la sentencia INCLUDE. */
  nombreInclude?: string;
  hijos: NodoObjeto[];
}

export interface ResumenDiario {
  entradas: number;
  ultima?: string;
}

export const COMANDO_ABRIR_DIARIO = 'abapNavigator.objeto.diario';

export interface EntradaObjeto {
  tipo: TipoObjeto;
  nombre: string;
  archivoAbierto: string;
  archivos: string[];
  simbolos: SimboloDocumento[];
  /** Includes del programa abiertos en el editor: su estructura cuelga del nodo include. */
  includesAbiertos?: IncludeAbierto[];
  /** Resumen del diario del objeto: si tiene entradas, cuelga el nodo Diario al final de la raíz. */
  diario?: ResumenDiario;
}

export interface IncludeAbierto {
  nombre: string;
  ruta: string;
  simbolos: SimboloDocumento[];
}

export const ETIQUETA_TIPO: Record<TipoObjeto, string> = {
  clase: 'Clase',
  interfaz: 'Interfaz',
  programa: 'Programa',
  include: 'Include',
  cds: 'Vista CDS',
  tabla: 'Tabla',
  estructura: 'Estructura',
  grupoFunciones: 'Grupo de funciones',
  desconocido: 'Objeto',
};

export const AVISO_SIN_SIMBOLOS = 'Sin estructura todavía: refresca cuando la oficial termine de analizar';
const AVISO_CAMPOS = 'Campos: pendiente (fase 4)';
const TIPOS_SIN_AVISO_SIMBOLOS: readonly TipoObjeto[] = ['cds', 'tabla', 'estructura', 'grupoFunciones'];

const PATRON_EVENTO =
  /^(INITIALIZATION|LOAD-OF-PROGRAM|START-OF-SELECTION|END-OF-SELECTION|AT SELECTION-SCREEN(\s.*)?|AT USER-COMMAND|AT LINE-SELECTION|AT PF\d+|TOP-OF-PAGE(\s.*)?|END-OF-PAGE|GET\s\S+.*)$/i;

export function esEvento(nombre: string): boolean {
  return PATRON_EVENTO.test(nombre);
}

/** `TABLES:` o `include.` → `TABLES` / `INCLUDE`: la palabra clave de una sentencia sin la puntuación. */
export function palabraClave(palabra: string): string {
  return palabra.trim().replace(/[:.,]+$/, '').toUpperCase();
}

interface GrupoSimbolos {
  etiqueta: string;
  acepta: (simbolo: SimboloDocumento) => boolean;
  /** Cómo se dibuja cada símbolo del grupo; por defecto, como símbolo navegable con sus hijos. */
  nodo?: (simbolo: SimboloDocumento, archivoAbierto: string) => NodoObjeto;
}

function esKind(...kinds: string[]): (simbolo: SimboloDocumento) => boolean {
  return (simbolo) => kinds.includes(simbolo.nombreKind);
}

const GRUPOS_DEFINICION: GrupoSimbolos[] = [
  { etiqueta: 'Tipos', acepta: esKind('Property') },
  { etiqueta: 'Constantes', acepta: esKind('Constant') },
  { etiqueta: 'Atributos', acepta: esKind('Field', 'Variable') },
  { etiqueta: 'Eventos', acepta: esKind('Event') },
  { etiqueta: 'Métodos', acepta: esKind('Method') },
  { etiqueta: 'Otros', acepta: () => true },
];

/**
 * Los `Object` de primer nivel de un programa son eventos, sentencias INCLUDE (S/4) o TABLES; el
 * proveedor rellena `detalle` con la primera palabra de su línea. Un `Object` que no es evento ni
 * INCLUDE va a Tablas, tenga detalle `TABLES`, ninguno u otro (como antes de distinguir los includes).
 */
const GRUPOS_PROGRAMA: GrupoSimbolos[] = [
  { etiqueta: 'Includes', acepta: (s) => esObjetoPrograma(s) && s.detalle === 'INCLUDE', nodo: nodoInclude },
  { etiqueta: 'Tablas', acepta: (s) => esObjetoPrograma(s) && s.detalle !== 'INCLUDE' },
  { etiqueta: 'Datos', acepta: esKind('Variable') },
  { etiqueta: 'Eventos', acepta: (s) => s.nombreKind === 'Object' && esEvento(s.nombre) },
  { etiqueta: 'Forms', acepta: esKind('Function') },
  { etiqueta: 'Clases locales', acepta: esKind('Class', 'Interface') },
  { etiqueta: 'Otros', acepta: () => true },
];

/**
 * `localtypes.abap` visto en ECC; `definitions.abap`, `implementations.abap` y `macros.abap` vistos en S/4.
 * `locals_imp.abap` y `testclasses.abap`: NO VERIFICADO.
 */
const ETIQUETA_INCLUDE_LOCAL: Record<string, string> = {
  'localtypes.abap': 'Definiciones locales',
  'definitions.abap': 'Definiciones locales',
  'implementations.abap': 'Implementaciones locales',
  'locals_imp.abap': 'Implementaciones locales',
  'testclasses.abap': 'Test classes',
  'macros.abap': 'Macros',
};

function nodoSeccion(etiqueta: string, hijos: NodoObjeto[]): NodoObjeto {
  return { id: `sec:${etiqueta}`, clase: 'seccion', etiqueta, icono: 'folder', hijos };
}

function nodoAviso(etiqueta: string): NodoObjeto {
  return { id: `aviso:${etiqueta}`, clase: 'aviso', etiqueta, icono: 'info', hijos: [] };
}

export function nodoDiario(resumen: ResumenDiario): NodoObjeto {
  const cuenta = `${resumen.entradas} ${resumen.entradas === 1 ? 'entrada' : 'entradas'}`;
  const descripcion = resumen.ultima === undefined ? cuenta : `${cuenta} · última ${resumen.ultima}`;
  return { id: 'diario', clase: 'diario', etiqueta: 'Diario', descripcion, icono: 'note', hijos: [] };
}

function nodoArchivo(archivo: string, etiqueta: string, icono = 'file-code'): NodoObjeto {
  return { id: `archivo:${archivo}`, clase: 'archivo', etiqueta, icono, archivo, hijos: [] };
}

function esObjetoPrograma(simbolo: SimboloDocumento): boolean {
  return simbolo.nombreKind === 'Object' && !esEvento(simbolo.nombre);
}

/** Sentencia INCLUDE: no tiene archivo propio en el objeto; `objeto.ir` busca el include por su nombre. */
function nodoInclude(simbolo: SimboloDocumento, archivoAbierto: string): NodoObjeto {
  const rango = simbolo.rangoSeleccion ?? simbolo.rango;
  return {
    id: `include:${archivoAbierto}#${rango.join(',')}#${simbolo.nombre}`,
    clase: 'include',
    etiqueta: simbolo.nombre,
    icono: 'file-submodule',
    rango,
    nombreInclude: simbolo.nombre,
    hijos: [],
  };
}

function nodoSimbolo(simbolo: SimboloDocumento, archivoAbierto: string): NodoObjeto {
  const rango = simbolo.rangoSeleccion ?? simbolo.rango;
  return {
    id: `${archivoAbierto}#${rango.join(',')}#${simbolo.nombre}`,
    clase: 'simbolo',
    etiqueta: simbolo.nombre,
    icono: iconoDeKind(simbolo.nombreKind),
    archivo: archivoAbierto,
    rango,
    nombreKind: simbolo.nombreKind,
    hijos: simbolo.hijos.map((hijo) => nodoSimbolo(hijo, archivoAbierto)),
  };
}

function agrupar(simbolos: SimboloDocumento[], grupos: GrupoSimbolos[], archivoAbierto: string): NodoObjeto[] {
  const asignados = grupos.map((): NodoObjeto[] => []);
  for (const simbolo of simbolos) {
    const indice = grupos.findIndex((grupo) => grupo.acepta(simbolo));
    const crear = grupos[indice].nodo ?? nodoSimbolo;
    asignados[indice].push(crear(simbolo, archivoAbierto));
  }
  return grupos
    .map((grupo, indice) => ({ etiqueta: grupo.etiqueta, nodos: asignados[indice] }))
    .filter(({ nodos }) => nodos.length > 0)
    .map(({ etiqueta, nodos }) => nodoSeccion(etiqueta, nodos));
}

function seccionDefinicion(simbolo: SimboloDocumento | undefined, archivoAbierto: string): NodoObjeto[] {
  if (simbolo === undefined) {
    return [];
  }
  const subsecciones = agrupar(simbolo.hijos, GRUPOS_DEFINICION, archivoAbierto);
  return subsecciones.length > 0 ? [nodoSeccion('Definición', subsecciones)] : [];
}

function seccionImplementacion(simbolo: SimboloDocumento | undefined, archivoAbierto: string): NodoObjeto[] {
  if (simbolo === undefined || simbolo.hijos.length === 0) {
    return [];
  }
  return [nodoSeccion('Implementación', simbolo.hijos.map((hijo) => nodoSimbolo(hijo, archivoAbierto)))];
}

function seccionIncludesLocales(nombre: string, archivos: string[]): NodoObjeto[] {
  const propios = new Set([`${nombre}.clas.abap`, `${nombre}.clas.json`]);
  const nodos = archivos
    .filter((archivo) => !propios.has(archivo.toLowerCase()))
    .map((archivo) => {
      const extension = analizarNombreAff(archivo)?.extension ?? archivo;
      return nodoArchivo(archivo, ETIQUETA_INCLUDE_LOCAL[extension] ?? archivo);
    });
  return nodos.length > 0 ? [nodoSeccion('Includes locales', nodos)] : [];
}

function seccionArchivos(archivos: string[]): NodoObjeto[] {
  return archivos.length > 0 ? [nodoSeccion('Archivos', archivos.map((a) => nodoArchivo(a, a)))] : [];
}

function seccionesGrupoFunciones(archivoAbierto: string, archivos: string[], simbolos: SimboloDocumento[]): NodoObjeto[] {
  const clasificados = archivos.flatMap((archivo) => {
    const clasificado = clasificarArchivoFugr(archivo);
    return clasificado === undefined ? [] : [clasificado];
  });
  const modulos = clasificados
    .filter((c) => c.clase === 'moduloFuncion')
    .map((c) => nodoArchivo(c.archivo, c.nombre, 'symbol-function'));
  const nodoIncludeFugr = (c: ArchivoGrupoFunciones): NodoObjeto => ({
    ...nodoArchivo(c.archivo, c.nombre, 'file-submodule'),
    ...(c.clase === 'principal' && { descripcion: 'principal' }),
  });
  const includes = [
    ...clasificados.filter((c) => c.clase === 'principal'),
    ...clasificados.filter((c) => c.clase === 'include'),
  ].map(nodoIncludeFugr);
  const secciones: NodoObjeto[] = [];
  if (modulos.length > 0) {
    secciones.push(nodoSeccion('Módulos de función', modulos));
  }
  if (includes.length > 0) {
    secciones.push(nodoSeccion('Includes', includes));
  }
  const estructura = agrupar(simbolos, GRUPOS_PROGRAMA, archivoAbierto);
  if (estructura.length > 0) {
    const nombreAbierto = clasificarArchivoFugr(archivoAbierto)?.nombre ?? archivoAbierto;
    secciones.push(nodoSeccion(`Estructura de ${nombreAbierto}`, estructura));
  }
  return secciones;
}

/**
 * Mueve a un include abierto un subárbol construido sin archivo: los símbolos pasan a llevar la `ruta`
 * del include y todos los ids se prefijan con su nombre para no chocar con los del programa.
 */
function reubicarEnInclude(nodo: NodoObjeto, nombre: string, ruta: string): NodoObjeto {
  const { archivo, ...resto } = nodo;
  return {
    ...resto,
    id: `inc:${nombre}#${nodo.id}`,
    ...(archivo !== undefined && { ruta }),
    hijos: nodo.hijos.map((hijo) => reubicarEnInclude(hijo, nombre, ruta)),
  };
}

/** Cuelga de cada nodo include abierto las secciones de programa de sus símbolos; un include no se repite en su propia rama. */
function expandirIncludes(
  nodos: NodoObjeto[],
  abiertos: ReadonlyMap<string, IncludeAbierto>,
  enRama: ReadonlySet<string>,
): NodoObjeto[] {
  return nodos.map((nodo) => {
    if (nodo.clase !== 'include' || nodo.nombreInclude === undefined) {
      return nodo.hijos.length === 0 ? nodo : { ...nodo, hijos: expandirIncludes(nodo.hijos, abiertos, enRama) };
    }
    const nombre = nodo.nombreInclude.toUpperCase();
    const abierto = abiertos.get(nombre);
    if (abierto === undefined || enRama.has(nombre)) {
      return nodo;
    }
    const secciones = expandirIncludes(agrupar(abierto.simbolos, GRUPOS_PROGRAMA, ''), abiertos, new Set([...enRama, nombre]));
    return { ...nodo, hijos: secciones.map((seccion) => reubicarEnInclude(seccion, nombre, abierto.ruta)) };
  });
}

function seccionesPrograma(entrada: EntradaObjeto): NodoObjeto[] {
  const secciones = agrupar(entrada.simbolos, GRUPOS_PROGRAMA, entrada.archivoAbierto);
  const abiertos = entrada.includesAbiertos ?? [];
  if (abiertos.length === 0) {
    return secciones;
  }
  const porNombre = new Map(abiertos.map((include) => [include.nombre.toUpperCase(), include]));
  return expandirIncludes(secciones, porNombre, new Set());
}

function primerNivel(simbolos: SimboloDocumento[], nombreKind: string): SimboloDocumento[] {
  return simbolos.filter((s) => s.nombreKind === nombreKind);
}

function hijosPorTipo(entrada: EntradaObjeto): NodoObjeto[] {
  const { tipo, nombre, archivoAbierto, archivos, simbolos } = entrada;
  switch (tipo) {
    case 'clase': {
      const [definicion, implementacion] = primerNivel(simbolos, 'Class');
      return [
        ...seccionDefinicion(definicion, archivoAbierto),
        ...seccionImplementacion(implementacion, archivoAbierto),
        ...seccionIncludesLocales(nombre.toLowerCase(), archivos),
      ];
    }
    case 'interfaz':
      return seccionDefinicion(primerNivel(simbolos, 'Interface')[0], archivoAbierto);
    case 'programa':
    case 'include':
      return seccionesPrograma(entrada);
    case 'cds':
      return [...seccionArchivos(archivos), nodoAviso(AVISO_CAMPOS)];
    case 'tabla':
    case 'estructura':
      // El .tabl.json sale en el listado pero vscode.open no lo resuelve: solo se ofrece el .ddic.
      return [...seccionArchivos(archivos.filter((a) => !/\.jsonc?$/i.test(a))), nodoAviso(AVISO_CAMPOS)];
    case 'grupoFunciones':
      return seccionesGrupoFunciones(archivoAbierto, archivos, simbolos);
    case 'desconocido':
      return [...simbolos.map((s) => nodoSimbolo(s, archivoAbierto)), ...seccionArchivos(archivos)];
  }
}

export function construirArbolObjeto(entrada: EntradaObjeto): NodoObjeto {
  const hijos = hijosPorTipo(entrada);
  const sinEstructura = entrada.simbolos.length === 0 && !TIPOS_SIN_AVISO_SIMBOLOS.includes(entrada.tipo);
  const conAviso = sinEstructura ? [nodoAviso(AVISO_SIN_SIMBOLOS), ...hijos] : hijos;
  const diario = entrada.diario !== undefined && entrada.diario.entradas > 0 ? [nodoDiario(entrada.diario)] : [];
  return {
    id: `objeto:${entrada.nombre.toLowerCase()}`,
    clase: 'raiz',
    etiqueta: entrada.nombre.toUpperCase(),
    descripcion: ETIQUETA_TIPO[entrada.tipo],
    icono: iconoDeTipo(entrada.tipo),
    archivo: archivoPrincipal(entrada.archivos),
    hijos: [...conAviso, ...diario],
  };
}
