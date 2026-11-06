import * as vscode from 'vscode';
import { log } from '../log';
import { nombreDeError } from '../util/errores';
import { contarLineas } from './lectura-modelo';
import { idDeUriPropuesta, uriDePropuesta, type ProveedorDocumentoPropuesta } from './propuestas-documento';
import {
  MOTIVO_SIN_CAMBIOS,
  MSG_ARCHIVO_CAMBIO,
  MSG_SIN_APLICAR,
  MSG_SIN_DIFF,
  MSG_SIN_GUARDAR,
  MSG_YA_APLICADO,
  construirPropuesto,
  decisionDe,
  type DatosPropuesta,
  type Decision,
  type Propuesta,
  type RegistroPropuestas,
} from './propuestas-modelo';

export { MSG_ARCHIVO_CAMBIO, MSG_SIN_GUARDAR, MSG_SIN_APLICAR, MSG_YA_APLICADO, MSG_SIN_DIFF } from './propuestas-modelo';

/** Tras Aplicar: el diff se cierra si la propuesta quedó decidida y limpia; si no, sigue abierto. */
type TrasAplicar = 'cerrarDiff' | 'mantenerDiff';

export interface DependenciasGestor {
  /** Producción: `workspace.openTextDocument`. */
  abrirDocumento(uri: vscode.Uri): Thenable<vscode.TextDocument>;
  /** Producción: `workspace.applyEdit`. */
  aplicarEdicion(edit: vscode.WorkspaceEdit): Thenable<boolean>;
  /** Producción: `doc.save()`. */
  guardar(doc: vscode.TextDocument): Thenable<boolean>;
  /** Producción: comando `vscode.diff`. */
  mostrarDiff(izquierda: vscode.Uri, derecha: vscode.Uri, titulo: string): Thenable<void>;
  /** Producción: `window.showTextDocument` con el foco y sin pestaña de vista previa (no sustituye al diff). */
  mostrarDocumento(doc: vscode.TextDocument): Thenable<unknown>;
  /** Producción: `window.showInputBox`. */
  pedirMotivo(): Thenable<string | undefined>;
}

/**
 * Muestra la propuesta del agente como diff (el `abap:` a la izquierda, el texto propuesto a la derecha) y la aplica
 * o rechaza a orden del usuario. Aplicar edita el documento `abap:` y lo guarda, para que bloqueo y transporte
 * sigan en la oficial.
 */
// NO VERIFICADO: que `doc.save()` sobre un documento `abap:` dispare el guardado, bloqueo y transporte de la
// oficial igual que Ctrl+S (mismo supuesto que `bloques/bloque-fs.ts`).
export class GestorPropuestas implements vscode.Disposable {
  /** Ids con un Aplicar en curso: un doble clic no debe aplicar dos veces ni dejar rechazar a medias. */
  private readonly aplicando = new Set<string>();

  constructor(
    private readonly registro: RegistroPropuestas,
    private readonly documentos: ProveedorDocumentoPropuesta,
    private readonly deps: DependenciasGestor,
  ) {}

  async proponer(datos: DatosPropuesta): Promise<Propuesta> {
    const propuesta = this.registro.crear(datos);
    try {
      await this.abrirDiff(propuesta.id);
    } catch (err) {
      // Sin diff el usuario no puede decidir: no se deja una pendiente huérfana esperando.
      this.registro.decidir(propuesta.id, 'caducada', MSG_SIN_DIFF);
      log.warn(`IA: no se pudo abrir el diff de la propuesta (${nombreDeError(err)})`);
      throw err;
    }
    return propuesta;
  }

  async abrirDiff(id: string): Promise<boolean> {
    const propuesta = this.registro.obtener(id);
    if (!propuesta) {
      return false;
    }
    const origen = vscode.Uri.parse(propuesta.uri);
    await this.deps.mostrarDiff(origen, uriDePropuesta(id, origen), `Propuesta: ${propuesta.resumen}`);
    return true;
  }

  async aplicar(id: string): Promise<Decision> {
    const propuesta = this.registro.obtener(id);
    if (!propuesta || propuesta.estado !== 'pendiente' || this.aplicando.has(id)) {
      return decisionDe(propuesta, id);
    }
    this.aplicando.add(id);
    let tras: TrasAplicar;
    try {
      tras = await this.aplicarPendiente(propuesta);
    } finally {
      this.aplicando.delete(id);
    }
    if (tras === 'cerrarDiff') {
      await this.cerrarDiff(id);
    }
    return decisionDe(this.registro.obtener(id), id);
  }

  /**
   * `motivo` dado → sin InputBox (lo usan los tests y la paleta con argumento). Escape en el InputBox cancela: la
   * propuesta sigue pendiente y el diff abierto; aceptar la caja vacía rechaza sin motivo.
   */
  async rechazar(id: string, motivo?: string): Promise<Decision> {
    const propuesta = this.registro.obtener(id);
    if (!propuesta || propuesta.estado !== 'pendiente' || this.aplicando.has(id)) {
      return decisionDe(propuesta, id);
    }
    const escrito = (motivo ?? (await this.deps.pedirMotivo()))?.trim();
    if (escrito === undefined) {
      return decisionDe(this.registro.obtener(id), id);
    }
    if (this.registro.decidir(id, 'rechazada', escrito === '' ? undefined : escrito)) {
      log.info('IA: propuesta rechazada');
    }
    await this.cerrarDiff(id);
    return decisionDe(this.registro.obtener(id), id);
  }

  /** Cierra las pestañas de diff de la propuesta; cerrar es lo de menos, un fallo solo se anota. */
  async cerrarDiff(id: string): Promise<void> {
    const pestanas = vscode.window.tabGroups.all
      .flatMap((grupo) => grupo.tabs)
      .filter((pestana) => pestana.input instanceof vscode.TabInputTextDiff && idDeUriPropuesta(pestana.input.modified) === id);
    if (pestanas.length === 0) {
      return;
    }
    try {
      await vscode.window.tabGroups.close(pestanas);
    } catch (err) {
      log.warn(`IA: no se pudo cerrar el diff de la propuesta (${nombreDeError(err)})`);
    }
  }

  dispose(): void {
    this.aplicando.clear();
  }

  /**
   * Si el archivo cambió desde la propuesta y los fragmentos siguen siendo únicos, no se escribe: el diff se refresca
   * con el propuesto recalculado y la propuesta sigue pendiente hasta un segundo Aplicar sobre lo que el usuario ya vio.
   */
  private async aplicarPendiente(propuesta: Propuesta): Promise<TrasAplicar> {
    const doc = await this.deps.abrirDocumento(vscode.Uri.parse(propuesta.uri));
    const actual = doc.getText();
    if (actual !== propuesta.textoBase) {
      const recalculada = construirPropuesto(actual, propuesta.entrada);
      if (!recalculada.ok) {
        const yaAplicado = recalculada.motivo === MOTIVO_SIN_CAMBIOS;
        this.registro.decidir(propuesta.id, 'caducada', yaAplicado ? MSG_YA_APLICADO : MSG_ARCHIVO_CAMBIO);
        log.warn(yaAplicado ? 'IA: propuesta caducada (el archivo ya tenía el cambio)' : 'IA: propuesta caducada (el archivo cambió)');
        return 'cerrarDiff';
      }
      this.registro.recalcular(propuesta.id, actual, recalculada.texto);
      this.documentos.refrescar(propuesta.id);
      log.info('IA: propuesta recalculada (el archivo cambió); se pide volver a Aplicar');
      return 'mantenerDiff';
    }
    const lineas = contarLineas(propuesta.textoPropuesto);
    const edicion = new vscode.WorkspaceEdit();
    edicion.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(actual.length)), propuesta.textoPropuesto);
    if (!(await this.deps.aplicarEdicion(edicion))) {
      this.registro.decidir(propuesta.id, 'rechazada', MSG_SIN_APLICAR);
      log.warn('IA: propuesta rechazada (VS Code no aplicó la edición)');
      return 'cerrarDiff';
    }
    if (!(await this.guardarSinLanzar(doc))) {
      this.registro.decidir(propuesta.id, 'aplicada', MSG_SIN_GUARDAR);
      log.warn(`IA: propuesta aplicada (${lineas} líneas) sin guardar`);
      // El documento sucio queda a la vista para que el usuario guarde; el diff no se cierra.
      await this.mostrarSinLanzar(doc);
      return 'mantenerDiff';
    }
    this.registro.decidir(propuesta.id, 'aplicada');
    log.info(`IA: propuesta aplicada (${lineas} líneas)`);
    return 'cerrarDiff';
  }

  private async mostrarSinLanzar(doc: vscode.TextDocument): Promise<void> {
    try {
      await this.deps.mostrarDocumento(doc);
    } catch (err) {
      log.warn(`IA: no se pudo mostrar el archivo sin guardar (${nombreDeError(err)})`);
    }
  }

  /** Un guardado que lanza cuenta como no guardado: la edición ya está en el editor y el usuario puede guardar. */
  private async guardarSinLanzar(doc: vscode.TextDocument): Promise<boolean> {
    try {
      return await this.deps.guardar(doc);
    } catch (err) {
      log.warn(`IA: guardar la propuesta aplicada falló (${nombreDeError(err)})`);
      return false;
    }
  }
}
