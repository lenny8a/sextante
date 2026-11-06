import * as vscode from 'vscode';
import { ESQUEMA_BLOQUE, rutaDeBloque, uriOrigenDe } from '../bloques/bloque-modelo';
import { ESQUEMA_ABAP } from '../bridge/adt-uri';
import { uriDeRuta } from '../bridge/repotree-oficial';
import { log } from '../log';
import { nombreDeError } from '../util/errores';
import { localizarForm, performEnLinea, type LectorTexto } from './perform-modelo';

/** Mismo selector que el hover del diccionario: el lenguaje `abap` lo registra la oficial. */
export const SELECTOR_NAVEGACION: vscode.DocumentFilter = { language: 'abap' };
const MS_AVISO = 5000;

export interface DependenciasNavegacionPerform {
  modoBloque(): boolean;
  /** Ruta del archivo principal del programa o grupo de funciones mostrado en el árbol, si `uri` le pertenece. */
  rutaPrincipalDe(uri: vscode.Uri): string | undefined;
  /** Texto de un archivo `abap:` por su ruta; `undefined` si no se puede leer. Producción: `leerTextoAbap`. */
  leerTexto: LectorTexto;
  /** Aviso breve al usuario cuando el FORM no aparece. Producción: barra de estado. */
  avisar(mensaje: string): void;
}

export async function leerTextoAbap(ruta: string): Promise<string | undefined> {
  try {
    return (await vscode.workspace.openTextDocument(uriDeRuta(ruta))).getText();
  } catch (err) {
    log.info(`Navegación: un include no se pudo leer (${nombreDeError(err)})`);
    return undefined;
  }
}

export function avisarEnBarra(mensaje: string): void {
  vscode.window.setStatusBarMessage(mensaje, MS_AVISO);
}

/**
 * Destino de un `PERFORM` bajo el cursor: el `FORM` en el propio archivo, en sus includes o en los del programa
 * principal. Con el modo bloque activo (y un origen `abap:`) el destino es el editor de bloque del FORM; si no, la
 * línea del FORM en su archivo. Desde un editor de bloque se busca sobre su archivo origen.
 */
export async function definicionDePerform(
  doc: Pick<vscode.TextDocument, 'uri' | 'lineAt' | 'getText'>,
  posicion: vscode.Position,
  deps: DependenciasNavegacionPerform,
): Promise<vscode.Location | undefined> {
  const nombre = performEnLinea(doc.lineAt(posicion.line).text, posicion.character);
  if (nombre === undefined) {
    return undefined;
  }
  const esBloque = doc.uri.scheme === ESQUEMA_BLOQUE;
  const origen = uriOrigenDe(doc.uri);
  const uriOrigen = esBloque ? uriDeRuta(origen.path) : doc.uri;
  const texto = esBloque ? await deps.leerTexto(origen.path) : doc.getText();
  if (texto === undefined) {
    log.warn('Navegación: no se pudo leer el origen del bloque');
    return undefined;
  }
  const { destino, leidos } = await localizarForm(
    nombre,
    { ruta: origen.path, texto, rutaPrincipal: deps.rutaPrincipalDe(uriOrigen) },
    deps.leerTexto,
  );
  if (destino === undefined) {
    log.info(`Navegación: FORM no encontrado tras mirar ${leidos} archivos`);
    deps.avisar(`FORM ${nombre} no está en este objeto ni en sus includes`);
    return undefined;
  }
  const donde = destino.ruta === origen.path ? 'en el origen' : `en un include (${leidos} archivos mirados)`;
  if (deps.modoBloque() && uriOrigen.scheme === ESQUEMA_ABAP) {
    log.info(`Navegación: FORM ${donde}; se abre como bloque`);
    const bloque = vscode.Uri.from({ scheme: ESQUEMA_BLOQUE, path: rutaDeBloque(destino.ruta, nombre, 'form') });
    return new vscode.Location(bloque, new vscode.Position(0, 0));
  }
  log.info(`Navegación: FORM ${donde}; se abre en su archivo`);
  const uriDestino = destino.ruta === origen.path ? uriOrigen : uriDeRuta(destino.ruta);
  return new vscode.Location(uriDestino, new vscode.Position(destino.linea, destino.columna));
}

/** `selector` solo cambia en las pruebas: sin la extensión oficial no existe el lenguaje `abap`. */
export function registrarNavegacionPerform(
  context: Pick<vscode.ExtensionContext, 'subscriptions'>,
  deps: DependenciasNavegacionPerform,
  selector: vscode.DocumentSelector = SELECTOR_NAVEGACION,
): void {
  const proveedor: vscode.DefinitionProvider = {
    provideDefinition: async (doc, posicion, token) => {
      try {
        const destino = await definicionDePerform(doc, posicion, deps);
        return token.isCancellationRequested ? undefined : destino;
      } catch (err) {
        log.warn(`Navegación: ir al FORM → error ${nombreDeError(err)}`);
        return undefined;
      }
    },
  };
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, proveedor));
}
