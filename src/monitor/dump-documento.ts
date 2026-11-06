import * as vscode from 'vscode';
import type { ResultadoAbrir } from '../adt/abrir-resultado';
import type { ResultadoBusqueda } from '../adt/busqueda-modelo';
import { uriDeRuta } from '../bridge/repotree-oficial';
import { avisarAlAbrir, type MostrarRuta } from '../commands/buscar';
import { descodificarSegmento } from '../adt/busqueda-modelo';
import { log } from '../log';
import { nombreDeError } from '../util/errores';
import { documentoDump, type EstadoDumpCompleto } from './dump-texto';
import { type Dump, horaArchivo, resultadoDePosicion } from './dumps-modelo';
import type { ResultadoDumpCompleto } from './servicio';

export const ESQUEMA_DUMP = 'abap-navigator-dump';
export const COMANDO_ABRIR_POSICION = 'abapNavigator.monitor.abrirPosicion';

export function uriDeDump(destino: string, dump: Dump): vscode.Uri {
  return vscode.Uri.from({
    scheme: ESQUEMA_DUMP,
    path: `/${encodeURIComponent(destino)}/Dump ${dump.errorEjecucion} · ${horaArchivo(dump.publicado)}.txt`,
    query: encodeURIComponent(dump.id),
  });
}

interface DocumentoRegistrado {
  destino: string;
  dump: Dump;
  estado: EstadoDumpCompleto;
  enVuelo: boolean;
}

export class ProveedorDocumentoDump implements vscode.TextDocumentContentProvider, vscode.DocumentLinkProvider, vscode.Disposable {
  private readonly documentos = new Map<string, DocumentoRegistrado>();
  private readonly emisor = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emisor.event;

  registrar(destino: string, dump: Dump): vscode.Uri {
    const uri = uriDeDump(destino, dump);
    const clave = uri.toString();
    if (!this.documentos.has(clave)) {
      this.documentos.set(clave, { destino, dump, estado: { clase: 'cargando' }, enVuelo: false });
    }
    return uri;
  }

  estadoDe(uri: vscode.Uri): EstadoDumpCompleto | undefined {
    return this.documentos.get(uri.toString())?.estado;
  }

  actualizar(uri: vscode.Uri, estado: ResultadoDumpCompleto): void {
    const registrado = this.documentos.get(uri.toString());
    if (registrado) {
      registrado.estado = estado;
      registrado.enVuelo = false;
      this.emisor.fire(uri);
    }
  }

  /** Reserva la lectura de SNAP: `false` si ya hay una en vuelo o el dump ya está completo. Un error previo se reintenta. */
  iniciarLectura(uri: vscode.Uri): boolean {
    const registrado = this.documentos.get(uri.toString());
    if (!registrado || registrado.enVuelo || registrado.estado.clase === 'ok') {
      return false;
    }
    registrado.enVuelo = true;
    if (registrado.estado.clase === 'error') {
      registrado.estado = { clase: 'cargando' };
      this.emisor.fire(uri);
    }
    return true;
  }

  abandonarLectura(uri: vscode.Uri): void {
    const registrado = this.documentos.get(uri.toString());
    if (registrado) {
      registrado.enVuelo = false;
    }
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const r = this.documentos.get(uri.toString());
    return r ? documentoDump(r.dump, r.destino, r.estado).texto : '';
  }

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const r = this.documentos.get(document.uri.toString());
    if (!r) {
      return [];
    }
    return documentoDump(r.dump, r.destino, r.estado).enlaces.map((e) => {
      // NO VERIFICADO: con un objeto con espacio de nombres (%2f en la uri ADT) falta probarlo con F5.
      // `Uri.from` no descodifica la query; el abridor de comandos de VS Code la descodifica una sola vez.
      const destinoEnlace = vscode.Uri.from({
        scheme: 'command',
        path: COMANDO_ABRIR_POSICION,
        query: encodeURIComponent(JSON.stringify([r.destino, e.uriAdt, e.lineaDestino])),
      });
      const enlace = new vscode.DocumentLink(new vscode.Range(e.linea, e.inicio, e.linea, e.fin), destinoEnlace);
      enlace.tooltip = 'Abrir en la línea';
      return enlace;
    });
  }

  dispose(): void {
    this.emisor.dispose();
  }
}

export interface DependenciasAbrirDump {
  abrirResultado(r: ResultadoBusqueda, destino: string, mostrar?: MostrarRuta): Promise<ResultadoAbrir>;
  documentos: ProveedorDocumentoDump;
  avisar(mensaje: string): void;
  registrar?: (mensaje: string) => void;
  aUri?: (ruta: string) => vscode.Uri;
  dumpCompleto?: (destino: string, dump: Dump) => Promise<ResultadoDumpCompleto>;
}

export type ResultadoAbrirDump = 'abierto' | 'sinPosicion' | 'noAbierto';

export function mostrarEnLinea(linea: number, aUri: (ruta: string) => vscode.Uri = uriDeRuta): MostrarRuta {
  return async (ruta) => {
    const doc = await vscode.workspace.openTextDocument(aUri(ruta));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const posicion = new vscode.Position(Math.max(linea - 1, 0), 0);
    editor.selection = new vscode.Selection(posicion, posicion);
    editor.revealRange(new vscode.Range(posicion, posicion), vscode.TextEditorRevealType.InCenter);
  };
}

function programaDe(dump: Dump): ResultadoBusqueda {
  return { nombre: dump.programa, tipo: 'PROG/P', descripcion: '', paquete: '', uriAdt: '' };
}

export async function abrirDumpEnEditor(destino: string, dump: Dump, deps: DependenciasAbrirDump): Promise<ResultadoAbrirDump> {
  const deLinea = dump.posicion ? resultadoDePosicion(dump.posicion, dump.programa) : undefined;
  const programa = programaDe(dump);
  let salida: ResultadoAbrirDump = 'abierto';
  let ultimo: ResultadoAbrir;
  let ultimoR: ResultadoBusqueda = deLinea ?? programa;
  if (deLinea && dump.posicion) {
    ultimo = await deps.abrirResultado(deLinea, destino, mostrarEnLinea(dump.posicion.linea, deps.aUri));
    if (ultimo !== 'abierto' && (deLinea.nombre !== programa.nombre || deLinea.tipo !== programa.tipo)) {
      deps.avisar(`No se localizó ${deLinea.nombre}; abierto el programa ${dump.programa}`);
      ultimoR = programa;
      ultimo = await deps.abrirResultado(programa, destino);
      salida = 'sinPosicion';
    }
  } else {
    salida = 'sinPosicion';
    deps.avisar(
      dump.posicion
        ? `Posición del dump no reconocida: abierto el programa ${dump.programa}`
        : `Dump sin posición: abierto el programa ${dump.programa}`,
    );
    ultimo = await deps.abrirResultado(programa, destino);
  }
  if (ultimo !== 'abierto') {
    avisarAlAbrir(ultimo, ultimoR);
    salida = 'noAbierto';
  }
  const uriDocumento = deps.documentos.registrar(destino, dump);
  const doc = await vscode.workspace.openTextDocument(uriDocumento);
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: true });
  if (deps.dumpCompleto && deps.documentos.iniciarLectura(uriDocumento)) {
    deps.dumpCompleto(destino, dump).then(
      (resultado) => deps.documentos.actualizar(uriDocumento, resultado),
      (err: unknown) => {
        deps.documentos.abandonarLectura(uriDocumento);
        log.error(`Monitor: dump completo → error ${nombreDeError(err)}`);
      },
    );
  }
  deps.registrar?.(`Monitor: abrir dump → ${salida}`);
  return salida;
}

export interface DependenciasAbrirPosicion {
  abrirResultado(r: ResultadoBusqueda, destino: string, mostrar?: MostrarRuta): Promise<ResultadoAbrir>;
  avisar(mensaje: string): void;
  aUri?: (ruta: string) => vscode.Uri;
}

/** Abre el objeto de una fila de la pila (uri ADT del feed) en su línea. */
export async function abrirPosicion(destino: unknown, uriAdt: unknown, linea: unknown, deps: DependenciasAbrirPosicion): Promise<void> {
  if (typeof destino !== 'string' || typeof uriAdt !== 'string' || typeof linea !== 'number' || !Number.isInteger(linea) || linea < 1) {
    deps.avisar('Posición no reconocida');
    return;
  }
  const ultimo = uriAdt.split('/source')[0].split('/').pop() ?? '';
  const r = resultadoDePosicion({ uriAdt, linea }, descodificarSegmento(ultimo).toUpperCase());
  if (r === undefined) {
    deps.avisar('Posición no reconocida');
    return;
  }
  const resultado = await deps.abrirResultado(r, destino, mostrarEnLinea(linea, deps.aUri));
  if (resultado !== 'abierto') {
    avisarAlAbrir(resultado, r);
  }
}
