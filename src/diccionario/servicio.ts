import { ErrorAdt, type ConexionAdt } from '../adt/conexion-adt';
import { partirSqlEnLineas } from '../adt/sql-lineas';
import { ACCEPT_DATA_PREVIEW, RUTA_DATA_PREVIEW, analizarDataPreview } from '../adt/transaccion';
import { CacheTtl } from '../util/cache-ttl';
import {
  ACCEPT_USOS,
  CONTENT_TYPE_USOS,
  RUTA_USOS,
  TIEMPO_USOS_MS,
  analizarUsos,
  cuerpoUsos,
  filtrarUsos,
  type ResultadoUsos,
  type UsosPropios,
} from './donde-se-usa';
import {
  RUTAS_DDIC,
  analizarDominio,
  analizarElementoDatos,
  analizarMetadatosDdic,
  camposDe,
  claveIdiomaSap,
  consultaCampos,
  consultaCamposSinTexto,
  consultaMensaje,
  consultaValoresDominio,
  decimalesPorCampo,
  mensajeDe,
  nombreValido,
  valoresDe,
  type CampoDiccionario,
  type Dominio,
  type ElementoDatos,
  type Mensaje,
  type ObjetoDiccionario,
  type TipoDiccionario,
} from './modelo';

export interface DependenciasServicio {
  /** `undefined` = sin vía RFC o sin credencial: no se consulta. */
  conexion(destino: string): Promise<ConexionAdt | undefined>;
  /** Clave SAP ya resuelta por el cableado; si no lo es, el servicio usa 'E'. */
  idiomaDe(destino: string): string;
  ahora?: () => number;
  registrar?: (m: string) => void;
}

// Medido 4,4 s en frío el 2026-10-30 vía SAP Router; VS Code mantiene el hover abierto mientras el proveedor está pendiente.
export const TIEMPO_HOVER_MS = 12_000;
export const TTL_METADATOS_MS = 600_000;
export const TTL_MENSAJES_MS = 300_000;
export const FILAS_POR_PAGINA = 50;
export const TIEMPO_DATOS_MS = 30_000;

/** `filas[i][j]` es el valor de `columnas[j]`; `total` es `dataPreview:totalRows` si el servidor lo da. */
export interface DatosTabla { columnas: string[]; filas: string[][]; total?: number }

/** Lo filtrado y la lista completa: el panel la guarda para volver a filtrar sin pedir de nuevo. */
export interface UsosConsultados extends UsosPropios { completo: ResultadoUsos }

/** `campos` solo para tabla/estructura. */
export interface Resuelto { objeto: ObjetoDiccionario; campos?: CampoDiccionario[] }

export interface CampoResuelto { campo: CampoDiccionario; elemento?: ElementoDatos; dominio?: Dominio }

// NO VERIFICADO: los Accept son los Content-Type de las respuestas reales (tabla-mara.xml, …); no se probó qué Accept exige el servidor.
const ACCEPT_DDIC: Readonly<Record<TipoDiccionario, string>> = {
  tabla: 'application/vnd.sap.adt.tables.v2+xml',
  estructura: 'application/vnd.sap.adt.structures.v2+xml',
  elementoDatos: 'application/vnd.sap.adt.dataelements.v2+xml',
  dominio: 'application/vnd.sap.adt.domains.v2+xml',
};

const ORDEN_BUSQUEDA: readonly TipoDiccionario[] = ['tabla', 'estructura', 'elementoDatos'];
const IDIOMA_RESPALDO = 'E';
const FILAS_CAMPOS = 5_000;
const FILAS_VALORES = 1_000;
const FILAS_MENSAJE = 10;
const PATRON_NUMERO = /^[0-9]{1,3}$/;
const PREFIJOS_GRUPO = ['.INCLU', '.APPEND'];
const PREFIJO_URI_ADT = '/sap/bc/adt/';
const TOTAL_FILAS = /<dataPreview:totalRows>\s*(\d+)\s*<\/dataPreview:totalRows>/;
export const NOMBRE_COLUMNA = /<dataPreview:metadata\s[^>]*?dataPreview:name\s*=\s*"([^"]*)"/g;

/** Rechazo interno de `memo` sin conexión: así la entrada no queda en caché. */
class SinConexion extends Error {}

function segmentoUri(nombre: string): string {
  return nombre.toLowerCase().replace(/\//g, '%2f');
}

export function esNoEncontrado(error: unknown): boolean {
  return error instanceof ErrorAdt && error.estado === 404;
}

export function nombreDeError(error: unknown): string {
  return error instanceof Error ? error.name : 'desconocido';
}

/**
 * NO VERIFICADO: cómo marca DD03L los campos de un include. Se supone que la fila `.INCLUDE`/`.APPEND`
 * lleva en PRECFIELD el nombre del include y que sus campos la siguen hasta la próxima fila de ese tipo.
 * Sin PRECFIELD (como en dd03l-mara.xml) los campos quedan planos.
 */
function includesPorCampo(filasDd03l: Record<string, string>[]): Map<string, string> {
  const includes = new Map<string, string>();
  let actual: string | undefined;
  for (const fila of filasDd03l) {
    const nombre = (fila.FIELDNAME ?? '').toUpperCase();
    if (PREFIJOS_GRUPO.some((p) => nombre.startsWith(p))) {
      actual = (fila.PRECFIELD ?? '').trim() || undefined;
    } else if (actual) {
      includes.set(nombre, actual);
    }
  }
  return includes;
}

function exigirNombre(nombre: string): string {
  if (!nombreValido(nombre)) {
    throw new Error('nombre no válido');
  }
  return nombre.toUpperCase();
}

/** Columnas en el orden de los metadatos de la respuesta; sin metadatos, las pedidas. */
function columnasDe(xml: string, pedidas: string[]): string[] {
  const nombres = Array.from(xml.matchAll(NOMBRE_COLUMNA), (m) => m[1].toUpperCase()).filter((n) => n !== '');
  return nombres.length > 0 ? nombres : pedidas;
}

function datosDe(xml: string, pedidas: string[]): DatosTabla {
  const sinComentarios = xml.replace(/<!--[\s\S]*?-->/g, '');
  const columnas = columnasDe(sinComentarios, pedidas);
  const filas = analizarDataPreview(sinComentarios).map((f) => columnas.map((c) => f[c] ?? ''));
  const total = TOTAL_FILAS.exec(sinComentarios)?.[1];
  return total === undefined ? { columnas, filas } : { columnas, filas, total: Number(total) };
}

/** Completa con DD03L lo que DD03VT no trae: el include y los decimales (sin DD03L quedan sin include y en 0). */
function completarConDd03l(campos: CampoDiccionario[], filasDd03l: Record<string, string>[]): CampoDiccionario[] {
  const includes = includesPorCampo(filasDd03l);
  const decimales = decimalesPorCampo(filasDd03l);
  return campos.map((c) => {
    const nombre = c.nombre.toUpperCase();
    const include = includes.get(nombre);
    return { ...c, decimales: decimales.get(nombre) ?? 0, ...(include ? { include } : {}) };
  });
}

export class ServicioDiccionario {
  private readonly cache = new CacheTtl(() => this.ahora());
  private readonly avisadosSinConexion = new Set<string>();
  private readonly avisadosIdioma = new Set<string>();

  constructor(private readonly deps: DependenciasServicio) {}

  objeto(destino: string, nombre: string): Promise<Resuelto | undefined> {
    if (!nombreValido(nombre)) {
      return Promise.resolve(undefined);
    }
    return this.memo(destino, 'objeto', nombre.toUpperCase(), TTL_METADATOS_MS, (c) => this.buscarObjeto(c, destino, nombre.toUpperCase()));
  }

  async campo(destino: string, tabla: string, campo: string): Promise<CampoResuelto | undefined> {
    const resuelto = await this.objeto(destino, tabla);
    const encontrado = resuelto?.campos?.find((c) => c.nombre.toUpperCase() === campo.toUpperCase());
    if (!encontrado) {
      return undefined;
    }
    const elemento = encontrado.elementoDatos ? await this.sinFallo(this.elementoDatos(destino, encontrado.elementoDatos)) : undefined;
    const dominio = elemento?.dominio ? await this.sinFallo(this.dominio(destino, elemento.dominio)) : undefined;
    return {
      campo: encontrado,
      ...(elemento ? { elemento } : {}),
      ...(dominio ? { dominio } : {}),
    };
  }

  elementoDatos(destino: string, nombre: string): Promise<ElementoDatos | undefined> {
    if (!nombreValido(nombre)) {
      return Promise.resolve(undefined);
    }
    return this.memo(destino, 'elementoDatos', nombre.toUpperCase(), TTL_METADATOS_MS, (c) => this.registrandoError('elementoDatos', async () => {
      const xml = await this.leerMetadatos(c, 'elementoDatos', nombre);
      return this.registrarResultado('elementoDatos', xml === undefined ? undefined : analizarElementoDatos(xml), xml);
    }));
  }

  dominio(destino: string, nombre: string): Promise<Dominio | undefined> {
    if (!nombreValido(nombre)) {
      return Promise.resolve(undefined);
    }
    return this.memo(destino, 'dominio', nombre.toUpperCase(), TTL_METADATOS_MS, (c) => this.registrandoError('dominio', async () => {
      const xml = await this.leerMetadatos(c, 'dominio', nombre);
      const dominio = xml === undefined ? undefined : analizarDominio(xml);
      if (dominio && dominio.valores.length === 0) {
        dominio.valores = await this.valoresDominio(c, destino, dominio.nombre);
      }
      return this.registrarResultado('dominio', dominio, xml);
    }));
  }

  mensaje(destino: string, clase: string, numero: string): Promise<Mensaje | undefined> {
    if (!nombreValido(clase) || !PATRON_NUMERO.test(numero)) {
      return Promise.resolve(undefined);
    }
    const numeroCompleto = numero.padStart(3, '0');
    const claseMayus = clase.toUpperCase();
    return this.memo(destino, 'mensaje', `${claseMayus} ${numeroCompleto}`, TTL_MENSAJES_MS, (c) => this.registrandoError('mensaje', async () => {
      const idiomas = this.idiomas(destino);
      const filas = await this.consultar(c, consultaMensaje(claseMayus, numeroCompleto, idiomas), FILAS_MENSAJE);
      const mensaje = mensajeDe(filas, idiomas);
      this.registrar(`Diccionario: mensaje → ${mensaje ? 'ok' : '404'}`);
      return mensaje;
    }));
  }

  /**
   * Las primeras `filas` filas de `tabla` con `campos`. Sin caché: los datos nunca se guardan ni se registran.
   * Solo tablas: Data Preview no admite estructuras (verificado 2026-10-31). NO VERIFICADO: si admite OFFSET.
   */
  async datos(destino: string, tabla: string, campos: string[], filas: number): Promise<DatosTabla> {
    try {
      const nombreTabla = exigirNombre(tabla);
      const columnas = campos.map(exigirNombre);
      if (columnas.length === 0) {
        throw new Error('sin campos');
      }
      const conexion = await this.deps.conexion(destino);
      if (!conexion) {
        this.avisarSinConexion(destino);
        throw new Error('sin conexión RFC');
      }
      const sql = `SELECT ${columnas.join(', ')} FROM ${nombreTabla}`;
      const respuesta = await conexion.post(
        RUTA_DATA_PREVIEW, partirSqlEnLineas(sql), 'text/plain', ACCEPT_DATA_PREVIEW, undefined, { rowNumber: String(filas) }, TIEMPO_DATOS_MS,
      );
      const datos = datosDe(respuesta.cuerpo, columnas);
      const de = datos.total === undefined ? '' : ` de ${datos.total}`;
      this.registrar(`Diccionario: datos → ok (${datos.filas.length} filas${de})`);
      return datos;
    } catch (error) {
      this.registrar(`Diccionario: datos → error ${nombreDeError(error)}`);
      throw error;
    }
  }

  /**
   * Dónde se usa el objeto de `uriAdt`, acotado a los propios según `prefijos`. La caché guarda la lista
   * completa y el filtro se aplica al leer: añadir un prefijo no repite la petición (puede tardar un minuto).
   */
  async usos(destino: string, uriAdt: string, prefijos: string[], signal?: AbortSignal): Promise<UsosConsultados> {
    const inicio = this.ahora();
    try {
      if (!uriAdt.startsWith(PREFIJO_URI_ADT)) {
        throw new Error('uri no válida');
      }
      const resultado = await this.memo<ResultadoUsos>(destino, 'usos', uriAdt, TTL_METADATOS_MS, async (c) => {
        const respuesta = await c.post(
          RUTA_USOS, cuerpoUsos(), CONTENT_TYPE_USOS, ACCEPT_USOS, signal, { uri: uriAdt }, TIEMPO_USOS_MS,
        );
        return analizarUsos(respuesta.cuerpo);
      });
      if (resultado === undefined) {
        throw new Error('sin conexión RFC');
      }
      const filtrado = filtrarUsos(resultado, prefijos);
      this.registrar(`Diccionario: usos → total ${filtrado.total}, propios ${filtrado.propios.length} (${this.ahora() - inicio} ms)`);
      return { ...filtrado, completo: resultado };
    } catch (error) {
      this.registrar(`Diccionario: usos → error ${nombreDeError(error)}`);
      throw error;
    }
  }

  vaciar(destino?: string): void {
    if (destino === undefined) {
      this.cache.vaciar();
      this.avisadosSinConexion.clear();
      return;
    }
    this.cache.vaciar(`${destino}|`);
    this.avisadosSinConexion.delete(destino);
  }

  private async memo<T>(
    destino: string, clase: string, nombre: string, ttl: number, calcular: (c: ConexionAdt) => Promise<T | undefined>,
  ): Promise<T | undefined> {
    try {
      return await this.cache.obtener(`${destino}|${clase}|${nombre}`, ttl, async () => {
        const conexion = await this.deps.conexion(destino);
        if (!conexion) {
          throw new SinConexion();
        }
        return calcular(conexion);
      });
    } catch (error) {
      if (error instanceof SinConexion) {
        this.avisarSinConexion(destino);
        return undefined;
      }
      throw error;
    }
  }

  private avisarSinConexion(destino: string): void {
    if (!this.avisadosSinConexion.has(destino)) {
      this.avisadosSinConexion.add(destino);
      this.registrar('Diccionario: sin conexión RFC');
    }
  }

  private async buscarObjeto(c: ConexionAdt, destino: string, nombre: string): Promise<Resuelto | undefined> {
    for (const tipo of ORDEN_BUSQUEDA) {
      let xml: string | undefined;
      try {
        xml = await this.leerMetadatos(c, tipo, nombre);
      } catch (error) {
        this.registrar(`Diccionario: objeto → error ${nombreDeError(error)}`);
        throw error;
      }
      if (xml === undefined) {
        continue;
      }
      const objeto = analizarMetadatosDdic(xml);
      if (!objeto) {
        this.registrar('Diccionario: objeto → error formato');
        return undefined;
      }
      if (objeto.tipo !== 'tabla' && objeto.tipo !== 'estructura') {
        this.registrar(`Diccionario: ${objeto.tipo} → ok`);
        return { objeto };
      }
      const campos = await this.leerCampos(c, destino, objeto);
      this.registrar(`Diccionario: ${objeto.tipo} → ok (${campos.length} campos)`);
      return { objeto, campos };
    }
    this.registrar('Diccionario: objeto → 404');
    return undefined;
  }

  /** `undefined` si el servidor responde 404; cualquier otro fallo rechaza. */
  private async leerMetadatos(c: ConexionAdt, tipo: TipoDiccionario, nombre: string): Promise<string | undefined> {
    const ruta = `${RUTAS_DDIC[tipo]}/${segmentoUri(nombre)}`;
    try {
      return (await c.get(ruta, undefined, ACCEPT_DDIC[tipo], undefined, TIEMPO_HOVER_MS)).cuerpo;
    } catch (error) {
      if (esNoEncontrado(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async leerCampos(c: ConexionAdt, destino: string, objeto: ObjetoDiccionario): Promise<CampoDiccionario[]> {
    const idiomas = this.idiomas(destino);
    const [filasVt, filasL] = await Promise.all([
      this.consultar(c, consultaCampos(objeto.nombre, idiomas), FILAS_CAMPOS).catch((error: unknown) => {
        this.registrar(`Diccionario: ${objeto.tipo} → error ${nombreDeError(error)}`);
        throw error;
      }),
      this.consultar(c, consultaCamposSinTexto(objeto.nombre), FILAS_CAMPOS).catch((error: unknown) => {
        this.registrar(`Diccionario: includes → error ${nombreDeError(error)}`);
        return [];
      }),
    ]);
    return completarConDd03l(camposDe(filasVt, idiomas), filasL);
  }

  private async valoresDominio(c: ConexionAdt, destino: string, dominio: string): Promise<Dominio['valores']> {
    try {
      const idiomas = this.idiomas(destino);
      return valoresDe(await this.consultar(c, consultaValoresDominio(dominio, idiomas), FILAS_VALORES), idiomas);
    } catch (error) {
      this.registrar(`Diccionario: valores → error ${nombreDeError(error)}`);
      return [];
    }
  }

  private async consultar(c: ConexionAdt, sql: string, filas: number): Promise<Record<string, string>[]> {
    const parametros = { rowNumber: String(filas) };
    const respuesta = await c.post(RUTA_DATA_PREVIEW, partirSqlEnLineas(sql), 'text/plain', ACCEPT_DATA_PREVIEW, undefined, parametros, TIEMPO_HOVER_MS);
    return analizarDataPreview(respuesta.cuerpo);
  }

  private registrarResultado<T>(clase: string, valor: T | undefined, xml: string | undefined): T | undefined {
    if (xml === undefined) {
      this.registrar(`Diccionario: ${clase} → 404`);
    } else if (valor === undefined) {
      this.registrar(`Diccionario: ${clase} → error formato`);
    } else {
      this.registrar(`Diccionario: ${clase} → ok`);
    }
    return valor;
  }

  private async registrandoError<T>(clase: string, calcular: () => Promise<T>): Promise<T> {
    try {
      return await calcular();
    } catch (error) {
      this.registrar(`Diccionario: ${clase} → error ${nombreDeError(error)}`);
      throw error;
    }
  }

  private async sinFallo<T>(promesa: Promise<T | undefined>): Promise<T | undefined> {
    try {
      return await promesa;
    } catch {
      return undefined;
    }
  }

  /** Un idioma que no es clave SAP nunca hace fallar la consulta: se usa solo el respaldo. */
  private idiomas(destino: string): string[] {
    const clave = claveIdiomaSap(this.deps.idiomaDe(destino));
    if (clave === undefined) {
      if (!this.avisadosIdioma.has(destino)) {
        this.avisadosIdioma.add(destino);
        this.registrar(`Diccionario: idioma no reconocido; se usa ${IDIOMA_RESPALDO}`);
      }
      return [IDIOMA_RESPALDO];
    }
    return [...new Set([clave, IDIOMA_RESPALDO])];
  }

  private ahora(): number {
    return this.deps.ahora?.() ?? Date.now();
  }

  private registrar(mensaje: string): void {
    this.deps.registrar?.(mensaje);
  }
}
