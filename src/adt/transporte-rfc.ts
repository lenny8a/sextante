import { ErrorDelPuente, type PuenteRfc, type RespuestaPuente } from './puente-rfc';
import { ErrorAdt, rutaParaLog, type PeticionAdt, type RespuestaAdt, type TransporteAdt } from './transporte';

export interface OpcionesTransporteRfc {
  puente: Pick<PuenteRfc, 'peticion'>;
  destino: string;
  /** Con función se evalúa en cada petición: el rol del sistema puede cambiar con la sesión abierta. */
  soloLectura: boolean | (() => boolean);
  registrar?: (m: string) => void;
  /** Se llama si el puente perdió la sesión (clase `proceso`) para que la siguiente búsqueda repita el logon; un tiempo agotado (`tiempo`) no la pierde. */
  alPerderSesion?: () => void;
}

export class ErrorSoloLectura extends ErrorAdt {
  constructor(metodo: string, ruta: string) {
    super(`Sistema de solo lectura: ${metodo} no permitido`, 0, ruta);
    this.name = 'ErrorSoloLectura';
  }
}

// Spec §6 (diccionario en contexto): estos endpoints viajan por POST pero solo leen.
export const LECTURAS_PERMITIDAS: readonly string[] = [
  '/sap/bc/adt/datapreview/freestyle',
  '/sap/bc/adt/datapreview/ddic',
  '/sap/bc/adt/repository/informationsystem/usageReferences',
  '/sap/bc/adt/repository/nodestructure',
];

export function esLecturaPermitida(p: PeticionAdt): boolean {
  return p.metodo === 'GET' || (p.metodo === 'POST' && LECTURAS_PERMITIDAS.includes(p.ruta));
}

const MENSAJE_SIN_FUNCION = 'El sistema no expone SADT_REST_RFC_ENDPOINT';

function sinQuery(ruta: string): string {
  const corte = ruta.indexOf('?');
  return corte < 0 ? ruta : ruta.slice(0, corte);
}

function traducir(error: ErrorDelPuente, ruta: string): ErrorAdt {
  const { clase, mensaje } = error.detalle;
  if (clase === 'logon') { return new ErrorAdt(mensaje, 401, ruta); }
  return new ErrorAdt(clase === 'funcion' ? MENSAJE_SIN_FUNCION : mensaje, 0, ruta);
}

function aRespuestaAdt(r: RespuestaPuente): RespuestaAdt {
  const nombres = Object.keys(r.cabeceras);
  const tipo = nombres.find((n) => n.toLowerCase() === 'content-type');
  return {
    estado: r.estado,
    cuerpo: r.cuerpo.toString('utf8'),
    tipoContenido: tipo === undefined ? undefined : r.cabeceras[tipo],
    cabeceras: [...new Set(nombres.map((n) => n.toLowerCase()))],
  };
}

export class TransporteRfc implements TransporteAdt {
  constructor(private readonly opciones: OpcionesTransporteRfc) {}

  async peticion(p: PeticionAdt, signal?: AbortSignal): Promise<RespuestaAdt> {
    const { metodo, ruta } = p;
    if (this.esSoloLectura() && !esLecturaPermitida(p)) {
      throw new ErrorSoloLectura(metodo, ruta);
    }
    // El puente tiene su propio tiempo máximo: la señal solo se atiende antes de enviar.
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new ErrorAdt('Petición cancelada', 0, ruta);
    }
    const rutaLog = rutaParaLog(sinQuery(ruta));
    try {
      const respuesta = await this.opciones.puente.peticion(this.opciones.destino, p);
      this.opciones.registrar?.(`ADT(rfc) ${metodo} ${rutaLog} → ${respuesta.estado} (${respuesta.cuerpo.length} bytes)`);
      return aRespuestaAdt(respuesta);
    } catch (error) {
      if (!(error instanceof ErrorDelPuente)) { throw error; }
      this.opciones.registrar?.(`ADT(rfc) ${metodo} ${rutaLog} → error ${error.detalle.clase}`);
      if (error.detalle.clase === 'proceso') {
        this.opciones.alPerderSesion?.();
      }
      throw traducir(error, ruta);
    }
  }

  private esSoloLectura(): boolean {
    const { soloLectura } = this.opciones;
    return typeof soloLectura === 'function' ? soloLectura() : soloLectura;
  }
}
