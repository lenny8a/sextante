import * as vscode from 'vscode';
import { analizarUriAbap } from '../bridge/adt-uri';
import { piezasDe, type PiezaFuente } from '../adt/fuente-adt';
import { formatearFechaIso, type Version } from '../adt/versiones-modelo';
import { COMANDO_FOCO_VERSIONES } from '../commands/objeto-acciones';
import { enfocarVistaOficial } from '../commands/herramientas';
import { log } from '../log';
import { uriFuente, type ProveedorFuente } from './documento-fuente';
import type { ClaveFuente } from './documento-fuente-modelo';
import type { ServicioObjeto } from './servicio';
import {
  documentoDe,
  etiquetaVersion,
  hijosDe,
  MSG_SELECCIONA_DOS,
  paresParaDiff,
  raicesDe,
  tituloDiffVersion,
  type EstadoVersiones,
  type NodoVersiones,
  type PiezaVersiones,
} from './versiones-modelo';

export const VISTA_VERSIONES = 'abapNavigator.versiones';

const COMANDO_REFRESCAR = 'abapNavigator.versiones.refrescar';
const COMANDO_COMPARAR = 'abapNavigator.versiones.compararSeleccion';
const COMANDO_LINEA_TIEMPO = 'abapNavigator.versiones.lineaDeTiempoOficial';
const COMANDO_ABRIR_DIFF = 'abapNavigator.versiones.abrirDiff';
const COMANDO_ABRIR_VERSION = 'abapNavigator.versiones.abrirVersion';
const COMANDO_COPIAR_ORDEN = 'abapNavigator.versiones.copiarOrden';

export interface DependenciasVersiones {
  editorActivo(): vscode.Uri | undefined;
  onCambioEditor: vscode.Event<vscode.Uri | undefined>;
  servicio: Pick<ServicioObjeto, 'versiones' | 'fuente'>;
  proveedorFuente: Pick<ProveedorFuente, 'invalidar'>;
  /** Sin credencial guardada se muestra el aviso "conectar" sin pedir nada. */
  credencialGuardada(destino: string): Promise<boolean>;
  /** Por qué el destino no tiene vía RFC (SSO, sin puente…), o `undefined` si la tiene. */
  motivoSinRfc(destino: string): string | undefined;
  /** Abre la sesión (pide la contraseña). */
  conectar(destino: string): Promise<void>;
  abrirDiff(izquierda: vscode.Uri, derecha: vscode.Uri, titulo: string): Promise<void>;
  mostrar(uri: vscode.Uri): Promise<void>;
  /** Selección actual de la vista. */
  seleccion(): NodoVersiones[];
  copiar(texto: string): Promise<void>;
  avisar(mensaje: string): void;
  fecha?: (iso: string) => string;
}

type Documento = NonNullable<EstadoVersiones['documento']>;

function etiquetaLog(pieza: PiezaFuente): string {
  return pieza.include === undefined ? pieza.tipo : `${pieza.tipo}/${pieza.include}`;
}

export class ProveedorVersiones implements vscode.TreeDataProvider<NodoVersiones>, vscode.Disposable {
  private readonly emisor = new vscode.EventEmitter<NodoVersiones | undefined>();
  readonly onDidChangeTreeData: vscode.Event<NodoVersiones | undefined> = this.emisor.event;
  private readonly emisorEstado = new vscode.EventEmitter<void>();
  /** Se dispara cuando cambia el documento mostrado (la vista actualiza su descripción). */
  readonly onDidChangeEstado: vscode.Event<void> = this.emisorEstado.event;
  private estadoActual: EstadoVersiones = { piezas: [], motivoVacio: 'sinDocumento' };
  private documento: Documento | undefined;
  private visible = false;
  private generacion = 0;
  private readonly suscripcion: vscode.Disposable;

  constructor(private readonly deps: DependenciasVersiones) {
    this.suscripcion = deps.onCambioEditor((uri) => void this.alCambiarEditor(uri));
  }

  get estado(): EstadoVersiones {
    return this.estadoActual;
  }

  private get fecha(): (iso: string) => string {
    return this.deps.fecha ?? ((iso) => formatearFechaIso(iso));
  }

  dispose(): void {
    this.suscripcion.dispose();
    this.emisor.dispose();
    this.emisorEstado.dispose();
  }

  async alCambiarVisibilidad(visible: boolean): Promise<void> {
    this.visible = visible;
    if (!visible) {
      return;
    }
    if (this.documento === undefined) {
      await this.alCambiarEditor(this.deps.editorActivo());
      return;
    }
    const primera = this.estadoActual.piezas[0];
    if (primera?.estado === 'pendiente') {
      await this.cargarPieza(this.generacion, primera);
    }
  }

  async alCambiarEditor(uri: vscode.Uri | undefined): Promise<void> {
    const documento = documentoDe(uri);
    if (documento === undefined) {
      return;
    }
    if (this.documento?.uri.toString() === documento.uri.toString()) {
      return;
    }
    this.documento = documento;
    await this.preparar(documento);
  }

  async refrescar(): Promise<void> {
    const documento = this.documento;
    if (documento === undefined) {
      return;
    }
    const sinConexion = this.estadoActual.piezas.some((p) => p.estado === 'sinConexion');
    if (this.estadoActual.motivoVacio === 'conectar' || sinConexion) {
      await this.deps.conectar(documento.destino);
    }
    // Las piezas ya cargadas se vuelven a pedir saltando la caché; las demás siguen perezosas.
    const cargadas = new Set(this.estadoActual.piezas.filter((p) => p.estado !== 'pendiente').map((p) => p.pieza.rutaVersiones));
    this.deps.proveedorFuente.invalidar(documento.destino);
    await this.preparar(documento, true, cargadas);
  }

  async abrirDiff(nodo: NodoVersiones): Promise<void> {
    const documento = this.estadoActual.documento;
    if (nodo.clase !== 'version' || documento === undefined) {
      return;
    }
    const izquierda = this.uriDe(documento, nodo.pieza.pieza, nodo.version);
    const titulo = tituloDiffVersion(documento.nombre, nodo.version, 'editor', this.fecha);
    if (nodo.pieza.pieza.rutaFuente === this.estadoActual.piezas[0]?.pieza.rutaFuente) {
      await this.deps.abrirDiff(izquierda, documento.uri, titulo);
      return;
    }
    // El editor muestra otra parte (otro include): se compara con la fuente activa de la parte del nodo.
    const activa: Version = { id: '00000', activa: true, autor: '', fecha: '', src: '' };
    await this.deps.abrirDiff(izquierda, this.uriDe(documento, nodo.pieza.pieza, activa), titulo.replace(/ editor$/, ' Activa'));
  }

  async abrirVersion(nodo: NodoVersiones): Promise<void> {
    const documento = this.estadoActual.documento;
    if (nodo.clase === 'version' && documento !== undefined) {
      await this.deps.mostrar(this.uriDe(documento, nodo.pieza.pieza, nodo.version));
    }
  }

  async copiarOrden(nodo: NodoVersiones): Promise<void> {
    if (nodo.clase === 'version' && nodo.version.orden !== undefined) {
      await this.deps.copiar(nodo.version.orden);
    }
  }

  async compararSeleccion(): Promise<void> {
    const documento = this.estadoActual.documento;
    const par = paresParaDiff(this.deps.seleccion());
    if (par === undefined || documento === undefined) {
      this.deps.avisar(MSG_SELECCIONA_DOS);
      return;
    }
    await this.deps.abrirDiff(
      this.uriDe(documento, par.pieza.pieza, par.antigua),
      this.uriDe(documento, par.pieza.pieza, par.nueva),
      tituloDiffVersion(documento.nombre, par.antigua, par.nueva, this.fecha),
    );
  }

  getTreeItem(nodo: NodoVersiones): vscode.TreeItem {
    if (nodo.clase === 'aviso') {
      const item = new vscode.TreeItem(nodo.texto, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(nodo.motivo === 'error' ? 'error' : nodo.motivo === 'cargando' ? 'loading~spin' : 'info');
      if (nodo.motivo === 'conectar') {
        item.command = { command: COMANDO_REFRESCAR, title: 'Conectar' };
      }
      return item;
    }
    if (nodo.clase === 'pieza') {
      const item = new vscode.TreeItem(
        nodo.pieza.pieza.etiqueta,
        nodo.expandida ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon('file-code');
      item.contextValue = 'pieza';
      return item;
    }
    const e = etiquetaVersion(nodo.version, this.fecha);
    const item = new vscode.TreeItem(e.label, vscode.TreeItemCollapsibleState.None);
    item.description = e.description;
    item.tooltip = e.tooltip;
    item.iconPath = new vscode.ThemeIcon(e.icono);
    item.contextValue = e.contextValue;
    item.command = { command: COMANDO_ABRIR_DIFF, title: 'Comparar con el editor', arguments: [nodo] };
    return item;
  }

  getChildren(nodo?: NodoVersiones): NodoVersiones[] {
    if (nodo === undefined) {
      return raicesDe(this.estadoActual);
    }
    if (nodo.clase === 'pieza' && nodo.pieza.estado === 'pendiente') {
      void this.cargarPieza(this.generacion, nodo.pieza);
    }
    return hijosDe(nodo);
  }

  private uriDe(documento: Documento, pieza: PiezaFuente, version: Version): vscode.Uri {
    const clave: ClaveFuente = {
      destino: documento.destino,
      ruta: version.activa ? pieza.rutaFuente : version.src,
      nombre: documento.nombre,
      extension: documento.extension,
      etiqueta: `v${version.id}`,
    };
    return uriFuente(version.activa ? { ...clave, version: 'active' } : clave);
  }

  private actualizar(estado: EstadoVersiones): void {
    this.estadoActual = estado;
    this.emisor.fire(undefined);
    this.emisorEstado.fire();
  }

  /** `forzar`: la primera pieza salta la caché; `forzadas`: rutas de versiones que además se cargan ya, saltando la caché. */
  private async preparar(documento: Documento, forzar = false, forzadas: ReadonlySet<string> = new Set()): Promise<void> {
    const generacion = ++this.generacion;
    const motivo = this.deps.motivoSinRfc(documento.destino);
    if (motivo !== undefined) {
      log.info('Versiones: sin vía RFC');
      this.actualizar({ piezas: [], motivoVacio: 'sinVia' });
      return;
    }
    const credencial = await this.deps.credencialGuardada(documento.destino);
    if (generacion !== this.generacion) {
      return;
    }
    if (!credencial) {
      this.actualizar({ piezas: [], motivoVacio: 'conectar' });
      return;
    }
    const archivo = analizarUriAbap(documento.uri)?.archivo;
    const piezas = piezasDe({ tipo: documento.tipo, nombre: documento.nombre }, archivo).map(
      (pieza): PiezaVersiones => ({ pieza, estado: 'pendiente', versiones: [] }),
    );
    if (piezas.length === 0) {
      this.actualizar({ piezas: [], motivoVacio: 'desconocido' });
      return;
    }
    this.actualizar({ documento, piezas });
    if (this.visible) {
      const aCargar = piezas.filter((p, i) => i === 0 || forzadas.has(p.pieza.rutaVersiones));
      await Promise.all(
        aCargar.map((p, i) => this.cargarPieza(generacion, p, (i === 0 && forzar) || forzadas.has(p.pieza.rutaVersiones))),
      );
    }
  }

  private async cargarPieza(generacion: number, pieza: PiezaVersiones, forzar = false): Promise<void> {
    const documento = this.estadoActual.documento;
    if (documento === undefined || pieza.estado !== 'pendiente') {
      return;
    }
    pieza.estado = 'cargando';
    this.emisor.fire(undefined);
    const resultado = await this.deps.servicio.versiones(documento.destino, pieza.pieza.rutaVersiones, etiquetaLog(pieza.pieza), forzar);
    if (generacion !== this.generacion) {
      return;
    }
    pieza.estado = resultado.estado;
    if (resultado.estado === 'ok') {
      pieza.versiones = resultado.versiones;
    } else if (resultado.estado === 'error') {
      pieza.mensaje = resultado.mensaje;
    }
    this.emisor.fire(undefined);
  }
}

export function registrarVistaVersiones(
  context: vscode.ExtensionContext,
  deps: Omit<DependenciasVersiones, 'seleccion'>,
): ProveedorVersiones {
  const proveedor = new ProveedorVersiones({ ...deps, seleccion: () => [...creada.selection] });
  const creada: vscode.TreeView<NodoVersiones> = vscode.window.createTreeView(VISTA_VERSIONES, {
    treeDataProvider: proveedor,
    canSelectMany: true,
    showCollapseAll: true,
  });
  const describir = (): void => {
    const documento = proveedor.estado.documento;
    creada.description = documento === undefined ? undefined : `${documento.nombre} · ${documento.destino}`;
  };
  const conNodo = (accion: (nodo: NodoVersiones) => Promise<void>) => (nodo?: NodoVersiones) =>
    nodo === undefined ? undefined : accion(nodo);
  context.subscriptions.push(
    proveedor,
    creada,
    proveedor.onDidChangeEstado(describir),
    creada.onDidChangeVisibility((e) => void proveedor.alCambiarVisibilidad(e.visible)),
    vscode.commands.registerCommand(COMANDO_REFRESCAR, () => proveedor.refrescar()),
    vscode.commands.registerCommand(COMANDO_COMPARAR, () => proveedor.compararSeleccion()),
    vscode.commands.registerCommand(COMANDO_LINEA_TIEMPO, () => enfocarVistaOficial(COMANDO_FOCO_VERSIONES)),
    vscode.commands.registerCommand(COMANDO_ABRIR_DIFF, conNodo((n) => proveedor.abrirDiff(n))),
    vscode.commands.registerCommand(COMANDO_ABRIR_VERSION, conNodo((n) => proveedor.abrirVersion(n))),
    vscode.commands.registerCommand(COMANDO_COPIAR_ORDEN, conNodo((n) => proveedor.copiarOrden(n))),
  );
  describir();
  if (creada.visible) {
    void proveedor.alCambiarVisibilidad(true);
  }
  return proveedor;
}
