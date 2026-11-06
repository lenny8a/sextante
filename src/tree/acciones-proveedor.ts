import * as vscode from 'vscode';
import { construirBarra, type EstadoBarra, type NodoBarra } from './acciones-modelo';

export interface DependenciasAcciones {
  objeto(): EstadoBarra['objeto'];
  sistemaActivo(): string | undefined;
  /** Eventos que cambian el estado de la barra (objeto abierto, sistema activo). */
  onCambio: vscode.Event<unknown>[];
}

export class ProveedorAcciones implements vscode.TreeDataProvider<NodoBarra>, vscode.Disposable {
  private readonly emisor = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this.emisor.event;
  private readonly suscripciones: vscode.Disposable[];

  constructor(private readonly deps: DependenciasAcciones) {
    this.suscripciones = deps.onCambio.map((evento) => evento(() => this.refrescar()));
  }

  estado(): EstadoBarra {
    return { objeto: this.deps.objeto(), sistemaActivo: this.deps.sistemaActivo() };
  }

  refrescar(): void {
    this.emisor.fire();
  }

  getTreeItem(nodo: NodoBarra): vscode.TreeItem {
    if (nodo.clase === 'grupo') {
      const item = new vscode.TreeItem(nodo.etiqueta, vscode.TreeItemCollapsibleState.Expanded);
      item.id = nodo.id;
      return item;
    }
    const item = new vscode.TreeItem(nodo.etiqueta, vscode.TreeItemCollapsibleState.None);
    item.id = nodo.id;
    item.iconPath = nodo.icono === undefined ? undefined : new vscode.ThemeIcon(nodo.icono);
    item.tooltip = nodo.etiqueta;
    item.contextValue = nodo.habilitado ? 'accion' : 'accionDeshabilitada';
    if (nodo.habilitado && nodo.comando !== undefined) {
      item.command = { command: nodo.comando, title: nodo.etiqueta };
    } else {
      item.description = nodo.motivo;
    }
    return item;
  }

  getChildren(nodo?: NodoBarra): NodoBarra[] {
    return nodo === undefined ? construirBarra(this.estado()) : nodo.hijos;
  }

  dispose(): void {
    for (const suscripcion of this.suscripciones) {
      suscripcion.dispose();
    }
    this.emisor.dispose();
  }
}
