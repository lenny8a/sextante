import type * as vscode from 'vscode';
import type { DependenciasDesarrollo } from './desarrollo-dependencias';

/** Punto de enganche para herramientas de desarrollo; la versión publicada no registra ninguna. */
export function activarDesarrollo(context: vscode.ExtensionContext, deps: DependenciasDesarrollo): void {
  void context;
  void deps;
}
