import * as vscode from 'vscode';
import type { ResultadoAbrir } from '../adt/abrir-resultado';
import type { ViaSesion } from '../adt/sesiones';
import type { FiltroTipo, ResultadoBusqueda } from '../adt/busqueda-modelo';
import { MSG_SIN_SISTEMA, avisarAlAbrir, mostrarQuickPickBusqueda } from '../commands/buscar';
import { insertarSnippetEnCursor } from '../diccionario/insertar';
import { mensajeDe, nombreDeError } from '../util/errores';
import {
  FILTROS_FIRMAS,
  destinoParaPaleta,
  mensajeSistemaSinRfc,
  posicionDeInsercion,
  receptorPara,
  reintentoComoInterfaz,
  type PosicionInsercion,
} from './cableado-modelo';
import type { LectorLineas } from './contexto-llamada';
import { COMANDO_ABRIR_FIRMA, COMANDO_INSERTAR_LLAMADA, type PeticionAbrirFirma, type PeticionInsertar } from './hover-modelo';
import type { Firma, MetodoResumen } from './modelo';
import { patronLlamada } from './patron';
import type { ServicioFirmas } from './servicio';

export interface DependenciasFirmas {
  servicio: ServicioFirmas;
  destinoDe(uri: vscode.Uri): string | undefined;
  /** Sistema activo, para la paleta sin editor abap:. */
  destinoActivo(): string | undefined;
  /** Abre la sesión del destino antes del QuickPick (puede pedir la contraseña); sin sesión ya avisó y da false. */
  abrirSesion(destino: string): Promise<boolean>;
  /** Vía que resolvió la sesión del destino: las firmas solo se leen por RFC. */
  viaDe(destino: string): ViaSesion | undefined;
  consultar(destino: string, texto: string, signal: AbortSignal, filtro?: FiltroTipo): Promise<ResultadoBusqueda[]>;
  abrirResultado(r: ResultadoBusqueda, destino: string): Promise<ResultadoAbrir>;
  registrar?(m: string): void;
}

export const MSG_SIN_FIRMA = 'No se pudo leer la firma completa; no se insertó nada';
export const MSG_SIN_EDITOR = 'Abre un editor para insertar la llamada';
export const MSG_SIN_METODOS = 'No hay métodos públicos que llamar';
export const MSG_EDITOR_SIN_RFC = 'El sistema del editor no tiene conexión RFC; no se puede leer la firma';
export const PLACEHOLDER_FIRMAS = 'Módulo de funciones, clase o interfaz (func, clas, intf)';
const TITULO_LEYENDO = 'Leyendo la firma…';
const PLACEHOLDER_METODO = 'Método a llamar';
/** La paleta busca módulos de funciones; `clas` e `intf` por prefijo (o botón) cambian a clases e interfaces. */
const FILTRO_INICIAL = FILTROS_FIRMAS[0];
const TIPOS_FIRMA = new Set(FILTROS_FIRMAS.map((f) => f.tipoAdt));
const TIPO_FUNCION = 'FUGR/FF';
const CANCELADO = Symbol('cancelado');

interface ItemMetodo extends vscode.QuickPickItem {
  metodo: MetodoResumen;
}

function esPeticionInsertar(valor: unknown): valor is PeticionInsertar {
  return typeof valor === 'object' && valor !== null && 'destino' in valor && 'firma' in valor && 'fila' in valor;
}

function esPeticionAbrir(valor: unknown): valor is PeticionAbrirFirma {
  return typeof valor === 'object' && valor !== null && 'destino' in valor && 'uriAdt' in valor && 'tipoAdt' in valor;
}

function sangriaDe(texto: string): string {
  return /^\s*/.exec(texto)?.[0] ?? '';
}

function lectorDe(doc: vscode.TextDocument): LectorLineas {
  return { total: doc.lineCount, linea: (i) => doc.lineAt(i).text };
}

function conProgreso<T>(leer: () => Thenable<T>): Thenable<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: TITULO_LEYENDO }, leer);
}

/** Un fallo al leer equivale a no tener la firma: nunca se inserta una llamada a medias. */
async function leerSeguro<T>(deps: DependenciasFirmas, leer: () => Promise<T | undefined>): Promise<T | undefined> {
  try {
    return await conProgreso(leer);
  } catch (error) {
    deps.registrar?.(`Firmas: insertar → error ${nombreDeError(error)}`);
    return undefined;
  }
}

function firmaDePeticion(peticion: PeticionInsertar, servicio: ServicioFirmas): Promise<Firma | undefined> {
  const { destino, firma } = peticion;
  return firma.tipo === 'funcion'
    ? servicio.firmaFuncion(destino, firma.nombre)
    : servicio.firmaMetodo(destino, firma.objeto, firma.metodo, { desdeSuper: firma.viaSuper });
}

/**
 * Debajo de la sentencia: al final de su última línea, con un salto delante y la sangría de la línea del hover.
 * En una fila en blanco, en ella con su sangría; sin fin de sentencia, en la fila del cursor (la línea baja).
 */
function insertarEnPosicion(doc: vscode.TextDocument, pos: PosicionInsercion, snippet: string, filaHover: number): Thenable<boolean> {
  if (pos.nuevaLinea) {
    const anterior = doc.lineAt(pos.fila - 1).range.end;
    return insertarSnippetEnCursor(`\n${snippet}`, anterior, sangriaDe(doc.lineAt(filaHover).text));
  }
  const linea = doc.lineAt(pos.fila);
  if (pos.sinFin) {
    return insertarSnippetEnCursor(`${snippet}\n`, new vscode.Position(pos.fila, sangriaDe(linea.text).length));
  }
  return insertarSnippetEnCursor(snippet, linea.range.end);
}

async function insertarDesdeHover(peticion: PeticionInsertar, deps: DependenciasFirmas): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showInformationMessage(MSG_SIN_EDITOR);
    return;
  }
  const firma = await leerSeguro(deps, () => firmaDePeticion(peticion, deps.servicio));
  if (firma === undefined) {
    void vscode.window.showInformationMessage(MSG_SIN_FIRMA);
    return;
  }
  const receptor = firma.tipo === 'metodo' ? receptorPara(peticion, firma) : '';
  const snippet = patronLlamada(firma, { receptor });
  const doc = editor.document;
  if (peticion.fila < 0 || peticion.fila >= doc.lineCount) {
    deps.registrar?.('Firmas: insertar → fila fuera del documento, en el cursor');
    await insertarSnippetEnCursor(snippet);
    return;
  }
  const pos = posicionDeInsercion(lectorDe(doc), peticion.fila);
  if (pos.sinFin) {
    deps.registrar?.('Firmas: insertar → sentencia sin fin, en el cursor');
  }
  const aplicado = await insertarEnPosicion(doc, pos, snippet, peticion.fila);
  deps.registrar?.(`Firmas: insertar desde el hover → ${aplicado ? 'ok' : 'no aplicado'}`);
}

function itemsMetodos(metodos: MetodoResumen[]): ItemMetodo[] {
  return metodos.map((m) => ({ label: m.nombre, description: m.descripcion, detail: m.origen, metodo: m }));
}

/** Función → su firma; clase o interfaz → la firma del método que se elija. */
async function firmaDeResultado(r: ResultadoBusqueda, destino: string, deps: DependenciasFirmas): Promise<Firma | undefined | typeof CANCELADO> {
  if (r.tipo === TIPO_FUNCION) {
    return leerSeguro(deps, () => deps.servicio.firmaFuncion(destino, r.nombre));
  }
  const resumen = await leerSeguro(deps, () => deps.servicio.clase(destino, r.nombre));
  if (resumen === undefined) {
    return undefined;
  }
  const metodos = [...resumen.metodos, ...resumen.heredados];
  if (metodos.length === 0) {
    void vscode.window.showInformationMessage(MSG_SIN_METODOS);
    return CANCELADO;
  }
  const elegido = await vscode.window.showQuickPick(itemsMetodos(metodos), { placeHolder: PLACEHOLDER_METODO, matchOnDescription: true });
  if (elegido === undefined) {
    return CANCELADO;
  }
  return leerSeguro(deps, () => deps.servicio.firmaMetodo(destino, r.nombre, elegido.metodo.nombre));
}

async function insertarDesdePaleta(deps: DependenciasFirmas): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showInformationMessage(MSG_SIN_EDITOR);
    return;
  }
  const eleccion = destinoParaPaleta(editor.document.uri, (uri) => deps.destinoDe(uri), () => deps.destinoActivo());
  if ('motivo' in eleccion) {
    if (eleccion.motivo === 'editorSinRfc') {
      void vscode.window.showWarningMessage(MSG_EDITOR_SIN_RFC);
    } else {
      void vscode.window.showWarningMessage(MSG_SIN_SISTEMA);
    }
    return;
  }
  const { destino } = eleccion;
  if (!(await deps.abrirSesion(destino))) {
    return;
  }
  if (deps.viaDe(destino) !== 'rfc') {
    deps.registrar?.('Firmas: paleta → sistema sin RFC');
    void vscode.window.showWarningMessage(mensajeSistemaSinRfc(destino));
    return;
  }
  const consultar = async (texto: string, signal: AbortSignal, filtro?: FiltroTipo): Promise<ResultadoBusqueda[]> =>
    (await deps.consultar(destino, texto, signal, filtro ?? FILTRO_INICIAL)).filter((r) => TIPOS_FIRMA.has(r.tipo));
  const elegido = await mostrarQuickPickBusqueda(destino, consultar, [], {
    filtros: FILTROS_FIRMAS,
    filtroInicial: FILTRO_INICIAL,
    placeholder: PLACEHOLDER_FIRMAS,
  });
  if (elegido === undefined) {
    return;
  }
  const firma = await firmaDeResultado(elegido, destino, deps);
  if (firma === CANCELADO) {
    return;
  }
  if (firma === undefined) {
    void vscode.window.showInformationMessage(MSG_SIN_FIRMA);
    return;
  }
  const aplicado = await insertarSnippetEnCursor(patronLlamada(firma, { receptor: '' }));
  deps.registrar?.(`Firmas: insertar desde la paleta → ${aplicado ? 'ok' : 'no aplicado'}`);
}

function resultadoDePeticion(peticion: PeticionAbrirFirma): ResultadoBusqueda {
  return { nombre: peticion.nombre, tipo: peticion.tipoAdt, descripcion: '', paquete: '', uriAdt: peticion.uriAdt };
}

async function abrirFirma(peticion: PeticionAbrirFirma, deps: DependenciasFirmas): Promise<void> {
  let r = resultadoDePeticion(peticion);
  let resultado = await deps.abrirResultado(r, peticion.destino);
  const reintento = reintentoComoInterfaz(peticion, resultado);
  if (reintento !== undefined) {
    deps.registrar?.('Firmas: abrir → reintento como interfaz');
    r = resultadoDePeticion(reintento);
    resultado = await deps.abrirResultado(r, peticion.destino);
  }
  deps.registrar?.(`Firmas: abrir → ${resultado}`);
  avisarAlAbrir(resultado, r);
}

/** «Insertar llamada» (enlace del hover o paleta) y «Abrir» (enlace del hover). */
export function registrarComandosFirmas(context: Pick<vscode.ExtensionContext, 'subscriptions'>, deps: DependenciasFirmas): void {
  const fallo = (que: string, error: unknown): void => {
    deps.registrar?.(`Firmas: ${que} → error ${nombreDeError(error)}`);
    void vscode.window.showErrorMessage(mensajeDe(error));
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(COMANDO_INSERTAR_LLAMADA, async (peticion?: unknown) => {
      try {
        await (esPeticionInsertar(peticion) ? insertarDesdeHover(peticion, deps) : insertarDesdePaleta(deps));
      } catch (error) {
        fallo('insertar', error);
      }
    }),
    vscode.commands.registerCommand(COMANDO_ABRIR_FIRMA, async (peticion?: unknown) => {
      if (!esPeticionAbrir(peticion)) {
        return;
      }
      try {
        await abrirFirma(peticion, deps);
      } catch (error) {
        fallo('abrir', error);
      }
    }),
  );
}
