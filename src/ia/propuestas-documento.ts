import * as vscode from 'vscode';
import type { RegistroPropuestas } from './propuestas-modelo';

export const ESQUEMA_PROPUESTA = 'sextante-propuesta';

const TEXTO_DESCONOCIDA = '* Propuesta desconocida';

/** `sextante-propuesta:/<id>/<nombre de archivo>` — el nombre conserva la extensión para que el diff coloree ABAP. */
export function uriDePropuesta(id: string, uriOrigen: vscode.Uri): vscode.Uri {
  const nombre = uriOrigen.path.slice(uriOrigen.path.lastIndexOf('/') + 1);
  return vscode.Uri.from({ scheme: ESQUEMA_PROPUESTA, path: `/${id}/${nombre}` });
}

export function idDeUriPropuesta(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== ESQUEMA_PROPUESTA) {
    return undefined;
  }
  const partes = uri.path.split('/');
  if (partes.length !== 3 || partes[0] !== '' || partes[1] === '' || partes[2] === '') {
    return undefined;
  }
  return partes[1];
}

/** Documentos de solo lectura con el texto propuesto por el agente: el lado derecho del diff. */
export class ProveedorDocumentoPropuesta implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly emisor = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emisor.event;

  constructor(private readonly registro: Pick<RegistroPropuestas, 'obtener'>) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    const id = idDeUriPropuesta(uri);
    const propuesta = id === undefined ? undefined : this.registro.obtener(id);
    return propuesta?.textoPropuesto ?? TEXTO_DESCONOCIDA;
  }

  /** Vuelve a pedir el texto de los documentos abiertos de la propuesta (tras recalcularla al Aplicar). */
  refrescar(id: string): void {
    const propuesta = this.registro.obtener(id);
    if (propuesta) {
      this.emisor.fire(uriDePropuesta(id, vscode.Uri.parse(propuesta.uri)));
    }
  }

  dispose(): void {
    this.emisor.dispose();
  }
}
