import type { IncludeClase, PiezaFuente } from '../adt/fuente-adt';
import type { RolSistema } from '../config/navegador-config';
import type { Destino } from '../config/destinos';

export const ROLES_EN_ID: readonly string[] = ['DEV', 'QAS', 'QA', 'PRD', 'PRO', 'PRE', 'TST'];

export const MSG_SIN_OTRO_SISTEMA = 'No hay otro sistema configurado con el que comparar';
export const ETIQUETA_CAMBIAR = 'Cambiar sistemas con los que comparar…';
/** Botón del aviso cuando solo hay un sistema con el que comparar. */
export const BOTON_CAMBIAR = 'Cambiar sistemas…';
export const MSG_SIN_OBJETO = 'Abre primero un objeto ABAP';

const SEPARADOR_ID = /[-_ ]+/;
const ORDEN_ROL: Readonly<Record<RolSistema, number>> = { DEV: 0, QAS: 1, PRD: 2 };

/** Id en mayúsculas sin el token de rol (`DEV-A` y `A_QAS` son de la familia `A`); sin más tokens, el id entero. */
export function familiaDe(id: string): string {
  const mayusculas = id.toUpperCase();
  const resto = mayusculas.split(SEPARADOR_ID).filter((token) => token !== '' && !ROLES_EN_ID.includes(token));
  return resto.length === 0 ? mayusculas : resto.join('-');
}

export interface CandidatoHermano {
  destino: Destino;
  propuesto: boolean;
}

export function hermanosPropuestos(actual: Destino, otros: Destino[]): CandidatoHermano[] {
  const familia = familiaDe(actual.id);
  const router = actual.rutaRouter ?? '';
  return otros
    .filter((otro) => otro.id !== actual.id)
    .map((destino) => ({
      destino,
      propuesto: familiaDe(destino.id) === familia || (router !== '' && destino.rutaRouter === router),
    }));
}

/** Con sistemas guardados, esos son los preseleccionados; sin ellos se deja la propuesta por familia o router. */
export function candidatosConGuardados(candidatos: CandidatoHermano[], guardados: readonly string[]): CandidatoHermano[] {
  if (guardados.length === 0) {
    return candidatos;
  }
  return candidatos.map((c) => ({ ...c, propuesto: guardados.includes(c.destino.id) }));
}

/** Candidatos de la misma familia (o del mismo SAP Router) que aún no están entre los guardados. */
export function nuevosDeLaFamilia(candidatos: CandidatoHermano[], guardados: readonly string[]): string[] {
  return candidatos.filter((c) => c.propuesto && !guardados.includes(c.destino.id)).map((c) => c.destino.id);
}

export function ordenarPorRol(ids: string[], rolDe: (id: string) => RolSistema | undefined): string[] {
  const rango = (id: string): number => {
    const rol = rolDe(id);
    return rol === undefined ? 3 : ORDEN_ROL[rol];
  };
  return [...ids].sort((a, b) => rango(a) - rango(b) || a.localeCompare(b));
}

export type EstadoPieza = 'igual' | 'distinto' | 'noExiste' | 'soloAqui' | 'soloAlli';

export interface PiezaComparada {
  pieza: PiezaFuente;
  estado: EstadoPieza;
  lineas: number;
  /** `vscode.Uri` del archivo local; el modelo no depende de vscode. */
  uriLocal?: unknown;
}

export type EstadoComparacion = 'igual' | 'distinto' | 'noExiste' | 'sinConexion' | 'error';

export interface ResultadoSistema {
  destino: string;
  estado: EstadoComparacion;
  piezas: PiezaComparada[];
  motivo?: string;
  soloArchivo: boolean;
}

export function consolidar(piezas: PiezaComparada[]): EstadoComparacion {
  if (piezas.some((p) => p.estado === 'distinto' || p.estado === 'soloAqui' || p.estado === 'soloAlli')) {
    return 'distinto';
  }
  if (piezas.every((p) => p.estado === 'noExiste')) {
    return 'noExiste';
  }
  return 'igual';
}

function nombreDePieza(p: PiezaComparada): string {
  return p.pieza.include ?? p.pieza.etiqueta;
}

export function resumenDe(r: ResultadoSistema): { icono: string; texto: string } {
  const sufijo = r.soloArchivo ? ' · solo este módulo' : '';
  switch (r.estado) {
    case 'igual':
      return { icono: 'check', texto: `igual${sufijo}` };
    case 'distinto': {
      const detalle =
        r.piezas.length === 1
          ? `~${r.piezas[0].lineas} líneas`
          : r.piezas.filter((p) => p.estado !== 'igual').map(nombreDePieza).join(', ');
      return { icono: 'diff', texto: `distinto (${detalle})${sufijo}` };
    }
    case 'noExiste':
      return { icono: 'circle-slash', texto: 'no existe' };
    case 'sinConexion':
      return { icono: 'debug-disconnect', texto: `sin conexión: ${r.motivo ?? 'desconocido'}` };
    case 'error':
      return { icono: 'warning', texto: `error: ${r.motivo ?? 'desconocido'}` };
  }
}

/** La del include abierto si no es igual; si no, la primera no igual; si todo es igual, la primera. */
export function piezaParaDiff(r: ResultadoSistema, includeAbierto?: IncludeClase): PiezaComparada | undefined {
  const abierta =
    includeAbierto === undefined ? undefined : r.piezas.find((p) => p.pieza.include === includeAbierto && p.estado !== 'igual');
  return abierta ?? r.piezas.find((p) => p.estado !== 'igual') ?? r.piezas[0];
}

export function tituloComparacion(nombre: string, izquierda: string, derecha: string): string {
  return `${nombre}: ${izquierda} ↔ ${derecha}`;
}
