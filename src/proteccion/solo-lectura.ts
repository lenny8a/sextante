import * as vscode from 'vscode';
import type { RolSistema } from '../config/navegador-config';
import { log } from '../log';
import { nombreDeError } from '../util/errores';
import { ControladorSoloLectura } from './solo-lectura-controlador';

export { COMANDO_RESET_SOLO_LECTURA_SESION, COMANDO_SOLO_LECTURA_SESION } from './comandos-solo-lectura';

const PRIORIDAD_BARRA_ESTADO = 50;
const AVISO_RETIRADO = 'Solo lectura retirado. Si el editor sigue bloqueado, recarga la ventana';

export function registrarProteccionSoloLectura(
  context: vscode.ExtensionContext,
  rolDe: (id: string) => RolSistema | undefined,
  onDidChangeConfig: vscode.Event<void>,
): vscode.Disposable {
  const barra = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, PRIORIDAD_BARRA_ESTADO);
  const controlador = new ControladorSoloLectura({
    ejecutar: async (comando) => {
      await vscode.commands.executeCommand(comando);
    },
    barra: {
      mostrar: (texto, tooltip) => {
        barra.text = texto;
        barra.tooltip = tooltip;
        barra.show();
      },
      ocultar: () => barra.hide(),
    },
    rolDe,
    registrar: (mensaje) => log.info(mensaje),
  });

  const capturar = (promesa: Promise<unknown>): void => {
    promesa.catch((err: unknown) => {
      log.error(`Solo lectura: evaluación falló (${nombreDeError(err)})`);
    });
  };

  const alCambiarEditor = (editor: vscode.TextEditor | undefined): void => {
    capturar(controlador.evaluar(editor?.document.uri));
  };
  const alCambiarConfig = (): void => {
    const activa = vscode.window.activeTextEditor?.document.uri;
    capturar(
      controlador.reevaluar(activa).then(async (retirado) => {
        if (retirado) {
          void vscode.window.showInformationMessage(AVISO_RETIRADO);
        }
        await controlador.reevaluarTodos(
          vscode.window.visibleTextEditors.map((editor) => editor.document.uri),
          activa,
        );
      }),
    );
  };

  const disposable = vscode.Disposable.from(
    barra,
    vscode.window.onDidChangeActiveTextEditor(alCambiarEditor),
    onDidChangeConfig(alCambiarConfig),
  );
  alCambiarEditor(vscode.window.activeTextEditor);
  context.subscriptions.push(disposable);
  return disposable;
}
