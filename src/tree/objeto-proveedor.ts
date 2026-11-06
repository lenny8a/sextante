import * as vscode from 'vscode';
import { ESQUEMA_BLOQUE, uriOrigenDe } from '../bloques/bloque-modelo';
import {
  ESQUEMA_ABAP,
  analizarNombreAff,
  analizarUriAbap,
  archivoPrincipal,
  clasificarArchivoFugr,
  rutaDeObjeto,
  tipoObjetoDe,
  type ObjetoRepotree,
  type TipoObjeto,
  type UriAbap,
} from '../bridge/adt-uri';
import { uriDeRuta, type EntradaRepotree } from '../bridge/repotree-oficial';
import { esProtegido, type RolSistema } from '../config/navegador-config';
import { log } from '../log';
import { nombreDeError } from '../util/errores';
import {
  COMANDO_ABRIR_DIARIO,
  construirArbolObjeto,
  palabraClave,
  type NodoObjeto,
  type ResumenDiario,
  type SimboloDocumento,
} from './objeto-modelo';

export interface DependenciasObjeto {
  simbolosDe(uri: vscode.Uri): Promise<SimboloDocumento[]>;
  listarCarpeta(uri: vscode.Uri): Promise<EntradaRepotree[]>;
  rolDe(destino: string): RolSistema | undefined;
  /**
   * Primera palabra de cada línea pedida, leyendo el documento una sola vez; distingue INCLUDE de TABLES
   * en los `Object` de un programa.
   */
  primerasPalabras?(uri: vscode.Uri, lineas: number[]): Promise<Map<number, string>>;
  /** Versión del documento abierto en el editor; sin ella los símbolos no se guardan en caché. */
  versionDe?(uri: vscode.Uri): number | undefined;
  retardoGuardadoMs?: number;
}

export interface ObjetoAbierto {
  uri: vscode.Uri;
  analisis: UriAbap;
  objeto: ObjetoRepotree;
  tipo: TipoObjeto;
  nombre: string;
  archivos: string[];
  protegido: boolean;
  rol?: RolSistema;
}

interface IncludeCargado {
  ruta: string;
  simbolos: SimboloDocumento[];
  /** Versión del documento de la que salen estos símbolos; `SIN_VERSION` si no son fiables (fallo, vacíos). */
  version: number;
}

interface EstadoObjeto {
  abierto: ObjetoAbierto;
  archivoAbierto: string | undefined;
  simbolos: SimboloDocumento[];
  /** Includes del programa abiertos en el editor, por nombre en mayúsculas; su estructura cuelga del nodo include. */
  includesAbiertos: ReadonlyMap<string, IncludeCargado>;
  /** El último include perteneciente activado: su nodo se dibuja expandido. */
  includeActivo?: string;
}

interface SimbolosEnCache {
  version: number;
  simbolos: SimboloDocumento[];
}

/** Símbolos de un archivo con lo que tardó cada parte; las medidas van al log. */
interface CargaSimbolos {
  simbolos: SimboloDocumento[];
  /** Versión del documento de la que salen; `SIN_VERSION` si el resultado no se pudo guardar en caché. */
  version: number;
  msSimbolos: number;
  msDetalle: number;
}

interface DetalleSentencias {
  simbolos: SimboloDocumento[];
  /** Falso si no se pudo leer la sentencia: el resultado no se guarda en caché. */
  completo: boolean;
}

interface IncludePendiente {
  nombre: string;
  uri: vscode.Uri;
}

interface GuardadoPendiente {
  principal: boolean;
  includes: Set<string>;
}

const COMANDO_IR = 'abapNavigator.objeto.ir';
const RETARDO_GUARDADO_MS = 500;
const SIN_VERSION = -1;
const sinSimbolos = (): CargaSimbolos => ({ simbolos: [], version: SIN_VERSION, msSimbolos: 0, msDetalle: 0 });
/** Tipos cuyos `Object` de primer nivel pueden ser sentencias INCLUDE. */
const TIPOS_CON_INCLUDES: readonly TipoObjeto[] = ['programa', 'include', 'grupoFunciones'];
/** Tipos cuyos includes viven en su propia carpeta `Includes` y se muestran dentro del objeto. */
const TIPOS_CON_INCLUDES_PROPIOS: readonly TipoObjeto[] = ['programa', 'include'];
const CARPETA_INCLUDES = 'Includes';

export class ProveedorObjeto implements vscode.TreeDataProvider<NodoObjeto>, vscode.Disposable {
  private resumenDiario: ResumenDiario | undefined;
  private readonly emisor = new vscode.EventEmitter<void>();
  private readonly emisorObjeto = new vscode.EventEmitter<ObjetoAbierto | undefined>();
  readonly onDidChangeTreeData: vscode.Event<void> = this.emisor.event;
  readonly onDidChangeObjeto: vscode.Event<ObjetoAbierto | undefined> = this.emisorObjeto.event;
  private estado: EstadoObjeto | undefined;
  private raiz: NodoObjeto | undefined;
  private padres = new Map<NodoObjeto, NodoObjeto>();
  private ids = new Map<NodoObjeto, string>();
  private fijadoActual = false;
  private generacion = 0;
  /** URI cuya carga (mostrar o cambio de archivo) aún no se ha aplicado; refrescar la retoma en vez de pisarla. */
  private enCurso: vscode.Uri | undefined;
  /** Include perteneciente cuya carga aún no se ha aplicado; refrescar lo incluye en vez de perderlo. */
  private includeEnCurso: IncludePendiente | undefined;
  private temporizadorGuardado: NodeJS.Timeout | undefined;
  private guardadoPendiente: GuardadoPendiente | undefined;
  /** Símbolos por `uri.toString()` del objeto mostrado; valen mientras el documento siga en la misma versión. */
  private readonly cacheSimbolos = new Map<string, SimbolosEnCache>();

  constructor(private readonly deps: DependenciasObjeto) {
    this.publicarContexto();
  }

  get objeto(): ObjetoAbierto | undefined {
    return this.estado?.abierto;
  }

  /** El uri (archivo `abap:` o editor de bloque) es del objeto mostrado o de uno de sus includes. */
  pertenece(uri: vscode.Uri): boolean {
    const actual = this.estado;
    const origen = uriAbapDe(uri);
    const analisis = origen === undefined ? undefined : analizarUriAbap(origen);
    const objeto = analisis?.objeto;
    if (actual === undefined || analisis === undefined || objeto === undefined) {
      return false;
    }
    return (
      mismoObjeto(actual.abierto, analisis.destino, objeto) || this.esIncludePerteneciente(actual, analisis.destino, objeto)
    );
  }

  get fijado(): boolean {
    return this.fijadoActual;
  }

  fijar(valor: boolean): void {
    this.fijadoActual = valor;
    void vscode.commands.executeCommand('setContext', 'abapNavigator.objetoFijado', valor);
  }

  async mostrar(uri: vscode.Uri): Promise<void> {
    const analisis = analizarUriAbap(uri);
    const objeto = analisis?.objeto;
    if (analisis === undefined || objeto === undefined) {
      return;
    }
    const inicio = Date.now();
    if (this.estado === undefined || !mismoObjeto(this.estado.abierto, analisis.destino, objeto)) {
      this.cacheSimbolos.clear();
    }
    const generacion = ++this.generacion;
    this.enCurso = uri;
    this.includeEnCurso = undefined;
    const archivos = await this.listarArchivos(analisis.destino, objeto);
    const msListado = Date.now() - inicio;
    const archivoPedido = analisis.archivo ?? archivoPrincipal(archivos);
    const aff = archivoPedido === undefined ? undefined : analizarNombreAff(archivoPedido);
    const tipo = tipoObjetoDe(objeto.tipoCarpeta, aff?.tipo);
    const archivoAbierto = archivoDeEstructura(tipo, archivos, archivoPedido);
    const uriArchivo =
      archivoAbierto === undefined || archivoAbierto === analisis.archivo
        ? uri
        : uriDeRuta(rutaDeObjeto(analisis.destino, objeto, archivoAbierto));
    const carga = archivoAbierto === undefined ? sinSimbolos() : await this.pedirSimbolos(uriArchivo, tipo);
    if (generacion !== this.generacion) {
      return;
    }
    this.enCurso = undefined;
    const { simbolos } = carga;
    const rol = this.deps.rolDe(analisis.destino);
    this.estado = {
      abierto: {
        uri: uriArchivo,
        analisis,
        objeto,
        tipo,
        nombre: aff?.nombre ?? objeto.nombre.toLowerCase(),
        archivos,
        protegido: esProtegido(rol),
        rol,
      },
      archivoAbierto,
      simbolos,
      includesAbiertos: new Map(),
    };
    log.info(`Objeto: ${tipo} con ${archivos.length} archivos y ${simbolos.length} símbolos de primer nivel`);
    log.info(
      `Objeto: objeto mostrado en ${Date.now() - inicio} ms ` +
        `(listado ${msListado}, símbolos ${carga.msSimbolos}, detalle ${carga.msDetalle})`,
    );
    this.reconstruir();
  }

  async alCambiarEditor(uri: vscode.Uri | undefined): Promise<void> {
    if (this.fijadoActual || uri === undefined) {
      return;
    }
    if (uri.scheme === ESQUEMA_BLOQUE) {
      await this.alCambiarABloque(uri);
      return;
    }
    const analisis = analizarUriAbap(uri);
    const objeto = analisis?.objeto;
    if (analisis === undefined || objeto === undefined) {
      return;
    }
    const actual = this.estado;
    if (actual !== undefined && this.esIncludePerteneciente(actual, analisis.destino, objeto)) {
      if (analisis.archivo === undefined) {
        this.descartarCargaEnCurso();
        return;
      }
      const nombre = objeto.nombre.toUpperCase();
      if (this.includeYaCargado(actual, uri, nombre)) {
        this.reactivarInclude(actual, nombre);
        return;
      }
      await this.activarInclude(actual, uri, nombre);
      return;
    }
    if (actual === undefined || !mismoObjeto(actual.abierto, analisis.destino, objeto)) {
      await this.mostrar(uri);
      return;
    }
    if (analisis.archivo === undefined) {
      return;
    }
    const { tipo, archivos } = actual.abierto;
    if (archivoDeEstructura(tipo, archivos, analisis.archivo) !== analisis.archivo) {
      this.descartarCargaEnCurso();
      return;
    }
    const inicio = Date.now();
    const generacion = ++this.generacion;
    this.enCurso = uri;
    this.includeEnCurso = undefined;
    const carga = await this.pedirSimbolos(uri, tipo);
    if (generacion !== this.generacion || this.estado !== actual) {
      return;
    }
    this.enCurso = undefined;
    this.estado = {
      ...actual,
      abierto: { ...actual.abierto, uri, analisis },
      archivoAbierto: analisis.archivo,
      simbolos: carga.simbolos,
    };
    log.info(medidaDeActivacion(inicio, carga));
    this.reconstruir();
  }

  async refrescar(): Promise<void> {
    this.cacheSimbolos.clear();
    if (this.enCurso !== undefined) {
      await this.mostrar(this.enCurso);
      return;
    }
    const actual = this.estado;
    if (actual === undefined) {
      this.emisor.fire();
      return;
    }
    const { analisis, objeto, uri } = actual.abierto;
    const rol = this.deps.rolDe(analisis.destino);
    const pendiente = this.includeEnCurso;
    const generacion = ++this.generacion;
    const [archivos, carga, includes] = await Promise.all([
      this.listarArchivos(analisis.destino, objeto),
      actual.archivoAbierto === undefined
        ? Promise.resolve(sinSimbolos())
        : this.pedirSimbolos(uri, actual.abierto.tipo, true),
      this.recargarIncludes(actual, [...actual.includesAbiertos.keys()], pendiente),
    ]);
    if (generacion !== this.generacion || this.estado !== actual) {
      return;
    }
    this.estado = {
      ...this.conIncludes(actual, includes, pendiente),
      abierto: { ...actual.abierto, archivos, protegido: esProtegido(rol), rol },
      simbolos: carga.simbolos,
    };
    this.reconstruir();
  }

  /**
   * Al guardar un archivo del objeto mostrado vuelve a pedir su estructura, agrupando guardados seguidos.
   * Guardar un editor de bloque equivale a guardar su archivo origen.
   */
  alGuardar(guardado: vscode.Uri): void {
    const uri = uriAbapDe(guardado);
    if (uri === undefined) {
      return;
    }
    const actual = this.estado?.abierto;
    const analisis = analizarUriAbap(uri);
    const objeto = analisis?.objeto;
    if (actual === undefined || analisis === undefined || objeto === undefined) {
      return;
    }
    const include = this.includeAbiertoEn(uri);
    if (include === undefined && !mismoObjeto(actual, analisis.destino, objeto)) {
      return;
    }
    const pendiente = this.guardadoPendiente ?? { principal: false, includes: new Set<string>() };
    if (include === undefined) {
      pendiente.principal = true;
    } else {
      pendiente.includes.add(include);
    }
    this.guardadoPendiente = pendiente;
    clearTimeout(this.temporizadorGuardado);
    this.temporizadorGuardado = setTimeout(() => {
      this.temporizadorGuardado = undefined;
      this.guardadoPendiente = undefined;
      log.info(pendiente.principal ? 'Objeto: refresco tras guardar' : 'Objeto: refresco de include tras guardar');
      const tarea = pendiente.principal ? this.refrescar() : this.refrescarIncludes([...pendiente.includes]);
      tarea.catch((err: unknown) => {
        log.error(`Refrescar tras guardar falló (${nombreDeError(err)})`);
      });
    }, this.deps.retardoGuardadoMs ?? RETARDO_GUARDADO_MS);
  }

  uriDeNodo(nodo: NodoObjeto): vscode.Uri | undefined {
    if (nodo.ruta !== undefined) {
      return uriDeRuta(nodo.ruta);
    }
    const abierto = this.estado?.abierto;
    if (abierto === undefined || nodo.archivo === undefined || nodo.archivo === '') {
      return undefined;
    }
    return uriDeRuta(rutaDeObjeto(abierto.analisis.destino, abierto.objeto, nodo.archivo));
  }

  /**
   * Dónde buscar el include de una sentencia INCLUDE: en un grupo de funciones, su propio archivo
   * `.reps.abap`; si no, la carpeta `Includes` del mismo paquete y categoría que el objeto.
   */
  // NO VERIFICADO: que los includes de un programa estén en `Includes/<INCLUDE>/<include>.prog.abap` de su
  // mismo paquete y categoría, y que el `.reps.abap` propio de un grupo de funciones se abra con la oficial.
  uriDeInclude(nombreInclude: string): vscode.Uri | undefined {
    const abierto = this.estado?.abierto;
    if (abierto === undefined) {
      return undefined;
    }
    const { destino } = abierto.analisis;
    const nombre = nombreInclude.toUpperCase();
    if (abierto.tipo === 'grupoFunciones') {
      const propio = abierto.archivos.find((archivo) => {
        const clasificado = clasificarArchivoFugr(archivo);
        return (clasificado?.clase === 'include' || clasificado?.clase === 'principal') && clasificado.nombre === nombre;
      });
      if (propio !== undefined) {
        return uriDeRuta(rutaDeObjeto(destino, abierto.objeto, propio));
      }
    }
    const carpeta = { ...abierto.objeto, tipoCarpeta: 'Includes', nombre: nombreInclude };
    return uriDeRuta(rutaDeObjeto(destino, carpeta, `${nombreInclude.toLowerCase()}.prog.abap`));
  }

  getTreeItem(nodo: NodoObjeto): vscode.TreeItem {
    const item = new vscode.TreeItem(nodo.etiqueta, this.estadoColapso(nodo));
    item.id = this.ids.get(nodo);
    item.description = nodo.descripcion;
    item.iconPath = new vscode.ThemeIcon(nodo.icono);
    item.contextValue = nodo.clase;
    if (nodo.clase === 'raiz' && this.estado !== undefined) {
      const { analisis, objeto } = this.estado.abierto;
      item.tooltip = `${objeto.paquete} · ${objeto.tipoCarpeta} · ${analisis.destino}`;
      item.description = `${nodo.descripcion} · ${analisis.destino}`;
    }
    if (nodo.clase === 'raiz' || nodo.clase === 'simbolo' || nodo.clase === 'archivo' || nodo.clase === 'include') {
      item.command = { command: COMANDO_IR, title: nodo.clase === 'raiz' ? 'Abrir' : 'Ir', arguments: [nodo] };
    }
    if (nodo.clase === 'diario') {
      item.command = { command: COMANDO_ABRIR_DIARIO, title: 'Abrir diario' };
    }
    return item;
  }

  fijarDiario(resumen: ResumenDiario | undefined): void {
    this.resumenDiario = resumen;
    if (this.estado !== undefined) {
      this.reconstruirArbol();
    }
  }

  async getChildren(nodo?: NodoObjeto): Promise<NodoObjeto[]> {
    if (nodo !== undefined) {
      return nodo.hijos;
    }
    return this.raiz === undefined ? [] : [this.raiz];
  }

  getParent(nodo: NodoObjeto): NodoObjeto | undefined {
    return this.padres.get(nodo);
  }

  dispose(): void {
    clearTimeout(this.temporizadorGuardado);
    this.emisor.dispose();
    this.emisorObjeto.dispose();
  }

  private estadoColapso(nodo: NodoObjeto): vscode.TreeItemCollapsibleState {
    if (nodo.hijos.length === 0) {
      return vscode.TreeItemCollapsibleState.None;
    }
    const esSeccionPrincipal = nodo.clase === 'seccion' && this.padres.get(nodo)?.clase === 'raiz';
    const esIncludeActivo =
      nodo.clase === 'include' && nodo.nombreInclude?.toUpperCase() === this.estado?.includeActivo;
    return nodo.clase === 'raiz' || esSeccionPrincipal || esIncludeActivo
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
  }

  /**
   * Un editor de bloque cuenta como su archivo origen: si es del objeto mostrado (o de un include suyo) el árbol
   * sigue igual, sin pedir símbolos; si es de otro objeto, se muestra ese origen.
   */
  private async alCambiarABloque(uri: vscode.Uri): Promise<void> {
    const origen = uriAbapDe(uri);
    const analisis = origen === undefined ? undefined : analizarUriAbap(origen);
    const objeto = analisis?.objeto;
    if (origen === undefined || analisis === undefined || objeto === undefined) {
      return;
    }
    if (this.pertenece(origen)) {
      this.descartarCargaEnCurso();
      return;
    }
    await this.mostrar(origen);
  }

  /** El editor volvió al objeto mostrado: la carga pendiente de otro archivo u objeto ya no aplica. */
  private descartarCargaEnCurso(): void {
    if (this.enCurso !== undefined || this.includeEnCurso !== undefined) {
      this.generacion++;
      this.enCurso = undefined;
      this.includeEnCurso = undefined;
    }
  }

  /** Un include de la sección Includes del programa mostrado (en cualquier nivel) es parte del objeto, no otro objeto. */
  private esIncludePerteneciente(actual: EstadoObjeto, destino: string, objeto: ObjetoRepotree): boolean {
    if (!TIPOS_CON_INCLUDES_PROPIOS.includes(actual.abierto.tipo) || objeto.tipoCarpeta !== CARPETA_INCLUDES) {
      return false;
    }
    if (destino !== actual.abierto.analisis.destino || mismoObjeto(actual.abierto, destino, objeto)) {
      return false;
    }
    return this.raiz !== undefined && nombresDeIncludes(this.raiz).has(objeto.nombre.toUpperCase());
  }

  /**
   * El include ya está colgado del árbol con la misma ruta y los símbolos que se ven salen de la versión actual
   * del documento. Se compara con la versión de lo mostrado, no con la caché: una activación descartada pudo
   * guardar en caché otra versión sin llegar a mostrarla.
   */
  private includeYaCargado(actual: EstadoObjeto, uri: vscode.Uri, nombre: string): boolean {
    const cargado = actual.includesAbiertos.get(nombre);
    if (cargado?.ruta !== uri.path || cargado.version === SIN_VERSION) {
      return false;
    }
    return cargado.version === this.versionDe(uri);
  }

  /** Volver a un include ya cargado solo lo marca como activo, sin pedir sus símbolos otra vez. */
  private reactivarInclude(actual: EstadoObjeto, nombre: string): void {
    this.descartarCargaEnCurso();
    if (actual.includeActivo === nombre) {
      return;
    }
    this.estado = { ...actual, includeActivo: nombre };
    log.info('Objeto: include ya cargado reactivado sin pedir símbolos');
    this.reconstruir();
  }

  private async activarInclude(actual: EstadoObjeto, uri: vscode.Uri, nombre: string): Promise<void> {
    const inicio = Date.now();
    const generacion = ++this.generacion;
    this.enCurso = undefined;
    const pendiente: IncludePendiente = { nombre, uri };
    this.includeEnCurso = pendiente;
    const carga = await this.pedirSimbolos(uri, 'include');
    if (generacion !== this.generacion || this.estado !== actual) {
      return;
    }
    const { simbolos, version } = carga;
    this.estado = this.conIncludes(actual, new Map([[nombre, { ruta: uri.path, simbolos, version }]]), pendiente);
    log.info(`Objeto: include perteneciente activado, ${simbolos.length} símbolos`);
    log.info(medidaDeActivacion(inicio, carga));
    this.reconstruir();
  }

  private async refrescarIncludes(nombres: string[]): Promise<void> {
    if (this.enCurso !== undefined) {
      await this.refrescar();
      return;
    }
    const actual = this.estado;
    if (actual === undefined) {
      return;
    }
    const pendiente = this.includeEnCurso;
    const generacion = ++this.generacion;
    const includes = await this.recargarIncludes(actual, nombres, pendiente);
    if (generacion !== this.generacion || this.estado !== actual) {
      return;
    }
    this.estado = this.conIncludes(actual, includes, pendiente);
    this.reconstruir();
  }

  /** Vuelve a pedir, sin caché, los símbolos de los includes abiertos indicados y del que se estaba activando. */
  private async recargarIncludes(
    actual: EstadoObjeto,
    nombres: string[],
    pendiente: IncludePendiente | undefined,
  ): Promise<Map<string, IncludeCargado>> {
    const rutas = new Map<string, string>();
    for (const nombre of nombres) {
      const ruta = actual.includesAbiertos.get(nombre)?.ruta;
      if (ruta !== undefined) {
        rutas.set(nombre, ruta);
      }
    }
    if (pendiente !== undefined) {
      rutas.set(pendiente.nombre, pendiente.uri.path);
    }
    const cargados = await Promise.all(
      [...rutas].map(async ([nombre, ruta]): Promise<[string, IncludeCargado]> => {
        const { simbolos, version } = await this.pedirSimbolos(uriDeRuta(ruta), 'include', true);
        return [nombre, { ruta, simbolos, version }];
      }),
    );
    return new Map(cargados);
  }

  /** Estado con los includes recién cargados; si entre ellos está el que se activaba, pasa a ser el activo. */
  private conIncludes(
    actual: EstadoObjeto,
    cargados: ReadonlyMap<string, IncludeCargado>,
    pendiente: IncludePendiente | undefined,
  ): EstadoObjeto {
    const includesAbiertos = new Map([...actual.includesAbiertos, ...cargados]);
    if (pendiente === undefined || this.includeEnCurso !== pendiente) {
      return { ...actual, includesAbiertos };
    }
    this.includeEnCurso = undefined;
    return { ...actual, includesAbiertos, includeActivo: pendiente.nombre };
  }

  private includeAbiertoEn(uri: vscode.Uri): string | undefined {
    for (const [nombre, include] of this.estado?.includesAbiertos ?? []) {
      if (include.ruta === uri.path) {
        return nombre;
      }
    }
    return undefined;
  }

  private async listarArchivos(destino: string, objeto: ObjetoRepotree): Promise<string[]> {
    try {
      const entradas = await this.deps.listarCarpeta(uriDeRuta(rutaDeObjeto(destino, objeto)));
      return entradas.filter((e) => !e.esCarpeta).map((e) => e.nombre);
    } catch (err) {
      log.warn(`Objeto: no se pudo listar la carpeta del objeto (${nombreDeError(err)})`);
      return [];
    }
  }

  private versionDe(uri: vscode.Uri): number {
    return this.deps.versionDe?.(uri) ?? SIN_VERSION;
  }

  /**
   * Símbolos de un archivo; si el documento sigue en la versión de la última petición salen de la caché.
   * `forzar` (refrescar, guardar) ignora la caché. No se guardan fallos, detalles incompletos ni listas vacías:
   * una lista vacía puede ser el servidor de lenguaje aún cargando, así que un include sin símbolos se vuelve a
   * pedir siempre (hueco conocido). La `version` devuelta es `SIN_VERSION` cuando el resultado no se guardó.
   */
  private async pedirSimbolos(uri: vscode.Uri, tipo: TipoObjeto, forzar = false): Promise<CargaSimbolos> {
    const clave = uri.toString();
    const version = this.versionDe(uri);
    const guardado = this.cacheSimbolos.get(clave);
    if (!forzar && version !== SIN_VERSION && guardado?.version === version) {
      return { simbolos: guardado.simbolos, version, msSimbolos: 0, msDetalle: 0 };
    }
    this.cacheSimbolos.delete(clave);
    const inicio = Date.now();
    let crudos: SimboloDocumento[];
    try {
      crudos = await this.deps.simbolosDe(uri);
    } catch (err) {
      log.warn(`Objeto: no se pudieron pedir los símbolos (${nombreDeError(err)})`);
      return { ...sinSimbolos(), msSimbolos: Date.now() - inicio };
    }
    const msSimbolos = Date.now() - inicio;
    const detalle = TIPOS_CON_INCLUDES.includes(tipo)
      ? await this.conDetalleDeSentencia(uri, crudos)
      : { simbolos: crudos, completo: true };
    const msDetalle = Date.now() - inicio - msSimbolos;
    const fiable = version !== SIN_VERSION && detalle.completo && detalle.simbolos.length > 0;
    if (fiable) {
      this.cacheSimbolos.set(clave, { version, simbolos: detalle.simbolos });
    }
    return { simbolos: detalle.simbolos, version: fiable ? version : SIN_VERSION, msSimbolos, msDetalle };
  }

  /**
   * Copia los símbolos poniendo en `detalle` la sentencia (INCLUDE, TABLES…) de cada `Object` que no la trae;
   * lee todas las líneas en una sola petición por documento.
   */
  private async conDetalleDeSentencia(uri: vscode.Uri, simbolos: SimboloDocumento[]): Promise<DetalleSentencias> {
    const primerasPalabras = this.deps.primerasPalabras;
    const pendientes = new Set(simbolos.filter((s) => s.nombreKind === 'Object' && s.detalle === undefined));
    if (primerasPalabras === undefined || pendientes.size === 0) {
      return { simbolos, completo: true };
    }
    let palabras: Map<number, string>;
    try {
      palabras = await primerasPalabras(uri, [...new Set([...pendientes].map((s) => s.rango[0]))]);
    } catch {
      log.warn(`Objeto: no se pudo leer la sentencia de ${pendientes.size} símbolos`);
      return { simbolos, completo: false };
    }
    const resultado = simbolos.map((simbolo) => {
      if (!pendientes.has(simbolo)) {
        return simbolo;
      }
      const palabra = palabras.get(simbolo.rango[0]);
      const clave = palabra === undefined ? '' : palabraClave(palabra);
      return clave === '' ? simbolo : { ...simbolo, detalle: clave };
    });
    return { simbolos: resultado, completo: true };
  }

  private reconstruir(): void {
    this.resumenDiario = undefined;
    this.reconstruirArbol();
    this.emisorObjeto.fire(this.estado?.abierto);
    this.publicarContexto();
  }

  private reconstruirArbol(): void {
    const estado = this.estado;
    this.padres = new Map();
    this.ids = new Map();
    this.raiz =
      estado === undefined
        ? undefined
        : construirArbolObjeto({
            tipo: estado.abierto.tipo,
            nombre: estado.abierto.nombre,
            archivoAbierto: estado.archivoAbierto ?? '',
            archivos: estado.abierto.archivos,
            simbolos: estado.simbolos,
            includesAbiertos: [...estado.includesAbiertos].map(([nombre, { ruta, simbolos }]) => ({
              nombre,
              ruta,
              simbolos,
            })),
            diario: this.resumenDiario,
          });
    if (this.raiz !== undefined) {
      this.indexar(this.raiz, new Set());
    }
    this.emisor.fire();
  }

  /** Ids únicos para el TreeView aunque el modelo repita alguno (símbolos homónimos en el mismo rango). */
  private indexar(nodo: NodoObjeto, usados: Set<string>): void {
    let id = nodo.id;
    for (let n = 2; usados.has(id); n++) {
      id = `${nodo.id}~${n}`;
    }
    usados.add(id);
    this.ids.set(nodo, id);
    for (const hijo of nodo.hijos) {
      this.padres.set(hijo, nodo);
      this.indexar(hijo, usados);
    }
  }

  private publicarContexto(): void {
    const abierto = this.estado?.abierto;
    void vscode.commands.executeCommand('setContext', 'abapNavigator.objetoAbierto', abierto !== undefined);
    void vscode.commands.executeCommand('setContext', 'abapNavigator.objetoProtegido', abierto?.protegido ?? false);
    void vscode.commands.executeCommand('setContext', 'abapNavigator.objetoFijado', this.fijadoActual);
    void vscode.commands.executeCommand('setContext', 'abapNavigator.objetoTipo', abierto?.tipo ?? '');
  }
}

/**
 * Archivo cuyos símbolos dan la estructura del árbol. En clases e interfaces es siempre el principal:
 * los includes locales y el .json describen otra cosa y desordenarían Definición/Implementación.
 * En un grupo de funciones es el fuente abierto (módulo o include); sus `.json` usan el principal.
 */
function archivoDeEstructura(tipo: TipoObjeto, archivos: string[], archivoPedido: string | undefined): string | undefined {
  if (tipo === 'grupoFunciones') {
    const esFuente = archivoPedido !== undefined && clasificarArchivoFugr(archivoPedido) !== undefined;
    return esFuente ? archivoPedido : (archivoPrincipal(archivos) ?? archivoPedido);
  }
  if (tipo !== 'clase' && tipo !== 'interfaz') {
    return archivoPedido;
  }
  return archivoPrincipal(archivos) ?? archivoPedido;
}

function medidaDeActivacion(inicio: number, carga: CargaSimbolos): string {
  return (
    `Objeto: include activado en ${Date.now() - inicio} ms ` +
    `(símbolos ${carga.msSimbolos} ms, detalle ${carga.msDetalle} ms)`
  );
}

function nombresDeIncludes(nodo: NodoObjeto, nombres = new Set<string>()): Set<string> {
  if (nodo.clase === 'include' && nodo.nombreInclude !== undefined) {
    nombres.add(nodo.nombreInclude.toUpperCase());
  }
  for (const hijo of nodo.hijos) {
    nombresDeIncludes(hijo, nombres);
  }
  return nombres;
}

/** El archivo `abap:` de un uri: el propio, o el origen si es un editor de bloque. */
function uriAbapDe(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme !== ESQUEMA_BLOQUE) {
    return uri;
  }
  const origen = uriOrigenDe(uri);
  return origen.scheme === ESQUEMA_ABAP ? uriDeRuta(origen.path) : undefined;
}

function mismoObjeto(abierto: ObjetoAbierto, destino: string, objeto: ObjetoRepotree): boolean {
  return rutaDeObjeto(abierto.analisis.destino, abierto.objeto) === rutaDeObjeto(destino, objeto);
}
