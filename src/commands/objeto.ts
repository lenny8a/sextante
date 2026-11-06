import * as vscode from 'vscode';
import { ESQUEMA_BLOQUE, rutaDeBloque, tipoBloqueDe } from '../bloques/bloque-modelo';
import { analizarUriAbap, type UriAbap } from '../bridge/adt-uri';
import { COMANDO_ABRIR_OBJETO, avisarFaltaOficial, ejecutarComandoOficial, extensionOficialInstalada } from '../bridge/extension-oficial';
import type { EstadoDestino } from '../bridge/logon-oficial';
import { log } from '../log';
import type { OpcionesConectar } from '../tree/sistemas-modelo';
import type { NodoObjeto } from '../tree/objeto-modelo';
import type { ObjetoAbierto, ProveedorObjeto } from '../tree/objeto-proveedor';
import { mensajeDe, nombreDeError } from '../util/errores';
import type { ResultadoComparar } from '../objeto/comparar-sistemas';
import { enfocarVistaOficial } from './herramientas';
import {
  ACCIONES_OBJETO,
  ACCION_CONECTAR,
  COMANDO_FOCO_TRANSPORTES,
  MSG_BLOQUE_SIN_GUARDAR,
  MSG_CONECTA_PRIMERO,
  MSG_PESTANA_AJENA,
  MSG_SIN_OBJETO_ABIERTO,
  decidirAccion,
  type AccionObjeto,
  type DecisionAccion,
} from './objeto-acciones';

export interface DependenciasComandosObjeto {
  proveedor: ProveedorObjeto;
  conectar(id: string, opciones?: OpcionesConectar): Promise<void>;
  estadoDe(id: string): Promise<EstadoDestino>;
  /** Lo cablea la Tarea 8; sin él, comparar avisa. */
  compararSistemas?: () => Promise<ResultadoComparar>;
}

export const MSG_URI_NO_VALIDO = 'No es un URI abap: de la extensión oficial';
export const MSG_COMPARAR_NO_DISPONIBLE = 'Comparar no disponible todavía';
export const MSG_INCLUDE_FUERA = 'El include no está en el mismo paquete: búscalo con Buscar objeto';

/** Lo que resuelve `abapNavigator.objeto.ir`; sirve para observar el camino seguido en los tests. */
export type ResultadoIr = 'abierto' | 'bloque' | 'fueraDelPaquete' | 'sinObjeto' | 'sinArchivo';

const CLAVE_MODO_BLOQUE = 'abapNavigator.objeto.modoBloque';
const CONTEXTO_MODO_BLOQUE = 'abapNavigator.objetoModoBloque';
/** Id de lenguaje que registra la oficial para `.abap` (su package.json, 1.2.0). */
const LENGUAJE_ABAP = 'abap';

export interface DependenciasIr {
  proveedor: Pick<ProveedorObjeto, 'objeto' | 'uriDeNodo' | 'uriDeInclude'>;
  mostrarDocumento(uri: vscode.Uri, opciones?: vscode.TextDocumentShowOptions): Promise<unknown>;
  /** Con el modo bloque activo, un método o FORM se abre como documento propio (editor de bloque). */
  modoBloque?(): boolean;
  /** Producción: `languages.setTextDocumentLanguage(documento, 'abap')`. */
  fijarLenguaje?(uri: vscode.Uri): Promise<unknown>;
}

async function fijarLenguajeAbap(uri: vscode.Uri): Promise<void> {
  const documento = await vscode.workspace.openTextDocument(uri);
  if (documento.languageId !== LENGUAJE_ABAP) {
    await vscode.languages.setTextDocumentLanguage(documento, LENGUAJE_ABAP);
  }
}

/** URI del editor de bloque de un nodo símbolo, si el modo bloque está activo y el símbolo es un método o FORM. */
function uriDeBloque(nodo: NodoObjeto, uri: vscode.Uri, deps: DependenciasIr): vscode.Uri | undefined {
  const tipoObjeto = deps.proveedor.objeto?.tipo;
  const candidato = deps.modoBloque?.() === true && nodo.clase === 'simbolo';
  if (!candidato || nodo.nombreKind === undefined || tipoObjeto === undefined) {
    return undefined;
  }
  const tipo = tipoBloqueDe(nodo.nombreKind, tipoObjeto);
  return tipo === undefined
    ? undefined
    : vscode.Uri.from({ scheme: ESQUEMA_BLOQUE, path: rutaDeBloque(uri.path, nodo.etiqueta, tipo) });
}

async function abrirBloque(uri: vscode.Uri, deps: DependenciasIr): Promise<ResultadoIr> {
  await deps.mostrarDocumento(uri);
  try {
    await (deps.fijarLenguaje ?? fijarLenguajeAbap)(uri);
  } catch (err) {
    log.warn(`Objeto: no se pudo fijar el lenguaje ABAP en el bloque (${nombreDeError(err)})`);
  }
  log.info('Objeto: bloque abierto');
  return 'bloque';
}

/** Navega al archivo o al rango de un nodo del árbol Objeto; un nodo include busca el include por su nombre. */
export async function irANodo(nodo: NodoObjeto | undefined, deps: DependenciasIr): Promise<ResultadoIr> {
  const { proveedor } = deps;
  if (nodo === undefined || proveedor.objeto === undefined) {
    void vscode.window.showWarningMessage(MSG_SIN_OBJETO_ABIERTO);
    return 'sinObjeto';
  }
  if (nodo.clase === 'include' && nodo.nombreInclude !== undefined) {
    const uri = proveedor.uriDeInclude(nodo.nombreInclude);
    if (uri === undefined) {
      return 'sinObjeto';
    }
    // NO VERIFICADO: que abrir un include inexistente en el FS abap: rechace (FileNotFound) en vez de
    // mostrar un editor vacío; se abre directamente, sin stat previo, para no pagar una ida y vuelta más.
    try {
      await deps.mostrarDocumento(uri);
    } catch (err) {
      log.warn(`Objeto: el include no está junto al objeto (${nombreDeError(err)})`);
      void vscode.window.showWarningMessage(MSG_INCLUDE_FUERA);
      return 'fueraDelPaquete';
    }
    log.info('Objeto: include abierto');
    return 'abierto';
  }
  const uri = proveedor.uriDeNodo(nodo);
  if (uri === undefined) {
    return 'sinArchivo';
  }
  const bloque = uriDeBloque(nodo, uri, deps);
  if (bloque !== undefined) {
    return abrirBloque(bloque, deps);
  }
  const rango = nodo.rango;
  const opciones: vscode.TextDocumentShowOptions | undefined =
    rango === undefined ? undefined : { selection: new vscode.Range(rango[0], rango[1], rango[2], rango[3]) };
  await deps.mostrarDocumento(uri, opciones);
  return 'abierto';
}

export interface DocumentoGuardable {
  isDirty: boolean;
  save(): Thenable<boolean>;
}

export interface DependenciasAccion {
  proveedor: Pick<ProveedorObjeto, 'objeto' | 'pertenece'>;
  ejecutar(accion: AccionObjeto, objeto: ObjetoAbierto): Promise<void>;
  /** Documento abierto de un uri; producción: el de `workspace.textDocuments`. */
  documentoDe?(uri: vscode.Uri): DocumentoGuardable | undefined;
}

function documentoAbierto(uri: vscode.Uri): DocumentoGuardable | undefined {
  const texto = uri.toString();
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === texto);
}

function rechazar(motivo: string): DecisionAccion {
  void vscode.window.showWarningMessage(motivo);
  return { ejecutar: false, motivo };
}

/**
 * Lanza una acción sobre el objeto mostrado. Desde la cabecera del editor llega la Uri de la pestaña: si no es
 * del objeto mostrado no se ejecuta (el comando oficial actuaría sobre otro objeto) y un bloque con cambios se
 * guarda antes, para que la oficial vea lo que el usuario está viendo.
 */
export async function lanzarAccion(accion: AccionObjeto, arg: unknown, deps: DependenciasAccion): Promise<DecisionAccion> {
  const uri = arg instanceof vscode.Uri ? arg : undefined;
  if (uri !== undefined && !deps.proveedor.pertenece(uri)) {
    log.warn(`Objeto: acción ${accion.id} desde una pestaña que no es el objeto mostrado`);
    return rechazar(MSG_PESTANA_AJENA);
  }
  const objeto = deps.proveedor.objeto;
  const decision = decidirAccion(accion, objeto);
  if (!decision.ejecutar || objeto === undefined) {
    return rechazar(decision.ejecutar ? MSG_SIN_OBJETO_ABIERTO : decision.motivo);
  }
  if (uri?.scheme === ESQUEMA_BLOQUE) {
    const documento = (deps.documentoDe ?? documentoAbierto)(uri);
    if (documento?.isDirty === true && !(await documento.save())) {
      log.warn(`Objeto: acción ${accion.id} cancelada, el bloque no se guardó`);
      return rechazar(MSG_BLOQUE_SIN_GUARDAR);
    }
  }
  try {
    await deps.ejecutar(accion, objeto);
  } catch (err) {
    log.warn(`Objeto: acción ${accion.id} falló (${nombreDeError(err)})`);
    throw err;
  }
  log.info(`Objeto: acción ${accion.id} ok`);
  return decision;
}

/** Lo que resuelve `abapNavigator.objeto.abrir`; sirve para observar el camino seguido en los tests. */
type ResultadoAbrir = 'abierto' | 'uriNoValido' | 'sinOficial' | 'cancelado';
const PROMPT_URI = 'URI abap: del archivo del objeto (por ejemplo, copiado de la pestaña del editor)';
const PLACEHOLDER_URI = 'abap:/repotree-v1/<destino>/System Library/<paquete>/…/<OBJETO>/<archivo>';

/** Lo que otros módulos necesitan de los comandos de Objeto: el estado del modo bloque. */
export interface ComandosObjeto {
  modoBloque(): boolean;
}

export function registrarComandosObjeto(context: vscode.ExtensionContext, deps: DependenciasComandosObjeto): ComandosObjeto {
  const { proveedor } = deps;

  const registrar = <T, R = void>(nombre: string, accion: (arg?: T) => Promise<R>): void => {
    const comando = vscode.commands.registerCommand(`abapNavigator.objeto.${nombre}`, async (arg?: T) => {
      try {
        return await accion(arg);
      } catch (err) {
        log.error(`Falló el comando de objeto ${nombre} (${nombreDeError(err)})`);
        await vscode.window.showErrorMessage(mensajeDe(err));
        return undefined;
      }
    });
    context.subscriptions.push(comando);
  };

  const hayObjeto = (): boolean => {
    if (proveedor.objeto === undefined) {
      void vscode.window.showWarningMessage(MSG_SIN_OBJETO_ABIERTO);
      return false;
    }
    return true;
  };

  const abrirConLogon = async (uri: vscode.Uri, destino: string): Promise<ResultadoAbrir> => {
    try {
      await vscode.commands.executeCommand('vscode.open', uri);
      log.info('Objeto: abierto por URI');
      return 'abierto';
    } catch (err) {
      const estado = await deps.estadoDe(destino);
      if (estado === 'conectado') {
        throw err;
      }
      log.warn(`Objeto: no se pudo abrir sin conexión (${nombreDeError(err)}, estado ${estado})`);
    }
    const eleccion = await vscode.window.showWarningMessage(MSG_CONECTA_PRIMERO, ACCION_CONECTAR);
    if (eleccion !== ACCION_CONECTAR) {
      return 'cancelado';
    }
    await deps.conectar(destino);
    await vscode.commands.executeCommand('vscode.open', uri);
    log.info('Objeto: abierto por URI tras conectar');
    return 'abierto';
  };

  const abrir = async (uri: vscode.Uri | undefined): Promise<ResultadoAbrir> => {
    const analisis = uri === undefined ? undefined : analisisAbrible(uri);
    if (uri === undefined || analisis === undefined) {
      log.warn('Objeto: abrir con un URI no válido');
      void vscode.window.showWarningMessage(MSG_URI_NO_VALIDO);
      return 'uriNoValido';
    }
    if (!extensionOficialInstalada()) {
      await avisarFaltaOficial();
      return 'sinOficial';
    }
    return abrirConLogon(uri, analisis.destino);
  };

  registrar<vscode.Uri | string, ResultadoAbrir>('abrir', async (arg) => {
    if (arg instanceof vscode.Uri) {
      return abrir(arg);
    }
    const texto = typeof arg === 'string' ? arg : await pedirUri();
    return texto === undefined ? 'cancelado' : abrir(parsearUri(texto));
  });

  let modoBloque = context.globalState.get<boolean>(CLAVE_MODO_BLOQUE, true);
  void vscode.commands.executeCommand('setContext', CONTEXTO_MODO_BLOQUE, modoBloque);
  const fijarModoBloque = async (valor: boolean): Promise<boolean> => {
    modoBloque = valor;
    await context.globalState.update(CLAVE_MODO_BLOQUE, valor);
    await vscode.commands.executeCommand('setContext', CONTEXTO_MODO_BLOQUE, valor);
    log.info(`Objeto: modo bloque ${valor ? 'activado' : 'desactivado'}`);
    return valor;
  };
  registrar<undefined, boolean>('modoBloque.activar', () => fijarModoBloque(true));
  registrar<undefined, boolean>('modoBloque.desactivar', () => fijarModoBloque(false));

  registrar<NodoObjeto, ResultadoIr>('ir', (nodo) =>
    irANodo(nodo, {
      proveedor,
      modoBloque: () => modoBloque,
      mostrarDocumento: (uri, opciones) => Promise.resolve(vscode.window.showTextDocument(uri, opciones)),
    }),
  );

  registrar('refrescar', async () => {
    if (hayObjeto()) {
      await proveedor.refrescar();
    }
  });

  registrar('fijar', async () => {
    if (hayObjeto()) {
      proveedor.fijar(true);
      log.info('Objeto: fijado');
    }
  });

  registrar('soltar', async () => {
    proveedor.fijar(false);
    log.info('Objeto: soltado');
    await proveedor.alCambiarEditor(vscode.window.activeTextEditor?.document.uri);
  });

  const ejecutarAccion = async (accion: AccionObjeto, objeto: ObjetoAbierto): Promise<void> => {
    await vscode.window.showTextDocument(objeto.uri, { preserveFocus: false });
    if (accion.comandoOficial !== undefined) {
      await ejecutarComandoOficial(accion.comandoOficial);
    } else if (accion.id === 'transporte') {
      await enfocarVistaOficial(COMANDO_FOCO_TRANSPORTES);
    } else if (accion.id === 'versiones') {
      await vscode.commands.executeCommand('abapNavigator.versiones.focus');
    } else if (accion.id === 'copiarNombre') {
      await vscode.env.clipboard.writeText(objeto.nombre.toUpperCase());
    }
  };

  for (const accion of ACCIONES_OBJETO) {
    registrar<unknown, DecisionAccion>(accion.id, (arg) =>
      lanzarAccion(accion, arg, { proveedor, ejecutar: ejecutarAccion }),
    );
  }

  registrar<undefined, ResultadoComparar>('compararOtroSistema', async () => {
    if (deps.compararSistemas === undefined) {
      void vscode.window.showWarningMessage(MSG_COMPARAR_NO_DISPONIBLE);
      return 'sinObjeto';
    }
    return deps.compararSistemas();
  });

  registrar('buscarOficial', async () => {
    if (!extensionOficialInstalada()) {
      await avisarFaltaOficial();
      return;
    }
    await ejecutarComandoOficial(COMANDO_ABRIR_OBJETO);
  });

  return { modoBloque: () => modoBloque };
}

function analisisAbrible(uri: vscode.Uri): UriAbap | undefined {
  const analisis = analizarUriAbap(uri);
  return analisis?.objeto !== undefined && analisis.archivo !== undefined ? analisis : undefined;
}

function parsearUri(texto: string): vscode.Uri | undefined {
  try {
    return vscode.Uri.parse(texto.trim(), true);
  } catch {
    return undefined;
  }
}

async function pedirUri(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: PROMPT_URI,
    placeHolder: PLACEHOLDER_URI,
    ignoreFocusOut: true,
    validateInput: (valor) => {
      const uri = parsearUri(valor);
      return uri !== undefined && analisisAbrible(uri) !== undefined ? undefined : MSG_URI_NO_VALIDO;
    },
  });
}
