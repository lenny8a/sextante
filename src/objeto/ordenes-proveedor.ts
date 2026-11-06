import * as vscode from 'vscode';
import { carpetaTipoDe, type ResultadoAbrir } from '../adt/abrir-resultado';
import type { ResultadoBusqueda } from '../adt/busqueda-modelo';
import type { ObjetoOrden } from '../adt/transportes-modelo';
import type { SistemaActivo } from '../config/sistema-activo';
import { COMANDO_FOCO_TRANSPORTES } from '../commands/objeto-acciones';
import { enfocarVistaOficial } from '../commands/herramientas';
import { log } from '../log';
import { mensajeDe, nombreDeError } from '../util/errores';
import {
  etiquetaDe,
  hijosDe,
  nombreBuscable,
  raicesDe,
  resultadoBusquedaDe,
  TEXTO_NO_ABRIBLE,
  type EstadoOrdenes,
  type NodoOrdenes,
} from './ordenes-modelo';
import type { ServicioObjeto } from './servicio';

export const VISTA_ORDENES = 'abapNavigator.ordenes';

const COMANDO_REFRESCAR = 'abapNavigator.ordenes.refrescar';
const COMANDO_ORGANIZADOR = 'abapNavigator.ordenes.organizadorOficial';
const COMANDO_COPIAR = 'abapNavigator.ordenes.copiarNumero';
const COMANDO_ABRIR = 'abapNavigator.ordenes.abrirObjeto';
const COMANDO_CONECTAR = 'abapNavigator.ordenes.conectar';

export interface DependenciasOrdenes {
  sistemaActivo: Pick<SistemaActivo, 'id' | 'onDidChange'>;
  servicio: Pick<ServicioObjeto, 'ordenes'>;
  /** `Destino.usuario`, para la descripción de la vista. */
  usuarioDe(destino: string): string | undefined;
  /** Por qué el destino no tiene vía RFC (SSO, sin puente…), o `undefined` si la tiene. */
  motivoSinRfc(destino: string): string | undefined;
  /** Sin credencial guardada se muestra el aviso "conectar" sin pedir nada. */
  credencialGuardada(destino: string): Promise<boolean>;
  /** Abre la sesión (pide la contraseña). */
  conectar(destino: string): Promise<void>;
  abrirResultado(r: ResultadoBusqueda, destino: string): Promise<ResultadoAbrir>;
  /** Búsqueda rápida por nombre exacto (`buscar` con `{ patron: nombre }`, 10 resultados). */
  buscarExacto(nombre: string, destino: string): Promise<ResultadoBusqueda[]>;
  avisar(mensaje: string): void;
}

const RESULTADOS_QUE_REINTENTAN: readonly ResultadoAbrir[] = ['noLocalizado', 'tipoNoSoportado'];

/**
 * Abre el objeto de una orden: primero por su tipo del Workbench; si no se localiza o no hay tipo, por una
 * búsqueda por nombre exacto (el primer resultado que se sepa abrir).
 */
export async function abrirObjetoDeOrden(
  objeto: ObjetoOrden,
  destino: string,
  deps: Pick<DependenciasOrdenes, 'abrirResultado' | 'buscarExacto' | 'avisar'>,
): Promise<void> {
  const directo = resultadoBusquedaDe(objeto);
  if (directo !== undefined) {
    const resultado = await deps.abrirResultado(directo, destino);
    if (!RESULTADOS_QUE_REINTENTAN.includes(resultado)) {
      return;
    }
  }
  const nombre = nombreBuscable(objeto);
  const candidatos = await deps.buscarExacto(nombre, destino);
  const abrible = candidatos.find(
    (c) => c.nombre.toUpperCase() === nombre.toUpperCase() && carpetaTipoDe(c.tipo) !== undefined,
  );
  if (abrible === undefined) {
    deps.avisar(TEXTO_NO_ABRIBLE(objeto));
    return;
  }
  await deps.abrirResultado(abrible, destino);
}

export class ProveedorOrdenes implements vscode.TreeDataProvider<NodoOrdenes>, vscode.Disposable {
  private readonly emisor = new vscode.EventEmitter<NodoOrdenes | undefined>();
  readonly onDidChangeTreeData: vscode.Event<NodoOrdenes | undefined> = this.emisor.event;
  private readonly emisorEstado = new vscode.EventEmitter<void>();
  /** Se dispara cuando cambia el estado (la vista actualiza su descripción). */
  readonly onDidChangeEstado: vscode.Event<void> = this.emisorEstado.event;
  private estadoActual: EstadoOrdenes = { cargando: false };
  private visible = false;
  private generacion = 0;
  private readonly suscripcion: vscode.Disposable;

  constructor(private readonly deps: DependenciasOrdenes) {
    this.suscripcion = deps.sistemaActivo.onDidChange(() => {
      this.generacion += 1;
      this.actualizar({ destino: this.deps.sistemaActivo.id, cargando: false });
      if (this.visible) {
        void this.cargar(false);
      }
    });
  }

  get estado(): EstadoOrdenes {
    return this.estadoActual;
  }

  dispose(): void {
    this.suscripcion.dispose();
    this.emisor.dispose();
    this.emisorEstado.dispose();
  }

  async alCambiarVisibilidad(visible: boolean): Promise<void> {
    this.visible = visible;
    const destino = this.deps.sistemaActivo.id;
    const hayDatos = this.estadoActual.destino === destino && this.estadoActual.ordenes !== undefined;
    if (visible && !hayDatos && !this.estadoActual.cargando) {
      await this.cargar(false);
    }
  }

  refrescar(): Promise<void> {
    return this.cargar(true);
  }

  async conectar(nodo: NodoOrdenes): Promise<void> {
    if (nodo.clase !== 'aviso' || nodo.destino === undefined) {
      return;
    }
    await this.deps.conectar(nodo.destino);
    await this.cargar(false);
  }

  async abrir(nodo: NodoOrdenes): Promise<void> {
    if (nodo.clase === 'aviso' && nodo.motivo === 'error') {
      await this.refrescar();
      return;
    }
    const destino = this.estadoActual.destino;
    if (nodo.clase !== 'objeto' || destino === undefined) {
      return;
    }
    try {
      await abrirObjetoDeOrden(nodo.objeto, destino, this.deps);
    } catch (err) {
      log.info(`Órdenes: abrir objeto → error ${nombreDeError(err)}`);
      this.deps.avisar(`No se pudo abrir el objeto: ${mensajeDe(err)}`);
    }
  }

  getTreeItem(nodo: NodoOrdenes): vscode.TreeItem {
    const e = etiquetaDe(nodo);
    const colapsable = {
      no: vscode.TreeItemCollapsibleState.None,
      abierto: vscode.TreeItemCollapsibleState.Expanded,
      cerrado: vscode.TreeItemCollapsibleState.Collapsed,
    }[e.colapsable];
    const item = new vscode.TreeItem(e.label, colapsable);
    item.description = e.description;
    item.tooltip = e.tooltip;
    item.iconPath = new vscode.ThemeIcon(e.icono);
    item.contextValue = e.contextValue;
    if ((nodo.clase === 'objeto' && nodo.abrible) || (nodo.clase === 'aviso' && nodo.motivo === 'error')) {
      item.command = { command: COMANDO_ABRIR, title: 'Abrir objeto', arguments: [nodo] };
    } else if (nodo.clase === 'aviso' && nodo.motivo === 'conectar') {
      item.command = { command: COMANDO_CONECTAR, title: 'Conectar', arguments: [nodo] };
    }
    return item;
  }

  getChildren(nodo?: NodoOrdenes): NodoOrdenes[] {
    return nodo === undefined ? raicesDe(this.estadoActual) : hijosDe(nodo);
  }

  private actualizar(estado: EstadoOrdenes): void {
    this.estadoActual = estado;
    this.emisor.fire(undefined);
    this.emisorEstado.fire();
  }

  private async cargar(forzar: boolean): Promise<void> {
    const generacion = ++this.generacion;
    const destino = this.deps.sistemaActivo.id;
    if (destino === undefined) {
      this.actualizar({ cargando: false });
      return;
    }
    const motivo = this.deps.motivoSinRfc(destino);
    if (motivo !== undefined) {
      this.actualizar({ destino, cargando: false, motivoSinVia: motivo });
      return;
    }
    if (!(await this.deps.credencialGuardada(destino))) {
      if (generacion === this.generacion) {
        this.actualizar({ destino, cargando: false });
      }
      return;
    }
    if (generacion !== this.generacion) {
      return;
    }
    this.actualizar({ destino, cargando: true });
    try {
      const ordenes = await this.deps.servicio.ordenes(destino, forzar);
      if (generacion !== this.generacion) {
        return;
      }
      this.actualizar(
        ordenes === undefined
          ? { destino, cargando: false, motivoSinVia: 'sin conexión RFC' }
          : { destino, cargando: false, ordenes },
      );
    } catch (err) {
      log.info(`Órdenes: lista → error ${nombreDeError(err)}`);
      if (generacion === this.generacion) {
        this.actualizar({ destino, cargando: false, error: mensajeDe(err) });
      }
    }
  }
}

function numeroDe(nodo: NodoOrdenes | undefined): string | undefined {
  if (nodo?.clase === 'orden') {
    return nodo.orden.numero;
  }
  return nodo?.clase === 'tarea' ? nodo.tarea.numero : undefined;
}

export function registrarVistaOrdenes(context: vscode.ExtensionContext, deps: DependenciasOrdenes): ProveedorOrdenes {
  const proveedor = new ProveedorOrdenes(deps);
  const vista = vscode.window.createTreeView(VISTA_ORDENES, { treeDataProvider: proveedor, showCollapseAll: true });
  const describir = (): void => {
    const destino = proveedor.estado.destino;
    vista.description = destino === undefined ? undefined : [destino, deps.usuarioDe(destino)].filter(Boolean).join(' · ');
  };
  context.subscriptions.push(
    proveedor,
    vista,
    proveedor.onDidChangeEstado(describir),
    vista.onDidChangeVisibility((e) => void proveedor.alCambiarVisibilidad(e.visible)),
    vscode.commands.registerCommand(COMANDO_REFRESCAR, () => proveedor.refrescar()),
    vscode.commands.registerCommand(COMANDO_ORGANIZADOR, () => enfocarVistaOficial(COMANDO_FOCO_TRANSPORTES)),
    vscode.commands.registerCommand(COMANDO_COPIAR, async (nodo?: NodoOrdenes) => {
      const numero = numeroDe(nodo);
      if (numero !== undefined) {
        await vscode.env.clipboard.writeText(numero);
      }
    }),
    vscode.commands.registerCommand(COMANDO_ABRIR, (nodo?: NodoOrdenes) =>
      nodo === undefined ? undefined : proveedor.abrir(nodo),
    ),
    vscode.commands.registerCommand(COMANDO_CONECTAR, (nodo?: NodoOrdenes) =>
      nodo === undefined ? undefined : proveedor.conectar(nodo),
    ),
  );
  describir();
  if (vista.visible) {
    void proveedor.alCambiarVisibilidad(true);
  }
  return proveedor;
}
