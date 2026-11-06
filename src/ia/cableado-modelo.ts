import { randomBytes } from 'node:crypto';
import type { EstadoDestino } from '../bridge/logon-oficial';

export const CLAVE_TOKEN = 'abapNavigator.ia.token';
export const CLAVE_REGISTRO_OFRECIDO = 'abapNavigator.ia.registroOfrecido';
export const INTENTOS_PUERTO = 6;
export const ESPERA_PUERTO_MS = 500;

export function generarToken(): string {
  return randomBytes(32).toString('hex');
}

function esPuertoOcupado(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EADDRINUSE';
}

/**
 * Puro: intenta `arrancar(puerto)` hasta INTENTOS_PUERTO veces separadas por ESPERA_PUERTO_MS mientras `sigueConFoco()`;
 * EADDRINUSE → reintenta (tras el primero, una sola vez, `pedirCesion()` a la ventana que lo tiene); otro error → lanza.
 */
export async function tomarPuerto(
  arrancar: (p: number) => Promise<number>,
  puerto: number,
  sigueConFoco: () => boolean,
  esperar: (ms: number) => Promise<void>,
  pedirCesion: () => Promise<void>,
): Promise<number | 'ocupado' | 'sinFoco'> {
  for (let intento = 1; intento <= INTENTOS_PUERTO; intento++) {
    if (!sigueConFoco()) {
      return 'sinFoco';
    }
    try {
      return await arrancar(puerto);
    } catch (error) {
      if (!esPuertoOcupado(error)) {
        throw error;
      }
    }
    if (intento === 1) {
      await pedirCesion();
    }
    if (intento < INTENTOS_PUERTO) {
      await esperar(ESPERA_PUERTO_MS);
    }
  }
  return 'ocupado';
}

export interface OpcionesSondeo {
  intervaloMs: number;
  limiteMs: number;
  esperar(ms: number): Promise<void>;
  ahora(): number;
}

/** Puro: comprueba enseguida y luego cada `intervaloMs` hasta que `comprobar()` dé true o pasen `limiteMs`; devuelve el último valor. */
export async function sondear(comprobar: () => boolean | Promise<boolean>, opciones: OpcionesSondeo): Promise<boolean> {
  const limite = opciones.ahora() + opciones.limiteMs;
  for (;;) {
    if (await comprobar()) {
      return true;
    }
    const restante = limite - opciones.ahora();
    if (restante <= 0) {
      return false;
    }
    await opciones.esperar(Math.min(opciones.intervaloMs, restante));
  }
}

export interface DependenciasLogonEnCurso {
  estaConectando(id: string): boolean;
  estadoDe(id: string, silencioso: boolean): Promise<EstadoDestino>;
}

/**
 * Puro: la vista Sistemas ya tiene un logon en curso para `id`; en vez de lanzar otro (que respondería "ya se está
 * conectando" al momento) se espera, en silencio, a que conecte o a que ese logon termine. Devuelve false si se agotó
 * el plazo con el logon aún en curso.
 */
export function esperarLogonEnCurso(id: string, deps: DependenciasLogonEnCurso, sondeo: OpcionesSondeo): Promise<boolean> {
  return sondear(async () => !deps.estaConectando(id) || (await deps.estadoDe(id, true)) === 'conectado', sondeo);
}
