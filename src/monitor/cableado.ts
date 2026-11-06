import * as vscode from 'vscode';
import { analizarOrdenes, esModificable } from '../adt/transportes-modelo';
import type { ResultadoBusqueda } from '../adt/busqueda-modelo';
import type { ViaSesion } from '../adt/sesiones';
import { ACCEPT_TRANSPORTES, RUTA_TRANSPORTES } from '../objeto/servicio';
import { avisarAlAbrir, type BusquedaRegistrada } from '../commands/buscar';
import { asegurarConectado, type DependenciasConexion } from '../commands/conexion';
import type { Destino } from '../config/destinos';
import { esProtegido, type RolSistema } from '../config/navegador-config';
import type { SistemaActivo } from '../config/sistema-activo';
import { conexionDiccionario, motivoSinDiccionario, textoMotivoSinRfc, type PuenteDiccionario } from '../diccionario/cableado';
import { log } from '../log';
import { mensajeDe, nombreDeError } from '../util/errores';
import type { LectorDeTablas } from '../adt/tablas-legibles';
import { abrirDumpEnEditor, abrirPosicion, COMANDO_ABRIR_POSICION, ESQUEMA_DUMP, ProveedorDocumentoDump } from './dump-documento';
import type { Dump } from './dumps-modelo';
import { resultadoBusquedaDe, type ObjetoInactivo } from './inactivos-modelo';
import type { FuenteOrdenes, ObjetoMonitor } from './ordenes-modelo';
import type { NodoMonitor } from './panel-modelo';
import { ProveedorMonitor, VISTA_MONITOR } from './panel-proveedor';
import { ErrorSinSesion, ServicioMonitor, TIEMPO_MONITOR_MS } from './servicio';

export const COMANDOS_MONITOR = {
  refrescar: 'abapNavigator.monitor.refrescar',
  conectar: 'abapNavigator.monitor.conectar',
  abrirDump: 'abapNavigator.monitor.abrirDump',
  abrirInactivo: 'abapNavigator.monitor.abrirInactivo',
  abrirObjetoOrden: 'abapNavigator.monitor.abrirObjetoOrden',
  masDumps: 'abapNavigator.monitor.masDumps',
  dumpsTodos: 'abapNavigator.monitor.dumpsTodos',
  dumpsMios: 'abapNavigator.monitor.dumpsMios',
  inactivosTodos: 'abapNavigator.monitor.inactivosTodos',
  inactivosMios: 'abapNavigator.monitor.inactivosMios',
  activarTodo: 'abapNavigator.monitor.activarTodo',
  copiarNombre: 'abapNavigator.monitor.copiarNombre',
  abrirPosicion: COMANDO_ABRIR_POSICION,
} as const;

// NO VERIFICADO: comportamiento sin editor activo
export const COMANDO_ACTIVAR_TODO_OFICIAL = 'adt-vscode.activateAll';

/**
 * Refresca por un evento de vía solo en el destino activo y cuando de verdad aporta: la vía cambió (incluida
 * la invalidación), o el monitor esperaba conexión y otra vista abrió la sesión. Con `ultimaVia` sin definir y
 * sin espera, la transición es la primera carga del propio monitor abriendo su sesión: no se repite.
 */
export function debeRefrescarPorVia(
  idEvento: string,
  destinoActivo: string | undefined,
  viaActual: ViaSesion | undefined,
  ultimaVia: ViaSesion | undefined,
  esperandoConexion: boolean,
): boolean {
  if (idEvento !== destinoActivo) {
    return false;
  }
  return ultimaVia === undefined ? esperandoConexion && viaActual !== undefined : viaActual !== ultimaVia;
}

export interface OpcionesMonitor {
  busqueda: BusquedaRegistrada;
  sistemaActivo: Pick<SistemaActivo, 'id' | 'onDidChange'>;
  destinoPorId(id: string): Destino | undefined;
  descripcionDe(id: string): string | undefined;
  rolDe(id: string): RolSistema | undefined;
  puente: PuenteDiccionario;
  /** `estadoDe` + `conectar(id)` sin marcar el destino como activo. */
  conexionOficial: DependenciasConexion;
  /** La del diccionario: abre la sesión RFC (puede pedir la contraseña) y avisa del resultado. */
  conectarRfc(destino: string): Promise<void>;
  fuenteOrdenes?: FuenteOrdenes;
  /** Lectura de SNAP (el puente RFC); sin él el dump se muestra solo con el feed. */
  lector?: LectorDeTablas;
}

export interface MonitorRegistrado {
  proveedor: ProveedorMonitor;
  documentos: ProveedorDocumentoDump;
}

function nombreDeNodo(nodo: NodoMonitor): string | undefined {
  switch (nodo.clase) {
    case 'dump':
      return nodo.dump.programa;
    case 'inactivo':
    case 'objetoOrden':
      return nodo.objeto.nombre;
    default:
      return undefined;
  }
}

// NO VERIFICADO: la GET de transportrequests por la conexión del monitor (la misma ruta y Accept que usa src/objeto/servicio.ts).
function fuenteOrdenesPorRfc(busqueda: BusquedaRegistrada): FuenteOrdenes {
  return {
    async ordenesAbiertas(destino) {
      const conexion = await conexionDiccionario(busqueda.sesiones, destino);
      if (conexion === undefined) {
        throw new ErrorSinSesion();
      }
      try {
        const respuesta = await conexion.get(RUTA_TRANSPORTES, undefined, ACCEPT_TRANSPORTES, undefined, TIEMPO_MONITOR_MS);
        const ordenes = analizarOrdenes(respuesta.cuerpo).filter(esModificable);
        log.info(`Monitor: órdenes → ok (${ordenes.length} modificables)`);
        return ordenes;
      } catch (err) {
        log.error(`Monitor: órdenes → error ${nombreDeError(err)}`);
        throw err;
      }
    },
  };
}

export function activarMonitor(context: vscode.ExtensionContext, opciones: OpcionesMonitor): MonitorRegistrado {
  const { busqueda } = opciones;
  const servicio = new ServicioMonitor({
    conexionDe: (destino) => conexionDiccionario(busqueda.sesiones, destino),
    registrar: (m) => log.info(m),
    lector: opciones.lector,
  });
  const documentos = new ProveedorDocumentoDump();
  const cambioVia = new vscode.EventEmitter<string>();
  const ultimaVia = new Map<string, ViaSesion | undefined>();
  const marcarVia = (id: string | undefined): void => {
    if (id !== undefined) {
      ultimaVia.set(id, busqueda.sesiones.viaDe(id));
    }
  };
  busqueda.sesiones.alCambiarVia((id) => {
    const via = busqueda.sesiones.viaDe(id);
    if (debeRefrescarPorVia(id, opciones.sistemaActivo.id, via, ultimaVia.get(id), proveedor.estado.motivo === 'conectar')) {
      ultimaVia.set(id, via);
      cambioVia.fire(id);
    }
  });
  const refrescar = async (): Promise<void> => {
    const id = opciones.sistemaActivo.id;
    try {
      await proveedor.refrescar();
    } finally {
      marcarVia(id);
    }
  };

  const proveedor = new ProveedorMonitor({
    sistemaActivo: opciones.sistemaActivo,
    servicio,
    usuarioDe: (destino) => opciones.destinoPorId(destino)?.usuario?.toUpperCase(),
    descripcionDe: opciones.descripcionDe,
    motivoSinRfc: (destino) => {
      const motivo = motivoSinDiccionario(opciones.destinoPorId(destino), opciones.puente);
      return motivo === undefined || motivo === 'sinDestino' ? undefined : textoMotivoSinRfc(motivo);
    },
    credencialGuardada: (destino) => busqueda.credenciales.guardada(destino),
    alCambiarVia: cambioVia.event,
    rolDe: opciones.rolDe,
    fuenteOrdenes: opciones.fuenteOrdenes ?? fuenteOrdenesPorRfc(busqueda),
  });
  const vista = vscode.window.createTreeView(VISTA_MONITOR, { treeDataProvider: proveedor, showCollapseAll: true });
  const fijarDescripcion = (): void => {
    vista.description = proveedor.descripcionVista();
  };
  fijarDescripcion();

  const registrar = <A extends unknown[]>(id: string, accion: (...args: A) => Promise<void>): vscode.Disposable =>
    vscode.commands.registerCommand(id, async (...args: A) => {
      try {
        await accion(...args);
      } catch (err) {
        log.error(`Monitor: ${id} → error ${nombreDeError(err)}`);
        await vscode.window.showErrorMessage(mensajeDe(err));
      }
    });

  const abrirObjeto = async (destino: string, r: ResultadoBusqueda, etiqueta: string): Promise<void> => {
    if (!(await asegurarConectado(opciones.conexionOficial, destino))) {
      return;
    }
    const resultado = await busqueda.abrirResultado(r, destino);
    avisarAlAbrir(resultado, r);
    log.info(`Monitor: ${etiqueta} → ${resultado}`);
  };

  context.subscriptions.push(
    proveedor,
    vista,
    cambioVia,
    documentos,
    proveedor.onDidChangeTreeData(fijarDescripcion),
    vscode.workspace.registerTextDocumentContentProvider(ESQUEMA_DUMP, documentos),
    vscode.languages.registerDocumentLinkProvider({ scheme: ESQUEMA_DUMP }, documentos),
    registrar(COMANDOS_MONITOR.refrescar, () => refrescar()),
    registrar(COMANDOS_MONITOR.conectar, async (destino: string) => {
      await opciones.conectarRfc(destino);
      await refrescar();
    }),
    registrar(COMANDOS_MONITOR.abrirDump, async (destino: string, dump: Dump) => {
      try {
        if (!(await asegurarConectado(opciones.conexionOficial, destino))) {
          return;
        }
        await abrirDumpEnEditor(destino, dump, {
          abrirResultado: (r, d, mostrar) => busqueda.abrirResultado(r, d, mostrar),
          documentos,
          avisar: (m) => void vscode.window.showWarningMessage(m),
          registrar: (m) => log.info(m),
          dumpCompleto: (d, volcado) => servicio.dumpCompleto(d, volcado),
        });
      } catch (err) {
        log.error(`Monitor: abrir dump → error ${nombreDeError(err)}`);
        await vscode.window.showErrorMessage(mensajeDe(err));
      }
    }),
    registrar(COMANDOS_MONITOR.abrirPosicion, async (destino: unknown, uriAdt: unknown, linea: unknown) => {
      if (typeof destino !== 'string' || typeof uriAdt !== 'string' || typeof linea !== 'number') {
        void vscode.window.showWarningMessage('Posición no reconocida');
        return;
      }
      if (!(await asegurarConectado(opciones.conexionOficial, destino))) {
        return;
      }
      await abrirPosicion(destino, uriAdt, linea, {
        abrirResultado: (r, d, mostrar) => busqueda.abrirResultado(r, d, mostrar),
        avisar: (m) => void vscode.window.showWarningMessage(m),
      });
      log.info('Monitor: abrir posición de la pila');
    }),
    registrar(COMANDOS_MONITOR.abrirInactivo, (destino: string, objeto: ObjetoInactivo, padre?: ObjetoInactivo) =>
      abrirObjeto(destino, resultadoBusquedaDe(objeto, padre), 'abrir inactivo'),
    ),
    registrar(COMANDOS_MONITOR.abrirObjetoOrden, (destino: string, objeto: ObjetoMonitor) =>
      abrirObjeto(
        destino,
        { nombre: objeto.nombre, tipo: objeto.tipoWb ?? '', descripcion: objeto.info ?? '', paquete: '', uriAdt: '' },
        'abrir objeto de orden',
      ),
    ),
    registrar(COMANDOS_MONITOR.masDumps, () => proveedor.masDumps()),
    registrar(COMANDOS_MONITOR.dumpsTodos, () => proveedor.alternarDumpsTodos()),
    registrar(COMANDOS_MONITOR.dumpsMios, () => proveedor.alternarDumpsTodos()),
    registrar(COMANDOS_MONITOR.inactivosTodos, () => proveedor.alternarInactivosTodos()),
    registrar(COMANDOS_MONITOR.inactivosMios, () => proveedor.alternarInactivosTodos()),
    registrar(COMANDOS_MONITOR.activarTodo, async () => {
      const destino = opciones.sistemaActivo.id;
      if (destino === undefined || esProtegido(opciones.rolDe(destino))) {
        return;
      }
      if (!(await asegurarConectado(opciones.conexionOficial, destino))) {
        return;
      }
      await vscode.commands.executeCommand(COMANDO_ACTIVAR_TODO_OFICIAL);
      log.info('Monitor: activar todo → lanzado');
      await refrescar();
    }),
    registrar(COMANDOS_MONITOR.copiarNombre, async (nodo: NodoMonitor) => {
      const nombre = nombreDeNodo(nodo);
      if (nombre !== undefined) {
        await vscode.env.clipboard.writeText(nombre);
      }
    }),
  );

  refrescar().catch((err: unknown) => {
    log.error(`Monitor: refrescar → error ${nombreDeError(err)}`);
  });
  return { proveedor, documentos };
}
