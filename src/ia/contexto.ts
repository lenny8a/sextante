import * as vscode from 'vscode';
import { ESQUEMA_ABAP, analizarUriAbap } from '../bridge/adt-uri';
import { ESQUEMA_BLOQUE, uriOrigenDe } from '../bloques/bloque-modelo';
import type { RolSistema } from '../config/navegador-config';
import type { SimboloDocumento } from '../tree/objeto-modelo';
import {
  TIEMPO_RELEASE_MS,
  conTope,
  contextoActualDe,
  uriTexto,
  type ContextoActual,
  type EntradaContexto,
  type FotoEditor,
  type PropuestaPendiente,
  type ResumenDiario,
} from './contexto-modelo';

export interface DependenciasContexto {
  simbolosDe(uri: vscode.Uri): Promise<SimboloDocumento[]>;
  rolDe(id: string): RolSistema | undefined;
  viaDe(id: string): string | undefined;
  sistemaActivo(): string | undefined;
  modoBloque(): boolean;
  propuestasPendientes(): PropuestaPendiente[];
  diarioDe(uri: string): Promise<ResumenDiario | undefined>;
  /** Release del sistema sin preguntar nada al usuario; no rechaza. */
  releaseDe(id: string): Promise<string | undefined>;
}

function esperaReal(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

function esDeInteres(uri: vscode.Uri): boolean {
  return uri.scheme === ESQUEMA_BLOQUE || uri.scheme === ESQUEMA_ABAP;
}

function esAbapOBloque(uri: vscode.Uri): boolean {
  return esDeInteres(uri) && uriOrigenDe(uri).scheme === ESQUEMA_ABAP;
}

function fotoDe(editor: vscode.TextEditor, esActivo: boolean): FotoEditor {
  const { selection, document } = editor;
  const foto: FotoEditor = {
    uri: editor.document.uri,
    linea: selection.active.line,
    columna: selection.active.character,
    esActivo,
  };
  if (!selection.isEmpty) {
    foto.seleccion = {
      desdeLinea: selection.start.line,
      hastaLinea: selection.end.line,
      texto: document.getText(selection),
    };
  }
  return foto;
}

function pestanasAbiertas(): FotoEditor[] {
  const abiertas: FotoEditor[] = [];
  for (const grupo of vscode.window.tabGroups.all) {
    for (const pestana of grupo.tabs) {
      const { input } = pestana;
      if (input instanceof vscode.TabInputText && esAbapOBloque(input.uri)) {
        abiertas.push({ uri: input.uri, linea: 0, columna: 0, esActivo: pestana.isActive && grupo.isActive });
      }
    }
  }
  return abiertas;
}

export class ControladorContexto implements vscode.Disposable {
  private ultimo: FotoEditor | undefined;
  private readonly suscripciones: vscode.Disposable[] = [];

  constructor(private readonly deps: DependenciasContexto) {}

  /** Suscribe los cambios de editor y de selección y guarda el último editor abap:/bloque. */
  seguir(context: Pick<vscode.ExtensionContext, 'subscriptions'>): void {
    const registrar = (): void => this.recordar(vscode.window.activeTextEditor);
    this.suscripciones.push(
      vscode.window.onDidChangeActiveTextEditor(registrar),
      vscode.window.onDidChangeTextEditorSelection(registrar),
    );
    registrar();
    context.subscriptions.push(this);
  }

  async actual(): Promise<ContextoActual> {
    const activo = vscode.window.activeTextEditor;
    let editor: FotoEditor | undefined;
    let origenEditor: EntradaContexto['origenEditor'] = 'ninguno';
    if (activo !== undefined && esAbapOBloque(activo.document.uri)) {
      editor = fotoDe(activo, true);
      origenEditor = 'activo';
    } else if (this.ultimo !== undefined) {
      editor = this.ultimo;
      origenEditor = 'ultimoEditor';
    }
    const simbolos = editor === undefined ? [] : await this.simbolosDe(editor);
    const diario = editor === undefined ? undefined : await this.deps.diarioDe(uriTexto(uriOrigenDe(editor.uri))).catch(() => undefined);
    const idSistema = (editor === undefined ? undefined : analizarUriAbap(uriOrigenDe(editor.uri))?.destino) ?? this.deps.sistemaActivo();
    const release =
      idSistema === undefined
        ? undefined
        : await conTope(this.deps.releaseDe(idSistema).catch(() => undefined), TIEMPO_RELEASE_MS, esperaReal);
    return contextoActualDe({
      editor,
      origenEditor,
      simbolos,
      editoresAbiertos: pestanasAbiertas(),
      sistemaActivo: this.deps.sistemaActivo(),
      rolDe: (id) => this.deps.rolDe(id),
      viaDe: (id) => this.deps.viaDe(id),
      releaseDe: (id) => (id === idSistema ? release : undefined),
      modoBloque: this.deps.modoBloque(),
      propuestasPendientes: this.deps.propuestasPendientes(),
      diario,
    });
  }

  dispose(): void {
    for (const suscripcion of this.suscripciones.splice(0)) {
      suscripcion.dispose();
    }
  }

  private recordar(editor: vscode.TextEditor | undefined): void {
    if (editor !== undefined && esAbapOBloque(editor.document.uri)) {
      this.ultimo = fotoDe(editor, false);
    }
  }

  private async simbolosDe(editor: FotoEditor): Promise<SimboloDocumento[]> {
    const origen = uriOrigenDe(editor.uri);
    try {
      return await this.deps.simbolosDe(vscode.Uri.from({ scheme: origen.scheme, path: origen.path }));
    } catch {
      return [];
    }
  }
}
