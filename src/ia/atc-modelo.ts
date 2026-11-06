/** Lógica pura de la herramienta `ejecutar_atc` (sin `vscode`). */

export const ESPERA_ATC_MS = 60_000;
/** Una pasada (en curso o con resultado sin recoger) más vieja que esto se descarta y se lanza una nueva. */
export const VIGENCIA_RESULTADO_ATC_MS = 5 * 60_000;
export const MAX_HALLAZGOS_ATC = 200;

export type PrioridadAtc = 'error' | 'aviso' | 'info';

export interface HallazgoAtc {
  uri: string;
  /** Desde 1. */
  linea: number;
  prioridad: PrioridadAtc;
  mensaje: string;
  codigo?: string;
}

export interface ResultadoAtc {
  hallazgos: HallazgoAtc[];
  /** true si la oficial actualizó sus hallazgos durante esta pasada. */
  huboSenal: boolean;
}

export interface RespuestaAtc {
  estado: 'con hallazgos' | 'sin confirmar' | 'sin hallazgos' | 'en curso';
  total?: number;
  errores?: number;
  avisos?: number;
  infos?: number;
  hallazgos?: HallazgoAtc[];
  truncado?: true;
  indicacion?: string;
}

export const INDICACION_SIN_CONFIRMAR =
  'la extensión oficial no actualizó los hallazgos en esta pasada: pueden ser de una pasada anterior (ATC cancelado o con error; el aviso está en la ventana del usuario). Pregunta al usuario antes de corregir nada';
export const INDICACION_LIMPIO_SIN_SENAL =
  'la extensión oficial no publicó hallazgos; si el ATC hubiera fallado o se hubiera cancelado, el aviso está en la ventana del usuario y Sextante no lo ve';
export const INDICACION_EN_CURSO =
  'el ATC sigue en marcha; vuelve a llamar a ejecutar_atc con la misma uri para recoger el resultado (no lanza otro)';

const RANGO_PRIORIDAD: Record<PrioridadAtc, number> = { error: 0, aviso: 1, info: 2 };

export function ordenarHallazgos(hallazgos: readonly HallazgoAtc[]): HallazgoAtc[] {
  return [...hallazgos].sort(
    (a, b) =>
      RANGO_PRIORIDAD[a.prioridad] - RANGO_PRIORIDAD[b.prioridad] || (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0) || a.linea - b.linea,
  );
}

export function respuestaEnCurso(): RespuestaAtc {
  return { estado: 'en curso', indicacion: INDICACION_EN_CURSO };
}

export function respuestaDeResultado(resultado: ResultadoAtc): RespuestaAtc {
  const ordenados = ordenarHallazgos(resultado.hallazgos);
  if (ordenados.length === 0) {
    const base: RespuestaAtc = { estado: 'sin hallazgos', total: 0, errores: 0, avisos: 0, infos: 0, hallazgos: [] };
    return resultado.huboSenal ? base : { ...base, indicacion: INDICACION_LIMPIO_SIN_SENAL };
  }
  const contar = (prioridad: PrioridadAtc): number => ordenados.filter((h) => h.prioridad === prioridad).length;
  const truncado = ordenados.length > MAX_HALLAZGOS_ATC;
  const base: RespuestaAtc = {
    estado: resultado.huboSenal ? 'con hallazgos' : 'sin confirmar',
    total: ordenados.length,
    errores: contar('error'),
    avisos: contar('aviso'),
    infos: contar('info'),
    hallazgos: truncado ? ordenados.slice(0, MAX_HALLAZGOS_ATC) : ordenados,
    ...(truncado ? { truncado: true as const } : {}),
  };
  return resultado.huboSenal ? base : { ...base, indicacion: INDICACION_SIN_CONFIRMAR };
}

/** true si una pasada lanzada en `lanzado` sigue siendo la que hay que unir o recoger. */
export function pasadaVigente(lanzado: number, ahora: number): boolean {
  return ahora - lanzado < VIGENCIA_RESULTADO_ATC_MS;
}
