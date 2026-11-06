import * as vscode from 'vscode';
import type { Rango, SimboloDocumento } from '../tree/objeto-modelo';

type SimboloVsCode = vscode.DocumentSymbol | vscode.SymbolInformation;

function aRango(rango: vscode.Range): Rango {
  return [rango.start.line, rango.start.character, rango.end.line, rango.end.character];
}

function aSimbolo(s: SimboloVsCode): SimboloDocumento {
  const rango = 'location' in s ? s.location.range : s.range;
  const simbolo: SimboloDocumento = {
    nombre: s.name,
    kind: s.kind,
    nombreKind: vscode.SymbolKind[s.kind] ?? 'Desconocido',
    rango: aRango(rango),
    hijos: 'children' in s ? s.children.map(aSimbolo) : [],
  };
  if ('selectionRange' in s) {
    simbolo.rangoSeleccion = aRango(s.selectionRange);
  }
  if ('detail' in s && s.detail) {
    simbolo.detalle = s.detail;
  }
  return simbolo;
}

/**
 * Primera palabra (en mayúsculas) de cada línea pedida, abriendo el documento una sola vez. Las líneas
 * vacías o fuera del documento no aparecen en el resultado; si el documento no se puede abrir, lanza.
 */
export async function primerasPalabrasDe(uri: vscode.Uri, lineas: number[]): Promise<Map<number, string>> {
  const documento = await vscode.workspace.openTextDocument(uri);
  const palabras = new Map<number, string>();
  for (const linea of lineas) {
    if (linea < 0 || linea >= documento.lineCount) {
      continue;
    }
    const palabra = documento.lineAt(linea).text.trim().split(/\s+/)[0];
    if (palabra !== '') {
      palabras.set(linea, palabra.toUpperCase());
    }
  }
  return palabras;
}

/** Versión del documento si está abierto en VS Code. */
export function versionDocumentoDe(uri: vscode.Uri): number | undefined {
  const clave = uri.toString();
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === clave)?.version;
}

export async function simbolosDe(uri: vscode.Uri): Promise<SimboloDocumento[]> {
  const resultado = await vscode.commands.executeCommand<SimboloVsCode[] | undefined>(
    'vscode.executeDocumentSymbolProvider',
    uri,
  );
  return (resultado ?? []).map(aSimbolo);
}
