import * as vscode from 'vscode';
import type { NodoActividad } from './actividad-modelo';
import { MSG_ARCHIVO_CAMBIO, MSG_SIN_APLICAR, MSG_SIN_GUARDAR, MSG_YA_APLICADO, type GestorPropuestas } from './propuestas';
import { idDeUriPropuesta } from './propuestas-documento';
import type { Decision, RegistroPropuestas } from './propuestas-modelo';

const MSG_YA_NO_EXISTE = 'La propuesta ya no existe';
export const MSG_PROPUESTA_RECALCULADA =
  'El archivo cambió desde la propuesta: revisa el diff actualizado y vuelve a pulsar Aplicar.';

/** Los motivos están escritos para el agente; al usuario solo se le dicen los conocidos, con su propio texto. */
export const AVISOS_DE_MOTIVO: Readonly<Record<string, string>> = {
  [MSG_SIN_GUARDAR]: 'La extensión oficial no guardó el cambio: revisa el bloqueo o la orden de transporte y guarda con Ctrl+S.',
  [MSG_ARCHIVO_CAMBIO]: 'La propuesta caducó: el archivo cambió y algún fragmento ya no es único.',
  [MSG_YA_APLICADO]: 'El archivo ya contenía el cambio propuesto.',
  [MSG_SIN_APLICAR]: 'VS Code no pudo aplicar la edición.',
};

export interface ComandosPropuestas {
  aplicar(arg: unknown): Promise<void>;
  rechazar(arg: unknown, motivo?: unknown): Promise<void>;
  abrir(nodo: NodoActividad | undefined): Promise<void>;
}

function nombreDeArchivo(uri: string): string {
  const ruta = vscode.Uri.parse(uri).path;
  return ruta.slice(ruta.lastIndexOf('/') + 1);
}

function propuestaIdDe(arg: unknown): string | undefined {
  if (arg instanceof vscode.Uri) {
    return idDeUriPropuesta(arg);
  }
  if (typeof arg === 'object' && arg !== null && 'propuestaId' in arg && typeof arg.propuestaId === 'string') {
    return arg.propuestaId;
  }
  return undefined;
}

/** Aplicar, Rechazar y abrir una propuesta desde el título del diff, la vista Actividad o la paleta. */
export function crearComandosPropuestas(gestor: GestorPropuestas, registro: RegistroPropuestas): ComandosPropuestas {
  /** Uri del diff (botones del título) o nodo de la vista Actividad; sin argumento (paleta), se elige entre las pendientes. */
  const elegirPropuesta = async (arg: unknown): Promise<string | undefined> => {
    const id = propuestaIdDe(arg);
    if (id !== undefined) {
      return id;
    }
    const pendientes = registro.pendientes;
    if (pendientes.length === 0) {
      void vscode.window.showInformationMessage('No hay propuestas pendientes del agente');
      return undefined;
    }
    const elegida = await vscode.window.showQuickPick(
      pendientes.map((p) => ({ label: p.resumen, description: nombreDeArchivo(p.uri), id: p.id })),
      { placeHolder: 'Propuesta del agente' },
    );
    return elegida?.id;
  };

  /**
   * Un Aplicar que no salió limpio también se le dice al usuario, con su texto: solo si la propuesta se decidió en esta
   * llamada y el motivo es uno conocido; el resto de motivos son para el agente.
   */
  const avisarMotivo = (estabaPendiente: boolean, decision: Decision): void => {
    if (decision.estado === 'desconocida') {
      void vscode.window.showInformationMessage(MSG_YA_NO_EXISTE);
      return;
    }
    const aviso = decision.motivo === undefined ? undefined : AVISOS_DE_MOTIVO[decision.motivo];
    if (estabaPendiente && decision.estado !== 'pendiente' && aviso !== undefined) {
      void vscode.window.showWarningMessage(aviso);
    }
  };

  const aplicar = async (arg: unknown): Promise<void> => {
    const id = await elegirPropuesta(arg);
    if (id === undefined) {
      return;
    }
    const antes = registro.obtener(id);
    const estabaPendiente = antes?.estado === 'pendiente';
    const baseAntes = antes?.textoBase;
    const decision = await gestor.aplicar(id);
    // Sigue pendiente con otra base: se recalculó sobre el archivo cambiado y el usuario debe revisar antes de escribir.
    if (estabaPendiente && decision.estado === 'pendiente' && registro.obtener(id)?.textoBase !== baseAntes) {
      void vscode.window.showWarningMessage(MSG_PROPUESTA_RECALCULADA);
      return;
    }
    avisarMotivo(estabaPendiente, decision);
  };

  // Desde el título del editor llega (uri, { groupId, … }) como segundo argumento: solo un texto es un motivo.
  const rechazar = async (arg: unknown, motivo?: unknown): Promise<void> => {
    const id = await elegirPropuesta(arg);
    if (id !== undefined) {
      await gestor.rechazar(id, typeof motivo === 'string' ? motivo : undefined);
    }
  };

  const abrir = async (nodo: NodoActividad | undefined): Promise<void> => {
    if (nodo?.propuestaId === undefined) {
      return;
    }
    const propuesta = registro.obtener(nodo.propuestaId);
    if (!propuesta) {
      void vscode.window.showInformationMessage(MSG_YA_NO_EXISTE);
      return;
    }
    if (propuesta.estado === 'pendiente') {
      await gestor.abrirDiff(propuesta.id);
      return;
    }
    const motivo = propuesta.motivo === undefined ? '' : ` — ${propuesta.motivo}`;
    void vscode.window.showInformationMessage(`Propuesta ${propuesta.estado}: ${propuesta.resumen}${motivo}`);
  };

  return { aplicar, rechazar, abrir };
}
