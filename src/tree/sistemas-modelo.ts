import type { ViaSesion } from '../adt/sesiones';
import type { Destino } from '../config/destinos';
import { type ConfigNavegador, type RolSistema, esProtegido, rolDe } from '../config/navegador-config';

export type EstadoConexion = 'conectado' | 'desconectado' | 'conectando' | 'desconocido';

export interface NodoSistema {
  id: string;
  etiqueta: string;
  descripcion: string;
  tooltip: string;
  systemId?: string;
  rol?: RolSistema;
  protegido: boolean;
  estado: EstadoConexion;
  activo: boolean;
}

/** Opciones del comando conectar cuando lo invoca otra vista (comparar conecta sin cambiar el sistema activo). */
export interface OpcionesConectar {
  marcarActivo: boolean;
}

export function opcionesConectar(arg: unknown): OpcionesConectar {
  const sinMarcar = typeof arg === 'object' && arg !== null && 'marcarActivo' in arg && arg.marcarActivo === false;
  return { marcarActivo: !sinMarcar };
}

/** `viaDe` da la vía resuelta por la última sesión ADT de cada destino. */
export function construirNodosSistemas(
  destinos: Destino[],
  config: ConfigNavegador,
  estados: Record<string, EstadoConexion>,
  activoId?: string,
  viaDe: (id: string) => ViaSesion | undefined = () => undefined,
): NodoSistema[] {
  return [...destinos]
    .sort((a, b) => prioridad(a, activoId) - prioridad(b, activoId) || a.id.localeCompare(b.id))
    .map((destino) => construirNodo(destino, config, estados[destino.id] ?? 'desconocido', activoId, viaDe(destino.id)));
}

function prioridad(destino: Destino, activoId: string | undefined): number {
  return destino.id === activoId ? 0 : 1;
}

function construirNodo(
  destino: Destino,
  config: ConfigNavegador,
  estado: EstadoConexion,
  activoId: string | undefined,
  via: ViaSesion | undefined,
): NodoSistema {
  const rol = rolDe(config, destino.id);
  return {
    id: destino.id,
    etiqueta: destino.id,
    systemId: destino.systemId,
    descripcion: descripcionDe(destino, rol, via),
    tooltip: construirTooltip(destino, rol, estado),
    rol,
    protegido: esProtegido(rol),
    estado,
    activo: destino.id === activoId,
  };
}

const SUFIJO_VIA: Record<ViaSesion, string> = { rfc: ' · RFC', http: ' · REST', oficial: ' · búsqueda oficial' };

/** Sin vía resuelta todavía (ninguna sesión ADT en el destino) no lleva sufijo. */
export function descripcionDe(destino: Destino, rol: RolSistema | undefined, via: ViaSesion | undefined): string {
  const base = `${destino.systemId ?? '?'} · ${destino.mandante ?? '?'} · ${destino.usuario ?? '?'}`;
  const sufijo = via === undefined ? '' : SUFIJO_VIA[via];
  return `${base} · ${rol ?? 'rol sin definir'}${sufijo}`;
}

function construirTooltip(destino: Destino, rol: RolSistema | undefined, estado: EstadoConexion): string {
  return [
    destino.id,
    linea('Sistema', destino.systemId),
    linea('Mandante', destino.mandante),
    linea('Usuario', destino.usuario),
    linea('Protocolo', destino.protocolo),
    servidor(destino),
    `Rol: ${rol ?? 'sin definir'}`,
    `Estado: ${estado}`,
  ]
    .filter((texto): texto is string => texto !== undefined)
    .join('\n');
}

function linea(etiqueta: string, valor: string | undefined): string | undefined {
  return valor ? `${etiqueta}: ${valor}` : undefined;
}

function servidor(destino: Destino): string | undefined {
  if (!destino.servidorAplicacion) {
    return undefined;
  }
  const numero = destino.numeroSistema ? `:${destino.numeroSistema}` : '';
  return `Servidor: ${destino.servidorAplicacion}${numero}`;
}
