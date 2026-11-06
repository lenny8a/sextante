import * as vscode from 'vscode';
import { log } from '../log';
import { nombreDeError } from '../util/errores';
import { contextoLlamadaEn, type ContextoLlamada, type LectorLineas } from '../firmas/contexto-llamada';
import { COMANDO_ABRIR_FIRMA, COMANDO_INSERTAR_LLAMADA, markdownClase, markdownFuncion, markdownMetodo } from '../firmas/hover-modelo';
import type { ServicioFirmas } from '../firmas/servicio';
import { LINEAS_ATRAS, contextoEn, type ContextoDiccionario } from './contexto';
import {
  COMANDO_ABRIR_PANEL,
  COMANDO_CONECTAR,
  COMANDO_GENERAR_CASE,
  markdownCampo,
  markdownConectar,
  markdownElemento,
  markdownMensaje,
  markdownObjeto,
} from './hover-modelo';
import type { Dominio } from './modelo';
import { TIEMPO_HOVER_MS, type ServicioDiccionario } from './servicio';

export interface DependenciasHover {
  servicio: ServicioDiccionario;
  firmas: ServicioFirmas;
  destinoDe(uri: vscode.Uri): string | undefined;
  /** Solo mira si hay contraseña guardada; nunca la pide. */
  credencialGuardada(destino: string): Promise<boolean>;
}

/** El lenguaje `abap` lo registra la extensión oficial. */
export const SELECTOR_DICCIONARIO: vscode.DocumentFilter = { language: 'abap' };
/** `contextoEn` mira LINEAS_ATRAS hacia atrás y completa sentencias de hasta 20 líneas por cada lado. */
const MARGEN_SENTENCIA = 25;
const PALABRA = /[A-Za-z0-9_/]+/;
const AGOTADO = Symbol('agotado');
const COMANDOS_HOVER = [COMANDO_ABRIR_PANEL, COMANDO_CONECTAR, COMANDO_INSERTAR_LLAMADA, COMANDO_ABRIR_FIRMA, COMANDO_GENERAR_CASE];

type ContextoHover = ContextoDiccionario | ContextoLlamada;

export interface Ventana { lineas: string[]; fila: number }

/** Solo las líneas que `contextoEn` puede mirar, sin copiar el documento entero en cada hover. */
export function ventanaDe(doc: Pick<DocumentoHover, 'lineCount' | 'lineAt'>, fila: number): Ventana {
  const desde = Math.max(0, fila - LINEAS_ATRAS - MARGEN_SENTENCIA);
  const hasta = Math.min(doc.lineCount - 1, fila + MARGEN_SENTENCIA);
  const lineas: string[] = [];
  for (let i = desde; i <= hasta; i++) {
    lineas.push(doc.lineAt(i).text);
  }
  return { lineas, fila: fila - desde };
}

/** El dominio solo hace falta para el enlace «Generar CASE»: si falla, el hover sale sin él. */
async function dominioDe(servicio: ServicioDiccionario, destino: string, nombre: string | undefined): Promise<Dominio | undefined> {
  return nombre ? servicio.dominio(destino, nombre).catch(() => undefined) : undefined;
}

async function markdownDe(
  deps: Pick<DependenciasHover, 'servicio' | 'firmas'>, destino: string, contexto: ContextoHover, fila: number,
): Promise<string | undefined> {
  const { servicio, firmas } = deps;
  switch (contexto.clase) {
    case 'objeto': {
      const resuelto = await servicio.objeto(destino, contexto.nombre);
      if (resuelto?.objeto.tipo === 'elementoDatos') {
        const elemento = await servicio.elementoDatos(destino, resuelto.objeto.nombre);
        return elemento
          ? markdownElemento(elemento, await dominioDe(servicio, destino, elemento.dominio), destino)
          : markdownObjeto(resuelto, destino);
      }
      return resuelto ? markdownObjeto(resuelto, destino) : undefined;
    }
    case 'campo': {
      const resuelto = await servicio.campo(destino, contexto.tabla, contexto.campo);
      return resuelto
        ? markdownCampo(contexto.tabla, resuelto.campo, resuelto.elemento, resuelto.dominio, destino, contexto.expresion)
        : undefined;
    }
    case 'mensaje': {
      const mensaje = await servicio.mensaje(destino, contexto.claseMensaje, contexto.numero);
      return mensaje ? markdownMensaje(mensaje, contexto.tipo) : undefined;
    }
    case 'funcion': {
      const firma = await firmas.firmaFuncion(destino, contexto.nombre);
      return firma ? markdownFuncion(firma, destino, fila) : undefined;
    }
    case 'metodo': {
      const firma = await firmas.firmaMetodo(destino, contexto.objeto, contexto.metodo, { desdeSuper: contexto.viaSuper });
      const llamada = { objeto: contexto.objeto, metodo: contexto.metodo, viaSuper: contexto.viaSuper };
      return firma ? markdownMetodo(firma, destino, contexto.receptor, fila, llamada) : undefined;
    }
    case 'clase': {
      const resumen = await firmas.clase(destino, contexto.nombre);
      return resumen ? markdownClase(resumen, destino) : undefined;
    }
  }
}

/** Lo que tarde más de `ms` se deja seguir en segundo plano (llena la caché) y el hover no espera. */
async function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T | typeof AGOTADO> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<typeof AGOTADO>((resolver) => {
    temporizador = setTimeout(() => resolver(AGOTADO), ms);
  });
  try {
    return await Promise.race([promesa, limite]);
  } finally {
    clearTimeout(temporizador);
  }
}

function hoverDe(markdown: string, rango: vscode.Range | undefined): vscode.Hover {
  const contenido = new vscode.MarkdownString(markdown, true);
  contenido.isTrusted = { enabledCommands: COMANDOS_HOVER };
  return new vscode.Hover(contenido, rango);
}

/** Lo que el hover necesita de un documento; un `vscode.TextDocument` lo cumple (también sirve uno sintético). */
export interface DocumentoHover {
  uri: vscode.Uri;
  lineCount: number;
  lineAt(linea: number): { text: string };
  getWordRangeAtPosition(posicion: vscode.Position, patron?: RegExp): vscode.Range | undefined;
}

/** En qué paso terminó la resolución: sirve para saber dónde se queda el hover. */
export type FinHover = 'sinDestino' | 'sinContexto' | 'agotado' | 'cancelado' | 'sinDatos' | 'conectar' | 'ok';

export interface ResultadoHover {
  fin: FinHover;
  clase?: ContextoHover['clase'];
  markdown?: string;
  hover?: vscode.Hover;
}

function lectorDe(doc: Pick<DocumentoHover, 'lineCount' | 'lineAt'>): LectorLineas {
  return { total: doc.lineCount, linea: (i) => doc.lineAt(i).text };
}

function contextoDiccionarioEn(doc: DocumentoHover, posicion: vscode.Position): ContextoDiccionario | undefined {
  const { lineas, fila } = ventanaDe(doc, posicion.line);
  return contextoEn(lineas, fila, posicion.character);
}

/**
 * El camino completo del proveedor, con `TIEMPO_HOVER_MS`; `cancelado` hace de token de VS Code. Una llamada
 * (función, método, clase) va antes que el diccionario.
 */
export async function resolverHover(
  doc: DocumentoHover, posicion: vscode.Position, deps: DependenciasHover, cancelado: () => boolean = () => false,
): Promise<ResultadoHover> {
  const destino = deps.destinoDe(doc.uri);
  if (!destino) {
    return { fin: 'sinDestino' };
  }
  const contexto = contextoLlamadaEn(lectorDe(doc), posicion.line, posicion.character) ?? contextoDiccionarioEn(doc, posicion);
  if (!contexto) {
    return { fin: 'sinContexto' };
  }
  const clase = contexto.clase;
  const rango = doc.getWordRangeAtPosition(posicion, PALABRA);
  const markdown = await conLimite(markdownDe(deps, destino, contexto, posicion.line), TIEMPO_HOVER_MS);
  if (cancelado()) {
    return { fin: 'cancelado', clase };
  }
  if (markdown === AGOTADO) {
    log.info(`Diccionario: hover ${clase} → más de ${TIEMPO_HOVER_MS} ms; sigue en segundo plano`);
    return { fin: 'agotado', clase };
  }
  if (markdown !== undefined) {
    return { fin: 'ok', clase, markdown, hover: hoverDe(markdown, rango) };
  }
  // Con contraseña guardada la sesión silenciosa ya se está abriendo: el siguiente hover tendrá datos.
  const guardada = await deps.credencialGuardada(destino);
  if (cancelado()) {
    return { fin: 'cancelado', clase };
  }
  if (guardada) {
    return { fin: 'sinDatos', clase };
  }
  const conectar = markdownConectar(destino);
  return { fin: 'conectar', clase, markdown: conectar, hover: hoverDe(conectar, rango) };
}

/** `selector` solo cambia en las pruebas: sin la extensión oficial no existe el lenguaje `abap`. */
export function registrarHoverDiccionario(
  context: Pick<vscode.ExtensionContext, 'subscriptions'>, deps: DependenciasHover, selector: vscode.DocumentSelector = SELECTOR_DICCIONARIO,
): void {
  const proveedor: vscode.HoverProvider = {
    provideHover: async (doc, posicion, token) => {
      try {
        return (await resolverHover(doc, posicion, deps, () => token.isCancellationRequested)).hover;
      } catch (error) {
        log.warn(`Diccionario: hover → error ${nombreDeError(error)}`);
        return undefined;
      }
    },
  };
  context.subscriptions.push(vscode.languages.registerHoverProvider(selector, proveedor));
}
