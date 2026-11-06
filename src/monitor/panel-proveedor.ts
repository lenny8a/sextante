import * as vscode from 'vscode';
import { mensajeLegibleDe } from '../adt/excepcion-adt';
import { esProtegido, type RolSistema } from '../config/navegador-config';
import type { SistemaActivo } from '../config/sistema-activo';
import { TOP_DUMPS, TOP_MAXIMO, usuarioValido } from './dumps-modelo';
import type { FuenteOrdenes } from './ordenes-modelo';
import {
  estadoInicial,
  etiquetaDe,
  hijosDe,
  iconoDe,
  idDe,
  nodosRaiz,
  type EstadoMonitor,
  type EstadoSeccion,
  type NodoMonitor,
} from './panel-modelo';
import { ErrorSinSesion, type ServicioMonitor } from './servicio';

export const VISTA_MONITOR = 'abapNavigator.monitor';
export const CONTEXTO_ESCRIBIBLE = 'abapNavigator.monitor.escribible';
export const CONTEXTO_DUMPS_TODOS = 'abapNavigator.monitor.dumpsTodos';
export const CONTEXTO_INACTIVOS_TODOS = 'abapNavigator.monitor.inactivosTodos';

const COMANDO_ABRIR_DUMP = 'abapNavigator.monitor.abrirDump';
const COMANDO_ABRIR_INACTIVO = 'abapNavigator.monitor.abrirInactivo';
const COMANDO_ABRIR_OBJETO_ORDEN = 'abapNavigator.monitor.abrirObjetoOrden';
const COMANDO_CONECTAR = 'abapNavigator.monitor.conectar';
const COMANDO_MAS_DUMPS = 'abapNavigator.monitor.masDumps';

export interface DependenciasMonitor {
  sistemaActivo: Pick<SistemaActivo, 'id' | 'onDidChange'>;
  servicio: Pick<ServicioMonitor, 'dumps' | 'inactivos'>;
  /** `Destino.usuario` en mayúsculas. */
  usuarioDe(destino: string): string | undefined;
  /** La de la vista Sistemas (rol · vía). */
  descripcionDe(destino: string): string | undefined;
  /** Texto de `mensajeSinRfc(motivo)`, o `undefined` si hay vía RFC posible. */
  motivoSinRfc(destino: string): string | undefined;
  credencialGuardada(destino: string): Promise<boolean>;
  alCambiarVia: vscode.Event<unknown>;
  rolDe(destino: string): RolSistema | undefined;
  fuenteOrdenes?: FuenteOrdenes;
  ahora?: () => Date;
  /** `setContext`; los tests lo capturan. */
  establecerContexto?(clave: string, valor: boolean): Promise<void>;
}

type Seccion = 'dumps' | 'inactivos' | 'ordenes';

async function contextoPorDefecto(clave: string, valor: boolean): Promise<void> {
  await vscode.commands.executeCommand('setContext', clave, valor);
}

function seccionConError<T>(err: unknown): EstadoSeccion<T> {
  return { fase: 'error', mensaje: mensajeLegibleDe(err) };
}

export class ProveedorMonitor implements vscode.TreeDataProvider<NodoMonitor>, vscode.Disposable {
  private readonly emisor = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this.emisor.event;
  readonly estado: EstadoMonitor = estadoInicial();

  private readonly suscripciones: vscode.Disposable[] = [];
  private readonly generacion: Record<Seccion, number> = { dumps: 0, inactivos: 0, ordenes: 0 };
  private generacionRaiz = 0;
  private top = TOP_DUMPS;

  constructor(private readonly deps: DependenciasMonitor) {
    this.suscripciones.push(
      deps.sistemaActivo.onDidChange(() => void this.refrescar()),
      deps.alCambiarVia(() => void this.refrescar()),
    );
  }

  getChildren(nodo?: NodoMonitor): NodoMonitor[] {
    return nodo === undefined ? nodosRaiz(this.estado) : hijosDe(nodo, this.estado);
  }

  getTreeItem(nodo: NodoMonitor): vscode.TreeItem {
    const etiqueta = etiquetaDe(nodo, this.estado);
    const colapso = {
      no: vscode.TreeItemCollapsibleState.None,
      abierto: vscode.TreeItemCollapsibleState.Expanded,
      cerrado: vscode.TreeItemCollapsibleState.Collapsed,
    }[etiqueta.colapsable];
    const item = new vscode.TreeItem(etiqueta.label, colapso);
    item.id = idDe(nodo);
    item.description = etiqueta.description;
    item.tooltip = etiqueta.tooltip;
    item.contextValue = etiqueta.contextValue;
    const icono = iconoDe(nodo);
    if (icono !== undefined) {
      item.iconPath = new vscode.ThemeIcon(icono);
    }
    const comando = this.comandoDe(nodo, etiqueta.contextValue);
    if (comando !== undefined) {
      item.command = comando;
    }
    return item;
  }

  async refrescar(): Promise<void> {
    const generacion = ++this.generacionRaiz;
    this.invalidar();
    this.top = TOP_DUMPS;
    const destino = this.deps.sistemaActivo.id;
    const estado = this.estado;
    delete estado.motivo;
    delete estado.textoMotivo;
    delete estado.usuario;
    delete estado.descripcionDestino;
    delete estado.ordenes;
    estado.destino = destino;
    estado.ahora = this.deps.ahora?.();
    if (destino === undefined) {
      estado.motivo = 'sinSistema';
      await this.fijarContextoEscribible(undefined);
      if (generacion !== this.generacionRaiz) {
        return;
      }
      this.notificar();
      return;
    }
    const sinRfc = this.deps.motivoSinRfc(destino);
    if (sinRfc !== undefined) {
      estado.motivo = 'sinRfc';
      estado.textoMotivo = sinRfc;
      await this.fijarContextoEscribible(destino);
      if (generacion !== this.generacionRaiz) {
        return;
      }
      this.notificar();
      return;
    }
    const guardada = await this.deps.credencialGuardada(destino);
    if (generacion !== this.generacionRaiz) {
      return;
    }
    await this.fijarContextoEscribible(destino);
    if (generacion !== this.generacionRaiz) {
      return;
    }
    if (!guardada) {
      estado.motivo = 'conectar';
      this.notificar();
      return;
    }
    const usuario = this.deps.usuarioDe(destino);
    if (usuarioValido(usuario)) {
      estado.usuario = usuario;
    }
    const descripcion = this.deps.descripcionDe(destino);
    if (descripcion !== undefined) {
      estado.descripcionDestino = descripcion;
    }
    await Promise.allSettled([
      this.cargarDumps(destino),
      this.cargarInactivos(destino),
      this.cargarOrdenes(destino),
    ]);
  }

  /** Texto de la cabecera de la vista: sistema activo con la misma descripción que en Sistemas. */
  descripcionVista(): string | undefined {
    const { destino, descripcionDestino } = this.estado;
    if (destino === undefined) {
      return undefined;
    }
    return descripcionDestino === undefined ? destino : `${destino} · ${descripcionDestino}`;
  }

  async alternarDumpsTodos(): Promise<void> {
    this.estado.dumpsTodos = !this.estado.dumpsTodos;
    await this.contexto(CONTEXTO_DUMPS_TODOS, this.estado.dumpsTodos);
    await this.recargar('dumps');
  }

  async alternarInactivosTodos(): Promise<void> {
    this.estado.inactivosTodos = !this.estado.inactivosTodos;
    await this.contexto(CONTEXTO_INACTIVOS_TODOS, this.estado.inactivosTodos);
    await this.recargar('inactivos');
  }

  async masDumps(): Promise<void> {
    this.top = Math.min(this.top * 2, TOP_MAXIMO);
    await this.recargar('dumps');
  }

  dispose(): void {
    this.generacionRaiz++;
    this.invalidar();
    for (const s of this.suscripciones) {
      s.dispose();
    }
    this.emisor.dispose();
  }

  private comandoDe(nodo: NodoMonitor, contextValue: string): vscode.Command | undefined {
    const destino = this.estado.destino;
    if (destino === undefined) {
      return undefined;
    }
    if (nodo.clase === 'dump') {
      return { command: COMANDO_ABRIR_DUMP, title: 'Abrir dump', arguments: [destino, nodo.dump] };
    }
    if (nodo.clase === 'inactivo' && contextValue === 'inactivo') {
      return { command: COMANDO_ABRIR_INACTIVO, title: 'Abrir', arguments: [destino, nodo.objeto, nodo.padre] };
    }
    if (nodo.clase === 'objetoOrden' && contextValue === 'objetoOrden') {
      return { command: COMANDO_ABRIR_OBJETO_ORDEN, title: 'Abrir', arguments: [destino, nodo.objeto] };
    }
    if (nodo.clase === 'conectar') {
      return { command: COMANDO_CONECTAR, title: 'Conectar', arguments: [destino] };
    }
    if (nodo.clase === 'masDumps') {
      return { command: COMANDO_MAS_DUMPS, title: 'Más dumps' };
    }
    return undefined;
  }

  private invalidar(): void {
    this.generacion.dumps++;
    this.generacion.inactivos++;
    this.generacion.ordenes++;
  }

  private notificar(): void {
    this.emisor.fire();
  }

  private async contexto(clave: string, valor: boolean): Promise<void> {
    await (this.deps.establecerContexto ?? contextoPorDefecto)(clave, valor);
  }

  private async fijarContextoEscribible(destino: string | undefined): Promise<void> {
    const escribible = destino !== undefined && !esProtegido(this.deps.rolDe(destino));
    await this.contexto(CONTEXTO_ESCRIBIBLE, escribible);
  }

  private async recargar(seccion: 'dumps' | 'inactivos'): Promise<void> {
    const destino = this.estado.destino;
    if (destino === undefined || this.estado.motivo !== undefined) {
      return;
    }
    await (seccion === 'dumps' ? this.cargarDumps(destino) : this.cargarInactivos(destino));
  }

  /** Un `ErrorSinSesion` en cualquier sección lleva la raíz a «Conectar». */
  private sinSesion(err: unknown): boolean {
    if (!(err instanceof ErrorSinSesion)) {
      return false;
    }
    this.estado.motivo = 'conectar';
    return true;
  }

  private async cargarDumps(destino: string): Promise<void> {
    const generacion = ++this.generacion.dumps;
    this.estado.dumps = { fase: 'cargando' };
    this.notificar();
    try {
      const usuario = this.estado.dumpsTodos ? undefined : this.estado.usuario;
      const r = await this.deps.servicio.dumps(destino, { usuario, top: this.top });
      if (generacion !== this.generacion.dumps) {
        return;
      }
      this.estado.dumps = { fase: 'ok', elementos: r.dumps, llena: r.llena };
    } catch (err) {
      if (generacion !== this.generacion.dumps) {
        return;
      }
      if (!this.sinSesion(err)) {
        this.estado.dumps = seccionConError(err);
      }
    }
    this.notificar();
  }

  private async cargarInactivos(destino: string): Promise<void> {
    const generacion = ++this.generacion.inactivos;
    this.estado.inactivos = { fase: 'cargando' };
    this.notificar();
    try {
      const usuario = this.estado.inactivosTodos ? undefined : this.estado.usuario;
      const objetos = await this.deps.servicio.inactivos(destino, undefined, usuario);
      if (generacion !== this.generacion.inactivos) {
        return;
      }
      this.estado.inactivos = { fase: 'ok', elementos: objetos, llena: false };
    } catch (err) {
      if (generacion !== this.generacion.inactivos) {
        return;
      }
      if (!this.sinSesion(err)) {
        this.estado.inactivos = seccionConError(err);
      }
    }
    this.notificar();
  }

  private async cargarOrdenes(destino: string): Promise<void> {
    const fuente = this.deps.fuenteOrdenes;
    if (fuente === undefined) {
      return;
    }
    const generacion = ++this.generacion.ordenes;
    this.estado.ordenes = { fase: 'cargando' };
    this.notificar();
    try {
      const ordenes = await fuente.ordenesAbiertas(destino);
      if (generacion !== this.generacion.ordenes) {
        return;
      }
      this.estado.ordenes = { fase: 'ok', elementos: ordenes, llena: false };
    } catch (err) {
      if (generacion !== this.generacion.ordenes) {
        return;
      }
      if (!this.sinSesion(err)) {
        this.estado.ordenes = seccionConError(err);
      }
    }
    this.notificar();
  }
}
