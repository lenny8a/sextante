import { descripcionDe, etiquetaDe, FILTROS_TIPO, type FiltroTipo, type ResultadoBusqueda } from './busqueda-modelo';

export const ICONO_RECIENTE = '$(history)';

const ICONO_GENERICO = '$(symbol-misc)';

/** Forma de vscode.QuickPickItem con el resultado asociado; este módulo no importa vscode. */
export interface QuickPickItemResultado {
  label: string;
  description: string;
  alwaysShow: boolean;
  resultado: ResultadoBusqueda;
}

/** Numera las consultas: solo la última lanzada puede pintar su respuesta. */
export class ControlGeneraciones {
  private actual = 0;

  siguiente(): number {
    this.actual++;
    return this.actual;
  }

  esActual(n: number): boolean {
    return n === this.actual;
  }
}

/** Programa `accion` tras `ms` y devuelve cómo cancelarla; inyectable para probar sin esperar. */
export type Programar = (accion: () => void, ms: number) => () => void;

const programarConTemporizador: Programar = (accion, ms) => {
  const temporizador = setTimeout(accion, ms);
  return () => clearTimeout(temporizador);
};

export interface OpcionesProgramador<T> {
  esperaMs: number;
  consultar(texto: string, signal: AbortSignal): Promise<T>;
  /** Solo recibe la respuesta de la última consulta lanzada. */
  alResolver(resultados: T): void;
  /** Solo recibe el fallo de la última consulta lanzada, nunca el de una abortada. */
  alFallar(error: unknown): void;
  alCambiarOcupado(ocupado: boolean): void;
  programar?: Programar;
}

/**
 * Consultas del QuickPick de búsqueda: espera `esperaMs` tras la última tecla, aborta la consulta anterior y
 * solo deja pintar la respuesta de la última. Sin vscode: el QuickPick solo conecta los callbacks.
 */
export class ProgramadorConsultas<T> {
  private readonly generaciones = new ControlGeneraciones();
  private controlador: AbortController | undefined;
  private cancelarEspera: (() => void) | undefined;
  private detenido = false;

  constructor(private readonly opciones: OpcionesProgramador<T>) {}

  cambiarTexto(texto: string): void {
    this.cancelar();
    if (this.detenido || texto.trim() === '') {
      return;
    }
    const programar = this.opciones.programar ?? programarConTemporizador;
    this.cancelarEspera = programar(() => void this.consultarAhora(texto), this.opciones.esperaMs);
  }

  /** Cancela la espera y la consulta en vuelo; ninguna respuesta anterior pinta ya. */
  cancelar(): void {
    this.cancelarEspera?.();
    this.cancelarEspera = undefined;
    this.controlador?.abort();
    this.controlador = undefined;
    this.generaciones.siguiente();
    this.opciones.alCambiarOcupado(false);
  }

  /** Cancela y ya no programa más consultas. */
  detener(): void {
    this.detenido = true;
    this.cancelar();
  }

  private async consultarAhora(texto: string): Promise<void> {
    this.cancelarEspera = undefined;
    const generacion = this.generaciones.siguiente();
    const propio = new AbortController();
    this.controlador = propio;
    this.opciones.alCambiarOcupado(true);
    try {
      const resultados = await this.opciones.consultar(texto, propio.signal);
      if (this.generaciones.esActual(generacion)) {
        this.opciones.alResolver(resultados);
      }
    } catch (error) {
      if (this.generaciones.esActual(generacion) && !propio.signal.aborted) {
        this.opciones.alFallar(error);
      }
    } finally {
      if (this.generaciones.esActual(generacion)) {
        this.controlador = undefined;
        this.opciones.alCambiarOcupado(false);
      }
    }
  }
}

export function tituloBusqueda(destino: string, filtro?: FiltroTipo): string {
  return filtro ? `Buscar objeto · ${destino} · ${filtro.etiqueta}` : `Buscar objeto · ${destino}`;
}

function iconoDe(tipo: string): string {
  return FILTROS_TIPO.find((f) => f.tipoAdt === tipo)?.icono ?? ICONO_GENERICO;
}

/** El servidor ya filtró: `alwaysShow` evita que el filtro difuso del QuickPick oculte resultados. */
export function itemsDe(resultados: ResultadoBusqueda[], recientes: boolean): QuickPickItemResultado[] {
  return resultados.map((r) => ({
    label: `${iconoDe(r.tipo)} ${etiquetaDe(r)}`,
    description: recientes ? `${ICONO_RECIENTE} ${descripcionDe(r)}` : descripcionDe(r),
    alwaysShow: true,
    resultado: r,
  }));
}

/**
 * Items en cuanto cambia el texto, antes de la respuesta: con texto la lista se vacía para que Enter no abra
 * un reciente ni un resultado de otro texto; con el campo vacío, los recientes del tipo del filtro activo.
 */
export function itemsAlCambiarTexto(
  texto: string,
  recientes: ResultadoBusqueda[],
  filtro?: FiltroTipo,
): QuickPickItemResultado[] {
  if (texto.trim() !== '') {
    return [];
  }
  return itemsDe(filtro ? recientes.filter((r) => r.tipo === filtro.tipoAdt) : recientes, true);
}
