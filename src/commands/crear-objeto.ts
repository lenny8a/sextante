import * as vscode from 'vscode';
import { avisarFaltaOficial, ejecutarComandoOficial } from '../bridge/extension-oficial';
import type { EstadoDestino } from '../bridge/logon-oficial';
import type { RolSistema } from '../config/navegador-config';
import { log } from '../log';
import { mensajeDe, nombreDeError } from '../util/errores';
import { asegurarConectado } from './conexion';
import {
  COMANDO_CREAR_OBJETO_OFICIAL,
  MSG_SIN_SISTEMA_PARA_CREAR,
  argumentoAsistente,
  decidirCrear,
  destinoDeRuta,
  destinoParaCrear,
  type ResultadoCrear,
} from './crear-objeto-modelo';

export const COMANDO_CREAR_OBJETO = 'abapNavigator.crearObjeto';

export interface DependenciasCrearObjeto {
  objetoAbierto(): { destino: string } | undefined;
  sistemaActivo(): string | undefined;
  rolDe(destino: string): RolSistema | undefined;
  estadoDe(destino: string): Promise<EstadoDestino>;
  conectar(destino: string): Promise<void>;
  oficialInstalada(): boolean;
  ejecutarOficial(destino: string): Thenable<unknown>;
}

export async function crearObjeto(deps: DependenciasCrearObjeto, nodo?: { ruta?: string }): Promise<ResultadoCrear> {
  const destino = destinoParaCrear({
    nodo: destinoDeRuta(nodo?.ruta),
    objetoAbierto: deps.objetoAbierto()?.destino,
    sistemaActivo: deps.sistemaActivo(),
  });
  if (destino === undefined) {
    void vscode.window.showWarningMessage(MSG_SIN_SISTEMA_PARA_CREAR);
    return 'sinSistema';
  }
  const decision = decidirCrear(deps.rolDe(destino));
  if (!decision.ejecutar) {
    void vscode.window.showWarningMessage(decision.motivo);
    return 'protegido';
  }
  if (!deps.oficialInstalada()) {
    // Sin esperar la respuesta al aviso: crear_objeto del agente no debe quedarse colgado de él.
    void avisarFaltaOficial().catch((err: unknown) => {
      log.error(`Aviso de extensión oficial falló (${nombreDeError(err)})`);
    });
    return 'sinOficial';
  }
  if (!(await asegurarConectado(deps, destino))) {
    return 'sinConexion';
  }
  try {
    await deps.ejecutarOficial(destino);
  } catch (err) {
    log.warn(`Crear objeto: el asistente falló (${nombreDeError(err)})`);
    throw err;
  }
  log.info('Crear objeto: asistente de la oficial lanzado');
  return 'lanzado';
}

export function ejecutarAsistenteOficial(destino: string): Thenable<unknown> {
  return ejecutarComandoOficial(COMANDO_CREAR_OBJETO_OFICIAL, vscode.Uri.from(argumentoAsistente(destino)));
}

export function registrarComandoCrearObjeto(context: vscode.ExtensionContext, deps: DependenciasCrearObjeto): void {
  const comando = vscode.commands.registerCommand(COMANDO_CREAR_OBJETO, async (nodo?: { ruta?: string }) => {
    try {
      return await crearObjeto(deps, nodo);
    } catch (err) {
      log.error(`Falló el comando crearObjeto (${nombreDeError(err)})`);
      await vscode.window.showErrorMessage(mensajeDe(err));
      return undefined;
    }
  });
  context.subscriptions.push(comando);
}
