import * as vscode from 'vscode';
import { analizarUriFuente, ESQUEMA_FUENTE, partesUriFuente, textoError, type ClaveFuente } from './documento-fuente-modelo';
import type { ResultadoFuente } from './servicio';

export interface DependenciasProveedorFuente {
  fuente(destino: string, ruta: string, version?: 'active'): Promise<ResultadoFuente>;
  /** Tira las fuentes guardadas del destino para que `invalidar` las vuelva a leer. */
  vaciarFuentes?(destino: string): void;
}

export function uriFuente(clave: ClaveFuente): vscode.Uri {
  return vscode.Uri.from(partesUriFuente(clave));
}

/** Documentos de solo lectura con la fuente de un objeto, de una versión o de otro sistema. */
export class ProveedorFuente implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly emisor = new vscode.EventEmitter<vscode.Uri>();
  private readonly servidas = new Map<string, { uri: vscode.Uri; clave: ClaveFuente }>();
  readonly onDidChange = this.emisor.event;

  constructor(private readonly deps: DependenciasProveedorFuente) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const clave = analizarUriFuente(uri);
    if (!clave) {
      return '* No se pudo leer la fuente (dirección no válida)';
    }
    this.servidas.set(uri.toString(), { uri, clave });
    const resultado = await this.deps.fuente(clave.destino, clave.ruta, clave.version);
    switch (resultado.estado) {
      case 'ok': return resultado.texto;
      case 'noExiste': return textoError(clave, 'no existe');
      case 'sinConexion': return textoError(clave, 'conéctate al sistema');
      case 'error': return textoError(clave, resultado.mensaje);
    }
  }

  invalidar(destino: string, ruta?: string): void {
    this.deps.vaciarFuentes?.(destino);
    for (const { uri, clave } of this.servidas.values()) {
      if (clave.destino === destino && (ruta === undefined || clave.ruta === ruta)) {
        this.emisor.fire(uri);
      }
    }
  }

  dispose(): void {
    this.emisor.dispose();
    this.servidas.clear();
  }
}

export function registrarProveedorFuente(context: vscode.ExtensionContext, proveedor: ProveedorFuente): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(ESQUEMA_FUENTE, proveedor),
    proveedor,
  );
}
