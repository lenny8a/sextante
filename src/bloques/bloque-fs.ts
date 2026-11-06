import * as vscode from 'vscode';
import { log } from '../log';
import type { Rango, SimboloDocumento } from '../tree/objeto-modelo';
import { mensajeDe, nombreDeError } from '../util/errores';
import {
  ESQUEMA_BLOQUE,
  ajustarSaltoFinal,
  analizarRutaBloque,
  buscarBloque,
  comprobarBloque,
  textoDeRango,
  type RutaBloque,
} from './bloque-modelo';

export interface DependenciasBloques {
  /** Producción: `workspace.openTextDocument(uriDeRuta(ruta))`. */
  abrirOrigen(rutaOrigen: string): Thenable<vscode.TextDocument>;
  simbolosDe(uri: vscode.Uri): Promise<SimboloDocumento[]>;
  /** Producción: `workspace.applyEdit`. */
  aplicarEdicion(edit: vscode.WorkspaceEdit): Thenable<boolean>;
  /** Producción: `doc.save()`. */
  guardar(doc: vscode.TextDocument): Thenable<boolean>;
  /** Producción: `decidirProteccion(uri abap del origen, rolDe).proteger`. */
  protegido(rutaOrigen: string): boolean;
}

interface BloqueLocalizado {
  ruta: RutaBloque;
  origen: vscode.TextDocument;
  rango: Rango;
  texto: string;
}

const MSG_PROTEGIDO = 'Sistema protegido: solo lectura';
const MSG_DESFASADO = 'La estructura del objeto aún no refleja su texto: vuelve a intentarlo en unos segundos';
const MSG_SIN_APLICAR = 'No se pudo aplicar el cambio en el origen';
const MSG_REDIMENSIONADO =
  'El bloque cambió de tamaño y los símbolos aún no están actualizados: espera un momento y vuelve a guardar';
const MSG_SIN_GUARDAR =
  'La extensión oficial no guardó el objeto: el cambio quedó en el archivo del objeto sin guardar; ' +
  'revisa el bloqueo o la orden de transporte y guarda el objeto';
const MSG_SIN_DIRECTORIOS = 'El editor de bloque solo abre métodos y forms';

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

/**
 * Un método o FORM de un objeto como archivo propio: se lee del archivo `abap:` de origen y al guardarlo se
 * sustituye su rango en el origen y se guarda el origen, para que bloqueo y transporte sigan en la oficial.
 */
// NO VERIFICADO: que `doc.save()` sobre un documento `abap:` dispare el guardado, bloqueo y transporte de la
// oficial igual que Ctrl+S, y que el servidor de lenguaje coloree y complete en un documento de este esquema
// (si no, fase 4: gramática TextMate de ABAP propia).
export class ProveedorBloques implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly emisor = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emisor.event;

  constructor(private readonly deps: DependenciasBloques) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { ruta, origen, texto } = await this.localizar(uri);
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: origen.version,
      size: codificador.encode(texto).byteLength,
      ...(this.deps.protegido(ruta.rutaOrigen) && { permissions: vscode.FilePermission.Readonly }),
    };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return codificador.encode((await this.localizar(uri)).texto);
  }

  async writeFile(uri: vscode.Uri, contenido: Uint8Array): Promise<void> {
    const ruta = rutaDe(uri);
    if (this.deps.protegido(ruta.rutaOrigen)) {
      throw vscode.FileSystemError.NoPermissions(MSG_PROTEGIDO);
    }
    const { origen, rango, texto } = await this.localizar(uri);
    const nuevo = ajustarSaltoFinal(decodificador.decode(contenido), texto);
    if (origen.isDirty) {
      log.info('Bloque: el origen tenía cambios sin guardar; se guardan con el bloque');
    }
    const edicion = new vscode.WorkspaceEdit();
    edicion.replace(origen.uri, new vscode.Range(rango[0], rango[1], rango[2], rango[3]), nuevo);
    if (!(await this.deps.aplicarEdicion(edicion))) {
      log.warn('Bloque: no se pudo aplicar el cambio en el origen');
      throw vscode.FileSystemError.Unavailable(MSG_SIN_APLICAR);
    }
    if (!(await this.deps.guardar(origen))) {
      log.warn('Bloque: la oficial no guardó el origen');
      throw vscode.FileSystemError.Unavailable(MSG_SIN_GUARDAR);
    }
    this.emisor.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    log.info(`Bloque: guardado (${nuevo.split('\n').length} líneas)`);
  }

  readDirectory(): [string, vscode.FileType][] {
    throw vscode.FileSystemError.NoPermissions(MSG_SIN_DIRECTORIOS);
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions(MSG_SIN_DIRECTORIOS);
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions(MSG_SIN_DIRECTORIOS);
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions(MSG_SIN_DIRECTORIOS);
  }

  dispose(): void {
    this.emisor.dispose();
  }

  /** Abre el origen y pide sus símbolos cada vez: el rango del bloque se mueve al editar el resto del objeto. */
  private async localizar(uri: vscode.Uri): Promise<BloqueLocalizado> {
    const ruta = rutaDe(uri);
    let origen: vscode.TextDocument;
    let simbolos: SimboloDocumento[];
    try {
      origen = await this.deps.abrirOrigen(ruta.rutaOrigen);
      simbolos = await this.deps.simbolosDe(origen.uri);
    } catch (err) {
      log.warn(`Bloque: no se pudo abrir el origen (${nombreDeError(err)})`);
      throw vscode.FileSystemError.Unavailable(mensajeDe(err));
    }
    const rango = buscarBloque(simbolos, ruta.nombre, ruta.tipo);
    if (rango === undefined) {
      log.warn(`Bloque: no está entre los ${simbolos.length} símbolos de primer nivel del origen`);
      throw vscode.FileSystemError.FileNotFound(`Bloque ${ruta.nombre} no encontrado en el origen`);
    }
    const texto = origen.getText();
    const estado = comprobarBloque(texto, rango, ruta.nombre, ruta.tipo);
    if (estado !== 'vigente') {
      log.warn(`Bloque: los símbolos no corresponden al texto actual del origen (${estado})`);
      throw vscode.FileSystemError.Unavailable(estado === 'desplazado' ? MSG_DESFASADO : MSG_REDIMENSIONADO);
    }
    return { ruta, origen, rango, texto: textoDeRango(texto, rango) };
  }
}

function rutaDe(uri: vscode.Uri): RutaBloque {
  const ruta = analizarRutaBloque(uri.path);
  if (ruta === undefined) {
    throw vscode.FileSystemError.FileNotFound(uri);
  }
  return ruta;
}

export function registrarBloques(context: vscode.ExtensionContext, deps: DependenciasBloques): ProveedorBloques {
  const proveedor = new ProveedorBloques(deps);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(ESQUEMA_BLOQUE, proveedor, { isCaseSensitive: true }),
    proveedor,
  );
  return proveedor;
}
