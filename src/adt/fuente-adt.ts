import { analizarNombreAff, clasificarArchivoFugr, TipoObjeto } from '../bridge/adt-uri';
import { ErrorAdt } from './transporte';

export type IncludeClase = 'main' | 'definitions' | 'implementations' | 'macros' | 'testclasses';

export const INCLUDES_CLASE: readonly IncludeClase[] = ['main', 'definitions', 'implementations', 'macros', 'testclasses'];

export const ETIQUETA_INCLUDE: Readonly<Record<IncludeClase, string>> = {
  main: 'Clase (principal)',
  definitions: 'Definiciones locales',
  implementations: 'Implementaciones locales',
  macros: 'Macros',
  testclasses: 'Test classes',
};

const INCLUDE_POR_EXTENSION: Readonly<Record<string, IncludeClase>> = {
  abap: 'main',
  'definitions.abap': 'definitions',
  'locals_def.abap': 'definitions',
  'implementations.abap': 'implementations',
  'locals_imp.abap': 'implementations',
  'macros.abap': 'macros',
  'testclasses.abap': 'testclasses',
};

export function includeDeArchivo(archivo: string): IncludeClase | undefined {
  const aff = analizarNombreAff(archivo);
  if (aff === undefined || aff.tipo !== 'clas') {
    return undefined;
  }
  return INCLUDE_POR_EXTENSION[aff.extension];
}

export interface PiezaFuente {
  tipo: TipoObjeto;
  nombre: string;
  etiqueta: string;
  include?: IncludeClase;
  archivo?: string;
  rutaFuente: string;
  rutaVersiones: string;
}

export interface ObjetoParaPiezas {
  tipo: TipoObjeto;
  nombre: string;
  archivos?: string[];
}

const RAIZ_ADT = '/sap/bc/adt';

export function segmentoAdt(nombre: string): string {
  return nombre.toLowerCase().replace(/\//g, '%2f');
}

function piezasDeClase(objeto: ObjetoParaPiezas, archivoAbierto: string | undefined): PiezaFuente[] {
  const base = `${RAIZ_ADT}/oo/classes/${segmentoAdt(objeto.nombre)}`;
  const archivoPorInclude = new Map<IncludeClase, string>();
  for (const archivo of objeto.archivos ?? []) {
    const include = includeDeArchivo(archivo);
    if (include !== undefined && !archivoPorInclude.has(include)) {
      archivoPorInclude.set(include, archivo);
    }
  }
  const abierto = archivoAbierto === undefined ? undefined : includeDeArchivo(archivoAbierto);
  const incluidos = INCLUDES_CLASE.filter((include) => objeto.archivos === undefined || archivoPorInclude.has(include));
  const ordenados = abierto !== undefined && incluidos.includes(abierto) ? [abierto, ...incluidos.filter((i) => i !== abierto)] : incluidos;
  return ordenados.map((include) => {
    const pieza: PiezaFuente = {
      tipo: objeto.tipo,
      nombre: objeto.nombre,
      etiqueta: ETIQUETA_INCLUDE[include],
      include,
      // NO VERIFICADO: la ruta de fuente de implementations, macros y testclasses se infiere del patrón de definitions.
      rutaFuente: include === 'main' ? `${base}/source/main` : `${base}/includes/${include}`,
      // NO VERIFICADO solo para testclasses (un sistema real dio 404 en una clase sin ese include).
      rutaVersiones: `${base}/includes/${include}/versions`,
    };
    const archivo = archivoPorInclude.get(include) ?? (include === abierto ? archivoAbierto : undefined);
    if (archivo !== undefined) {
      pieza.archivo = archivo;
    }
    return pieza;
  });
}

function piezaDeGrupo(objeto: ObjetoParaPiezas, archivoAbierto: string | undefined): PiezaFuente {
  const grupo = `${RAIZ_ADT}/functions/groups/${segmentoAdt(objeto.nombre)}`;
  const clasificado = archivoAbierto === undefined ? undefined : clasificarArchivoFugr(archivoAbierto);
  let rutaFuente = `${grupo}/source/main`;
  let etiqueta = objeto.nombre;
  if (clasificado?.clase === 'moduloFuncion') {
    rutaFuente = `${grupo}/fmodules/${segmentoAdt(clasificado.nombre)}/source/main`;
    etiqueta = clasificado.nombre;
  } else if (clasificado?.clase === 'include') {
    rutaFuente = `${grupo}/includes/${segmentoAdt(clasificado.nombre)}/source/main`;
    etiqueta = clasificado.nombre;
  }
  const pieza: PiezaFuente = { tipo: objeto.tipo, nombre: objeto.nombre, etiqueta, rutaFuente, rutaVersiones: `${rutaFuente}/versions` };
  if (archivoAbierto !== undefined) {
    pieza.archivo = archivoAbierto;
  }
  return pieza;
}

const RUTA_SIMPLE: Readonly<Partial<Record<TipoObjeto, string>>> = {
  interfaz: 'oo/interfaces',
  programa: 'programs/programs',
  include: 'programs/includes',
  tabla: 'ddic/tables',
  estructura: 'ddic/structures',
};

/**
 * Piezas con fuente propio de un objeto y sus rutas ADT.
 * Verificadas contra un sistema real (2026-10-30): fuente de clase main y definitions; versiones de main, definitions,
 * implementations y macros; interfaz, programa, include, tabla y estructura (fuente y versiones); CDS (fuente y
 * versiones sin source/main); grupo de funciones (módulo, include y programa principal, fuente y versiones).
 * NO VERIFICADO: fuente de includes/implementations, macros y testclasses (inferidas de definitions) y las
 * versiones de testclasses.
 * Las versiones de una CDS cuelgan de `…/sources/<v>/versions`, sin `source/main`.
 */
export function piezasDe(objeto: ObjetoParaPiezas, archivoAbierto?: string): PiezaFuente[] {
  if (objeto.tipo === 'clase') {
    return piezasDeClase(objeto, archivoAbierto);
  }
  if (objeto.tipo === 'grupoFunciones') {
    return [piezaDeGrupo(objeto, archivoAbierto)];
  }
  if (objeto.tipo === 'cds') {
    const base = `${RAIZ_ADT}/ddic/ddl/sources/${segmentoAdt(objeto.nombre)}`;
    return [{ tipo: objeto.tipo, nombre: objeto.nombre, etiqueta: objeto.nombre, rutaFuente: `${base}/source/main`, rutaVersiones: `${base}/versions` }];
  }
  const raiz = RUTA_SIMPLE[objeto.tipo];
  if (raiz === undefined) {
    return [];
  }
  const rutaFuente = `${RAIZ_ADT}/${raiz}/${segmentoAdt(objeto.nombre)}/source/main`;
  return [{ tipo: objeto.tipo, nombre: objeto.nombre, etiqueta: objeto.nombre, rutaFuente, rutaVersiones: `${rutaFuente}/versions` }];
}

export interface ComparacionFuente {
  igual: boolean;
  /**
   * 0 si igual; si no, el mayor de las líneas que sobran a cada lado (multiconjuntos de líneas normalizadas),
   * al menos 1 cuando los textos difieren aunque las líneas coincidan como multiconjunto.
   */
  lineas: number;
}

export function normalizarFuente(texto: string): string[] {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n').map((linea) => linea.trimEnd());
  while (lineas.length > 0 && lineas[lineas.length - 1] === '') {
    lineas.pop();
  }
  return lineas;
}

function contar(lineas: string[]): Map<string, number> {
  const cuentas = new Map<string, number>();
  for (const linea of lineas) {
    cuentas.set(linea, (cuentas.get(linea) ?? 0) + 1);
  }
  return cuentas;
}

function sobrantes(a: Map<string, number>, b: Map<string, number>): number {
  let total = 0;
  for (const [linea, cuenta] of a) {
    total += Math.max(0, cuenta - (b.get(linea) ?? 0));
  }
  return total;
}

export function compararFuentes(a: string, b: string): ComparacionFuente {
  const lineasA = normalizarFuente(a);
  const lineasB = normalizarFuente(b);
  const cuentasA = contar(lineasA);
  const cuentasB = contar(lineasB);
  const lineas = Math.max(sobrantes(cuentasA, cuentasB), sobrantes(cuentasB, cuentasA));
  const igual = lineasA.length === lineasB.length && lineasA.every((linea, i) => linea === lineasB[i]);
  return { igual, lineas: igual ? 0 : Math.max(1, lineas) };
}

export function esNoExiste(error: unknown): boolean {
  return error instanceof ErrorAdt && error.estado === 404;
}

export function extensionDe(archivo: string | undefined): string {
  const extension = archivo === undefined ? undefined : analizarNombreAff(archivo)?.extension;
  return extension === 'acds' || extension === 'ddic' ? extension : 'abap';
}
