import type { RegistroLlamada } from './mcp-modelo';
import type { EstadoPropuesta, Propuesta } from './propuestas-modelo';

export const VISTA_IA = 'abapNavigator.ia';
export const MAX_LLAMADAS = 100;

export type EstadoServidor =
  | { estado: 'parado' }
  | { estado: 'escuchando'; puerto: number; sesiones: number }
  | { estado: 'otraVentana'; puerto: number }
  | { estado: 'error'; mensaje: string };

export interface NodoActividad {
  id: string;
  clase: 'servidor' | 'seccion' | 'llamada' | 'aviso' | 'propuesta';
  etiqueta: string;
  descripcion?: string;
  tooltip?: string;
  icono: string;
  uri?: string;
  propuestaId?: string;
  /** Solo en los nodos de propuesta: las pendientes llevan Aplicar y Rechazar en línea. */
  estadoPropuesta?: EstadoPropuesta;
  hijos: NodoActividad[];
}

export interface Suscripcion {
  dispose(): void;
}

export type EventoSimple = (oyente: () => void) => Suscripcion;

export class RegistroActividad {
  private readonly oyentes = new Set<() => void>();
  private _llamadas: RegistroLlamada[] = [];
  private _servidor: EstadoServidor = { estado: 'parado' };

  readonly onDidChange: EventoSimple = (oyente) => {
    this.oyentes.add(oyente);
    return { dispose: () => void this.oyentes.delete(oyente) };
  };

  get llamadas(): readonly RegistroLlamada[] {
    return this._llamadas;
  }

  get servidor(): EstadoServidor {
    return this._servidor;
  }

  fijarServidor(estado: EstadoServidor): void {
    this._servidor = estado;
    this.avisar();
  }

  anotar(llamada: RegistroLlamada): void {
    this._llamadas = [llamada, ...this._llamadas].slice(0, MAX_LLAMADAS);
    this.avisar();
  }

  /** Un oyente que falla no impide avisar al resto ni sube al despacho de la herramienta que anotó. */
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

export function textoServidor(e: EstadoServidor): string {
  switch (e.estado) {
    case 'parado':
      return 'Parado';
    case 'escuchando':
      return `Servidor en 127.0.0.1:${e.puerto} · ${e.sesiones} ${e.sesiones === 1 ? 'sesión' : 'sesiones'}`;
    case 'otraVentana':
      return `Atiende otra ventana (${e.puerto})`;
    case 'error':
      return `Error: ${e.mensaje}`;
  }
}

function dos(n: number): string {
  return String(n).padStart(2, '0');
}

function horaDe(epoch: number): string {
  const f = new Date(epoch);
  return `${dos(f.getHours())}:${dos(f.getMinutes())}:${dos(f.getSeconds())}`;
}

function iconoServidor(e: EstadoServidor): string {
  if (e.estado === 'escuchando') return 'broadcast';
  return e.estado === 'error' ? 'error' : 'circle-slash';
}

const ICONO_PROPUESTA: Record<Propuesta['estado'], string> = {
  pendiente: 'git-pull-request',
  aplicada: 'check',
  rechazada: 'close',
  caducada: 'warning',
};

function nodoPropuesta(p: Propuesta): NodoActividad {
  const motivo = p.motivo === undefined ? '' : `\n${p.motivo}`;
  return {
    id: `ia/propuestas/${p.id}`,
    clase: 'propuesta',
    etiqueta: p.resumen,
    descripcion: p.uri.slice(p.uri.lastIndexOf('/') + 1),
    tooltip: `${p.uri}\n${p.estado}${motivo}`,
    icono: ICONO_PROPUESTA[p.estado],
    propuestaId: p.id,
    estadoPropuesta: p.estado,
    hijos: [],
  };
}

export function textoBadge(pendientes: number): { value: number; tooltip: string } | undefined {
  if (pendientes === 0) return undefined;
  return { value: pendientes, tooltip: pendientes === 1 ? '1 propuesta pendiente' : `${pendientes} propuestas pendientes` };
}

export function nodosDe(
  servidor: EstadoServidor,
  llamadas: readonly RegistroLlamada[],
  registrado: boolean | undefined,
  propuestas: { pendientes: readonly Propuesta[]; decididas: readonly Propuesta[] },
): NodoActividad[] {
  const conectado = registrado === undefined ? 'sin comprobar' : registrado ? 'sí' : 'no';
  const nodoServidor: NodoActividad = {
    id: 'ia/servidor',
    clase: 'servidor',
    etiqueta: 'Servidor',
    descripcion: textoServidor(servidor),
    icono: iconoServidor(servidor),
    hijos: [
      {
        id: 'ia/servidor/claude',
        clase: 'aviso',
        etiqueta: `Conectado en Claude Code: ${conectado}`,
        icono: registrado ? 'check' : 'question',
        hijos: [],
      },
    ],
  };
  const todas = [...propuestas.pendientes, ...propuestas.decididas];
  const nodoPropuestas: NodoActividad = {
    id: 'ia/propuestas',
    clase: 'seccion',
    etiqueta: 'Propuestas',
    icono: 'git-pull-request',
    hijos:
      todas.length === 0
        ? [{ id: 'ia/propuestas/aviso', clase: 'aviso', etiqueta: 'Sin propuestas', icono: 'info', hijos: [] }]
        : todas.map(nodoPropuesta),
  };
  const lista: NodoActividad = {
    id: 'ia/llamadas',
    clase: 'seccion',
    etiqueta: 'Llamadas',
    icono: 'history',
    hijos: llamadas.map((l, i) => ({
      id: `ia/llamadas/${i}`,
      clase: 'llamada',
      etiqueta: `${horaDe(l.hora)} ${l.herramienta}`,
      descripcion: l.resumen,
      tooltip: l.detalle,
      icono: l.resultado === 'ok' ? 'check' : 'error',
      uri: l.uri,
      hijos: [],
    })),
  };
  return [nodoServidor, nodoPropuestas, lista];
}
