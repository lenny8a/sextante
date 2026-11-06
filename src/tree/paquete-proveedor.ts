import * as vscode from 'vscode';
import { BIBLIOTECA_SISTEMA, rutaRaizDestino } from '../bridge/adt-uri';
import type { EstadoDestino } from '../bridge/logon-oficial';
import { uriDeRuta, type EntradaRepotree } from '../bridge/repotree-oficial';
import type { SistemaActivo } from '../config/sistema-activo';
import { log } from '../log';
import { nombreDeError } from '../util/errores';
import { nivelDeHijos, nodosDesdeEntradas, type NodoPaquete } from './paquete-modelo';

export interface DependenciasPaquetes {
  listarCarpeta(uri: vscode.Uri): Promise<EntradaRepotree[]>;
  sistemaActivo: SistemaActivo;
  estadoDe(id: string): Promise<EstadoDestino>;
  /** Reloj en ms; los tests lo sustituyen para hacer caducar los listados vacíos. */
  ahora?: () => number;
}

/**
 * Un listado vacío puede ser la oficial cargando todavía la carpeta: se guarda solo este tiempo y luego
 * se vuelve a pedir. Así una carpeta vacía de verdad no paga los reintentos en cada expansión.
 */
export const CADUCIDAD_VACIO_MS = 30_000;

interface EntradaCache {
  nodos: NodoPaquete[];
  /** Solo en listados vacíos: instante (ms) a partir del cual hay que volver a pedirlos. */
  caduca?: number;
}

export const COMANDO_ABRIR_PAQUETE = 'abapNavigator.paquetes.abrir';
const CONTEXTO_SIN_SISTEMA = 'abapNavigator.paquetesSinSistema';
const CONTEXTO_SIN_CONEXION = 'abapNavigator.paquetesSinConexion';

export class ProveedorPaquetes implements vscode.TreeDataProvider<NodoPaquete>, vscode.Disposable {
  private readonly emisor = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this.emisor.event;
  private readonly cache = new Map<string, EntradaCache>();
  private readonly padres = new Map<string, NodoPaquete>();
  /** Descarta listados que terminan después de vaciar la caché (refrescar o cambio de sistema). */
  private generacion = 0;
  private readonly suscripcionActivo: vscode.Disposable;

  constructor(private readonly deps: DependenciasPaquetes) {
    this.suscripcionActivo = deps.sistemaActivo.onDidChange(() => this.refrescar());
  }

  getTreeItem(nodo: NodoPaquete): vscode.TreeItem {
    const estado = nodo.esCarpeta ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(nodo.etiqueta, estado);
    item.id = nodo.id;
    item.iconPath = new vscode.ThemeIcon(nodo.icono);
    item.contextValue = nodo.tipoObjeto ? `${nodo.clase}.${nodo.tipoObjeto}` : nodo.clase;
    if (nodo.clase === 'objeto' || nodo.clase === 'archivo') {
      item.command = { command: COMANDO_ABRIR_PAQUETE, title: 'Abrir', arguments: [nodo] };
    }
    return item;
  }

  getParent(nodo: NodoPaquete): NodoPaquete | undefined {
    return this.padres.get(nodo.ruta);
  }

  async getChildren(nodo?: NodoPaquete): Promise<NodoPaquete[]> {
    if (nodo === undefined) {
      return this.raiz();
    }
    return nodo.esCarpeta ? this.listar(nodo.ruta, nivelDeHijos(nodo), nodo) : [];
  }

  async paquetes(): Promise<NodoPaquete[]> {
    const sistema = (await this.getChildren()).find((n) => n.etiqueta === BIBLIOTECA_SISTEMA);
    return sistema === undefined ? [] : this.getChildren(sistema);
  }

  refrescar(): void {
    this.generacion++;
    this.cache.clear();
    this.padres.clear();
    this.emisor.fire();
  }

  dispose(): void {
    this.suscripcionActivo.dispose();
    this.emisor.dispose();
  }

  private async raiz(): Promise<NodoPaquete[]> {
    const id = this.deps.sistemaActivo.id;
    if (id === undefined) {
      await this.fijarContexto(true, false);
      return [];
    }
    let estado: EstadoDestino;
    try {
      estado = await this.deps.estadoDe(id);
    } catch (err) {
      log.warn(`Paquetes: no se pudo consultar el estado del sistema activo (${nombreDeError(err)})`);
      estado = 'desconocido';
    }
    if (estado !== 'conectado') {
      await this.fijarContexto(false, true);
      return [];
    }
    await this.fijarContexto(false, false);
    return this.listar(rutaRaizDestino(id), 0, undefined);
  }

  private async listar(ruta: string, nivel: number, padre: NodoPaquete | undefined): Promise<NodoPaquete[]> {
    const enCache = this.cache.get(ruta);
    if (enCache !== undefined && (enCache.caduca === undefined || this.ahora() < enCache.caduca)) {
      return enCache.nodos;
    }
    const generacion = this.generacion;
    let entradas: EntradaRepotree[];
    try {
      entradas = await this.deps.listarCarpeta(uriDeRuta(ruta));
    } catch (err) {
      log.warn(`Paquetes: no se pudo listar el nivel ${nivel} (${nombreDeError(err)})`);
      return [];
    }
    const nodos = nodosDesdeEntradas(ruta, nivel, entradas);
    if (generacion === this.generacion) {
      this.cache.set(ruta, entradas.length > 0 ? { nodos } : { nodos, caduca: this.ahora() + CADUCIDAD_VACIO_MS });
      for (const hijo of nodos) {
        if (padre === undefined) {
          this.padres.delete(hijo.ruta);
        } else {
          this.padres.set(hijo.ruta, padre);
        }
      }
    }
    log.info(`Paquetes: nivel ${nivel} con ${nodos.length} nodos`);
    return nodos;
  }

  private ahora(): number {
    return (this.deps.ahora ?? Date.now)();
  }

  private async fijarContexto(sinSistema: boolean, sinConexion: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', CONTEXTO_SIN_SISTEMA, sinSistema);
    await vscode.commands.executeCommand('setContext', CONTEXTO_SIN_CONEXION, sinConexion);
  }
}
