import * as vscode from 'vscode';
import {
  abrirResultado,
  type DependenciasAbrir,
  type DependenciasTransaccion,
  type ResultadoAbrir,
} from '../adt/abrir-resultado';
import { resolverTransaccion } from '../adt/transaccion';
import { buscar, paqueteSinFiltro } from '../adt/busqueda-cliente';
import {
  FILTROS_TIPO,
  interpretarConsulta,
  type Consulta,
  type FiltroTipo,
  type ResultadoBusqueda,
} from '../adt/busqueda-modelo';
import {
  itemsAlCambiarTexto,
  itemsDe,
  ProgramadorConsultas,
  tituloBusqueda,
  type QuickPickItemResultado,
} from '../adt/buscar-modelo';
import { ErrorAdt, type ConexionAdt } from '../adt/conexion-adt';
import { Credenciales } from '../adt/credenciales';
import { mensajeDeExcepcionAdt, mensajeLegibleDe } from '../adt/excepcion-adt';
import { Recientes } from '../adt/recientes';
import { esNoAutorizado, SesionesAdt, type PuenteSesiones, type ResultadoSesion } from '../adt/sesiones';
import { COMANDO_ABRIR_OBJETO, avisarFaltaOficial, ejecutarComandoOficial, extensionOficialInstalada } from '../bridge/extension-oficial';
import { estadoConexion } from '../bridge/logon-oficial';
import { listarCarpeta, uriDeRuta } from '../bridge/repotree-oficial';
import { leerDestinos, type Destino } from '../config/destinos';
import type { RolSistema } from '../config/navegador-config';
import type { SistemaActivo } from '../config/sistema-activo';
import { log } from '../log';
import type { NodoSistema } from '../tree/sistemas-modelo';
import { mensajeDe, nombreDeError } from '../util/errores';
import { asegurarConectado, type DependenciasConexion } from './conexion';

export const COMANDO_BUSCAR = 'abapNavigator.buscar';
export const COMANDO_OLVIDAR_BUSQUEDA = 'abapNavigator.buscar.olvidar';
export const DEBOUNCE_MS = 250;
export const MAX_RESULTADOS = 50;
export const PLACEHOLDER_BUSCAR = 'Nombre con * o prefijo (clas, prog, func, tabl, tran…)';
export const MSG_SIN_SISTEMA = 'Marca un sistema como activo para buscar objetos';
export const MSG_TRANSACCION = 'No se pudo resolver qué ejecuta la transacción';
export const ACCION_ENVIAR_INSEGURO = 'Enviar de todos modos';
export const MSG_CONTRASENA_CADUCADA = 'La contraseña de búsqueda ya no es válida; vuelve a buscar para escribirla';
export const MSG_SIN_SESION = 'Sin conexión ADT propia con el sistema: conéctate (o busca una vez) y vuelve a intentarlo';

/** El servidor respondió 401 con la sesión abierta: no se consulta más hasta volver a pedir la contraseña. */
export class ErrorContrasenaCaducada extends Error {
  constructor() {
    super(MSG_CONTRASENA_CADUCADA);
    this.name = 'ErrorContrasenaCaducada';
  }
}

export type ResultadoBuscar = 'quickPick' | 'oficial' | 'sinSistema' | 'sinOficial' | 'sinConexion' | 'cancelado';

/** Lanza una consulta al servidor; el filtro es el botón de tipo activo del QuickPick. */
export type ConsultarBusqueda = (texto: string, signal: AbortSignal, filtro?: FiltroTipo) => Promise<ResultadoBusqueda[]>;

/** `estadoDe` y `conectar` son de la oficial: abrir un resultado necesita su sesión en el repotree. */
export interface DependenciasBuscar extends DependenciasConexion {
  sistemaActivo: Pick<SistemaActivo, 'id'>;
  sesiones: Pick<SesionesAdt, 'sesion' | 'invalidar'>;
  recientes: Recientes;
  credenciales: Pick<Credenciales, 'olvidar'>;
  /** Borra la URL guardada en abap-navigator.json para volver a deducirla. */
  olvidarUrl(id: string): Promise<void>;
  /** Sesión del destino en el puente RFC; olvidar la búsqueda también la cierra. */
  puente?: Pick<PuenteSesiones, 'olvidar'>;
  /** Por defecto, `extensionOficialInstalada`. */
  oficialInstalada?(): boolean;
  buscar(conexion: ConexionAdt, consulta: Consulta, signal: AbortSignal): Promise<ResultadoBusqueda[]>;
  abrir(r: ResultadoBusqueda, destino: string): Promise<ResultadoAbrir>;
  buscarOficial(): Promise<void>;
  /** Inyectable en tests; por defecto, el QuickPick con filtros y recientes. */
  mostrarQuickPick?(destino: string, consultar: ConsultarBusqueda): Promise<ResultadoBusqueda | undefined>;
}

export async function ejecutarBuscar(deps: DependenciasBuscar): Promise<ResultadoBuscar> {
  const destino = deps.sistemaActivo.id;
  if (destino === undefined) {
    void vscode.window.showWarningMessage(MSG_SIN_SISTEMA);
    return 'sinSistema';
  }
  const sesion = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Conectando con ${destino}…` },
    () => deps.sesiones.sesion(destino),
  );
  if (sesion.estado !== 'ok') {
    return reaccionarSinSesion(sesion, destino, deps);
  }
  const conexion = sesion.conexion;
  let caducada = false;
  const consultar: ConsultarBusqueda = async (texto, signal, filtro) => {
    if (caducada) {
      throw new ErrorContrasenaCaducada();
    }
    try {
      return await consultarEn(deps.buscar, conexion, texto, signal, filtro);
    } catch (err) {
      if (!esNoAutorizado(err)) {
        throw err;
      }
      if (!caducada) {
        caducada = true;
        await caducarContrasena(destino, deps);
      }
      throw new ErrorContrasenaCaducada();
    }
  };
  const mostrar =
    deps.mostrarQuickPick ??
    ((d: string, c: ConsultarBusqueda) => mostrarQuickPickBusqueda(d, c, deps.recientes.listar(d)));
  const elegido = await mostrar(destino, consultar);
  if (caducada) {
    void vscode.window.showWarningMessage(MSG_CONTRASENA_CADUCADA);
    return 'cancelado';
  }
  if (elegido === undefined) {
    return 'cancelado';
  }
  if (!(await asegurarConectado(deps, destino))) {
    log.info('Búsqueda: sin conexión de la oficial; no se abre el elegido');
    return 'sinConexion';
  }
  const resultado = await deps.abrir(elegido, destino);
  log.info(`Búsqueda: abrir el elegido → ${resultado}`);
  await reaccionarAlAbrir(resultado, elegido, destino, deps);
  return 'quickPick';
}

/** Una consulta del QuickPick con la conexión dada: el texto con su prefijo de tipo o el filtro del botón activo. */
async function consultarEn(
  buscarEn: DependenciasBuscar['buscar'], conexion: ConexionAdt, texto: string, signal: AbortSignal, filtro?: FiltroTipo,
): Promise<ResultadoBusqueda[]> {
  const consulta = interpretarConsulta(texto, filtro);
  const resultados = await buscarEn(conexion, consulta, signal);
  log.info(`Búsqueda: ${resultados.length} resultados${consulta.filtro ? ` (filtro ${consulta.filtro.id})` : ''}`);
  return resultados;
}

async function reaccionarSinSesion(
  sesion: Exclude<ResultadoSesion, { estado: 'ok' }>,
  destino: string,
  deps: DependenciasBuscar,
): Promise<ResultadoBuscar> {
  switch (sesion.estado) {
    case 'sinRest':
      log.info(`Búsqueda: sin ADT propio (${sesion.motivo}); se usa la búsqueda de la extensión oficial`);
      return usarBusquedaOficial(deps);
    case 'sinContrasena':
      log.info(`Búsqueda: sesión REST no abierta (${sesion.estado}); se usa la búsqueda de la extensión oficial`);
      return usarBusquedaOficial(deps);
    case 'noAutorizado':
    case 'error':
      avisarSesionFallida(sesion, destino);
      return 'cancelado';
  }
}

/** Contraseña rechazada o error al abrir la sesión: el aviso lo comparten la búsqueda y «Insertar llamada». */
function avisarSesionFallida(sesion: Extract<ResultadoSesion, { estado: 'noAutorizado' | 'error' }>, destino: string): void {
  if (sesion.estado === 'noAutorizado') {
    log.warn('Búsqueda: contraseña rechazada');
    void vscode.window.showErrorMessage(`${destino} rechazó el usuario o la contraseña de la búsqueda`);
    return;
  }
  log.warn('Búsqueda: no se pudo abrir la sesión REST');
  void vscode.window.showErrorMessage(sesion.mensaje);
}

/**
 * Abre la sesión del destino antes de un QuickPick que consulta en silencio (puede pedir la contraseña una vez, como
 * la búsqueda). Sin sesión avisa una sola vez y devuelve false; si el usuario cancela la contraseña, sin aviso.
 */
async function abrirSesionPara(sesiones: Pick<SesionesAdt, 'sesion'>, destino: string): Promise<boolean> {
  const sesion = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Conectando con ${destino}…` },
    () => sesiones.sesion(destino),
  );
  switch (sesion.estado) {
    case 'ok':
      return true;
    case 'sinContrasena':
      log.info('Búsqueda: sesión no abierta (sinContrasena); no se consulta');
      return false;
    case 'sinRest':
      log.info(`Búsqueda: sin ADT propio (${sesion.motivo}); no se consulta`);
      void vscode.window.showInformationMessage(MSG_SIN_SESION);
      return false;
    case 'noAutorizado':
    case 'error':
      avisarSesionFallida(sesion, destino);
      return false;
  }
}

async function usarBusquedaOficial(deps: DependenciasBuscar): Promise<ResultadoBuscar> {
  if (!(deps.oficialInstalada ?? extensionOficialInstalada)()) {
    avisarFaltaOficial().catch((err: unknown) => {
      log.error(`Aviso de extensión oficial falló (${nombreDeError(err)})`);
    });
    return 'sinOficial';
  }
  await deps.buscarOficial();
  return 'oficial';
}

async function reaccionarAlAbrir(
  resultado: ResultadoAbrir,
  r: ResultadoBusqueda,
  destino: string,
  deps: DependenciasBuscar,
): Promise<void> {
  if (resultado === 'abierto') {
    await deps.recientes.anotar(destino, r);
    return;
  }
  avisarAlAbrir(resultado, r);
}

/** El aviso al usuario cuando un objeto no se pudo abrir; lo comparten la búsqueda y el diccionario. */
export function avisarAlAbrir(resultado: ResultadoAbrir, r: ResultadoBusqueda): void {
  switch (resultado) {
    case 'abierto':
    case 'paquete':
    case 'vista':
      return;
    case 'noLocalizado':
      void vscode.window.showWarningMessage(
        `No se encontró ${r.nombre} en el árbol de la extensión oficial: prueba Paquetes`,
      );
      return;
    case 'tipoNoSoportado':
      void vscode.window.showWarningMessage(`${r.nombre} es de un tipo (${r.tipo}) que aún no se abre desde la búsqueda`);
      return;
    case 'transaccion':
    case 'transaccionSinDestino':
      void vscode.window.showWarningMessage(`${MSG_TRANSACCION} ${r.nombre}`);
      return;
  }
}

/** Un 401 con la sesión cacheada: la contraseña cambió en SAP. Seguir enviándola podría bloquear al usuario. */
async function caducarContrasena(destino: string, deps: Pick<DependenciasBuscar, 'credenciales' | 'sesiones'>): Promise<void> {
  log.warn('Búsqueda: 401 con la sesión abierta; se olvida la contraseña');
  deps.sesiones.invalidar(destino);
  await deps.credenciales.olvidar(destino);
}

export async function olvidarBusqueda(
  id: string,
  deps: Pick<DependenciasBuscar, 'credenciales' | 'olvidarUrl' | 'sesiones' | 'puente'>,
): Promise<void> {
  await deps.credenciales.olvidar(id);
  await deps.olvidarUrl(id);
  try {
    await deps.puente?.olvidar(id);
  } catch (err) {
    log.warn(`Búsqueda: el puente RFC no pudo olvidar la sesión (${nombreDeError(err)})`);
  }
  deps.sesiones.invalidar(id);
  log.info('Búsqueda: contraseña y URL olvidadas para un destino');
}

function botonDe(filtro: FiltroTipo, activo: boolean): vscode.QuickInputButton {
  const icono = filtro.icono.replace(/^\$\((.+)\)$/, '$1');
  return { iconPath: new vscode.ThemeIcon(icono), tooltip: activo ? `${filtro.etiqueta} (activo)` : filtro.etiqueta };
}

/** Sin opciones, la búsqueda general: todos los botones de tipo, ninguno activo. */
export interface OpcionesQuickPickBusqueda {
  filtros?: readonly FiltroTipo[];
  filtroInicial?: FiltroTipo;
  placeholder?: string;
}

/**
 * QuickPick de búsqueda: con el campo vacío muestra los recientes; al escribir consulta tras DEBOUNCE_MS,
 * aborta la consulta anterior y solo pinta la respuesta de la última. Resuelve con el elegido o `undefined`.
 */
export function mostrarQuickPickBusqueda(
  destino: string,
  consultar: ConsultarBusqueda,
  recientes: ResultadoBusqueda[],
  opciones: OpcionesQuickPickBusqueda = {},
): Promise<ResultadoBusqueda | undefined> {
  const filtros = opciones.filtros ?? FILTROS_TIPO;
  const qp = vscode.window.createQuickPick<QuickPickItemResultado>();
  qp.title = tituloBusqueda(destino);
  qp.placeholder = opciones.placeholder ?? PLACEHOLDER_BUSCAR;
  qp.matchOnDescription = true;
  qp.ignoreFocusOut = false;

  let filtro: FiltroTipo | undefined = opciones.filtroInicial;
  let botones: readonly vscode.QuickInputButton[] = [];

  const programador = new ProgramadorConsultas<ResultadoBusqueda[]>({
    esperaMs: DEBOUNCE_MS,
    consultar: (texto, signal) => consultar(texto, signal, filtro),
    alResolver: (resultados) => {
      qp.items = itemsDe(resultados, false);
    },
    alFallar: (err) => {
      if (err instanceof ErrorContrasenaCaducada) {
        programador.detener();
        qp.hide();
        return;
      }
      log.warn(`Búsqueda: la consulta falló (${nombreDeError(err)})`);
      void vscode.window.showErrorMessage(mensajeLegibleDe(err));
      qp.items = [];
    },
    alCambiarOcupado: (ocupado) => {
      qp.busy = ocupado;
    },
  });

  const pintarBotones = (): void => {
    botones = filtros.map((f) => botonDe(f, f === filtro));
    qp.buttons = botones;
    qp.title = tituloBusqueda(destino, filtro);
  };
  const alCambiarTexto = (texto: string): void => {
    qp.items = itemsAlCambiarTexto(texto, recientes, filtro);
    programador.cambiarTexto(texto);
  };

  return new Promise((resolver) => {
    let elegido: ResultadoBusqueda | undefined;
    const suscripciones = [
      qp.onDidChangeValue(alCambiarTexto),
      qp.onDidTriggerButton((boton) => {
        const pulsado = filtros[botones.indexOf(boton)];
        filtro = pulsado === filtro ? undefined : pulsado;
        pintarBotones();
        alCambiarTexto(qp.value);
      }),
      qp.onDidAccept(() => {
        elegido = (qp.selectedItems[0] ?? qp.activeItems[0])?.resultado;
        if (elegido !== undefined) {
          qp.hide();
        }
      }),
      qp.onDidHide(() => {
        programador.cancelar();
        for (const s of suscripciones) {
          s.dispose();
        }
        qp.dispose();
        resolver(elegido);
      }),
    ];
    pintarBotones();
    qp.items = itemsAlCambiarTexto('', recientes, filtro);
    qp.show();
  });
}

export function registrarComandoBuscar(context: vscode.ExtensionContext, deps: DependenciasBuscar): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMANDO_BUSCAR, async (): Promise<ResultadoBuscar> => {
      try {
        return await ejecutarBuscar(deps);
      } catch (err) {
        log.error(`Falló la búsqueda de objetos (${nombreDeError(err)})`);
        void vscode.window.showErrorMessage(mensajeLegibleDe(err));
        return 'cancelado';
      }
    }),
    vscode.commands.registerCommand(COMANDO_OLVIDAR_BUSQUEDA, async (nodo?: NodoSistema): Promise<void> => {
      const id = nodo?.id || deps.sistemaActivo.id;
      if (!id) {
        void vscode.window.showWarningMessage(MSG_SIN_SISTEMA);
        return;
      }
      try {
        await olvidarBusqueda(id, deps);
        void vscode.window.showInformationMessage(`Se olvidaron la contraseña y la URL de búsqueda de ${id}`);
      } catch (err) {
        log.error(`Falló olvidar la contraseña de búsqueda (${nombreDeError(err)})`);
        void vscode.window.showErrorMessage(mensajeDe(err));
      }
    }),
  );
}

/** Consultas ADT al abrir un resultado: lo que ejecuta una transacción y el paquete que falta tras un filtro. */
export type ConsultasAbrir = DependenciasTransaccion & Required<Pick<DependenciasAbrir, 'paqueteDe'>>;

/** Un 401 caduca la contraseña como en la búsqueda. */
export function dependenciasTransaccion(
  deps: Pick<DependenciasBuscar, 'credenciales' | 'sesiones'>,
  destino: string,
): ConsultasAbrir {
  let caducada = false;
  const conSesion = async <T>(accion: (conexion: ConexionAdt) => Promise<T>): Promise<T> => {
    const sesion = await deps.sesiones.sesion(destino);
    if (sesion.estado !== 'ok') {
      throw new Error('Sin sesión REST');
    }
    try {
      return await accion(sesion.conexion);
    } catch (err) {
      if (esNoAutorizado(err) && !caducada) {
        caducada = true;
        await caducarContrasena(destino, deps);
        void vscode.window.showWarningMessage(MSG_CONTRASENA_CADUCADA);
      } else if (err instanceof ErrorAdt && err.cuerpo !== undefined) {
        const texto = mensajeDeExcepcionAdt(err.cuerpo);
        if (texto !== undefined) {
          log.warn(`Búsqueda: el servidor rechazó una consulta de la transacción (estado ${err.estado})`);
          void vscode.window.showErrorMessage(texto);
        }
      }
      throw err;
    }
  };
  return {
    resolver: (tcode) => conSesion((conexion) => resolverTransaccion(conexion, tcode)),
    paqueteDe: (nombre, tipo) => conSesion((conexion) => paqueteSinFiltro(conexion, nombre, tipo)),
    avisar: (mensaje) => void vscode.window.showInformationMessage(mensaje),
  };
}

export interface OpcionesBusqueda {
  sistemaActivo: SistemaActivo;
  rutaDestinos: string;
  urlDe(id: string): string | undefined;
  guardarUrl(id: string, url: string): Promise<void>;
  quitarUrl(id: string): Promise<void>;
  rolDe(id: string): RolSistema | undefined;
  /** Logon de la oficial en el destino, como el resto de comandos que necesitan el repotree. */
  conectar(id: string): Promise<void>;
  /** Puente RFC compartido de la ventana; sin él, las sesiones van por HTTP si hay una URL que responda. */
  puente?: PuenteSesiones;
}

/** Cómo se muestra la ruta `abap:` ya resuelta; por defecto `vscode.open`. */
export type MostrarRuta = (ruta: string) => Promise<unknown>;

/** Lo que otros consumidores (el árbol de sistemas, el diccionario, el monitor) necesitan de la búsqueda registrada. */
export interface BusquedaRegistrada {
  sesiones: Pick<SesionesAdt, 'sesion' | 'sesionSilenciosa' | 'viaDe' | 'alCambiarVia' | 'invalidar'>;
  credenciales: Pick<Credenciales, 'guardada'>;
  /** Abre un objeto en la oficial con las mismas dependencias que un resultado de la búsqueda. */
  abrirResultado(r: ResultadoBusqueda, destino: string, mostrar?: MostrarRuta): Promise<ResultadoAbrir>;
  /** Abre la sesión del destino (puede pedir la contraseña); sin sesión avisa y devuelve false. Va antes de `consultar`. */
  abrirSesion(destino: string): Promise<boolean>;
  /** La consulta del QuickPick de la búsqueda sobre la sesión ya abierta del destino (nunca pide la contraseña). */
  consultar(destino: string, texto: string, signal: AbortSignal, filtro?: FiltroTipo): Promise<ResultadoBusqueda[]>;
}

/** Cableado de producción: sesiones ADT (RFC o REST), contraseña en SecretStorage, recientes en globalState. */
export function registrarBusqueda(context: vscode.ExtensionContext, opciones: OpcionesBusqueda): BusquedaRegistrada {
  const destinoDe = (id: string): Destino | undefined => leerDestinos(opciones.rutaDestinos).find((d) => d.id === id);
  const credenciales = new Credenciales(context.secrets, (destino, usuario) =>
    Promise.resolve(
      vscode.window.showInputBox({
        password: true,
        ignoreFocusOut: true,
        prompt: `Contraseña de ${usuario} en ${destino} (solo para la búsqueda; se guarda en el almacén seguro de VS Code)`,
      }),
    ),
  );
  const sesiones = new SesionesAdt({
    destinoDe,
    urlDe: opciones.urlDe,
    guardarUrl: opciones.guardarUrl,
    confirmarInseguro: async (_url, id) =>
      (await vscode.window.showWarningMessage(
        `La URL de ${id} es HTTP sin cifrar: la contraseña viajaría en claro. ¿Enviar de todos modos?`,
        { modal: true },
        ACCION_ENVIAR_INSEGURO,
      )) === ACCION_ENVIAR_INSEGURO,
    credenciales,
    registrar: (mensaje) => log.info(mensaje),
    puente: opciones.puente,
    rolDe: opciones.rolDe,
  });
  const abrirEnDestino = (r: ResultadoBusqueda, destino: string, mostrar?: MostrarRuta): Promise<ResultadoAbrir> => {
    const consultas = dependenciasTransaccion({ sesiones, credenciales }, destino);
    return abrirResultado(r, {
      destino,
      usuario: destinoDe(destino)?.usuario ?? '',
      listarCarpeta: async (ruta) => (await listarCarpeta(uriDeRuta(ruta))).map((e) => e.nombre),
      mostrar: mostrar ?? ((ruta) => Promise.resolve(vscode.commands.executeCommand('vscode.open', uriDeRuta(ruta)))),
      irAPaquete: async (nombre) => {
        await vscode.commands.executeCommand('abapNavigator.paquetes.ir', nombre);
      },
      registrar: (mensaje) => log.info(mensaje),
      paqueteDe: consultas.paqueteDe,
      transacciones: consultas,
    });
  };
  const buscarEn: DependenciasBuscar['buscar'] = (conexion, consulta, signal) => buscar(conexion, consulta, signal, MAX_RESULTADOS);
  // Silenciosa: con el QuickPick abierto, el cuadro de la contraseña lo cerraría.
  const consultarEnDestino: BusquedaRegistrada['consultar'] = async (destino, texto, signal, filtro) => {
    const sesion = await sesiones.sesionSilenciosa(destino);
    if (sesion.estado !== 'ok') {
      throw new Error(MSG_SIN_SESION);
    }
    try {
      return await consultarEn(buscarEn, sesion.conexion, texto, signal, filtro);
    } catch (err) {
      if (esNoAutorizado(err)) {
        await caducarContrasena(destino, { sesiones, credenciales });
        void vscode.window.showWarningMessage(MSG_CONTRASENA_CADUCADA);
        throw new ErrorContrasenaCaducada();
      }
      throw err;
    }
  };
  registrarComandoBuscar(context, {
    sistemaActivo: opciones.sistemaActivo,
    sesiones,
    recientes: new Recientes(context.globalState),
    credenciales,
    olvidarUrl: opciones.quitarUrl,
    puente: opciones.puente,
    estadoDe: estadoConexion,
    conectar: opciones.conectar,
    buscar: buscarEn,
    abrir: abrirEnDestino,
    buscarOficial: async () => {
      await ejecutarComandoOficial(COMANDO_ABRIR_OBJETO);
    },
  });
  return {
    sesiones,
    credenciales,
    abrirResultado: abrirEnDestino,
    abrirSesion: (destino) => abrirSesionPara(sesiones, destino),
    consultar: consultarEnDestino,
  };
}
