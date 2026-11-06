export interface RespuestaAdt { estado: number; cuerpo: string; tipoContenido?: string; cabeceras?: string[] }

export class ErrorAdt extends Error {
  /** `cuerpo`: la respuesta de error del servidor, para mostrar su texto legible; nunca se registra. */
  constructor(mensaje: string, readonly estado: number, readonly ruta: string, readonly cuerpo?: string) {
    super(mensaje);
    this.name = 'ErrorAdt';
  }
}

export const RUTA_DISCOVERY = '/sap/bc/adt/discovery';
// Obligatorio por RFC: sin Accept el endpoint devuelve 400 (verificado el 2026-10-30).
export const ACCEPT_DISCOVERY = 'application/atomsvc+xml';

export interface PeticionAdt {
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Empieza por '/'. */
  ruta: string;
  parametros?: Record<string, string>;
  /** Nombres en minúscula. */
  cabeceras: Record<string, string>;
  cuerpo?: string;
  /** Tiempo máximo de esta petición; por defecto el del transporte. */
  tiempoMs?: number;
}

/** Lleva una `PeticionAdt` al sistema y devuelve la respuesta con cualquier estado; un fallo de red es un `ErrorAdt` con estado 0. */
export interface TransporteAdt {
  peticion(p: PeticionAdt, signal?: AbortSignal): Promise<RespuestaAdt>;
  cerrar?(): void;
}

const MARCA_OBJETO = '<objeto>';
const SEGMENTO = '[^/?#]+';
/** El grupo 1 es lo que queda; el segmento que le sigue es el nombre del objeto. El orden importa: ddl/sources antes que ddic/<tipo>. */
const RUTAS_CON_OBJETO: readonly RegExp[] = [
  new RegExp(`^(/sap/bc/adt/ddic/ddl/sources/)${SEGMENTO}`, 'i'),
  new RegExp(`^(/sap/bc/adt/ddic/${SEGMENTO}/)${SEGMENTO}`, 'i'),
  new RegExp(`^(/sap/bc/adt/oo/(?:classes|interfaces)/)${SEGMENTO}`, 'i'),
  new RegExp(`^(/sap/bc/adt/programs/(?:programs|includes)/)${SEGMENTO}`, 'i'),
  new RegExp(`^(/sap/bc/adt/functions/groups/)${SEGMENTO}`, 'i'),
  new RegExp(`^(/sap/bc/adt/packages/)${SEGMENTO}`, 'i'),
];
const MODULO_DE_FUNCIONES = new RegExp(`^(/sap/bc/adt/functions/groups/${MARCA_OBJETO}/fmodules/)${SEGMENTO}`, 'i');

/** La ruta para el Output Channel: sin nombres de objeto (pueden ser del cliente). */
export function rutaParaLog(ruta: string): string {
  const regla = RUTAS_CON_OBJETO.find((r) => r.test(ruta));
  if (regla === undefined) {
    return ruta;
  }
  return ruta.replace(regla, `$1${MARCA_OBJETO}`).replace(MODULO_DE_FUNCIONES, `$1${MARCA_OBJETO}`);
}
