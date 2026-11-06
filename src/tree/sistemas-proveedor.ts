import * as vscode from 'vscode';
import type { SesionesAdt, ViaSesion } from '../adt/sesiones';
import { ErrorDestinos, leerDestinos, type Destino } from '../config/destinos';
import {
  ErrorConfig,
  configVacia,
  conCompararCon,
  conPrefijoPropio,
  conRol,
  conUrl,
  escribirConfig,
  leerConfig,
  sinUrl,
  type ConfigNavegador,
  type RolSistema,
} from '../config/navegador-config';
import type { SistemaActivo } from '../config/sistema-activo';
import { log } from '../log';
import { mensajeDe, nombreDeError } from '../util/errores';
import { construirNodosSistemas, type EstadoConexion, type NodoSistema } from './sistemas-modelo';

export interface DependenciasSistemas {
  rutaDestinos: string;
  rutaConfig: string;
  sistemaActivo: SistemaActivo;
  estadoDe: (id: string) => Promise<EstadoConexion>;
}

const PREFIJO_PROTEGIDO = 'solo lectura · ';

/** De dónde sale la vía resuelta de cada destino (las sesiones ADT de la búsqueda). */
export type FuenteVias = Pick<SesionesAdt, 'viaDe' | 'alCambiarVia'>;

const ESTILO_ESTADO: Record<EstadoConexion, { icono: string; color: string }> = {
  conectado: { icono: 'plug', color: 'charts.green' },
  desconectado: { icono: 'debug-disconnect', color: 'disabledForeground' },
  conectando: { icono: 'sync~spin', color: 'charts.yellow' },
  desconocido: { icono: 'question', color: 'disabledForeground' },
};

export class ProveedorSistemas implements vscode.TreeDataProvider<NodoSistema>, vscode.Disposable {
  private readonly emisor = new vscode.EventEmitter<void>();
  private readonly emisorConfig = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this.emisor.event;
  readonly onDidChangeConfig: vscode.Event<void> = this.emisorConfig.event;
  private generacion = 0;
  private avisoConfigCorrupta = false;
  private estados: Record<string, EstadoConexion> = {};
  private readonly conectando = new Set<string>();
  private avisoSinArchivo = false;
  private configActual: ConfigNavegador;
  private readonly suscripcionActivo: vscode.Disposable;
  private viaDe: (id: string) => ViaSesion | undefined = () => undefined;
  private avisoClavesAntiguas = false;

  constructor(private readonly deps: DependenciasSistemas) {
    this.configActual = this.leerConfigTolerante() ?? configVacia();
    this.suscripcionActivo = deps.sistemaActivo.onDidChange(() => this.refrescar());
  }

  get config(): ConfigNavegador {
    return this.configActual;
  }

  getTreeItem(nodo: NodoSistema): vscode.TreeItem {
    const item = new vscode.TreeItem(nodo.etiqueta, vscode.TreeItemCollapsibleState.None);
    item.description = nodo.protegido ? `${PREFIJO_PROTEGIDO}${nodo.descripcion}` : nodo.descripcion;
    item.tooltip = nodo.tooltip;
    item.iconPath = iconoDeEstado(nodo.estado);
    if (nodo.id === '') {
      item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    }
    item.contextValue = contextValueDe(nodo);
    return item;
  }

  async getChildren(): Promise<NodoSistema[]> {
    let destinos: Destino[];
    try {
      destinos = leerDestinos(this.deps.rutaDestinos);
    } catch (err) {
      if (!(err instanceof ErrorDestinos)) {
        throw err;
      }
      if (esArchivoAusente(err)) {
        if (!this.avisoSinArchivo) {
          this.avisoSinArchivo = true;
          log.warn('destinations.json no existe todavía');
        }
        await this.fijarSinDestinos(true);
        return [];
      }
      this.avisoSinArchivo = false;
      log.error(`Error leyendo destinations.json (${nombreDeError(err)})`);
      await this.fijarSinDestinos(false);
      return [nodoError(mensajeDe(err))];
    }
    this.avisoSinArchivo = false;
    const leida = this.leerConfigTolerante();
    if (leida) {
      this.reemplazarConfig(leida);
    }
    await this.fijarSinDestinos(destinos.length === 0);
    return construirNodosSistemas(destinos, this.configActual, this.estados, this.deps.sistemaActivo.id, this.viaDe);
  }

  refrescar(): void {
    this.emisor.fire();
  }

  /** La descripción de cada sistema muestra la vía resuelta; se refresca la vista cada vez que una sesión la resuelve. */
  seguirVias(fuente: FuenteVias): void {
    this.viaDe = (id) => fuente.viaDe(id);
    fuente.alCambiarVia(() => this.refrescar());
  }

  async actualizarEstados(): Promise<void> {
    const generacion = ++this.generacion;
    const ids = this.idsActuales();
    const resultados = await Promise.all(ids.map(async (id) => [id, await this.deps.estadoDe(id)] as const));
    if (generacion !== this.generacion) {
      return;
    }
    const previos = this.estados;
    this.estados = Object.fromEntries(
      resultados.map(([id, estado]) => [id, this.conectando.has(id) ? (previos[id] ?? estado) : estado]),
    );
    this.refrescar();
  }

  marcarConectando(id: string): void {
    this.conectando.add(id);
    this.estados = { ...this.estados, [id]: 'conectando' };
    this.refrescar();
  }

  terminarConexion(id: string): void {
    this.conectando.delete(id);
  }

  estaConectando(id: string): boolean {
    return this.conectando.has(id);
  }

  async fijarRol(id: string, rol: RolSistema): Promise<void> {
    this.modificarConfig((base) => conRol(base, id, rol));
    this.refrescar();
  }

  async fijarUrl(id: string, url: string): Promise<void> {
    this.modificarConfig((base) => conUrl(base, id, url));
  }

  async quitarUrl(id: string): Promise<void> {
    this.modificarConfig((base) => sinUrl(base, id));
  }

  async anadirPrefijoPropio(id: string, prefijo: string): Promise<void> {
    this.modificarConfig((base) => conPrefijoPropio(base, id, prefijo));
  }

  async fijarCompararCon(id: string, ids: string[]): Promise<void> {
    this.modificarConfig((base) => conCompararCon(base, id, ids));
  }

  dispose(): void {
    this.suscripcionActivo.dispose();
    this.emisor.dispose();
    this.emisorConfig.dispose();
  }

  private modificarConfig(transformar: (base: ConfigNavegador) => ConfigNavegador): void {
    let base: ConfigNavegador;
    try {
      base = leerConfig(this.deps.rutaConfig, (mensaje) => this.avisarClavesAntiguas(mensaje));
    } catch (err) {
      if (!(err instanceof ErrorConfig)) {
        throw err;
      }
      log.warn('abap-navigator.json corrupto: se reemplaza al guardarlo');
      base = configVacia();
    }
    const nueva = transformar(base);
    escribirConfig(this.deps.rutaConfig, nueva);
    this.reemplazarConfig(nueva);
  }

  private reemplazarConfig(nueva: ConfigNavegador): void {
    const cambio = JSON.stringify(nueva) !== JSON.stringify(this.configActual);
    this.configActual = nueva;
    if (cambio) {
      this.emisorConfig.fire();
    }
  }

  private idsActuales(): string[] {
    try {
      return leerDestinos(this.deps.rutaDestinos).map((d) => d.id);
    } catch (err) {
      if (!(err instanceof ErrorDestinos)) {
        throw err;
      }
      return [];
    }
  }

  private leerConfigTolerante(): ConfigNavegador | undefined {
    try {
      const config = leerConfig(this.deps.rutaConfig, (mensaje) => this.avisarClavesAntiguas(mensaje));
      this.avisoConfigCorrupta = false;
      return config;
    } catch (err) {
      if (!(err instanceof ErrorConfig)) {
        throw err;
      }
      if (!this.avisoConfigCorrupta) {
        this.avisoConfigCorrupta = true;
        log.warn(`Error leyendo abap-navigator.json (${nombreDeError(err)}); se conserva la última configuración válida`);
      }
      return undefined;
    }
  }

  // Se lee en cada refresco hasta que un cambio reescribe el archivo: una sola línea por ventana.
  private avisarClavesAntiguas(mensaje: string): void {
    if (!this.avisoClavesAntiguas) {
      this.avisoClavesAntiguas = true;
      log.info(mensaje);
    }
  }

  private async fijarSinDestinos(valor: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'abapNavigator.sinDestinos', valor);
  }
}

function contextValueDe(nodo: NodoSistema): string {
  if (nodo.id === '') {
    return 'errorDestinos';
  }
  const base = nodo.activo ? 'sistemaActivo' : 'sistema';
  return nodo.estado === 'conectando' ? `${base}.conectando` : base;
}

function iconoDeEstado(estado: EstadoConexion): vscode.ThemeIcon {
  const { icono, color } = ESTILO_ESTADO[estado];
  return new vscode.ThemeIcon(icono, new vscode.ThemeColor(color));
}

function esArchivoAusente(err: ErrorDestinos): boolean {
  return (err.cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function nodoError(mensaje: string): NodoSistema {
  return {
    id: '',
    etiqueta: 'Error leyendo destinations.json',
    descripcion: mensaje,
    tooltip: mensaje,
    protegido: false,
    estado: 'desconocido',
    activo: false,
  };
}
