import type { RolSistema } from '../config/navegador-config';

// Verificado contra un sistema real el 2026-11-04 (test/fixtures/adt/real/creacion): un usuario de desarrollo lee CVERS por Data Preview.
export const SQL_CVERS = 'SELECT COMPONENT, RELEASE, EXTRELEASE FROM CVERS ORDER BY COMPONENT';
export const FILAS_CVERS = 200;
export const TIEMPO_CVERS_MS = 10_000;
/** Tras un fallo de CVERS, durante este tiempo se responde el mismo aviso sin volver a consultar. */
export const VENTANA_FALLO_CVERS_MS = 60_000;
export const INDICACION_SIN_CONEXION = 'conecta el sistema con Sextante (RFC o REST) para leer release y componentes';

const COMPONENTE_BASE = 'SAP_BASIS';

export interface Componente {
  componente: string;
  release: string;
  nivel: string;
}

export type FuenteInfo = 'rfc' | 'rest' | 'no disponible';

export interface InfoSistema {
  sistema: string;
  rol?: RolSistema;
  via?: string;
  release?: string;
  componentes?: Componente[];
  fuente: FuenteInfo;
  indicacion?: string;
}

/** Lo que se guarda por destino; el rol y la vía se leen frescos en cada llamada. */
export interface InfoCacheada {
  release?: string;
  componentes?: Componente[];
  fuente: Exclude<FuenteInfo, 'no disponible'>;
}

export interface FalloCvers {
  instante: number;
  indicacion: string;
}

function campo(fila: Record<string, string>, clave: string): string {
  return fila[clave] ?? fila[clave.toLowerCase()] ?? '';
}

export function componentesDe(filas: Record<string, string>[]): Componente[] {
  return filas
    .map((fila) => ({
      componente: campo(fila, 'COMPONENT').trim(),
      release: campo(fila, 'RELEASE').trim(),
      nivel: campo(fila, 'EXTRELEASE').trim(),
    }))
    .filter((c) => c.componente !== '');
}

export function releaseDeComponentes(componentes: Componente[]): string | undefined {
  return componentes.find((c) => c.componente === COMPONENTE_BASE)?.release;
}

export function falloVigente(fallo: FalloCvers | undefined, ahora: number): fallo is FalloCvers {
  return fallo !== undefined && ahora - fallo.instante < VENTANA_FALLO_CVERS_MS;
}

export function infoDe(
  sistema: string,
  rol: RolSistema | undefined,
  via: string | undefined,
  datos: InfoCacheada,
  indicacion?: string,
): InfoSistema {
  return {
    sistema,
    ...(rol ? { rol } : {}),
    ...(via ? { via } : {}),
    ...(datos.release ? { release: datos.release } : {}),
    ...(datos.componentes ? { componentes: datos.componentes } : {}),
    fuente: datos.fuente,
    ...(indicacion ? { indicacion } : {}),
  };
}

export function infoSinConexion(sistema: string, rol: RolSistema | undefined, via: string | undefined): InfoSistema {
  return {
    sistema,
    ...(rol ? { rol } : {}),
    ...(via ? { via } : {}),
    fuente: 'no disponible',
    indicacion: INDICACION_SIN_CONEXION,
  };
}
