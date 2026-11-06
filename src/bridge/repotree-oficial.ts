import * as vscode from 'vscode';
import { ESQUEMA_ABAP } from './adt-uri';
import { log } from '../log';
import { mensajeDe, nombreDeError } from '../util/errores';
import { conReintentos } from '../util/reintentos';

export interface EntradaRepotree {
  nombre: string;
  esCarpeta: boolean;
}

export class ErrorRepotree extends Error {
  override name = 'ErrorRepotree';
}

export function uriDeRuta(ruta: string): vscode.Uri {
  return vscode.Uri.from({ scheme: ESQUEMA_ABAP, path: ruta });
}

export interface OpcionesListado {
  reintentos?: number;
  esperaMs?: number;
}

const REINTENTOS_LISTADO = 3;
const ESPERA_LISTADO_MS = 1000;

/**
 * Lista una carpeta del repotree. La oficial carga las carpetas de forma perezosa: mientras carga,
 * `readDirectory` devuelve `[]` sin error (visto en S/4 justo tras el logon), así que un listado vacío
 * se reintenta unas veces antes de darlo por bueno. Vacío no significa carpeta vacía ni inexistente.
 */
export async function listarCarpeta(uri: vscode.Uri, opciones: OpcionesListado = {}): Promise<EntradaRepotree[]> {
  try {
    const entradas = await conReintentos(async () => vscode.workspace.fs.readDirectory(uri), {
      reintentos: opciones.reintentos ?? REINTENTOS_LISTADO,
      esperaMs: opciones.esperaMs ?? ESPERA_LISTADO_MS,
      alReintentar: (intento) => log.info(`Repotree: listado vacío, reintento ${intento}`),
    });
    return entradas.map(([nombre, tipo]) => ({
      nombre,
      esCarpeta: (tipo & vscode.FileType.Directory) !== 0,
    }));
  } catch (err) {
    log.warn(`Repotree: no se pudo listar una carpeta (${nombreDeError(err)})`);
    throw new ErrorRepotree(mensajeDe(err));
  }
}

export async function existe(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
