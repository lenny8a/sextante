import type { TipoObjeto } from '../bridge/adt-uri';
import { ErrorAdt, type ConexionAdt } from '../adt/conexion-adt';
import { esNoExiste } from '../adt/fuente-adt';
import { ACCEPT_DATA_PREVIEW, RUTA_DATA_PREVIEW, analizarDataPreviewConTotal } from '../adt/transaccion';
import {
  analizarOrdenes,
  consultaObjetosDeOrden,
  consultaTareas,
  consultaTextos,
  esNumeroOrden,
  objetosDeOrden,
  objetosDeOrdenDe,
  ordenesDeObjetoDe,
  type Fila,
  type ObjetoOrden,
  type Orden,
  type OrdenDeObjeto,
} from '../adt/transportes-modelo';
import { analizarVersiones, type Version } from '../adt/versiones-modelo';
import { partirSqlEnLineas } from '../adt/sql-lineas';
import { claveIdiomaSap } from '../diccionario/modelo';
import { TIEMPO_HOVER_MS } from '../diccionario/servicio';
import { consultaOrdenesDeObjetoFiltro, esDelObjeto, filtroOrdenesDeObjeto, type AlcanceOrdenes } from './consulta-ordenes-objeto';

export const TTL_OBJETO_MS = 300_000;
export const TIEMPO_FUENTE_MS = 20_000;
export const RUTA_TRANSPORTES = '/sap/bc/adt/cts/transportrequests';
export const ACCEPT_TRANSPORTES = 'application/vnd.sap.adt.transportorganizer.v1+xml';
/** Tareas y textos de órdenes. */
export const FILAS_ORDENES = 200;
/** Filas de E071 (órdenes de un objeto y contenido de una orden): pocas columnas y sin ORDER BY en el join. */
// VERIFICADO 2026-11-03: rowNumber=5000 aceptado por el Data Preview por RFC
export const FILAS_E071 = 5000;
/** Solo el contenido de una versión concreta (`…/versions/<fecha>/<n>/content`) no cambia y se guarda en caché. */
const MARCA_FUENTE_INMUTABLE = '/versions/';

// NO VERIFICADO: el Accept de versiones (la prueba real pidió */*; aquí va el Content-Type de la respuesta real). El text/plain de fuente sí está verificado.
const ACCEPT_VERSIONES = 'application/atom+xml;type=feed';
const ACCEPT_FUENTE = 'text/plain';
const IDIOMA_RESPALDO = 'E';

export interface DependenciasServicioObjeto {
  /** `undefined` = sin vía RFC o sin credencial: no se consulta. */
  conexion(destino: string): Promise<ConexionAdt | undefined>;
  idiomaDe(destino: string): string;
  ahora?: () => number;
  registrar?: (m: string) => void;
  /** Avisos (lista truncada); sin él van a `registrar`. */
  advertir?: (m: string) => void;
}

/** La consulta trajo `recibidas` filas de las `total` que tiene. */
export interface Truncado {
  recibidas: number;
  total: number;
}

export interface ResultadoOrdenesDeObjeto {
  ordenes: OrdenDeObjeto[];
  alcance: AlcanceOrdenes;
  truncado?: Truncado;
}

export interface ResultadoObjetosDeOrden {
  objetos: ObjetoOrden[];
  truncado?: Truncado;
}

export interface OpcionesOrdenesDeObjeto {
  /** Archivos de la carpeta del objeto: dan los módulos e includes de un grupo de funciones. */
  archivos?: readonly string[];
  forzar?: boolean;
}

export type ResultadoFuente =
  | { estado: 'ok'; texto: string }
  | { estado: 'noExiste' }
  | { estado: 'sinConexion' }
  | { estado: 'error'; mensaje: string };

export type ResultadoVersiones =
  | { estado: 'ok'; versiones: Version[] }
  | { estado: 'noExiste' }
  | { estado: 'sinConexion' }
  | { estado: 'error'; mensaje: string };

interface EntradaCache { hasta: number; valor: Promise<unknown> }

interface FilasE071 { filas: Fila[]; truncado?: Truncado }

function conteo(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorAdt) {
    return `HTTP ${error.estado}`;
  }
  return error instanceof Error ? error.name : 'desconocido';
}

function conTruncado<T extends object>(valor: T, truncado: Truncado | undefined): T & { truncado?: Truncado } {
  return truncado === undefined ? valor : { ...valor, truncado };
}

export class ServicioObjeto {
  // Pendiente de unificar con CacheTtl (src/util/cache-ttl.ts, ya en master): esta caché guarda la promesa en vuelo.
  private readonly cache = new Map<string, EntradaCache>();
  private readonly avisadosSinConexion = new Set<string>();

  constructor(private readonly deps: DependenciasServicioObjeto) {}

  /** `undefined` = sin conexión. */
  ordenes(destino: string, forzar = false): Promise<Orden[] | undefined> {
    if (forzar) {
      this.cache.delete(`${destino}|ordenes|lista`);
    }
    return this.memo(destino, 'ordenes', 'lista', async (c) => {
      const respuesta = await c.get(RUTA_TRANSPORTES, undefined, ACCEPT_TRANSPORTES, undefined, TIEMPO_FUENTE_MS);
      const ordenes = analizarOrdenes(respuesta.cuerpo);
      const modificables = ordenes.filter((o) => o.estado === 'modificable').length;
      const liberadas = ordenes.filter((o) => o.estado === 'liberada').length;
      this.registrar(
        `Órdenes: lista → ${conteo(ordenes.length, 'orden', 'órdenes')} (${conteo(modificables, 'modificable', 'modificables')}, ${conteo(liberadas, 'liberada', 'liberadas')})`,
      );
      return ordenes;
    });
  }

  /** Un nombre no válido o un tipo sin órdenes devuelve una lista vacía sin consultar. */
  ordenesDeObjeto(
    destino: string,
    nombre: string,
    tipo: TipoObjeto,
    opciones: OpcionesOrdenesDeObjeto = {},
  ): Promise<ResultadoOrdenesDeObjeto | undefined> {
    const filtro = filtroOrdenesDeObjeto(nombre, tipo, opciones.archivos);
    if (filtro === undefined) {
      return Promise.resolve({ ordenes: [], alcance: 'objeto' });
    }
    const nombreCache = `${tipo}|${filtro.nombre}|${filtro.exactos.join(',')}`;
    if (opciones.forzar === true) {
      this.cache.delete(`${destino}|ordenesDeObjeto|${nombreCache}`);
    }
    return this.memo(destino, 'ordenesDeObjeto', nombreCache, async (c): Promise<ResultadoOrdenesDeObjeto> => {
      const idiomas = this.idiomas(destino);
      const todas = await this.consultarE071(c, consultaOrdenesDeObjetoFiltro(filtro), 'objeto');
      const filas = todas.filas.filter((f) => esDelObjeto(f, filtro));
      const numeros = [...new Set(filas.map((f) => f.STRKORR || f.TRKORR || '').filter(esNumeroOrden))];
      const textos = numeros.length === 0 ? [] : await this.consultar(c, consultaTextos(numeros, idiomas));
      const ordenes = ordenesDeObjetoDe(filas, textos, idiomas);
      const liberadas = ordenes.filter((o) => o.estado === 'liberada').length;
      this.registrar(`Órdenes: objeto → ${conteo(ordenes.length, 'orden', 'órdenes')} (${conteo(liberadas, 'liberada', 'liberadas')})`);
      return conTruncado({ ordenes, alcance: filtro.alcance }, todas.truncado);
    });
  }

  async objetosDeOrden(destino: string, numero: string): Promise<ResultadoObjetosDeOrden | undefined> {
    if (!esNumeroOrden(numero)) {
      return { objetos: [] };
    }
    const conocida = (await this.ordenesCacheadas(destino))?.find((o) => o.numero === numero);
    if (conocida) {
      return { objetos: objetosDeOrden(conocida) };
    }
    return this.memo(destino, 'objetosDeOrden', numero, async (c): Promise<ResultadoObjetosDeOrden> => {
      const tareas = (await this.consultar(c, consultaTareas(numero))).map((f) => f.TRKORR ?? '').filter(esNumeroOrden);
      const contenido = await this.consultarE071(c, consultaObjetosDeOrden([numero, ...tareas]), 'contenido');
      const objetos = objetosDeOrdenDe(contenido.filas);
      this.registrar(`Órdenes: contenido → ${conteo(objetos.length, 'objeto', 'objetos')}`);
      return conTruncado({ objetos }, contenido.truncado);
    });
  }

  async versiones(destino: string, rutaVersiones: string, etiquetaLog = 'versiones', forzar = false): Promise<ResultadoVersiones> {
    if (forzar) {
      this.cache.delete(`${destino}|versiones|${rutaVersiones}`);
    }
    try {
      const resultado = await this.memo<ResultadoVersiones>(destino, 'versiones', rutaVersiones, async (c) => {
        try {
          const respuesta = await c.get(rutaVersiones, undefined, ACCEPT_VERSIONES, undefined, TIEMPO_FUENTE_MS);
          const versiones = analizarVersiones(respuesta.cuerpo);
          this.registrar(`Versiones: ${etiquetaLog} → ${conteo(versiones.length, 'versión', 'versiones')}`);
          return { estado: 'ok', versiones };
        } catch (error) {
          if (esNoExiste(error)) {
            this.registrar(`Versiones: ${etiquetaLog} → 404`);
            return { estado: 'noExiste' };
          }
          throw error;
        }
      });
      return resultado ?? { estado: 'sinConexion' };
    } catch (error) {
      this.registrar(`Versiones: ${etiquetaLog} → error ${mensajeDeError(error)}`);
      return { estado: 'error', mensaje: mensajeDeError(error) };
    }
  }

  /**
   * Solo el contenido de una versión (ruta con `/versions/`) se guarda en caché; `source/main`, `?version=active`
   * y las lecturas de Comparar van siempre frescas (dos lecturas simultáneas comparten la petición en vuelo).
   */
  async fuente(destino: string, ruta: string, version?: 'active', etiquetaLog = 'fuente'): Promise<ResultadoFuente> {
    const soloEnVuelo = !ruta.includes(MARCA_FUENTE_INMUTABLE);
    try {
      const resultado = await this.memo<ResultadoFuente>(destino, 'fuente', `${version ?? ''}|${ruta}`, async (c) => {
        try {
          const parametros = version === undefined ? undefined : { version };
          const respuesta = await c.get(ruta, parametros, ACCEPT_FUENTE, undefined, TIEMPO_FUENTE_MS);
          this.registrar(`Fuente: ${etiquetaLog} → 200 (${Buffer.byteLength(respuesta.cuerpo)} bytes)`);
          return { estado: 'ok', texto: respuesta.cuerpo };
        } catch (error) {
          if (esNoExiste(error)) {
            this.registrar(`Fuente: ${etiquetaLog} → 404`);
            return { estado: 'noExiste' };
          }
          throw error;
        }
      }, soloEnVuelo);
      return resultado ?? { estado: 'sinConexion' };
    } catch (error) {
      this.registrar(`Fuente: ${etiquetaLog} → error ${mensajeDeError(error)}`);
      return { estado: 'error', mensaje: mensajeDeError(error) };
    }
  }

  vaciar(destino?: string): void {
    if (destino === undefined) {
      this.cache.clear();
      this.avisadosSinConexion.clear();
      return;
    }
    const prefijo = `${destino}|`;
    for (const clave of [...this.cache.keys()]) {
      if (clave.startsWith(prefijo)) {
        this.cache.delete(clave);
      }
    }
    this.avisadosSinConexion.delete(destino);
  }

  /** Tira las fuentes guardadas de un destino (al refrescar sus documentos de solo lectura). */
  vaciarFuentes(destino: string): void {
    const prefijo = `${destino}|fuente|`;
    for (const clave of [...this.cache.keys()]) {
      if (clave.startsWith(prefijo)) {
        this.cache.delete(clave);
      }
    }
  }

  private async ordenesCacheadas(destino: string): Promise<Orden[] | undefined> {
    const entrada = this.cache.get(`${destino}|ordenes|lista`);
    if (!entrada || entrada.hasta <= this.ahora()) {
      return undefined;
    }
    try {
      return (await entrada.valor) as Orden[] | undefined;
    } catch {
      return undefined;
    }
  }

  /** `soloEnVuelo`: la entrada se borra al terminar; solo evita duplicar peticiones simultáneas. */
  private memo<T>(
    destino: string,
    clase: string,
    nombre: string,
    calcular: (c: ConexionAdt) => Promise<T>,
    soloEnVuelo = false,
  ): Promise<T | undefined> {
    const clave = `${destino}|${clase}|${nombre}`;
    const ahora = this.ahora();
    const existente = this.cache.get(clave);
    if (existente && existente.hasta > ahora) {
      return existente.valor as Promise<T | undefined>;
    }
    const entrada: EntradaCache = { hasta: ahora + TTL_OBJETO_MS, valor: Promise.resolve(undefined) };
    const valor = (async (): Promise<T | undefined> => {
      const conexion = await this.deps.conexion(destino);
      if (!conexion) {
        this.borrarSiEs(clave, entrada);
        this.avisarSinConexion(destino);
        return undefined;
      }
      return calcular(conexion);
    })();
    entrada.valor = valor;
    this.cache.set(clave, entrada);
    valor.then(
      () => {
        if (soloEnVuelo) {
          this.borrarSiEs(clave, entrada);
        }
      },
      () => this.borrarSiEs(clave, entrada),
    );
    return valor;
  }

  private borrarSiEs(clave: string, entrada: EntradaCache): void {
    if (this.cache.get(clave) === entrada) {
      this.cache.delete(clave);
    }
  }

  private avisarSinConexion(destino: string): void {
    if (!this.avisadosSinConexion.has(destino)) {
      this.avisadosSinConexion.add(destino);
      this.registrar('Objeto: sin conexión RFC');
    }
  }

  private async consultar(c: ConexionAdt, sql: string): Promise<Fila[]> {
    return (await this.consultarConTotal(c, sql, FILAS_ORDENES)).filas;
  }

  /** E071 con su límite propio; si `totalRows` supera las filas recibidas, avisa con los dos conteos. */
  private async consultarE071(c: ConexionAdt, sql: string, etiquetaLog: string): Promise<FilasE071> {
    const { filas, total } = await this.consultarConTotal(c, sql, FILAS_E071);
    if (total === undefined || total <= filas.length) {
      return { filas };
    }
    this.advertir(`Órdenes: ${etiquetaLog} → truncado, ${filas.length} de ${total} filas`);
    return { filas, truncado: { recibidas: filas.length, total } };
  }

  private async consultarConTotal(c: ConexionAdt, sql: string, filas: number): Promise<{ filas: Fila[]; total?: number }> {
    const parametros = { rowNumber: String(filas) };
    const respuesta = await c.post(RUTA_DATA_PREVIEW, partirSqlEnLineas(sql), 'text/plain', ACCEPT_DATA_PREVIEW, undefined, parametros, TIEMPO_HOVER_MS);
    return analizarDataPreviewConTotal(respuesta.cuerpo);
  }

  /** Idioma del destino y `E` de respaldo, sin repetir; una clave que no es SAP deja solo el respaldo. */
  private idiomas(destino: string): string[] {
    const clave = claveIdiomaSap(this.deps.idiomaDe(destino));
    return [...new Set([...(clave === undefined ? [] : [clave]), IDIOMA_RESPALDO])];
  }

  private ahora(): number {
    return this.deps.ahora?.() ?? Date.now();
  }

  private registrar(mensaje: string): void {
    this.deps.registrar?.(mensaje);
  }

  private advertir(mensaje: string): void {
    if (this.deps.advertir) {
      this.deps.advertir(mensaje);
    } else {
      this.registrar(mensaje);
    }
  }
}
