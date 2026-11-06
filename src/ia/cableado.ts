import path from 'node:path';
import * as vscode from 'vscode';
import { paqueteSinFiltro } from '../adt/busqueda-cliente';
import { FILTROS_TIPO, type ResultadoBusqueda } from '../adt/busqueda-modelo';
import { ACCEPT_DATA_PREVIEW, RUTA_DATA_PREVIEW, analizarDataPreview } from '../adt/transaccion';
import { uriOrigenDe } from '../bloques/bloque-modelo';
import { analizarUriAbap, type UriMinimo } from '../bridge/adt-uri';
import type { EstadoDestino } from '../bridge/logon-oficial';
import { uriDeRuta } from '../bridge/repotree-oficial';
import { simbolosDe } from '../bridge/simbolos-oficial';
import type { BusquedaRegistrada } from '../commands/buscar';
import { crearObjeto, type DependenciasCrearObjeto } from '../commands/crear-objeto';
import { argumentoAsistente, lanzamientoDe } from '../commands/crear-objeto-modelo';
import type { Destino } from '../config/destinos';
import type { RolSistema } from '../config/navegador-config';
import type { SistemaActivo } from '../config/sistema-activo';
import { log } from '../log';
import { leerTextoAbap } from '../navegacion/perform-navegacion';
import type { ServicioObjeto } from '../objeto/servicio';
import { COMANDO_ABRIR_DIARIO } from '../tree/objeto-modelo';
import type { ProveedorObjeto } from '../tree/objeto-proveedor';
import { mensajeDe, nombreDeError } from '../util/errores';
import { RegistroActividad, VISTA_IA, textoBadge, type NodoActividad } from './actividad-modelo';
import { ProveedorActividad } from './actividad-proveedor';
import {
  CLAVE_REGISTRO_OFRECIDO,
  CLAVE_TOKEN,
  esperarLogonEnCurso,
  generarToken,
  sondear,
  tomarPuerto,
} from './cableado-modelo';
import { crearComandosPropuestas } from './comandos-propuestas';
import { TIPO_ADT_PROGRAMA, claveObjeto, objetoPedidoEn, ordenUnicaModificable, paqueteDeObjeto } from './creacion-modelo';
import { ControladorContexto } from './contexto';
import { AlmacenDiario } from './diario';
import { uriTexto } from './contexto-modelo';
import { identidadSegunVista, type IdentidadDiario, type NuevaEntrada } from './diario-modelo';
import { ESPERA_LOGON_MS, ErrorHerramienta, crearCatalogoLectura, rutaDeUriTexto, type DependenciasHerramientas } from './herramientas';
import { crearCatalogoDiario } from './herramientas-diario';
import { crearCatalogoEscritura, type DependenciasEscritura } from './herramientas-escritura';
import { ORDEN_SISTEMA, crearCatalogoSistema, releaseDe, type DependenciasSistema } from './herramientas-sistema';
import { INSTRUCCIONES_AGENTE, type DependenciasDespacho, type HerramientaMcp, type RegistroLlamada } from './mcp-modelo';
import { dependenciasOficialEscritura } from './oficial-escritura';
import { GestorPropuestas } from './propuestas';
import { ESQUEMA_PROPUESTA, ProveedorDocumentoPropuesta } from './propuestas-documento';
import { RegistroPropuestas } from './propuestas-modelo';
import {
  comandoParaCopiar,
  consultarRegistro,
  ejecutorCliPorDefecto,
  registrarEnClaude,
  textoConfiguracion,
} from './registro-claude';
import { PUERTO_POR_DEFECTO, RUTA_CEDER, ServidorHttpMcp } from './servidor-http';
import { TIEMPO_CVERS_MS, type FalloCvers, type InfoCacheada } from './sistema-modelo';

export const COMANDOS_IA = {
  arrancar: 'abapNavigator.ia.arrancar',
  parar: 'abapNavigator.ia.parar',
  conectarAgente: 'abapNavigator.ia.conectarAgente',
  copiarConfiguracion: 'abapNavigator.ia.copiarConfiguracion',
  regenerarToken: 'abapNavigator.ia.regenerarToken',
  abrirLlamada: 'abapNavigator.ia.abrirLlamada',
  aplicarPropuesta: 'abapNavigator.ia.aplicarPropuesta',
  rechazarPropuesta: 'abapNavigator.ia.rechazarPropuesta',
  abrirPropuesta: 'abapNavigator.ia.abrirPropuesta',
  abrirDiario: COMANDO_ABRIR_DIARIO,
} as const;

const CONTEXTO_HAY_PROPUESTAS = 'abapNavigator.ia.hayPropuestas';

const SECCION_AJUSTES = 'abapNavigator.ia';
const ACCION_CONECTAR_AGENTE = 'Conectar el agente';
const ACCION_REGENERAR = 'Regenerar';
const TIEMPO_CESION_MS = 2000;
const INTERVALO_LOGON_EN_CURSO_MS = 500;
/** Tras `abrir_objeto` la vista Objeto tarda un momento en cargar el objeto nuevo. */
const ESPERA_VISTA_OBJETO_MS = 3000;
const INTERVALO_VISTA_OBJETO_MS = 250;
/** Sondeo de los editores mientras el usuario completa el asistente de creación de la oficial. */
const INTERVALO_OBJETO_CREADO_MS = 500;
const ACCION_ABRIR_ASISTENTE = 'Abrir asistente';
const ACCION_CREAR = 'Crear';

const AVISO_CONVIVENCIA =
  'Si también tienes registrado en el agente el servidor MCP «adt» de la extensión oficial de SAP, el agente podría ' +
  'editar con abap_object_edit_file saltándose el diff de Sextante y la regla de rol (QAS/PRD). Esa herramienta solo ' +
  'existe si la oficial tiene activado adt.mcpServer.enableEditFileToolForABAPObjects (por defecto, desactivado).';

/** Conexión de la oficial vista desde el agente: sin marcar el destino como activo. */
export interface ConexionOficialIa {
  /** `silencioso`: sin aviso en el log si el estado es desconocido (sondeos repetidos). */
  estadoDe(id: string, silencioso?: boolean): Promise<EstadoDestino>;
  conectar(id: string): Promise<void>;
  /** La vista Sistemas tiene un logon en curso para el destino. */
  estaConectando(id: string): boolean;
}

export interface OpcionesIa {
  busqueda: BusquedaRegistrada;
  sistemaActivo: SistemaActivo;
  proveedorObjeto: ProveedorObjeto;
  modoBloque(): boolean;
  rolDe(id: string): RolSistema | undefined;
  conexionOficial: ConexionOficialIa;
  /** `context.extension.packageJSON.version`. */
  version: string;
  /** Las mismas dependencias que el comando «Nuevo objeto ABAP»: `crear_objeto` lanza el mismo asistente. */
  crearObjeto: DependenciasCrearObjeto;
  /** Órdenes del programa principal al crear un include directo (como «Orden del objeto»). */
  servicioObjeto: Pick<ServicioObjeto, 'ordenesDeObjeto'>;
  destinoPorId(id: string): Destino | undefined;
}

export interface IaRegistrada {
  servidor: ServidorHttpMcp | undefined;
  registro: RegistroActividad;
  contexto: ControladorContexto;
  catalogo: HerramientaMcp[];
  propuestas: GestorPropuestas;
  registroPropuestas: RegistroPropuestas;
  diario: AlmacenDiario;
  arrancar(): Promise<void>;
  parar(): Promise<void>;
  token(): Promise<string>;
}

interface AjustesIa {
  servidor: boolean;
  puerto: number;
}

function leerAjustes(): AjustesIa {
  const ajustes = vscode.workspace.getConfiguration(SECCION_AJUSTES);
  return { servidor: ajustes.get<boolean>('servidor', true), puerto: ajustes.get<number>('puerto', PUERTO_POR_DEFECTO) };
}

function destinoDeUri(uri: vscode.Uri | undefined): string | undefined {
  return uri === undefined ? undefined : analizarUriAbap(uriOrigenDe(uri))?.destino;
}

/**
 * Única regla de identidad del diario (almacén, herramientas, contexto, nodo y botón): un include de programa que la
 * vista Objeto muestra dentro del programa abierto va al diario del programa; el resto, según su uri.
 */
function identidadDeUriConVista(proveedorObjeto: ProveedorObjeto, uri: string): IdentidadDiario | undefined {
  return identidadSegunVista(uri, {
    pertenece: (texto) => proveedorObjeto.pertenece(uriDeRuta(rutaDeUriTexto(texto))),
    programaMostrado: () => {
      const abierto = proveedorObjeto.objeto;
      return abierto?.tipo === 'programa' ? uriTexto(abierto.uri) : undefined;
    },
  });
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/** El almacén es común a todas las ventanas: tras guardar uno nuevo se adopta el que quedó (gana la última escritura). */
async function leerOCrearToken(secretos: vscode.SecretStorage): Promise<string> {
  const guardado = await secretos.get(CLAVE_TOKEN);
  if (guardado !== undefined && guardado !== '') {
    return guardado;
  }
  const nuevo = generarToken();
  await secretos.store(CLAVE_TOKEN, nuevo);
  const releido = await secretos.get(CLAVE_TOKEN);
  return releido !== undefined && releido !== '' ? releido : nuevo;
}

/** Pide a la ventana que atiende el puerto que lo suelte; si no responde, siguen los reintentos normales. */
async function pedirCesion(puerto: number, token: string): Promise<void> {
  log.info(`IA: se pide el puerto ${puerto} a la ventana que lo atiende`);
  try {
    await fetch(`http://127.0.0.1:${puerto}${RUTA_CEDER}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIEMPO_CESION_MS),
    });
  } catch {
    // Sin respuesta: quizá ya lo soltó o es otro programa; los reintentos lo dirán.
  }
}

/** Abre un resultado de búsqueda en un editor; `ruta` solo si la oficial llegó a abrirlo. */
async function abrirEnEditor(
  busqueda: BusquedaRegistrada,
  r: ResultadoBusqueda,
  destino: string,
): ReturnType<DependenciasHerramientas['abrirResultado']> {
  let ruta: string | undefined;
  const resultado = await busqueda.abrirResultado(r, destino, (abierta) => {
    ruta = abierta;
    return Promise.resolve(vscode.commands.executeCommand('vscode.open', uriDeRuta(abierta)));
  });
  return { resultado, ruta };
}

/** Herramientas de lectura sobre lo que Sextante ya tiene: búsqueda, conexión de la oficial, vista Objeto. */
function dependenciasHerramientas(opciones: OpcionesIa, contexto: ControladorContexto, sistemaPorDefecto: () => string | undefined): DependenciasHerramientas {
  const { busqueda, proveedorObjeto, conexionOficial } = opciones;
  return {
    contexto: () => contexto.actual(),
    sistemaPorDefecto,
    estadoDe: (id, silencioso) => conexionOficial.estadoDe(id, silencioso),
    conectar: async (id) => {
      if (!conexionOficial.estaConectando(id)) {
        await conexionOficial.conectar(id);
        return;
      }
      // Otro logon (del usuario o de una llamada anterior) sigue abierto: lanzar otro respondería "ya se está
      // conectando" al instante y la herramienta lo tomaría por una cancelación.
      log.info('IA: logon ya en curso en la vista Sistemas; se espera a que termine');
      await esperarLogonEnCurso(id, conexionOficial, {
        intervaloMs: INTERVALO_LOGON_EN_CURSO_MS,
        limiteMs: ESPERA_LOGON_MS,
        esperar,
        ahora: Date.now,
      });
    },
    consultar: async (destino, texto, filtroId) => {
      // `consultar` nunca pide la contraseña: si no hay sesión ADT propia se abre aquí, con la pregunta al usuario.
      if ((await busqueda.sesiones.sesionSilenciosa(destino)).estado !== 'ok' && !(await busqueda.abrirSesion(destino))) {
        throw new ErrorHerramienta(
          `Sin conexión ADT propia con ${destino}: el usuario debe escribir la contraseña de búsqueda cuando VS Code se la pida ` +
            '(o abrir el objeto desde la búsqueda de Sextante) y volver a intentarlo',
        );
      }
      const filtro = filtroId === undefined ? undefined : FILTROS_TIPO.find((f) => f.id === filtroId);
      return busqueda.consultar(destino, texto, new AbortController().signal, filtro);
    },
    abrirResultado: (r, destino) => abrirEnEditor(busqueda, r, destino),
    viaDe: (id) => busqueda.sesiones.viaDe(id),
    leerTexto: leerTextoAbap,
    arbolDe: async (ruta) => {
      const uri = uriDeRuta(ruta);
      if (!proveedorObjeto.pertenece(uri) && proveedorObjeto.fijado) {
        throw new ErrorHerramienta('La vista Objeto está fijada en otro objeto; pide al usuario que la suelte (botón «Soltar objeto» de la vista Objeto) y vuelve a llamar');
      }
      const cargado = await sondear(() => proveedorObjeto.pertenece(uri), {
        intervaloMs: INTERVALO_VISTA_OBJETO_MS,
        limiteMs: ESPERA_VISTA_OBJETO_MS,
        esperar,
        ahora: Date.now,
      });
      return cargado ? (await proveedorObjeto.getChildren())[0] : undefined;
    },
  };
}

/** Herramientas de escritura: toda edición pasa por el diff del gestor y la decisión del usuario. */
function dependenciasEscritura(opciones: OpcionesIa, gestor: GestorPropuestas, registroPropuestas: RegistroPropuestas): DependenciasEscritura {
  return {
    rolDe: (id) => opciones.rolDe(id),
    // Del TextDocument y no de los bytes del FS: VS Code normaliza los saltos de línea y Aplicar compara con su texto.
    leerTexto: async (ruta) => {
      try {
        return (await vscode.workspace.openTextDocument(uriDeRuta(ruta))).getText();
      } catch {
        return undefined;
      }
    },
    proponer: (datos) => gestor.proponer(datos),
    esperarDecision: (id, ms) => registroPropuestas.esperarDecision(id, ms),
    ...dependenciasOficialEscritura(),
  };
}

/** Uris de origen (la abap: detrás de un bloque) de las pestañas y los editores visibles. */
function urisAbiertas(): UriMinimo[] {
  const uris: vscode.Uri[] = [];
  for (const grupo of vscode.window.tabGroups.all) {
    for (const { input } of grupo.tabs) {
      if (input instanceof vscode.TabInputText) uris.push(input.uri);
    }
  }
  uris.push(...vscode.window.visibleTextEditors.map((e) => e.document.uri));
  return uris.map((uri) => uriOrigenDe(uri));
}

/**
 * Claves de los objetos abiertos (por cualquiera de sus archivos), para que no cuenten como recién creados.
 */
function instantaneaObjetos(): ReadonlySet<string> {
  return new Set(urisAbiertas().map(claveObjeto).filter((clave) => clave !== undefined));
}

/** El asistente de la oficial abre el objeto nuevo al crearlo: se espera a que aparezca su editor. */
async function esperarObjetoCreado(
  destino: string,
  nombre: string,
  limiteMs: number,
  previos: ReadonlySet<string>,
): Promise<{ uri: string; paquete: string } | undefined> {
  let encontrado: { uri: string; paquete: string } | undefined;
  const buscar = (): boolean => {
    for (const uri of urisAbiertas()) {
      const clave = claveObjeto(uri);
      const objeto = clave === undefined || previos.has(clave) ? undefined : objetoPedidoEn(uri, destino, nombre);
      if (objeto !== undefined) {
        encontrado = { uri: uriTexto(uri), paquete: paqueteDeObjeto(objeto) };
        return true;
      }
    }
    return false;
  };
  await sondear(buscar, { intervaloMs: INTERVALO_OBJETO_CREADO_MS, limiteMs, esperar, ahora: Date.now });
  return encontrado;
}

async function lanzarAsistente(deps: DependenciasCrearObjeto, destino: string): ReturnType<DependenciasSistema['lanzarAsistente']> {
  try {
    return lanzamientoDe(await crearObjeto(deps, { ruta: argumentoAsistente(destino).path }), destino);
  } catch (err) {
    return { ok: false, motivo: `el asistente de la oficial falló: ${mensajeDe(err)}` };
  }
}

/**
 * `info_sistema` por la sesión ADT propia y Data Preview; `crear_objeto` por el asistente de la oficial o, para un
 * include de un programa que ya existe, por la sesión ADT propia tras el clic en «Crear».
 */
function dependenciasSistema(
  opciones: OpcionesIa,
  sistemaPorDefecto: () => string | undefined,
  cache: Map<string, InfoCacheada>,
  fallosCvers: Map<string, FalloCvers>,
  anotarDiario: (uri: string, entrada: NuevaEntrada) => Promise<void>,
): DependenciasSistema {
  const { busqueda } = opciones;
  const { sesiones } = busqueda;
  return {
    sistemaPorDefecto,
    rolDe: (id) => opciones.rolDe(id),
    viaDe: (id) => sesiones.viaDe(id),
    sesionSilenciosa: (id) => sesiones.sesionSilenciosa(id),
    consultarSql: async (c, sql, filas) => {
      // Sin partirSqlEnLineas: el SQL de CVERS tiene 67 caracteres, muy por debajo del límite de 255 por línea.
      const parametros = { rowNumber: String(filas) };
      const r = await c.post(RUTA_DATA_PREVIEW, sql, 'text/plain', ACCEPT_DATA_PREVIEW, undefined, parametros, TIEMPO_CVERS_MS);
      return analizarDataPreview(r.cuerpo);
    },
    cache,
    fallosCvers,
    copiar: (texto) => Promise.resolve(vscode.env.clipboard.writeText(texto)),
    confirmarGuia: async (mensaje, detalle) =>
      (await vscode.window.showInformationMessage(mensaje, { modal: true, detail: detalle }, ACCION_ABRIR_ASISTENTE)) ===
      ACCION_ABRIR_ASISTENTE,
    lanzarAsistente: (destino) => lanzarAsistente(opciones.crearObjeto, destino),
    instantaneaObjetos,
    esperarObjeto: esperarObjetoCreado,
    anotarDiario,
    usuarioDe: (id) => opciones.destinoPorId(id)?.usuario,
    paqueteDePrograma: (c, nombre) => paqueteSinFiltro(c, nombre, TIPO_ADT_PROGRAMA),
    // Siempre fresco, como «Orden del objeto»: la orden puede haberse creado o liberado hace un momento.
    ordenAbiertaDe: async (destino, programa) =>
      ordenUnicaModificable(await opciones.servicioObjeto.ordenesDeObjeto(destino, programa, 'programa', { forzar: true })),
    confirmarCreacion: async (mensaje, detalle) =>
      (await vscode.window.showInformationMessage(mensaje, { modal: true, detail: detalle }, ACCION_CREAR)) === ACCION_CREAR,
    // Verificado contra un sistema real el 2026-11-04: ADT acepta como Accept el content type del cuerpo.
    crear: (c, ruta, cuerpo, ct, params) => c.post(ruta, cuerpo, ct, ct, undefined, params),
    abrirCreado: async (r, destino) => {
      try {
        const { ruta } = await abrirEnEditor(busqueda, r, destino);
        return ruta === undefined ? undefined : uriTexto(uriDeRuta(ruta));
      } catch (err) {
        log.warn(`IA: abrir el objeto creado falló (${nombreDeError(err)})`);
        return undefined;
      }
    },
  };
}

export function activarIa(context: vscode.ExtensionContext, opciones: OpcionesIa): IaRegistrada {
  const registro = new RegistroActividad();
  const registroPropuestas = new RegistroPropuestas();
  const identidadDiario = (uri: string): IdentidadDiario | undefined => identidadDeUriConVista(opciones.proveedorObjeto, uri);
  const almacen = new AlmacenDiario({
    carpetaBase: path.join(context.globalStorageUri.fsPath, 'diario'),
    registrar: (linea, nivel) => (nivel === 'warn' ? log.warn(linea) : log.info(linea)),
    resolverIdentidad: identidadDiario,
  });
  const documentos = new ProveedorDocumentoPropuesta(registroPropuestas);
  const gestor = new GestorPropuestas(registroPropuestas, documentos, {
    abrirDocumento: (uri) => vscode.workspace.openTextDocument(uri),
    aplicarEdicion: (edicion) => vscode.workspace.applyEdit(edicion),
    guardar: (doc) => doc.save(),
    mostrarDiff: (izquierda, derecha, titulo) => vscode.commands.executeCommand<void>('vscode.diff', izquierda, derecha, titulo),
    mostrarDocumento: (doc) => vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false }),
    pedirMotivo: () => vscode.window.showInputBox({ prompt: 'Motivo del rechazo (opcional)', placeHolder: 'Se lo devuelve al agente' }),
  });
  // Mismo orden que contexto_actual: editor abap: activo, último editor abap:, sistema activo.
  let ultimoDestinoEditor = destinoDeUri(vscode.window.activeTextEditor?.document.uri);
  const sistemaPorDefecto = (): string | undefined =>
    destinoDeUri(vscode.window.activeTextEditor?.document.uri) ?? ultimoDestinoEditor ?? opciones.sistemaActivo.id;

  const cacheSistema = new Map<string, InfoCacheada>();
  const fallosCvers = new Map<string, FalloCvers>();
  opciones.busqueda.sesiones.alCambiarVia((id) => {
    cacheSistema.delete(id);
    fallosCvers.delete(id);
  });
  const depsSistema = dependenciasSistema(opciones, sistemaPorDefecto, cacheSistema, fallosCvers, async (uri, entrada) => {
    const id = identidadDiario(uri);
    if (id !== undefined) {
      await almacen.anotar(id, entrada);
    }
  });
  const contexto = new ControladorContexto({
    simbolosDe,
    rolDe: (id) => opciones.rolDe(id),
    viaDe: (id) => opciones.busqueda.sesiones.viaDe(id),
    sistemaActivo: () => opciones.sistemaActivo.id,
    modoBloque: () => opciones.modoBloque(),
    propuestasPendientes: () => registroPropuestas.pendientes.map(({ id, resumen, uri }) => ({ id, resumen, uri })),
    releaseDe: (id) => releaseDe(depsSistema, id),
    diarioDe: async (uri) => {
      try {
        const id = identidadDiario(uri);
        if (id === undefined) {
          return undefined;
        }
        const resumen = await almacen.resumen(id);
        return { ...resumen, archivo: almacen.rutaDe(id) };
      } catch (err) {
        log.warn(`IA: no se pudo leer el diario para el contexto (${nombreDeError(err)})`);
        return undefined;
      }
    },
  });
  contexto.seguir(context);

  const catalogoSistema = crearCatalogoSistema(depsSistema);
  const herramientaSistema = (nombre: (typeof ORDEN_SISTEMA)[number]): HerramientaMcp[] => catalogoSistema.filter((h) => h.nombre === nombre);

  const catalogo = [
    ...crearCatalogoLectura(dependenciasHerramientas(opciones, contexto, sistemaPorDefecto)),
    ...herramientaSistema('info_sistema'),
    ...crearCatalogoDiario({
      leer: (id) => almacen.leer(id),
      anotar: (id, entrada) => almacen.anotar(id, entrada),
      rutaDe: (id) => almacen.rutaDe(id),
      identidadDe: identidadDiario,
    }),
    ...herramientaSistema('crear_objeto'),
    ...crearCatalogoEscritura(dependenciasEscritura(opciones, gestor, registroPropuestas)),
  ];
  let servidor: ServidorHttpMcp | undefined;
  let tokenServidor: string | undefined;
  const leerToken = (): Promise<string> => {
    const promesa = leerOCrearToken(context.secrets);
    promesa.catch((err: unknown) => log.error(`IA: leer el token del agente falló (${nombreDeError(err)})`));
    return promesa;
  };
  let tokenActual = leerToken();
  let activo = leerAjustes().servidor;
  let registradoEnClaude: boolean | undefined;
  let cola: Promise<void> = Promise.resolve();

  const fijarEscuchando = (s: ServidorHttpMcp): void => {
    const puerto = s.puerto;
    if (puerto !== undefined) {
      registro.fijarServidor({ estado: 'escuchando', puerto, sesiones: s.sesiones });
    }
  };

  const despacho: DependenciasDespacho = {
    catalogo,
    version: opciones.version,
    instrucciones: INSTRUCCIONES_AGENTE,
    registrar: (llamada: RegistroLlamada) => {
      registro.anotar(llamada);
      log.info(`IA: ${llamada.herramienta} → ${llamada.resultado}`);
      if (servidor !== undefined) {
        fijarEscuchando(servidor);
      }
    },
  };

  /** Arranques y cierres en serie: un cambio de foco no adelanta a un arranque que aún reintenta. */
  const enCola = (operacion: () => Promise<void>): Promise<void> => {
    const siguiente = cola.then(operacion);
    cola = siguiente.catch(() => undefined);
    return siguiente;
  };

  /** Otra ventana ganó el foco y pide el puerto: esta lo suelta y pasa a "atiende otra ventana". */
  const ceder = (cedido: ServidorHttpMcp): Promise<void> =>
    enCola(async () => {
      const puerto = cedido.puerto;
      if (servidor !== cedido || puerto === undefined) {
        return;
      }
      // Carrera: la otra ventana pidió el puerto al ganar el foco, pero esta lo recuperó antes de atender la petición
      // (cambio rápido de ventana). Soltarlo dejaría el puerto a quien ya no tiene el foco; se conserva y la otra, al
      // agotar sus reintentos, queda en "atiende otra ventana".
      if (vscode.window.state.focused) {
        log.info('IA: petición de ceder el puerto ignorada; esta ventana tiene el foco');
        return;
      }
      await cedido.cerrar();
      log.info('IA: puerto cedido a otra ventana');
      registro.fijarServidor({ estado: 'otraVentana', puerto });
    });

  const asegurarServidor = async (): Promise<ServidorHttpMcp> => {
    const token = await tokenActual;
    if (servidor === undefined) {
      const nuevo: ServidorHttpMcp = new ServidorHttpMcp({
        token,
        despacho,
        registrar: (m) => log.info(m),
        alCeder: () => void ceder(nuevo),
      });
      servidor = nuevo;
      tokenServidor = token;
    }
    return servidor;
  };

  /**
   * `requiereFoco`: deja de reintentar si la ventana pierde el foco. `pedir`: con false no se pide el puerto a la
   * ventana que lo tiene (arranque sin foco: si está libre se toma; si no, "atiende otra ventana").
   */
  const tomar = (requiereFoco: boolean, pedir = true): Promise<void> =>
    enCola(async () => {
      if (!activo) {
        return;
      }
      const puerto = leerAjustes().puerto;
      try {
        const s = await asegurarServidor();
        if (s.puerto !== undefined) {
          fijarEscuchando(s);
          return;
        }
        const sigue = (): boolean => activo && (!requiereFoco || vscode.window.state.focused);
        const token = tokenServidor ?? (await tokenActual);
        const cesion = pedir ? (): Promise<void> => pedirCesion(puerto, token) : (): Promise<void> => Promise.resolve();
        const resultado = await tomarPuerto((p) => s.arrancar(p), puerto, sigue, esperar, cesion);
        if (resultado === 'ocupado') {
          log.info(`IA: el puerto ${puerto} lo atiende otra ventana`);
          registro.fijarServidor({ estado: 'otraVentana', puerto });
        } else if (resultado !== 'sinFoco') {
          log.info(`IA: servidor escuchando en 127.0.0.1:${resultado}`);
          fijarEscuchando(s);
        }
      } catch (err) {
        log.error(`IA: el servidor no arrancó (${nombreDeError(err)})`);
        registro.fijarServidor({ estado: 'error', mensaje: mensajeDe(err) });
      }
    });

  /**
   * El token cambió en el almacén (esta u otra ventana lo regeneró, o dos ventanas lo crearon a la vez): se adopta el
   * guardado y, si el servidor de esta ventana usa otro, se descarta; si estaba atendiendo, se rearranca con el nuevo.
   */
  const adoptarToken = async (): Promise<void> => {
    tokenActual = leerToken();
    const token = await tokenActual;
    let atendia = false;
    await enCola(async () => {
      if (servidor === undefined || token === tokenServidor) {
        return;
      }
      atendia = servidor.puerto !== undefined;
      await servidor.cerrar();
      servidor = undefined;
      tokenServidor = undefined;
      log.info('IA: token del agente cambiado; servidor descartado');
    });
    if (atendia) {
      await tomar(false);
    }
  };

  const cerrarDel = (): Promise<void> =>
    enCola(async () => {
      await servidor?.cerrar();
      registro.fijarServidor({ estado: 'parado' });
    });

  const arrancar = async (): Promise<void> => {
    activo = true;
    await tomar(false);
  };

  const parar = async (): Promise<void> => {
    activo = false;
    await cerrarDel();
    log.info('IA: servidor parado');
  };

  const proveedor = new ProveedorActividad(registro, () => registradoEnClaude, () => ({
    pendientes: registroPropuestas.pendientes,
    decididas: registroPropuestas.decididas,
  }));
  const vista = vscode.window.createTreeView(VISTA_IA, { treeDataProvider: proveedor });
  // ProveedorActividad solo escucha al registro: se vuelve a fijar el mismo estado para repintar la vista.
  const repintar = (): void => registro.fijarServidor(registro.servidor);

  const alCambiarPropuestas = (): void => {
    const pendientes = registroPropuestas.pendientes.length;
    vista.badge = textoBadge(pendientes);
    void vscode.commands.executeCommand('setContext', CONTEXTO_HAY_PROPUESTAS, pendientes > 0);
    repintar();
  };

  const comandosPropuestas = crearComandosPropuestas(gestor, registroPropuestas);

  const conectarAgente = async (): Promise<void> => {
    if (context.globalState.get<boolean>(CLAVE_REGISTRO_OFRECIDO) !== true) {
      await context.globalState.update(CLAVE_REGISTRO_OFRECIDO, true);
      const eleccion = await vscode.window.showWarningMessage(AVISO_CONVIVENCIA, { modal: true }, ACCION_CONECTAR_AGENTE);
      if (eleccion !== ACCION_CONECTAR_AGENTE) {
        return;
      }
    }
    const puerto = leerAjustes().puerto;
    const token = await tokenActual;
    const resultado = await registrarEnClaude(puerto, token, ejecutorCliPorDefecto());
    log.info(`IA: conectar el agente → ${resultado.estado}`);
    switch (resultado.estado) {
      case 'registrado':
        registradoEnClaude = true;
        repintar();
        void vscode.window.showInformationMessage(`Sextante quedó registrado en Claude Code (127.0.0.1:${puerto}).`);
        return;
      case 'sinCli': {
        const contenido = [
          'No se encontró la CLI de Claude Code (claude) en el PATH.',
          'Ejecuta este comando en una terminal para conectar el agente con Sextante.',
          'Contiene el token del servidor local: no lo compartas ni lo guardes en un repositorio.',
          '',
          comandoParaCopiar(puerto, token),
          '',
        ].join('\n');
        const documento = await vscode.workspace.openTextDocument({ content: contenido, language: 'plaintext' });
        await vscode.window.showTextDocument(documento);
        return;
      }
      case 'noRegistrado':
      case 'desconocido':
        void vscode.window.showWarningMessage(
          'No se pudo confirmar el registro en Claude Code. Compruébalo con «claude mcp get sextante» o usa «Copiar configuración MCP».',
        );
        return;
    }
  };

  const copiarConfiguracion = async (): Promise<void> => {
    await vscode.env.clipboard.writeText(textoConfiguracion(leerAjustes().puerto, await tokenActual));
    void vscode.window.showInformationMessage('Configuración MCP copiada al portapapeles. Contiene el token: no la compartas.');
  };

  const regenerarToken = async (): Promise<void> => {
    const eleccion = await vscode.window.showWarningMessage(
      '¿Regenerar el token del agente? Los agentes ya conectados perderán el acceso hasta que vuelvas a conectarlos.',
      { modal: true },
      ACCION_REGENERAR,
    );
    if (eleccion !== ACCION_REGENERAR) {
      return;
    }
    await context.secrets.store(CLAVE_TOKEN, generarToken());
    await adoptarToken();
    registradoEnClaude = false;
    repintar();
    log.info('IA: token regenerado');
    void vscode.window.showInformationMessage('Token del agente regenerado: vuelve a conectar el agente (Sextante: Conectar el agente).');
  };

  const abrirLlamada = async (nodo: NodoActividad | undefined): Promise<void> => {
    if (nodo?.uri !== undefined) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(nodo.uri));
    }
  };

  const registrarComando = <A extends unknown[]>(id: string, manejador: (...args: A) => Promise<void>): vscode.Disposable =>
    vscode.commands.registerCommand(id, (...args: A) =>
      manejador(...args).catch((err: unknown) => {
        log.error(`IA: ${id} falló (${nombreDeError(err)})`);
        void vscode.window.showErrorMessage(`No se pudo completar la acción del agente (${nombreDeError(err)}).`);
      }),
    );

  const { proveedorObjeto } = opciones;

  /** El proveedor descarta el resumen en cada reconstrucción: se vuelve a leer y se fija si el objeto no cambió. */
  const refrescarNodoDiario = async (): Promise<void> => {
    const abierto = proveedorObjeto.objeto;
    if (abierto === undefined) {
      return;
    }
    const id = identidadDiario(uriTexto(abierto.uri));
    const resumen = id === undefined ? undefined : await almacen.resumen(id);
    if (proveedorObjeto.objeto?.uri.toString() === abierto.uri.toString()) {
      proveedorObjeto.fijarDiario(resumen);
    }
  };
  const refrescarNodoDiarioSinFallar = (): void => {
    refrescarNodoDiario().catch((err: unknown) => log.warn(`IA: no se pudo refrescar el nodo Diario (${nombreDeError(err)})`));
  };

  const abrirDiario = async (): Promise<void> => {
    const abierto = proveedorObjeto.objeto;
    if (abierto === undefined) {
      void vscode.window.showInformationMessage('Abre un objeto ABAP para ver su diario');
      return;
    }
    try {
      const id = identidadDiario(uriTexto(abierto.uri));
      if (id === undefined) {
        void vscode.window.showInformationMessage('Este objeto no admite diario');
        return;
      }
      const ruta = await almacen.crearSiFalta(id);
      await vscode.window.showTextDocument(vscode.Uri.file(ruta), { viewColumn: vscode.ViewColumn.Beside, preview: false });
    } catch (err) {
      log.error(`IA: abrir el diario falló (${nombreDeError(err)})`);
      void vscode.window.showErrorMessage('No se pudo abrir el diario');
    }
  };

  const ofrecerConexion = async (): Promise<void> => {
    if (!activo || context.globalState.get<boolean>(CLAVE_REGISTRO_OFRECIDO) === true) {
      return;
    }
    await context.globalState.update(CLAVE_REGISTRO_OFRECIDO, true);
    const eleccion = await vscode.window.showInformationMessage(
      `¿Conectar Claude Code con Sextante para que el agente trabaje con tus objetos ABAP? ${AVISO_CONVIVENCIA}`,
      ACCION_CONECTAR_AGENTE,
    );
    if (eleccion === ACCION_CONECTAR_AGENTE) {
      await vscode.commands.executeCommand(COMANDOS_IA.conectarAgente);
    }
  };

  const comprobarRegistro = async (): Promise<void> => {
    const estado = await consultarRegistro(ejecutorCliPorDefecto());
    log.info(`IA: registro en Claude Code → ${estado.estado}`);
    if (estado.estado === 'registrado' || estado.estado === 'noRegistrado') {
      registradoEnClaude = estado.estado === 'registrado';
      repintar();
    }
    if (estado.estado !== 'registrado') {
      await ofrecerConexion();
    }
  };

  const alCambiarAjustes = async (): Promise<void> => {
    activo = leerAjustes().servidor;
    await cerrarDel();
    if (activo && vscode.window.state.focused) {
      await tomar(true);
    }
  };

  context.subscriptions.push(
    proveedor,
    vista,
    registrarComando(COMANDOS_IA.arrancar, arrancar),
    registrarComando(COMANDOS_IA.parar, parar),
    registrarComando(COMANDOS_IA.conectarAgente, conectarAgente),
    registrarComando(COMANDOS_IA.copiarConfiguracion, copiarConfiguracion),
    registrarComando(COMANDOS_IA.regenerarToken, regenerarToken),
    registrarComando(COMANDOS_IA.abrirLlamada, abrirLlamada),
    // NO VERIFICADO: que en un editor de diff `resourceScheme` (el `when` de los botones del título en package.json)
    // sea el del lado derecho (modified, `sextante-propuesta:`) y que la Uri que reciben estos comandos sea esa.
    registrarComando(COMANDOS_IA.aplicarPropuesta, comandosPropuestas.aplicar),
    registrarComando(COMANDOS_IA.rechazarPropuesta, comandosPropuestas.rechazar),
    registrarComando(COMANDOS_IA.abrirPropuesta, comandosPropuestas.abrir),
    registrarComando(COMANDOS_IA.abrirDiario, abrirDiario),
    vscode.workspace.registerTextDocumentContentProvider(ESQUEMA_PROPUESTA, documentos),
    documentos,
    gestor,
    registroPropuestas.onDidChange(alCambiarPropuestas),
    // registrarDecision ya anota sus fallos con `registrar`; el catch es solo la red de seguridad del oyente.
    registroPropuestas.onDidDecidir((p) => {
      almacen.registrarDecision(p).catch((err: unknown) => log.warn(`IA: no se pudo anotar la decisión en el diario (${nombreDeError(err)})`));
    }),
    almacen.onDidChange(refrescarNodoDiarioSinFallar),
    proveedorObjeto.onDidChangeObjeto(refrescarNodoDiarioSinFallar),
    vscode.workspace.onDidSaveTextDocument((documento) => {
      try {
        almacen.notificarCambioExterno(documento.uri.fsPath);
      } catch (err) {
        log.warn(`IA: no se pudo avisar del diario guardado (${nombreDeError(err)})`);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      ultimoDestinoEditor = destinoDeUri(editor?.document.uri) ?? ultimoDestinoEditor;
    }),
    // Al perder el foco el servidor sigue escuchando (el agente puede hablar desde una terminal externa); solo lo
    // suelta si otra ventana de Sextante gana el foco y se lo pide.
    vscode.window.onDidChangeWindowState((estado) => {
      if (estado.focused) {
        void tomar(true);
      }
    }),
    context.secrets.onDidChange((e) => {
      if (e.key === CLAVE_TOKEN) {
        adoptarToken().catch((err: unknown) => log.error(`IA: adoptar el token nuevo falló (${nombreDeError(err)})`));
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SECCION_AJUSTES)) {
        alCambiarAjustes().catch((err: unknown) => log.error(`IA: aplicar los ajustes falló (${nombreDeError(err)})`));
      }
    }),
    { dispose: () => void servidor?.cerrar() },
  );

  if (activo) {
    // Sin foco (ventana abierta en segundo plano) también se intenta, sin quitárselo a nadie: si es la única ventana el
    // puerto está libre y se atiende; si otra lo tiene, queda en "atiende otra ventana".
    void tomar(vscode.window.state.focused, vscode.window.state.focused);
  }
  refrescarNodoDiarioSinFallar();
  comprobarRegistro().catch((err: unknown) => log.error(`IA: comprobar el registro en Claude Code falló (${nombreDeError(err)})`));

  return {
    get servidor() {
      return servidor;
    },
    registro,
    contexto,
    catalogo,
    propuestas: gestor,
    registroPropuestas,
    diario: almacen,
    arrancar,
    parar,
    token: () => tokenActual,
  };
}
