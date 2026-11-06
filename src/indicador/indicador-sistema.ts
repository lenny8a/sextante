import * as vscode from 'vscode';
import { uriOrigenDe } from '../bloques/bloque-modelo';
import type { UriMinimo } from '../bridge/adt-uri';
import type { RolSistema } from '../config/navegador-config';
import { textoIndicador, type TextoIndicador } from './indicador-modelo';

const PRIORIDAD_BARRA_ESTADO = 51;

export interface BarraIndicador {
  mostrar(t: TextoIndicador): void;
  ocultar(): void;
}

export interface DependenciasIndicador {
  barra: BarraIndicador;
  rolDe: (id: string) => RolSistema | undefined;
}

export class ControladorIndicador {
  constructor(private readonly deps: DependenciasIndicador) {}

  evaluar(uri: UriMinimo | undefined): void {
    const texto = textoIndicador(uriOrigenDe(uri), this.deps.rolDe);
    if (texto === undefined) {
      this.deps.barra.ocultar();
      return;
    }
    this.deps.barra.mostrar(texto);
  }
}

function colorDeFondo(fondo: TextoIndicador['fondo']): vscode.ThemeColor | undefined {
  if (fondo === 'warning') {
    return new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  if (fondo === 'error') {
    return new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  return undefined;
}

export function registrarIndicadorSistema(
  context: vscode.ExtensionContext,
  rolDe: (id: string) => RolSistema | undefined,
  onDidChangeConfig: vscode.Event<void>,
): vscode.Disposable {
  const barra = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, PRIORIDAD_BARRA_ESTADO);
  const controlador = new ControladorIndicador({
    barra: {
      mostrar: (t) => {
        barra.text = t.texto;
        barra.tooltip = t.tooltip;
        barra.backgroundColor = colorDeFondo(t.fondo);
        barra.show();
      },
      ocultar: () => barra.hide(),
    },
    rolDe,
  });

  const evaluarActivo = (): void => controlador.evaluar(vscode.window.activeTextEditor?.document.uri);

  const disposable = vscode.Disposable.from(
    barra,
    vscode.window.onDidChangeActiveTextEditor(evaluarActivo),
    onDidChangeConfig(evaluarActivo),
  );
  evaluarActivo();
  context.subscriptions.push(disposable);
  return disposable;
}
