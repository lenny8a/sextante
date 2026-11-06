import { type ConexionAdt } from '../adt/conexion-adt';
import { partirSqlEnLineas } from '../adt/sql-lineas';
import { ACCEPT_DATA_PREVIEW, RUTA_DATA_PREVIEW, analizarDataPreview } from '../adt/transaccion';
import { claveIdiomaSap, nombreValido } from '../diccionario/modelo';
import {
  TIEMPO_HOVER_MS,
  TTL_METADATOS_MS,
  esNoEncontrado,
  nombreDeError,
  type DependenciasServicio,
} from '../diccionario/servicio';
import { CacheTtl } from '../util/cache-ttl';
import {
  claseResumenDe,
  consultaCabeceraMetodo,
  consultaComponentes,
  consultaGrupoFuncion,
  consultaMetodosPublicos,
  consultaParametrosFuncion,
  consultaParametrosMetodo,
  consultaRelaciones,
  consultaSubcomponentes,
  consultaTextoClase,
  consultaTextosComponentes,
  consultaTextosFuncion,
  consultaTextosMetodo,
  consultaTituloFuncion,
  firmaFuncionDe,
  firmaMetodoDe,
  metodosResumenDe,
  separarMetodo,
  uriClase,
  type ClaseResumen,
  type Fila,
  type FirmaFuncion,
  type FirmaMetodo,
  type MetodoResumen,
} from './modelo';

/** Como mucho, cuántas clases de la cadena de herencia se recorren (también corta los ciclos). */
export const PROFUNDIDAD_HERENCIA = 10;

const IDIOMA_RESPALDO = 'E';
const FILAS_CONSULTA = 1_000;
const ACCEPT_CLASE = 'application/vnd.sap.adt.oo.classes.v2+xml';
// NO VERIFICADO: Accept de interfaces por analogía con el de clases; no hay respuesta real guardada de oo/interfaces.
const ACCEPT_INTERFAZ = 'application/vnd.sap.adt.oo.interfaces.v2+xml';
const ACCEPT_ESTRUCTURA = 'application/vnd.sap.adt.objectstructure.v2+xml';
const PARAMETROS_ESTRUCTURA: Readonly<Record<string, string>> = { version: 'active', withShortDescriptions: 'true' };
const RELACION_INTERFAZ = '1';
const RELACION_SUPERCLASE = '2';

/** Rechazo interno de `memo` sin conexión: así la entrada no queda en caché. */
class SinConexion extends Error {}

function superclaseDe(relaciones: Fila[]): string | undefined {
  return relaciones.find((f) => f.RELTYPE === RELACION_SUPERCLASE)?.REFCLSNAME || undefined;
}

function interfacesDe(relaciones: Fila[]): string[] {
  return relaciones.filter((f) => f.RELTYPE === RELACION_INTERFAZ).map((f) => f.REFCLSNAME ?? '').filter((n) => n !== '');
}

function conteo(firma: FirmaFuncion | FirmaMetodo): string {
  return `${firma.parametros.length} parámetros, ${firma.excepciones.length} excepciones`;
}

export class ServicioFirmas {
  private readonly cache = new CacheTtl(() => this.deps.ahora?.() ?? Date.now());
  private readonly avisadosSinConexion = new Set<string>();
  private readonly avisadosIdioma = new Set<string>();

  constructor(private readonly deps: DependenciasServicio) {}

  firmaFuncion(destino: string, nombre: string): Promise<FirmaFuncion | undefined> {
    if (!nombreValido(nombre)) {
      return Promise.resolve(undefined);
    }
    const fm = nombre.toUpperCase();
    return this.memo(destino, 'funcion', fm, (c) => this.registrandoError('funcion', async () => {
      const idiomas = this.idiomas(destino);
      const [parametros, textos, titulo, grupo] = await Promise.all([
        this.consultar(c, consultaParametrosFuncion(fm)),
        this.opcional('textos', this.consultar(c, consultaTextosFuncion(fm, idiomas))),
        this.opcional('titulo', this.consultar(c, consultaTituloFuncion(fm, idiomas))),
        this.consultar(c, consultaGrupoFuncion(fm)),
      ]);
      const firma = firmaFuncionDe(fm, { parametros, textos, titulo, grupo }, idiomas);
      this.registrar(`Firmas: funcion → ${firma ? `ok (${conteo(firma)})` : '404'}`);
      return firma;
    }));
  }

  /** `metodo` puede ser `zif~m`: entonces se lee en la interfaz. Con `desdeSuper` se empieza en la superclase de `objeto`. */
  firmaMetodo(destino: string, objeto: string, metodo: string, opciones: { desdeSuper?: boolean } = {}): Promise<FirmaMetodo | undefined> {
    const { interfaz, metodo: nombreMetodo } = separarMetodo(metodo);
    const clase = objeto.toUpperCase();
    if (![clase, nombreMetodo, ...(interfaz === undefined ? [] : [interfaz])].every(nombreValido)) {
      return Promise.resolve(undefined);
    }
    const desdeSuper = opciones.desdeSuper === true && interfaz === undefined;
    const clave = `${clase}|${interfaz === undefined ? '' : `${interfaz}~`}${nombreMetodo}${desdeSuper ? '|super' : ''}`;
    return this.memo(destino, 'metodo', clave, (c) => this.registrandoError('metodo', async () => {
      const idiomas = this.idiomas(destino);
      const firma = interfaz === undefined
        ? await this.resolverMetodo(c, destino, clase, nombreMetodo, desdeSuper, idiomas)
        : await this.metodoEnInterfaz(c, interfaz, nombreMetodo, idiomas);
      const marcas = `${firma?.heredadoDe ? ', heredado' : ''}${firma?.deInterfaz ? ', de interfaz' : ''}`;
      this.registrar(`Firmas: metodo → ${firma ? `ok (${conteo(firma)}${marcas})` : '404'}`);
      return firma;
    }));
  }

  clase(destino: string, nombre: string): Promise<ClaseResumen | undefined> {
    if (!nombreValido(nombre)) {
      return Promise.resolve(undefined);
    }
    const clase = nombre.toUpperCase();
    return this.memo(destino, 'clase', clase, (c) => this.registrandoError('clase', async () => {
      const metadatos = await this.leerMetadatosClase(c, clase);
      if (!metadatos) {
        this.registrar('Firmas: clase → 404');
        return undefined;
      }
      const idiomas = this.idiomas(destino);
      const [estructura, texto, relaciones] = await Promise.all([
        c.get(`${metadatos.uri}/objectstructure`, { ...PARAMETROS_ESTRUCTURA }, ACCEPT_ESTRUCTURA, undefined, TIEMPO_HOVER_MS),
        this.opcional('texto', this.consultar(c, consultaTextoClase(clase, idiomas))),
        this.relaciones(c, destino, clase),
      ]);
      const resumen = claseResumenDe(clase, metadatos.xml, estructura.cuerpo, { texto, relaciones }, idiomas);
      if (!resumen) {
        this.registrar('Firmas: clase → error formato');
        return undefined;
      }
      resumen.heredados = await this.heredados(c, destino, clase, idiomas);
      this.registrar(`Firmas: clase → ok (${resumen.metodos.length} métodos, ${resumen.heredados.length} heredados)`);
      return resumen;
    }));
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
    destino: string, tipo: string, nombre: string, calcular: (c: ConexionAdt) => Promise<T | undefined>,
  ): Promise<T | undefined> {
    try {
      return await this.cache.obtener(`${destino}|${tipo}|${nombre}`, TTL_METADATOS_MS, async () => {
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

  /** Sube por la herencia y, si el método no está en ninguna clase, lo busca en las interfaces de toda la cadena. */
  private async resolverMetodo(
    c: ConexionAdt, destino: string, objeto: string, metodo: string, desdeSuper: boolean, idiomas: string[],
  ): Promise<FirmaMetodo | undefined> {
    const inicio = desdeSuper ? superclaseDe(await this.relaciones(c, destino, objeto)) : objeto;
    const interfaces: string[] = [];
    for await (const clase of this.cadena(c, destino, inicio, interfaces)) {
      const firma = await this.leerMetodo(c, clase, metodo, idiomas);
      if (firma) {
        return clase === objeto ? firma : { ...firma, heredadoDe: clase };
      }
    }
    for (const interfaz of new Set(interfaces)) {
      const firma = await this.metodoEnInterfaz(c, interfaz, metodo, idiomas);
      if (firma) {
        return firma;
      }
    }
    return undefined;
  }

  private async metodoEnInterfaz(c: ConexionAdt, interfaz: string, metodo: string, idiomas: string[]): Promise<FirmaMetodo | undefined> {
    const firma = await this.leerMetodo(c, interfaz, metodo, idiomas);
    return firma && { ...firma, deInterfaz: interfaz, uriAdt: uriClase(interfaz, true) };
  }

  /**
   * La cabecera decide si el método está definido en `clase`; solo entonces se piden parámetros, excepciones y textos.
   * Una fila de redefinición (`REDEFIN = 'X'`) no trae la firma: se sigue subiendo por la herencia. NO VERIFICADO: si
   * SEOCOMPODF guarda esas filas en la subclase.
   */
  private async leerMetodo(c: ConexionAdt, clase: string, metodo: string, idiomas: string[]): Promise<FirmaMetodo | undefined> {
    const cabecera = await this.consultar(c, consultaCabeceraMetodo(clase, metodo));
    if (cabecera.length === 0 || cabecera[0].REDEFIN === 'X') {
      return undefined;
    }
    const [parametros, subcomponentes, textos, textosComponentes] = await Promise.all([
      this.consultar(c, consultaParametrosMetodo(clase, metodo)),
      this.consultar(c, consultaSubcomponentes(clase, metodo)),
      this.opcional('textos', this.consultar(c, consultaTextosMetodo(clase, metodo, idiomas))),
      this.opcional('textos', this.consultar(c, consultaTextosComponentes(clase, idiomas))),
    ]);
    return firmaMetodoDe(clase, metodo, { cabecera, parametros, subcomponentes, textos, textosComponentes }, idiomas);
  }

  /**
   * `inicio` y sus antecesores, sin ciclos y como mucho PROFUNDIDAD_HERENCIA clases. Las relaciones de cada clase se
   * piden al avanzar desde ella (si quien recorre se detiene, no se piden) y sus interfaces se añaden a `interfaces`.
   */
  private async *cadena(c: ConexionAdt, destino: string, inicio: string | undefined, interfaces: string[]): AsyncGenerator<string> {
    const vistas = new Set<string>();
    let actual = inicio;
    while (actual !== undefined && !vistas.has(actual) && vistas.size < PROFUNDIDAD_HERENCIA) {
      vistas.add(actual);
      yield actual;
      const relaciones = await this.relaciones(c, destino, actual);
      interfaces.push(...interfacesDe(relaciones));
      actual = superclaseDe(relaciones);
    }
  }

  private relaciones(c: ConexionAdt, destino: string, clase: string): Promise<Fila[]> {
    return this.cache.obtener(`${destino}|relaciones|${clase}`, TTL_METADATOS_MS, () => this.consultar(c, consultaRelaciones(clase)));
  }

  /** Públicos de los antecesores y de las interfaces de toda la cadena, en ese orden y con su origen. */
  private async heredados(c: ConexionAdt, destino: string, clase: string, idiomas: string[]): Promise<MetodoResumen[]> {
    const antecesores: string[] = [];
    const interfaces: string[] = [];
    for await (const eslabon of this.cadena(c, destino, clase, interfaces)) {
      if (eslabon !== clase) {
        antecesores.push(eslabon);
      }
    }
    const origenes = [...new Set([...antecesores, ...interfaces])];
    return (await Promise.all(origenes.map((o) => this.metodosPublicos(c, destino, o, idiomas)))).flat();
  }

  private metodosPublicos(c: ConexionAdt, destino: string, clase: string, idiomas: string[]): Promise<MetodoResumen[]> {
    return this.cache.obtener(`${destino}|metodos|${clase}`, TTL_METADATOS_MS, async () => {
      const [metodos, componentes, textos] = await Promise.all([
        this.consultar(c, consultaMetodosPublicos(clase)),
        this.consultar(c, consultaComponentes(clase)),
        this.opcional('textos', this.consultar(c, consultaTextosComponentes(clase, idiomas))),
      ]);
      return metodosResumenDe({ metodos, componentes, textos }, idiomas, clase);
    });
  }

  /** Primero como clase y, con 404, como interfaz; ambos 404 → `undefined`. */
  private async leerMetadatosClase(c: ConexionAdt, nombre: string): Promise<{ xml: string; uri: string } | undefined> {
    for (const esInterfaz of [false, true]) {
      const uri = uriClase(nombre, esInterfaz);
      try {
        const respuesta = await c.get(uri, undefined, esInterfaz ? ACCEPT_INTERFAZ : ACCEPT_CLASE, undefined, TIEMPO_HOVER_MS);
        return { xml: respuesta.cuerpo, uri };
      } catch (error) {
        if (!esNoEncontrado(error)) {
          throw error;
        }
      }
    }
    return undefined;
  }

  private async consultar(c: ConexionAdt, sql: string): Promise<Fila[]> {
    const parametros = { rowNumber: String(FILAS_CONSULTA) };
    const respuesta = await c.post(RUTA_DATA_PREVIEW, partirSqlEnLineas(sql), 'text/plain', ACCEPT_DATA_PREVIEW, undefined, parametros, TIEMPO_HOVER_MS);
    return analizarDataPreview(respuesta.cuerpo);
  }

  /** Para lo que no es imprescindible (textos): un fallo se registra y queda sin filas. */
  private async opcional(que: string, promesa: Promise<Fila[]>): Promise<Fila[]> {
    try {
      return await promesa;
    } catch (error) {
      this.registrar(`Firmas: ${que} → error ${nombreDeError(error)}`);
      return [];
    }
  }

  private async registrandoError<T>(que: string, calcular: () => Promise<T>): Promise<T> {
    try {
      return await calcular();
    } catch (error) {
      this.registrar(`Firmas: ${que} → error ${nombreDeError(error)}`);
      throw error;
    }
  }

  private avisarSinConexion(destino: string): void {
    if (!this.avisadosSinConexion.has(destino)) {
      this.avisadosSinConexion.add(destino);
      this.registrar('Firmas: sin conexión RFC');
    }
  }

  /** Un idioma que no es clave SAP nunca hace fallar la consulta: se usa solo el respaldo. */
  private idiomas(destino: string): string[] {
    const clave = claveIdiomaSap(this.deps.idiomaDe(destino));
    if (clave === undefined) {
      if (!this.avisadosIdioma.has(destino)) {
        this.avisadosIdioma.add(destino);
        this.registrar(`Firmas: idioma no reconocido; se usa ${IDIOMA_RESPALDO}`);
      }
      return [IDIOMA_RESPALDO];
    }
    return [...new Set([clave, IDIOMA_RESPALDO])];
  }

  private registrar(mensaje: string): void {
    this.deps.registrar?.(mensaje);
  }
}
