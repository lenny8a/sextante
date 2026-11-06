import * as vscode from 'vscode';
import { ESQUEMA_ABAP, rutaRaizDestino } from './adt-uri';
import { COMANDO_LOGON, ejecutarComandoOficial } from './extension-oficial';
import { log } from '../log';
import { mensajeDe } from '../util/errores';
import { pausa } from '../util/tiempo';

export interface ResultadoLogon {
  estado: 'ok' | 'timeout' | 'error' | 'cancelado';
  segundos: number;
  error?: string;
}

export interface OpcionesLogon {
  timeoutMs?: number;
  intervaloMs?: number;
  token?: vscode.CancellationToken;
}

export type EstadoDestino = 'conectado' | 'desconectado' | 'desconocido';

const TIMEOUT_LOGON_MS = 180_000;
const INTERVALO_LOGON_MS = 2_000;
const AVISO_ESPERA_S = 10;
const INTERVALO_MINIMO_MS = 250;
const SONDEO_MINIMO_MS = 5_000;

export function uriRaizDestino(id: string): vscode.Uri {
  return vscode.Uri.from({ scheme: ESQUEMA_ABAP, path: rutaRaizDestino(id) });
}

export async function estadoConexion(
  id: string,
  timeoutMs = 5_000,
  silencioso = false,
): Promise<EstadoDestino> {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error('tiempo agotado')), timeoutMs);
  });
  try {
    const entradas = await Promise.race([
      vscode.workspace.fs.readDirectory(uriRaizDestino(id)),
      limite,
    ]);
    return entradas.length > 0 ? 'conectado' : 'desconectado';
  } catch {
    if (!silencioso) {
      log.warn('Estado de conexión: desconocido (error o timeout)');
    }
    return 'desconocido';
  } finally {
    clearTimeout(temporizador);
  }
}

export async function conectarDestino(
  id: string,
  opciones: OpcionesLogon = {},
): Promise<ResultadoLogon> {
  const { timeoutMs = TIMEOUT_LOGON_MS } = opciones;
  const intervaloMs = Math.max(opciones.intervaloMs ?? INTERVALO_LOGON_MS, INTERVALO_MINIMO_MS);
  const inicio = Date.now();
  const transcurridoMs = (): number => Date.now() - inicio;
  log.info('Logon: inicio');
  try {
    // verificado en fase 0: argumento Uri abap:/repotree-v1/<destino>
    await ejecutarComandoOficial(COMANDO_LOGON, uriRaizDestino(id));
  } catch (err) {
    log.error(`Logon: el comando falló (${err instanceof Error ? err.name : typeof err})`);
    return { estado: 'error', segundos: segundosDe(transcurridoMs()), error: mensajeDe(err) };
  }
  log.info(`Logon: el comando terminó en ${segundosDe(transcurridoMs())} s`);
  let avisos = 0;
  let desconocidoRegistrado = false;
  let alCancelar: vscode.Disposable | undefined;
  const cancelacion = new Promise<void>((resolver) => {
    alCancelar = opciones.token?.onCancellationRequested(() => resolver());
  });
  const cancelado = (): ResultadoLogon => {
    const segundos = segundosDe(transcurridoMs());
    log.info(`Logon: cancelado tras ${segundos} s`);
    return { estado: 'cancelado', segundos };
  };
  try {
    for (;;) {
      if (opciones.token?.isCancellationRequested) {
        return cancelado();
      }
      const cicloInicio = Date.now();
      const restanteMs = timeoutMs - transcurridoMs();
      const sondeoMs = Math.min(Math.max(SONDEO_MINIMO_MS, intervaloMs), Math.max(restanteMs, 1));
      const estado: EstadoDestino | 'cancelado' = await Promise.race([
        estadoConexion(id, sondeoMs, desconocidoRegistrado),
        cancelacion.then(() => 'cancelado' as const),
      ]);
      if (estado === 'cancelado' || opciones.token?.isCancellationRequested) {
        return cancelado();
      }
      desconocidoRegistrado ||= estado === 'desconocido';
      const segundos = segundosDe(transcurridoMs());
      if (estado === 'conectado') {
        log.info(`Logon: ok en ${segundos} s`);
        return { estado: 'ok', segundos };
      }
      if (transcurridoMs() >= timeoutMs) {
        log.warn(`Logon: sin respuesta tras ${segundos} s`);
        return { estado: 'timeout', segundos };
      }
      const bloques = Math.floor(segundos / AVISO_ESPERA_S);
      if (bloques > avisos) {
        avisos = bloques;
        log.info(`Logon: esperando, ${segundos} s`);
      }
      await Promise.race([pausa(Math.max(0, intervaloMs - (Date.now() - cicloInicio))), cancelacion]);
    }
  } finally {
    alCancelar?.dispose();
  }
}

function segundosDe(ms: number): number {
  return Math.round(ms / 1000);
}
