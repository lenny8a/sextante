import * as vscode from 'vscode';
import { log } from '../log';
import { mensajeDe, nombreDeError } from '../util/errores';
import { NOMBRE_TEMA_OSCURO, decidirAviso, decidirColoresPropios } from './tema-modelo';

export const COMANDO_COLORES_PROPIOS = 'abapNavigator.tema.coloresPropios';
export const MARCA_AVISO_COLORES = 'abapNavigator.tema.avisoColores';

const TEXTO_AVISO = `El tema ${NOMBRE_TEMA_OSCURO} colorea mejor el ABAP con sus propios colores. ¿Activarlos ahora?`;
const OPCION_ACTIVAR = 'Activar';
const OPCION_NO_PREGUNTAR = 'No volver a preguntar';

function overrideGlobalDeAbap(): boolean | undefined {
  return vscode.workspace
    .getConfiguration('editor', { languageId: 'abap' })
    .inspect<boolean>('semanticHighlighting.enabled')?.globalLanguageValue;
}

async function alternarColoresPropios(): Promise<void> {
  const configuracion = vscode.workspace.getConfiguration('editor', { languageId: 'abap' });
  const actual = overrideGlobalDeAbap();
  const { nuevoValor, mensaje } = decidirColoresPropios(actual);
  await configuracion.update('semanticHighlighting.enabled', nuevoValor, vscode.ConfigurationTarget.Global, true);
  log.info(`Tema: colores propios de ABAP ${nuevoValor === false ? 'activados' : 'desactivados'}`);
  void vscode.window.showInformationMessage(mensaje);
}

export function registrarComandoTema(context: vscode.ExtensionContext): void {
  const comando = vscode.commands.registerCommand(COMANDO_COLORES_PROPIOS, async () => {
    try {
      await alternarColoresPropios();
    } catch (err) {
      log.error(`Falló el comando ${COMANDO_COLORES_PROPIOS} (${nombreDeError(err)})`);
      await vscode.window.showErrorMessage(mensajeDe(err));
    }
  });
  context.subscriptions.push(comando);
  registrarAvisoColores(context);
}

/** Pregunta, como mucho una vez por sesión, si activar los colores propios cuando el tema propio está activo. */
function registrarAvisoColores(context: vscode.ExtensionContext): void {
  let mostradoEnSesion = false;

  const avisarSiProcede = async (): Promise<void> => {
    const tema = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme');
    const yaAvisado = context.globalState.get<boolean>(MARCA_AVISO_COLORES) === true;
    if (mostradoEnSesion || !decidirAviso(tema, overrideGlobalDeAbap(), yaAvisado)) {
      return;
    }
    mostradoEnSesion = true;
    log.info('Tema: aviso para activar los colores propios de ABAP');
    const eleccion = await vscode.window.showInformationMessage(TEXTO_AVISO, OPCION_ACTIVAR, OPCION_NO_PREGUNTAR);
    if (eleccion === OPCION_ACTIVAR) {
      await vscode.commands.executeCommand(COMANDO_COLORES_PROPIOS);
    } else if (eleccion === OPCION_NO_PREGUNTAR) {
      await context.globalState.update(MARCA_AVISO_COLORES, true);
      log.info('Tema: aviso de colores propios desactivado por el usuario');
    }
  };

  const avisar = (): void => {
    avisarSiProcede().catch((err: unknown) => {
      log.error(`Aviso de colores propios falló (${nombreDeError(err)})`);
    });
  };

  avisar();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((evento) => {
      if (evento.affectsConfiguration('workbench.colorTheme')) {
        avisar();
      }
    }),
  );
}
