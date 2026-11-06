import { randomBytes } from 'node:crypto';
import type { EventoSimple, Suscripcion } from './actividad-modelo';

export const ESPERA_DECISION_MS = 60_000;
export const MAX_DECIDIDAS = 20;

export const MSG_ARCHIVO_CAMBIO =
  'el archivo cambió desde la propuesta y algún fragmento ya no es único; vuelve a leer y a proponer';
export const MSG_SIN_GUARDAR =
  'el cambio está en el editor pero la extensión oficial no lo guardó (bloqueo u orden de transporte); el usuario debe guardar con Ctrl+S';
export const MSG_SIN_APLICAR = 'VS Code no pudo aplicar la edición en el documento';
export const MSG_YA_APLICADO = 'el archivo ya contiene el cambio propuesto; no hay nada que aplicar';
export const MSG_SIN_DIFF = 'no se pudo abrir el diff';

const MOTIVOS_TECNICOS = new Set<string>([MSG_ARCHIVO_CAMBIO, MSG_SIN_GUARDAR, MSG_SIN_APLICAR, MSG_YA_APLICADO, MSG_SIN_DIFF]);

/** true si el motivo lo escribió Sextante y no el usuario. */
export function esMotivoTecnico(motivo: string | undefined): boolean {
  return motivo !== undefined && MOTIVOS_TECNICOS.has(motivo);
}

export type EstadoPropuesta = 'pendiente' | 'aplicada' | 'rechazada' | 'caducada';

export interface CambioBuscar {
  buscar: string;
  reemplazar: string;
}

export type EntradaPropuesta = { cambios: CambioBuscar[] } | { textoCompleto: string };

export interface DatosPropuesta {
  uri: string;
  resumen: string;
  entrada: EntradaPropuesta;
  textoBase: string;
  textoPropuesto: string;
  /** Por qué el agente propone el cambio; alimenta el diario por objeto. */
  porque?: string;
}

export interface Propuesta extends DatosPropuesta {
  id: string;
  creada: number;
  estado: EstadoPropuesta;
  motivo?: string;
  decidida?: number;
}

/** Lo que ve el agente. `caducada` se le presenta como `rechazado` con su motivo. */
export interface Decision {
  id: string;
  estado: 'aplicado' | 'rechazado' | 'pendiente' | 'desconocida';
  motivo?: string;
}

export type Construccion = { ok: true; texto: string } | { ok: false; motivo: string };

const MOTIVO_DESCONOCIDA = 'no hay ninguna propuesta con ese id en esta ventana; vuelve a llamar a proponer_cambio';

export const MOTIVO_SIN_CAMBIOS = 'la propuesta no cambia nada';

/** Cuenta también las apariciones solapadas: `aa` en `aaa` son dos, así que no es un fragmento único. */
function contar(texto: string, buscar: string): number {
  let total = 0;
  let desde = texto.indexOf(buscar);
  while (desde !== -1) {
    total++;
    desde = texto.indexOf(buscar, desde + 1);
  }
  return total;
}

/**
 * El agente solo ve texto con LF (`leer_programa` quita los retornos de carro), pero VS Code conserva un archivo CRLF
 * como CRLF: en ese caso los saltos del agente se pasan a CRLF; los que ya venían en CRLF no se duplican.
 */
function adaptarSaltos(fragmento: string, crlf: boolean): string {
  return crlf ? fragmento.replace(/\r?\n/g, '\r\n') : fragmento;
}

/** Aplica los cambios en orden sobre el texto actual; cada `buscar` debe aparecer exactamente una vez en el texto en curso. */
export function construirPropuesto(textoActual: string, entrada: EntradaPropuesta): Construccion {
  const crlf = textoActual.includes('\r\n');
  let texto: string;
  if ('textoCompleto' in entrada) {
    texto = adaptarSaltos(entrada.textoCompleto, crlf);
  } else {
    texto = textoActual;
    for (const [i, cambio] of entrada.cambios.entries()) {
      const n = i + 1;
      if (cambio.buscar === '') return { ok: false, motivo: `el fragmento ${n} a buscar está vacío` };
      const buscar = adaptarSaltos(cambio.buscar, crlf);
      const veces = contar(texto, buscar);
      if (veces !== 1) {
        return {
          ok: false,
          motivo: `el fragmento ${n} a buscar aparece ${veces} veces en el archivo; tiene que aparecer exactamente una`,
        };
      }
      const pos = texto.indexOf(buscar);
      texto = texto.slice(0, pos) + adaptarSaltos(cambio.reemplazar, crlf) + texto.slice(pos + buscar.length);
    }
  }
  if (texto === textoActual) return { ok: false, motivo: MOTIVO_SIN_CAMBIOS };
  return { ok: true, texto };
}

export function decisionDe(p: Propuesta | undefined, id: string): Decision {
  if (!p) return { id, estado: 'desconocida', motivo: MOTIVO_DESCONOCIDA };
  const estado = p.estado === 'aplicada' ? 'aplicado' : p.estado === 'pendiente' ? 'pendiente' : 'rechazado';
  return p.motivo === undefined ? { id, estado } : { id, estado, motivo: p.motivo };
}

interface OpcionesRegistro {
  generarId?(): string;
  ahora?(): number;
  esperar?(ms: number): Promise<void>;
}

export class RegistroPropuestas {
  private readonly oyentes = new Set<() => void>();
  private readonly oyentesDecision = new Set<(p: Propuesta) => void>();
  private readonly porId = new Map<string, Propuesta>();
  private readonly esperando = new Map<string, Set<() => void>>();
  private _decididas: Propuesta[] = [];
  private readonly generarId: () => string;
  private readonly ahora: () => number;
  private readonly esperar?: (ms: number) => Promise<void>;

  constructor(opciones: OpcionesRegistro = {}) {
    this.generarId = opciones.generarId ?? (() => randomBytes(4).toString('hex'));
    this.ahora = opciones.ahora ?? (() => Date.now());
    this.esperar = opciones.esperar;
  }

  readonly onDidChange: EventoSimple = (oyente) => {
    this.oyentes.add(oyente);
    return { dispose: () => void this.oyentes.delete(oyente) };
  };

  /** Se dispara al decidir, con cualquier estado final. */
  readonly onDidDecidir = (oyente: (p: Propuesta) => void): Suscripcion => {
    this.oyentesDecision.add(oyente);
    return { dispose: () => void this.oyentesDecision.delete(oyente) };
  };

  crear(datos: DatosPropuesta): Propuesta {
    const propuesta: Propuesta = { ...datos, id: this.generarId(), creada: this.ahora(), estado: 'pendiente' };
    this.porId.set(propuesta.id, propuesta);
    this.avisar();
    return propuesta;
  }

  obtener(id: string): Propuesta | undefined {
    return this.porId.get(id);
  }

  get pendientes(): readonly Propuesta[] {
    return [...this.porId.values()].filter((p) => p.estado === 'pendiente');
  }

  get decididas(): readonly Propuesta[] {
    return this._decididas;
  }

  pendientesDe(uri: string): readonly Propuesta[] {
    return this.pendientes.filter((p) => p.uri === uri);
  }

  /**
   * Al Aplicar sobre un archivo que cambió: la propuesta pasa a partir del texto actual con el propuesto recalculado,
   * para que el usuario la vea antes de aplicarla. false si no existe o ya estaba decidida.
   */
  recalcular(id: string, textoBase: string, textoPropuesto: string): boolean {
    const p = this.porId.get(id);
    if (!p || p.estado !== 'pendiente') return false;
    p.textoBase = textoBase;
    p.textoPropuesto = textoPropuesto;
    this.avisar();
    return true;
  }

  /** false si no existe o ya estaba decidida. Despierta a quien espera. */
  decidir(id: string, estado: 'aplicada' | 'rechazada' | 'caducada', motivo?: string): boolean {
    const p = this.porId.get(id);
    if (!p || p.estado !== 'pendiente') return false;
    p.estado = estado;
    if (motivo !== undefined) p.motivo = motivo;
    p.decidida = this.ahora();
    this._decididas = [p, ...this._decididas];
    for (const descartada of this._decididas.slice(MAX_DECIDIDAS)) this.porId.delete(descartada.id);
    this._decididas = this._decididas.slice(0, MAX_DECIDIDAS);
    const despertar = this.esperando.get(id);
    this.esperando.delete(id);
    for (const resolver of despertar ?? []) resolver();
    this.avisar();
    for (const oyente of [...this.oyentesDecision]) {
      try {
        oyente(p);
      } catch {
        // Se ignora: un oyente que falla no debe romper la decisión ni a los demás.
      }
    }
    return true;
  }

  /** Resuelve al decidir o, pasados `limiteMs`, con `pendiente`; id desconocido → `desconocida` sin esperar. */
  async esperarDecision(id: string, limiteMs: number): Promise<Decision> {
    const p = this.porId.get(id);
    if (!p || p.estado !== 'pendiente') return decisionDe(p, id);
    await new Promise<void>((resolver) => {
      let temporizador: ReturnType<typeof setTimeout> | undefined;
      const terminar = (): void => {
        if (temporizador !== undefined) clearTimeout(temporizador);
        this.esperando.get(id)?.delete(terminar);
        resolver();
      };
      const set = this.esperando.get(id) ?? new Set<() => void>();
      set.add(terminar);
      this.esperando.set(id, set);
      if (this.esperar) void this.esperar(limiteMs).then(terminar);
      else temporizador = setTimeout(terminar, limiteMs);
    });
    return decisionDe(this.porId.get(id), id);
  }

  /** Un oyente que falla no impide avisar al resto ni rompe a quien decide. */
  private avisar(): void {
    for (const oyente of [...this.oyentes]) {
      try {
        oyente();
      } catch {
        // Se ignora: la vista se repintará en el próximo aviso.
      }
    }
  }
}
