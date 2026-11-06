import * as vscode from 'vscode';
import { nodosDe, type NodoActividad, type RegistroActividad, type Suscripcion } from './actividad-modelo';
import type { Propuesta } from './propuestas-modelo';

export const CONTEXTO_PROPUESTA_PENDIENTE = 'propuestaPendiente';

function contextoDe(nodo: NodoActividad): string {
  return nodo.clase === 'propuesta' && nodo.estadoPropuesta === 'pendiente' ? CONTEXTO_PROPUESTA_PENDIENTE : nodo.clase;
}

export class ProveedorActividad implements vscode.TreeDataProvider<NodoActividad>, vscode.Disposable {
  private readonly emisor = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this.emisor.event;
  private readonly suscripcion: Suscripcion;

  constructor(
    private readonly registro: RegistroActividad,
    private readonly registradoEnClaude: () => boolean | undefined,
    private readonly propuestas: () => { pendientes: readonly Propuesta[]; decididas: readonly Propuesta[] },
  ) {
    this.suscripcion = registro.onDidChange(() => this.emisor.fire());
  }

  getTreeItem(nodo: NodoActividad): vscode.TreeItem {
    const estado =
      nodo.hijos.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(nodo.etiqueta, estado);
    item.id = nodo.id;
    item.description = nodo.descripcion;
    item.tooltip = nodo.tooltip;
    item.iconPath = new vscode.ThemeIcon(nodo.icono);
    item.contextValue = contextoDe(nodo);
    if (nodo.clase === 'llamada' && nodo.uri !== undefined) {
      item.command = { command: 'abapNavigator.ia.abrirLlamada', title: 'Abrir', arguments: [nodo] };
    }
    if (nodo.clase === 'propuesta') {
      item.command = { command: 'abapNavigator.ia.abrirPropuesta', title: 'Abrir propuesta', arguments: [nodo] };
    }
    return item;
  }

  getChildren(nodo?: NodoActividad): NodoActividad[] {
    return nodo === undefined
      ? nodosDe(this.registro.servidor, this.registro.llamadas, this.registradoEnClaude(), this.propuestas())
      : nodo.hijos;
  }

  dispose(): void {
    this.suscripcion.dispose();
    this.emisor.dispose();
  }
}
