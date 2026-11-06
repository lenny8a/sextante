import * as path from 'node:path';
import * as vscode from 'vscode';

const RETARDO_MS = 300;

export function vigilarDestinos(ruta: string, onCambio: () => void): vscode.Disposable {
  const patron = new vscode.RelativePattern(vscode.Uri.file(path.dirname(ruta)), path.basename(ruta));
  const watcher = vscode.workspace.createFileSystemWatcher(patron);
  let temporizador: NodeJS.Timeout | undefined;
  const disparar = (): void => {
    clearTimeout(temporizador);
    temporizador = setTimeout(onCambio, RETARDO_MS);
  };
  const suscripciones = [watcher.onDidCreate(disparar), watcher.onDidChange(disparar), watcher.onDidDelete(disparar)];
  return {
    dispose: () => {
      clearTimeout(temporizador);
      suscripciones.forEach((s) => s.dispose());
      watcher.dispose();
    },
  };
}
