import * as vscode from 'vscode';
import { NOMBRE_PRODUCTO } from './producto';

type Nivel = 'INFO' | 'WARN' | 'ERROR';

let canal: vscode.OutputChannel | undefined;

function obtenerCanal(): vscode.OutputChannel {
  canal ??= vscode.window.createOutputChannel(NOMBRE_PRODUCTO);
  return canal;
}

function escribir(nivel: Nivel, mensaje: string): void {
  const hora = new Date().toTimeString().slice(0, 8);
  obtenerCanal().appendLine(`${hora} [${nivel}] ${mensaje}`);
}

function detalleDeError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  return String(err);
}

export const log = {
  info(mensaje: string): void {
    escribir('INFO', mensaje);
  },
  warn(mensaje: string): void {
    escribir('WARN', mensaje);
  },
  error(mensaje: string, err?: unknown): void {
    escribir('ERROR', err === undefined ? mensaje : `${mensaje}: ${detalleDeError(err)}`);
  },
  dispose(): void {
    canal?.dispose();
    canal = undefined;
  },
};
