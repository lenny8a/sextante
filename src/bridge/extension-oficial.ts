import * as vscode from 'vscode';
import { NOMBRE_PRODUCTO } from '../producto';
import { log } from '../log';
import { nombreDeError } from '../util/errores';

export const ID_EXTENSION_OFICIAL = 'sapse.adt-vscode';

export const MENSAJE_FALTA_OFICIAL =
  `${NOMBRE_PRODUCTO} necesita la extensión 'ABAP Development Tools for VS Code' de SAP`;
export const ACCION_ABRIR_MARKETPLACE = 'Abrir Marketplace';

export async function avisarFaltaOficial(): Promise<void> {
  const eleccion = await vscode.window.showWarningMessage(MENSAJE_FALTA_OFICIAL, ACCION_ABRIR_MARKETPLACE);
  if (eleccion === ACCION_ABRIR_MARKETPLACE) {
    await vscode.commands.executeCommand('workbench.extensions.search', ID_EXTENSION_OFICIAL);
  }
}

export function extensionOficialInstalada(): boolean {
  return vscode.extensions.getExtension(ID_EXTENSION_OFICIAL) !== undefined;
}

export const COMANDO_LOGON = 'adt-vscode.logonToDestination';
export const COMANDO_NUEVO_DESTINO = 'adt-vscode.new.AbapDestination';
export const COMANDO_EDITAR_DESTINOS = 'adt-vscode.openDestinationsJson';
export const COMANDO_ABRIR_OBJETO = 'adt-vscode.openAbapObject';

export const MENSAJE_OFICIAL_NO_INSTALADA = 'La extensión oficial no está instalada';
export const MENSAJE_OFICIAL_NO_ACTIVA = 'No se pudo activar la extensión oficial';

/** La oficial solo se activa con onFileSystem:abap/ddic-log: sus comandos no existen hasta activarla. */
export async function activarOficial(): Promise<boolean> {
  const extension = vscode.extensions.getExtension(ID_EXTENSION_OFICIAL);
  if (extension === undefined) {
    return false;
  }
  if (!extension.isActive) {
    try {
      await extension.activate();
    } catch (err) {
      log.warn(`No se pudo activar la extensión oficial (${nombreDeError(err)})`);
    }
  }
  return extension.isActive;
}

export async function ejecutarComandoOficial<T = unknown>(comando: string, ...args: unknown[]): Promise<T> {
  if (!extensionOficialInstalada()) {
    throw new Error(MENSAJE_OFICIAL_NO_INSTALADA);
  }
  if (!(await activarOficial())) {
    throw new Error(MENSAJE_OFICIAL_NO_ACTIVA);
  }
  return vscode.commands.executeCommand<T>(comando, ...args);
}
