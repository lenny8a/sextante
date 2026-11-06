import * as vscode from 'vscode';
import type { EstadoDestino } from '../bridge/logon-oficial';
import { log } from '../log';
import { ACCION_CONECTAR, MSG_CONECTA_PRIMERO } from './objeto-acciones';

export interface DependenciasConexion {
  estadoDe(id: string): Promise<EstadoDestino>;
  conectar(id: string): Promise<void>;
}

/** Garantiza que el destino esté conectado; si no lo está, pide confirmación y conecta con el `conectar` inyectado. */
export async function asegurarConectado(deps: DependenciasConexion, destino: string): Promise<boolean> {
  if ((await deps.estadoDe(destino)) === 'conectado') {
    return true;
  }
  const eleccion = await vscode.window.showWarningMessage(MSG_CONECTA_PRIMERO, ACCION_CONECTAR);
  if (eleccion !== ACCION_CONECTAR) {
    return false;
  }
  await deps.conectar(destino);
  const estado = await deps.estadoDe(destino);
  if (estado !== 'conectado') {
    log.warn(`Conexión: sin conexión tras conectar (estado ${estado})`);
    return false;
  }
  return true;
}
