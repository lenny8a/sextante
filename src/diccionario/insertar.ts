import * as vscode from 'vscode';
import { conIndentacion } from './generar';

const AVISO_SOLO_LECTURA = 'El editor es de solo lectura';

/**
 * Inserta en la selección del editor activo (la reemplaza si no está vacía), con la indentación de la línea del
 * cursor y el fin de línea del documento. `false` si no hay editor o si el editor no admite cambios.
 */
export async function insertarEnCursor(codigo: string): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    return false;
  }
  const { document, selection } = editor;
  const indentacion = /^\s*/.exec(document.lineAt(selection.active.line).text)?.[0] ?? '';
  const finDeLinea = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const texto = conIndentacion(codigo, indentacion).split('\n').join(finDeLinea);
  const version = document.version;
  let aplicado: boolean;
  try {
    // En un editor de solo lectura (FS isReadonly o solo lectura de la sesión) `edit` resuelve true pero descarta el
    // cambio: el documento no cambia de versión. Probado en la suite; con un abap: de la oficial, NO VERIFICADO.
    aplicado = (await editor.edit((e) => e.replace(selection, texto))) && document.version !== version;
  } catch {
    aplicado = false;
  }
  if (!aplicado) {
    void vscode.window.showInformationMessage(AVISO_SOLO_LECTURA);
  }
  return aplicado;
}

/**
 * Inserta un snippet (con tabulaciones) en `posicion` o, sin ella, en la selección del editor activo, con la indentación
 * de la línea destino (o `sangria`, si se da). `false` si no hay editor o si el editor no admite cambios (mismo aviso
 * que `insertarEnCursor`).
 */
export async function insertarSnippetEnCursor(snippet: string, posicion?: vscode.Position, sangria?: string): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    return false;
  }
  const { document, selection } = editor;
  const linea = (posicion ?? selection.active).line;
  const indentacion = sangria ?? /^\s*/.exec(document.lineAt(linea).text)?.[0] ?? '';
  const texto = new vscode.SnippetString(conIndentacion(snippet, indentacion));
  const version = document.version;
  let aplicado: boolean;
  try {
    // La indentación ya va en el texto: keepWhitespace evita que VS Code la añada otra vez.
    // NO VERIFICADO: insertSnippet en un documento abap: de la oficial (como `edit` en `insertarEnCursor`).
    const opciones = { undoStopBefore: true, undoStopAfter: true, keepWhitespace: true };
    aplicado = (await editor.insertSnippet(texto, posicion ?? selection, opciones)) && document.version !== version;
  } catch {
    aplicado = false;
  }
  if (!aplicado) {
    void vscode.window.showInformationMessage(AVISO_SOLO_LECTURA);
  }
  return aplicado;
}
