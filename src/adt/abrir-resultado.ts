import {
  archivoPrincipal,
  BIBLIOTECA_LOCAL,
  BIBLIOTECA_SISTEMA,
  RAIZ_REPOTREE,
  rutaDeObjeto,
  type ObjetoRepotree,
} from '../bridge/adt-uri';
import { etiquetaRepotreeDePaquete } from '../tree/paquete-modelo';
import { descodificarSegmento, esPaquete, esTransaccion, type ResultadoBusqueda } from './busqueda-modelo';
import type { DestinoTransaccion } from './transaccion';

/** Nombres de la categoría de código: `Source Code Library` en S/4HANA y `Source Library` en ECC. */
export const CATEGORIAS_CODIGO = ['Source Code Library', 'Source Library'] as const;

const CATEGORIA_DICTIONARY = 'Dictionary';
const PAQUETE_LOCAL = '$TMP';
const TIPO_FUNCION = 'FUGR/FF';

export interface CarpetaTipo {
  categoria: 'codigo' | typeof CATEGORIA_DICTIONARY;
  tipoCarpeta: string;
}

/** NO VERIFICADO: los nombres de carpeta de tablas, estructuras y CDS en `Dictionary` salen de la spec, no de una respuesta real. */
const CARPETA_POR_TIPO: Readonly<Record<string, CarpetaTipo>> = {
  'CLAS/OC': { categoria: 'codigo', tipoCarpeta: 'Classes' },
  'INTF/OI': { categoria: 'codigo', tipoCarpeta: 'Interfaces' },
  'PROG/P': { categoria: 'codigo', tipoCarpeta: 'Programs' },
  'PROG/I': { categoria: 'codigo', tipoCarpeta: 'Includes' },
  'FUGR/F': { categoria: 'codigo', tipoCarpeta: 'Function Groups' },
  'FUGR/FF': { categoria: 'codigo', tipoCarpeta: 'Function Groups' },
  'TABL/DT': { categoria: CATEGORIA_DICTIONARY, tipoCarpeta: 'Database Tables' },
  'TABL/DS': { categoria: CATEGORIA_DICTIONARY, tipoCarpeta: 'Structures' },
  'DDLS/DF': { categoria: CATEGORIA_DICTIONARY, tipoCarpeta: 'ABAP DDL Sources' },
};

export function carpetaTipoDe(tipoAdt: string): CarpetaTipo | undefined {
  return CARPETA_POR_TIPO[tipoAdt];
}

/** El grupo sale de la uri /sap/bc/adt/functions/groups/<GRUPO>/fmodules/<FM> (busq-fugr.xml). */
export function grupoDeFuncion(uriAdt: string): string | undefined {
  const m = /\/functions\/groups\/([^/]+)\//i.exec(uriAdt);
  return m ? descodificarSegmento(m[1]).toUpperCase() : undefined;
}

export function objetoRepotreeDe(
  r: ResultadoBusqueda,
  categoriaCodigo: string,
  usuarioLocal: string,
): ObjetoRepotree | undefined {
  const carpeta = carpetaTipoDe(r.tipo);
  if (carpeta === undefined) {
    return undefined;
  }
  const nombre = r.tipo === TIPO_FUNCION ? grupoDeFuncion(r.uriAdt) : r.nombre;
  if (nombre === undefined) {
    return undefined;
  }
  // NO VERIFICADO: el paquete $TMP cuelga de `Local Objects ($TMP)/<usuario>`; un paquete `/NS/X` se busca como
  // `(NS)X` (etiqueta de la spec, sección 10); el nombre de un objeto con namespace se usa tal cual.
  const local = r.paquete === PAQUETE_LOCAL;
  return {
    biblioteca: local ? BIBLIOTECA_LOCAL : BIBLIOTECA_SISTEMA,
    paquete: local ? usuarioLocal : etiquetaRepotreeDePaquete(r.paquete),
    categoria: carpeta.categoria === 'codigo' ? categoriaCodigo : CATEGORIA_DICTIONARY,
    tipoCarpeta: carpeta.tipoCarpeta,
    nombre,
  };
}

export function archivoPreferidoDe(r: ResultadoBusqueda, archivos: string[]): string | undefined {
  if (r.tipo === TIPO_FUNCION) {
    const grupo = grupoDeFuncion(r.uriAdt);
    if (grupo !== undefined) {
      const esperado = `${grupo}.fugr.${r.nombre}.func.abap`.toLowerCase();
      const encontrado = archivos.find((archivo) => archivo.toLowerCase() === esperado);
      if (encontrado !== undefined) {
        return encontrado;
      }
    }
  }
  return archivoPrincipal(archivos);
}

export type ResultadoAbrir =
  | 'abierto'
  | 'noLocalizado'
  | 'tipoNoSoportado'
  | 'paquete'
  | 'vista'
  | 'transaccion'
  | 'transaccionSinDestino';

/** Lo que hace falta para abrir lo que ejecuta una transacción; sin esto, la transacción solo se informa. */
export interface DependenciasTransaccion {
  resolver(tcode: string): Promise<DestinoTransaccion>;
  avisar(mensaje: string): void;
}

export interface DependenciasAbrir {
  destino: string;
  usuario: string;
  /** Nombres de las entradas de una carpeta del repotree; lanza si no existe. */
  listarCarpeta(ruta: string): Promise<string[]>;
  mostrar(ruta: string): Promise<unknown>;
  irAPaquete(nombre: string): Promise<void>;
  registrar?: (mensaje: string) => void;
  /**
   * Paquete del objeto con ese nombre y tipo exactos, o `undefined` si no se encuentra. Hace falta para los
   * resultados de una búsqueda filtrada, que llegan sin paquete, y para lo que ejecuta una transacción.
   */
  paqueteDe?(nombre: string, tipo: string): Promise<string | undefined>;
  transacciones?: DependenciasTransaccion;
}

const categoriaPorDestino = new Map<string, string>();

export function olvidarCategorias(): void {
  categoriaPorDestino.clear();
}

async function categoriaDeCodigo(
  destino: string,
  biblioteca: string,
  paquete: string,
  listarCarpeta: DependenciasAbrir['listarCarpeta'],
): Promise<string | undefined> {
  const cacheada = categoriaPorDestino.get(destino);
  if (cacheada !== undefined) {
    return cacheada;
  }
  const entradas = await listarCarpeta(`/${RAIZ_REPOTREE}/${destino}/${biblioteca}/${paquete}`);
  const categoria = CATEGORIAS_CODIGO.find((nombre) => entradas.includes(nombre));
  if (categoria !== undefined) {
    categoriaPorDestino.set(destino, categoria);
  }
  return categoria;
}

/** Sin paquete: `abrirResultado` lo pide a `paqueteDe`, igual que para un resultado de búsqueda filtrada. */
function abrirObjetoPorNombre(nombre: string, tipo: string, deps: DependenciasAbrir): Promise<ResultadoAbrir> {
  return abrirResultado({ nombre, tipo, descripcion: '', paquete: '', uriAdt: '' }, deps);
}

async function abrirTransaccion(
  tcode: string,
  transacciones: DependenciasTransaccion,
  deps: DependenciasAbrir,
): Promise<ResultadoAbrir> {
  const registrar = deps.registrar ?? (() => undefined);
  try {
    const destino = await transacciones.resolver(tcode);
    switch (destino.clase) {
      case 'programa': {
        const resultado = await abrirObjetoPorNombre(destino.programa, 'PROG/P', deps);
        if (resultado === 'abierto' && destino.dynpro !== undefined) {
          transacciones.avisar(`Dynpro ${destino.dynpro}: la extensión oficial no expone dynpros`);
        }
        return resultado;
      }
      case 'metodo':
        return await abrirObjetoPorNombre(destino.claseAbap, 'CLAS/OC', deps);
      case 'vista':
        // NO VERIFICADO: cómo abre la oficial una vista de actualización; de momento solo se informa.
        transacciones.avisar(`La transacción ${tcode} mantiene la vista ${destino.vista} (SM30)`);
        return 'vista';
      default:
        return 'transaccionSinDestino';
    }
  } catch (err) {
    registrar(`Búsqueda: no se pudo resolver la transacción (${err instanceof Error ? err.name : typeof err})`);
    return 'transaccionSinDestino';
  }
}

export async function abrirResultado(r: ResultadoBusqueda, deps: DependenciasAbrir): Promise<ResultadoAbrir> {
  const registrar = deps.registrar ?? (() => undefined);
  if (esPaquete(r)) {
    try {
      await deps.irAPaquete(r.nombre);
      return 'paquete';
    } catch (err) {
      registrar(`Búsqueda: no se pudo ir al paquete (${err instanceof Error ? err.name : typeof err})`);
      return 'noLocalizado';
    }
  }
  if (esTransaccion(r)) {
    return deps.transacciones ? abrirTransaccion(r.nombre, deps.transacciones, deps) : 'transaccion';
  }
  const carpeta = carpetaTipoDe(r.tipo);
  if (carpeta === undefined) {
    registrar(`Búsqueda: tipo sin carpeta conocida (${r.tipo})`);
    return 'tipoNoSoportado';
  }
  try {
    const paquete = r.paquete !== '' ? r.paquete : await deps.paqueteDe?.(r.nombre, r.tipo);
    if (paquete === undefined || paquete === '') {
      registrar('Búsqueda: resultado sin paquete; no se localiza');
      return 'noLocalizado';
    }
    const base = objetoRepotreeDe({ ...r, paquete }, '', deps.usuario);
    if (base === undefined) {
      return 'noLocalizado';
    }
    let categoria = CATEGORIA_DICTIONARY;
    if (carpeta.categoria === 'codigo') {
      const encontrada = await categoriaDeCodigo(deps.destino, base.biblioteca, base.paquete, deps.listarCarpeta);
      if (encontrada === undefined) {
        registrar('Búsqueda: el paquete no tiene categoría de código');
        return 'noLocalizado';
      }
      categoria = encontrada;
    }
    const objeto = { ...base, categoria };
    const archivos = await deps.listarCarpeta(rutaDeObjeto(deps.destino, objeto));
    const archivo = archivoPreferidoDe(r, archivos);
    if (archivo === undefined) {
      registrar(`Búsqueda: objeto sin archivos abribles (${archivos.length} entradas)`);
      return 'noLocalizado';
    }
    await deps.mostrar(rutaDeObjeto(deps.destino, objeto, archivo));
    return 'abierto';
  } catch {
    registrar('Búsqueda: no se pudo localizar el objeto en el repotree');
    return 'noLocalizado';
  }
}
