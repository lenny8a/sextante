import * as vscode from 'vscode';
import { activarOficial, avisarFaltaOficial, ejecutarComandoOficial, extensionOficialInstalada } from '../bridge/extension-oficial';
import { log } from '../log';
import { mensajeDe, nombreDeError } from '../util/errores';
import { COMANDO_EXPLORER, COMANDO_FOCO_DUMPS } from './objeto-acciones';

export const COMANDO_BUSCAR_TEXTO = 'abapNavigator.buscarTexto';
export const COMANDO_DUMPS = 'abapNavigator.dumps';
export const COMANDO_BUSCAR_TEXTO_OFICIAL = 'adt-vscode.abapSourceSearch';

export type ResultadoHerramienta = 'lanzado' | 'sinOficial';

const COMANDO_FOCO_MONITOR = 'abapNavigator.monitor.focus';

export interface DependenciasHerramientas {
  /** El sistema activo tiene vía RFC: el monitor propio puede mostrar dumps. */
  viaRfcActiva?: () => boolean;
}

/** Con vía RFC el botón enfoca el monitor propio; sin ella, la vista de la oficial. */
export function destinoDeDumps(viaRfc: boolean): 'monitor' | 'oficial' {
  return viaRfc ? 'monitor' : 'oficial';
}

/** Enfoca una vista de la oficial por su comando de foco; si no existe, abre el Explorer. */
export async function enfocarVistaOficial(idFoco: string): Promise<void> {
  if (extensionOficialInstalada()) {
    // los .focus existen por manifiesto, pero activar antes abre la vista ya poblada
    await activarOficial();
  }
  const comandos = await vscode.commands.getCommands(true);
  await vscode.commands.executeCommand(comandos.includes(idFoco) ? idFoco : COMANDO_EXPLORER);
}

async function buscarTexto(): Promise<ResultadoHerramienta> {
  if (!extensionOficialInstalada()) {
    await avisarFaltaOficial();
    return 'sinOficial';
  }
  await ejecutarComandoOficial(COMANDO_BUSCAR_TEXTO_OFICIAL);
  log.info('Herramientas: búsqueda de texto de la oficial lanzada');
  return 'lanzado';
}

async function dumps(viaRfc: boolean): Promise<ResultadoHerramienta> {
  if (destinoDeDumps(viaRfc) === 'monitor') {
    await vscode.commands.executeCommand(COMANDO_FOCO_MONITOR);
    log.info('Herramientas: monitor enfocado');
    return 'lanzado';
  }
  if (!extensionOficialInstalada()) {
    await avisarFaltaOficial();
    return 'sinOficial';
  }
  await enfocarVistaOficial(COMANDO_FOCO_DUMPS);
  log.info('Herramientas: vista de dumps y feeds enfocada');
  return 'lanzado';
}

export function registrarComandosHerramientas(context: vscode.ExtensionContext, deps: DependenciasHerramientas = {}): void {
  const registrar = (id: string, accion: () => Promise<ResultadoHerramienta>): void => {
    const comando = vscode.commands.registerCommand(id, async () => {
      try {
        return await accion();
      } catch (err) {
        log.error(`Falló el comando de herramientas ${id} (${nombreDeError(err)})`);
        await vscode.window.showErrorMessage(mensajeDe(err));
        return undefined;
      }
    });
    context.subscriptions.push(comando);
  };
  registrar(COMANDO_BUSCAR_TEXTO, buscarTexto);
  registrar(COMANDO_DUMPS, () => dumps(deps.viaRfcActiva?.() ?? false));
}
