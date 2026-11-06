import * as vscode from 'vscode';
import { avisarFaltaOficial, ejecutarComandoOficial, extensionOficialInstalada } from '../bridge/extension-oficial';
import { log } from '../log';
import { mensajeDe, nombreDeError } from '../util/errores';
import {
  COMANDO_NOTEBOOK_SQL,
  LENGUAJE_SQL,
  MSG_CONSULTA_COPIADA,
  MSG_SIN_TABLA,
  TIPO_NOTEBOOK_SQL,
  consultaSelect,
} from './sql-modelo';

export interface DependenciasSql {
  tablaActiva(): string | undefined;
}

export type ResultadoVerDatos = 'abierto' | 'fallback' | 'sinTabla' | 'sinOficial';

export async function abrirNotebookConConsulta(consulta: string): Promise<'abierto' | 'fallback'> {
  try {
    // NO VERIFICADO: que el controlador de la oficial acepte un notebook untitled de este tipo y qué
    // sistema usa (el usuario puede fijarlo con "Set Cell System" en la celda).
    const datos = new vscode.NotebookData([
      new vscode.NotebookCellData(vscode.NotebookCellKind.Code, consulta, LENGUAJE_SQL),
    ]);
    const documento = await vscode.workspace.openNotebookDocument(TIPO_NOTEBOOK_SQL, datos);
    await vscode.window.showNotebookDocument(documento);
    log.info('SQL: notebook abierto con consulta');
    return 'abierto';
  } catch (err) {
    log.warn(`SQL: fallback al comando oficial (${nombreDeError(err)})`);
    await ejecutarComandoOficial(COMANDO_NOTEBOOK_SQL);
    await vscode.env.clipboard.writeText(consulta);
    void vscode.window.showInformationMessage(MSG_CONSULTA_COPIADA);
    return 'fallback';
  }
}

export function registrarComandosSql(context: vscode.ExtensionContext, deps: DependenciasSql): void {
  const registrar = <A, R>(nombre: string, accion: (arg?: A) => Promise<R>): void => {
    const comando = vscode.commands.registerCommand(`abapNavigator.sql.${nombre}`, async (arg?: A) => {
      try {
        return await accion(arg);
      } catch (err) {
        log.error(`Falló el comando SQL ${nombre} (${nombreDeError(err)})`);
        await vscode.window.showErrorMessage(mensajeDe(err));
        return undefined;
      }
    });
    context.subscriptions.push(comando);
  };

  registrar<undefined, void>('consola', async () => {
    if (!extensionOficialInstalada()) {
      await avisarFaltaOficial();
      return;
    }
    await ejecutarComandoOficial(COMANDO_NOTEBOOK_SQL);
    log.info('SQL: consola abierta');
  });

  registrar<string, ResultadoVerDatos>('verDatos', async (nombreTabla) => {
    const tabla = typeof nombreTabla === 'string' ? nombreTabla : deps.tablaActiva();
    if (tabla === undefined) {
      void vscode.window.showWarningMessage(MSG_SIN_TABLA);
      return 'sinTabla';
    }
    if (!extensionOficialInstalada()) {
      await avisarFaltaOficial();
      return 'sinOficial';
    }
    return abrirNotebookConConsulta(consultaSelect(tabla));
  });
}
