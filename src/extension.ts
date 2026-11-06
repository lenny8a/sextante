import * as path from 'node:path';
import * as vscode from 'vscode';
import { crearPuentePerezoso, type PuentePerezoso } from './adt/puente-perezoso';
import type { ResultadoSesion } from './adt/sesiones';
import { registrarBloques } from './bloques/bloque-fs';
import { ID_EXTENSION_OFICIAL, avisarFaltaOficial, extensionOficialInstalada } from './bridge/extension-oficial';
import { estadoConexion } from './bridge/logon-oficial';
import { listarCarpeta, uriDeRuta } from './bridge/repotree-oficial';
import { primerasPalabrasDe, simbolosDe, versionDocumentoDe } from './bridge/simbolos-oficial';
import { ejecutarAsistenteOficial, registrarComandoCrearObjeto, type DependenciasCrearObjeto } from './commands/crear-objeto';
import { registrarComandosHerramientas } from './commands/herramientas';
import { registrarComandoTema } from './commands/tema';
import { avisarAlAbrir, registrarBusqueda, type BusquedaRegistrada } from './commands/buscar';
import { registrarComandosObjeto } from './commands/objeto';
import { registrarComandosSql } from './commands/sql';
import { registrarComandosPaquetes } from './commands/paquetes';
import { registrarComandosSistemas } from './commands/sistemas';
import { activarDesarrollo } from './desarrollo';
import { firmaConexion, prefijosPropiosDe, rolDe, urlDe, type RolSistema } from './config/navegador-config';
import { registrarIndicadorSistema } from './indicador/indicador-sistema';
import { decidirProteccion } from './proteccion/proteccion-modelo';
import { registrarProteccionSoloLectura } from './proteccion/solo-lectura';
import { leerDestinos, rutaDestinosPorDefecto, type Destino } from './config/destinos';
import { vigilarDestinos } from './config/destinos-watcher';
import { SistemaActivo } from './config/sistema-activo';
import { crearCableadoDiccionario, mensajeSinRfc, type CableadoDiccionario, type PuenteDiccionario } from './diccionario/cableado';
import { registrarHoverDiccionario, type DependenciasHover } from './diccionario/hover';
import { registrarPanelDiccionario } from './diccionario/panel-proveedor';
import { registrarComandosFirmas } from './firmas/cableado';
import { activarMonitor, type MonitorRegistrado } from './monitor/cableado';
import { avisarEnBarra, leerTextoAbap, registrarNavegacionPerform } from './navegacion/perform-navegacion';
import { rutaPrincipalDeObjeto } from './navegacion/perform-modelo';
import { activarObjetoActivo, type ObjetoActivoRegistrado } from './objeto/cableado';
import { activarIa, type IaRegistrada } from './ia/cableado';
import type { ResultadoComparar } from './objeto/comparar-sistemas';
import { log } from './log';
import { nombreDeError } from './util/errores';
import { descripcionBarra } from './tree/acciones-modelo';
import { ProveedorAcciones } from './tree/acciones-proveedor';
import { ProveedorObjeto } from './tree/objeto-proveedor';
import { ProveedorPaquetes } from './tree/paquete-proveedor';
import { descripcionDe, type OpcionesConectar } from './tree/sistemas-modelo';
import { ProveedorSistemas } from './tree/sistemas-proveedor';
import { NOMBRE_PRODUCTO } from './producto';

const INTERVALO_ESTADOS_MS = 30_000;

/** Solo se devuelve en modo de pruebas: da acceso a context.secrets y al cableado del diccionario a los tests de integración. */
export interface ApiDePrueba {
  contextoDePrueba: vscode.ExtensionContext;
  diccionario: CableadoDiccionario;
  /** Sin puente disponible (piezas de JCo ausentes en la instancia de pruebas) un destino rfc no tiene diccionario. */
  puente: PuenteDiccionario;
  objetoActivo?: ObjetoActivoRegistrado;
  monitor: MonitorRegistrado;
  ia: IaRegistrada;
  /** Para comprobar el árbol de la vista Objeto (p. ej. el nodo Diario). */
  objeto: ProveedorObjeto;
  /** Para fijar el rol de un destino desde los tests (las herramientas de escritura del agente exigen DEV). */
  sistemas: ProveedorSistemas;
}

export function activate(context: vscode.ExtensionContext): ApiDePrueba | undefined {
  const puente = crearPuenteDeVentana(context);
  // Se cierra antes que el canal de log: el cierre del puente todavía registra.
  context.subscriptions.push(puente, { dispose: () => log.dispose() });
  log.info(`${NOMBRE_PRODUCTO} activado`);

  const { proveedor: proveedorSistemas, sistemaActivo, rutaDestinos } = activarVistaSistemas(context);
  activarBloques(context, proveedorSistemas);
  const conectar = conectarPorId(proveedorSistemas);
  // Comparar con otro sistema usa las sesiones de la búsqueda, creadas después: el comando solo corre tras activate.
  const { proveedor: proveedorObjeto, modoBloque } = activarVistaObjeto(
    context,
    proveedorSistemas,
    conectar,
    () => objetoActivo.compararSistemas(),
  );
  registrarComandosSql(context, {
    tablaActiva: () => (proveedorObjeto.objeto?.tipo === 'tabla' ? proveedorObjeto.objeto.nombre : undefined),
  });
  activarVistaPaquetes(context, sistemaActivo, conectar);
  registrarComandosHerramientas(context, {
    viaRfcActiva: () => sistemaActivo.id !== undefined && busqueda.sesiones.viaDe(sistemaActivo.id) === 'rfc',
  });
  registrarComandoTema(context);
  activarVistaAcciones(context, proveedorObjeto, sistemaActivo);
  const busqueda = registrarBusqueda(context, {
    sistemaActivo,
    rutaDestinos,
    urlDe: (id) => urlDe(proveedorSistemas.config, id),
    guardarUrl: (id, url) => proveedorSistemas.fijarUrl(id, url),
    quitarUrl: (id) => proveedorSistemas.quitarUrl(id),
    rolDe: (id) => rolDe(proveedorSistemas.config, id),
    conectar: (id) => conectar(id, { marcarActivo: false }),
    puente,
  });
  proveedorSistemas.seguirVias(busqueda.sesiones);
  const diccionario = activarDiccionario(context, busqueda, proveedorSistemas, sistemaActivo, rutaDestinos, puente);
  const monitor = activarMonitor(context, {
    busqueda,
    sistemaActivo,
    destinoPorId: (id) => destinoPorId(rutaDestinos, id),
    descripcionDe: (id) => {
      const destino = destinoPorId(rutaDestinos, id);
      return destino === undefined ? undefined : descripcionDe(destino, rolDe(proveedorSistemas.config, id), busqueda.sesiones.viaDe(id));
    },
    rolDe: (id) => rolDe(proveedorSistemas.config, id),
    puente,
    conexionOficial: { estadoDe: (id) => estadoConexion(id), conectar: (id) => conectar(id, { marcarActivo: false }) },
    conectarRfc: async (destino) => avisarConexionDiccionario(await diccionario.conectar(destino), destino),
    lector: puente,
  });
  const objetoActivo = activarObjetoActivo(context, {
    sesiones: busqueda.sesiones,
    credenciales: busqueda.credenciales,
    destinoPorId: (id) => destinoPorId(rutaDestinos, id),
    destinos: () => destinosDe(rutaDestinos),
    config: () => proveedorSistemas.config,
    fijarCompararCon: (id, ids) => proveedorSistemas.fijarCompararCon(id, ids),
    proveedorObjeto,
    sistemaActivo,
    abrirResultado: (r, destino) => busqueda.abrirResultado(r, destino),
    puente,
  });
  const depsCrearObjeto: DependenciasCrearObjeto = {
    objetoAbierto: () => proveedorObjeto.objeto?.analisis,
    sistemaActivo: () => sistemaActivo.id,
    rolDe: (id) => rolDe(proveedorSistemas.config, id),
    estadoDe: (id) => estadoConexion(id),
    conectar: (id) => conectar(id, { marcarActivo: false }),
    oficialInstalada: extensionOficialInstalada,
    ejecutarOficial: ejecutarAsistenteOficial,
  };
  const ia = activarIa(context, {
    busqueda,
    sistemaActivo,
    proveedorObjeto,
    modoBloque,
    rolDe: (id) => rolDe(proveedorSistemas.config, id),
    conexionOficial: {
      estadoDe: (id, silencioso) => estadoConexion(id, undefined, silencioso),
      conectar: (id) => conectar(id, { marcarActivo: false }),
      estaConectando: (id) => proveedorSistemas.estaConectando(id),
    },
    version: versionDeExtension(context),
    crearObjeto: depsCrearObjeto,
    servicioObjeto: objetoActivo.servicio,
    destinoPorId: (id) => destinoPorId(rutaDestinos, id),
  });
  activarDesarrollo(context, {
    abrirSesion: (id) => busqueda.sesiones.sesion(id),
    diccionario: { cableado: diccionario, sesiones: busqueda.sesiones, destinoPorId: (id) => destinoPorId(rutaDestinos, id), puente },
    objeto: objetoActivo.servicio,
  });
  registrarComandoCrearObjeto(context, depsCrearObjeto);

  if (!extensionOficialInstalada()) {
    log.warn(`No se encontró la extensión oficial ${ID_EXTENSION_OFICIAL}`);
    avisarFaltaOficial().catch((err: unknown) => {
      log.error(`Aviso de extensión oficial falló (${nombreDeError(err)})`);
    });
  }
  return context.extensionMode === vscode.ExtensionMode.Test ? { contextoDePrueba: context, diccionario, puente, objetoActivo, monitor, ia, objeto: proveedorObjeto, sistemas: proveedorSistemas } : undefined;
}

function versionDeExtension(context: vscode.ExtensionContext): string {
  const manifiesto: unknown = context.extension.packageJSON;
  if (typeof manifiesto === 'object' && manifiesto !== null && 'version' in manifiesto && typeof manifiesto.version === 'string') {
    return manifiesto.version;
  }
  return '0.0.0';
}

/** Un único puente RFC por ventana para la búsqueda, las transacciones y el diccionario; se arranca en el primer uso. */
function crearPuenteDeVentana(context: vscode.ExtensionContext): PuentePerezoso {
  return crearPuentePerezoso({
    raizOficial: () => vscode.extensions.getExtension(ID_EXTENSION_OFICIAL)?.extensionPath,
    carpetaLib: path.join(context.globalStorageUri.fsPath, 'puente-rfc', 'lib'),
    clasesPuente: path.join(context.extensionPath, 'out', 'puente-rfc'),
    registrar: (mensaje) => log.info(mensaje),
  });
}

interface VistaSistemas {
  proveedor: ProveedorSistemas;
  sistemaActivo: SistemaActivo;
  rutaDestinos: string;
}

function activarVistaSistemas(context: vscode.ExtensionContext): VistaSistemas {
  const rutaDestinos = process.env.ABAP_NAVIGATOR_DESTINOS_PATH ?? rutaDestinosPorDefecto();
  const rutaConfig = path.join(context.globalStorageUri.fsPath, 'abap-navigator.json');
  void vscode.commands.executeCommand('setContext', 'abapNavigator.oficialInstalada', extensionOficialInstalada());
  void vscode.commands.executeCommand(
    'setContext',
    'abapNavigator.desarrollo',
    context.extensionMode !== vscode.ExtensionMode.Production,
  );

  const sistemaActivo = new SistemaActivo(context.globalState);
  const proveedor = new ProveedorSistemas({ rutaDestinos, rutaConfig, sistemaActivo, estadoDe: estadoConexion });
  const vista = vscode.window.createTreeView('abapNavigator.sistemas', {
    treeDataProvider: proveedor,
    showCollapseAll: false,
  });
  registrarComandosSistemas(context, proveedor, sistemaActivo);
  registrarProteccionSoloLectura(context, (id) => rolDe(proveedor.config, id), proveedor.onDidChangeConfig);
  registrarIndicadorSistema(context, (id) => rolDe(proveedor.config, id), proveedor.onDidChangeConfig);

  const actualizar = (): void => {
    proveedor.actualizarEstados().catch((err: unknown) => {
      log.error(`Actualizar estados de sistemas falló (${nombreDeError(err)})`);
    });
  };
  if (vista.visible) {
    actualizar();
  }
  const intervalo = setInterval(() => {
    if (vista.visible) {
      actualizar();
    }
  }, INTERVALO_ESTADOS_MS);

  context.subscriptions.push(
    sistemaActivo,
    proveedor,
    vista,
    vista.onDidChangeVisibility((e) => {
      if (e.visible) {
        actualizar();
      }
    }),
    vscode.extensions.onDidChange(() => {
      void vscode.commands.executeCommand('setContext', 'abapNavigator.oficialInstalada', extensionOficialInstalada());
      proveedor.refrescar();
    }),
    vigilarDestinos(rutaDestinos, actualizar),
    { dispose: () => clearInterval(intervalo) },
  );
  return { proveedor, sistemaActivo, rutaDestinos };
}

/** Editor de bloque: el esquema se registra antes de las vistas Objeto y Paquetes, con el rol de la protección. */
function activarBloques(context: vscode.ExtensionContext, proveedorSistemas: ProveedorSistemas): void {
  const rolDeSistema = (id: string): RolSistema | undefined => rolDe(proveedorSistemas.config, id);
  registrarBloques(context, {
    abrirOrigen: (ruta) => vscode.workspace.openTextDocument(uriDeRuta(ruta)),
    simbolosDe,
    aplicarEdicion: (edit) => vscode.workspace.applyEdit(edit),
    guardar: (documento) => documento.save(),
    protegido: (ruta) => decidirProteccion(uriDeRuta(ruta), rolDeSistema).proteger,
  });
}

type ConectarPorId = (id: string, opciones?: OpcionesConectar) => Promise<void>;

/** Conecta un destino por id reutilizando el comando de la vista Sistemas sobre su nodo. */
function conectarPorId(proveedorSistemas: ProveedorSistemas): ConectarPorId {
  return async (id, opciones) => {
    const nodo = (await proveedorSistemas.getChildren()).find((n) => n.id === id);
    if (nodo === undefined) {
      log.warn('Conectar: el destino no está en destinations.json');
      return;
    }
    await vscode.commands.executeCommand('abapNavigator.sistemas.conectar', nodo, opciones);
  };
}

function activarVistaObjeto(
  context: vscode.ExtensionContext,
  proveedorSistemas: ProveedorSistemas,
  conectar: ConectarPorId,
  compararSistemas: () => Promise<ResultadoComparar>,
): { proveedor: ProveedorObjeto; modoBloque(): boolean } {
  const proveedor = new ProveedorObjeto({
    simbolosDe,
    listarCarpeta,
    primerasPalabras: primerasPalabrasDe,
    versionDe: versionDocumentoDe,
    rolDe: (id) => rolDe(proveedorSistemas.config, id),
  });
  const vista = vscode.window.createTreeView('abapNavigator.objeto', {
    treeDataProvider: proveedor,
    showCollapseAll: true,
  });
  const comandos = registrarComandosObjeto(context, {
    proveedor,
    estadoDe: (id) => estadoConexion(id),
    conectar,
    compararSistemas,
  });
  registrarNavegacionPerform(context, {
    modoBloque: comandos.modoBloque,
    rutaPrincipalDe: (uri) => {
      const objeto = proveedor.objeto;
      return objeto !== undefined && proveedor.pertenece(uri)
        ? rutaPrincipalDeObjeto({ tipo: objeto.tipo, archivos: objeto.archivos, destino: objeto.analisis.destino, objeto: objeto.objeto })
        : undefined;
    },
    leerTexto: leerTextoAbap,
    avisar: avisarEnBarra,
  });

  const seguirEditor = (uri: vscode.Uri | undefined): void => {
    proveedor.alCambiarEditor(uri).catch((err: unknown) => {
      log.error(`Seguir el editor activo falló (${nombreDeError(err)})`);
    });
  };
  seguirEditor(vscode.window.activeTextEditor?.document.uri);

  context.subscriptions.push(
    proveedor,
    vista,
    proveedor.onDidChangeObjeto((objeto) => {
      vista.description = objeto ? `${objeto.analisis.destino} · ${objeto.rol ?? 'rol sin definir'}` : undefined;
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => seguirEditor(editor?.document.uri)),
    vscode.workspace.onDidSaveTextDocument((documento) => proveedor.alGuardar(documento.uri)),
    proveedorSistemas.onDidChangeConfig(() => {
      proveedor.refrescar().catch((err: unknown) => {
        log.error(`Refrescar la vista Objeto falló (${nombreDeError(err)})`);
      });
    }),
  );
  return { proveedor, modoBloque: comandos.modoBloque };
}

/** Barra tipo SE80: acciones sobre el objeto abierto y el sistema activo. */
function activarVistaAcciones(
  context: vscode.ExtensionContext,
  proveedorObjeto: ProveedorObjeto,
  sistemaActivo: SistemaActivo,
): void {
  const proveedor = new ProveedorAcciones({
    objeto: () => {
      const objeto = proveedorObjeto.objeto;
      return objeto === undefined
        ? undefined
        : {
            nombre: objeto.nombre,
            tipo: objeto.tipo,
            protegido: objeto.protegido,
            rol: objeto.rol,
            destino: objeto.analisis.destino,
          };
    },
    sistemaActivo: () => sistemaActivo.id,
    onCambio: [proveedorObjeto.onDidChangeObjeto, sistemaActivo.onDidChange],
  });
  const vista = vscode.window.createTreeView('abapNavigator.acciones', { treeDataProvider: proveedor });
  const describir = (): void => {
    vista.description = descripcionBarra(proveedor.estado());
  };
  describir();
  context.subscriptions.push(proveedor, vista, proveedor.onDidChangeTreeData(describir));
}

function activarVistaPaquetes(
  context: vscode.ExtensionContext,
  sistemaActivo: SistemaActivo,
  conectar: (id: string) => Promise<void>,
): void {
  const proveedor = new ProveedorPaquetes({ listarCarpeta, sistemaActivo, estadoDe: (id) => estadoConexion(id) });
  const vista = vscode.window.createTreeView('abapNavigator.paquetes', {
    treeDataProvider: proveedor,
    showCollapseAll: true,
  });
  registrarComandosPaquetes(context, { proveedor, vista, conectar, sistemaActivo });
  vista.description = sistemaActivo.id;
  context.subscriptions.push(
    proveedor,
    vista,
    sistemaActivo.onDidChange(() => {
      vista.description = sistemaActivo.id;
    }),
  );
}

/** Un destino de destinations.json por id; si el archivo no se puede leer, ninguno. */
function destinoPorId(rutaDestinos: string, id: string): Destino | undefined {
  try {
    return leerDestinos(rutaDestinos).find((d) => d.id === id);
  } catch {
    return undefined;
  }
}

/** Todos los destinos de destinations.json; si el archivo no se puede leer, ninguno. */
function destinosDe(rutaDestinos: string): Destino[] {
  try {
    return leerDestinos(rutaDestinos);
  } catch {
    return [];
  }
}

function avisarConexionDiccionario(resultado: ResultadoSesion, destino: string): void {
  switch (resultado.estado) {
    case 'ok':
      if (resultado.via !== 'rfc') {
        void vscode.window.showInformationMessage(`El diccionario necesita la conexión RFC; ${destino} quedó conectado por HTTP`);
      }
      return;
    case 'noAutorizado':
      void vscode.window.showErrorMessage(`${destino} rechazó el usuario o la contraseña`);
      return;
    case 'error':
      void vscode.window.showErrorMessage(resultado.mensaje);
      return;
    case 'sinRest':
      void vscode.window.showInformationMessage(mensajeSinRfc(resultado.motivo));
      return;
    case 'sinContrasena':
      return;
  }
}

/** Diccionario y firmas en contexto: servicios, hover, panel y comandos por ventana, sobre las sesiones de la búsqueda. */
function activarDiccionario(
  context: vscode.ExtensionContext,
  busqueda: BusquedaRegistrada,
  proveedorSistemas: ProveedorSistemas,
  sistemaActivo: SistemaActivo,
  rutaDestinos: string,
  puente: PuenteDiccionario,
): CableadoDiccionario {
  const cableado = crearCableadoDiccionario({
    sesiones: busqueda.sesiones,
    credenciales: busqueda.credenciales,
    destinoPorId: (id) => destinoPorId(rutaDestinos, id),
    puente,
    registrar: (m) => log.info(m),
  });
  const deps: DependenciasHover = {
    servicio: cableado.servicio,
    firmas: cableado.firmas,
    destinoDe: (uri) => cableado.destinoDe(uri),
    credencialGuardada: (destino) => cableado.credencialGuardada(destino),
  };
  registrarHoverDiccionario(context, deps);
  registrarComandosFirmas(context, {
    servicio: cableado.firmas,
    destinoDe: deps.destinoDe,
    destinoActivo: () => sistemaActivo.id,
    abrirSesion: (destino) => busqueda.abrirSesion(destino),
    viaDe: (destino) => busqueda.sesiones.viaDe(destino),
    consultar: (destino, texto, signal, filtro) => busqueda.consultar(destino, texto, signal, filtro),
    abrirResultado: (r, destino) => busqueda.abrirResultado(r, destino),
    registrar: (m) => log.info(m),
  });
  const panel = registrarPanelDiccionario(context, {
    ...deps,
    conectar: async (destino) => avisarConexionDiccionario(await cableado.conectar(destino), destino),
    abrir: async (r) => {
      const destino = panel.destino;
      if (destino === undefined) {
        log.warn('Diccionario: abrir sin destino en el panel');
        return;
      }
      const resultado = await busqueda.abrirResultado(r, destino);
      log.info(`Diccionario: abrir → ${resultado}`);
      avisarAlAbrir(resultado, r);
    },
    prefijosDe: (destino) => prefijosPropiosDe(proveedorSistemas.config, destino),
    anadirPrefijo: (destino, prefijo) => proveedorSistemas.anadirPrefijoPropio(destino, prefijo),
  });
  // Añadir un prefijo propio no vacía la caché: «Dónde se usa» vuelve a filtrar sin repetir la petición.
  let firma = firmaConexion(proveedorSistemas.config);
  context.subscriptions.push(proveedorSistemas.onDidChangeConfig(() => {
    const nueva = firmaConexion(proveedorSistemas.config);
    if (nueva !== firma) {
      firma = nueva;
      cableado.servicio.vaciar();
      cableado.firmas.vaciar();
    }
  }));
  return cableado;
}

export function deactivate(): void {}
