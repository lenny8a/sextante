import { pausa as pausaReal } from './tiempo';

export interface OpcionesReintentos {
  reintentos: number;
  esperaMs: number;
  pausa?: (ms: number) => Promise<void>;
  /** Avisa antes de cada reintento (1, 2…); sirve para registrar sin que este módulo dependa del log. */
  alReintentar?: (intento: number) => void;
}

/**
 * Repite `fn` mientras devuelva una lista vacía, esperando `esperaMs` entre intentos, hasta `reintentos`
 * veces. Devuelve la primera lista con elementos o `[]`. Los errores no se reintentan.
 */
export async function conReintentos<T>(fn: () => Promise<T[]>, opciones: OpcionesReintentos): Promise<T[]> {
  const esperar = opciones.pausa ?? pausaReal;
  let resultado = await fn();
  for (let intento = 1; resultado.length === 0 && intento <= opciones.reintentos; intento++) {
    opciones.alReintentar?.(intento);
    await esperar(opciones.esperaMs);
    resultado = await fn();
  }
  return resultado;
}
