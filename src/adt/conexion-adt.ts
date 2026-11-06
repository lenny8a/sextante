import { ACCEPT_DISCOVERY, ErrorAdt, RUTA_DISCOVERY, rutaParaLog, type PeticionAdt, type RespuestaAdt, type TransporteAdt } from './transporte';

export { ACCEPT_DISCOVERY, ErrorAdt, RUTA_DISCOVERY, type RespuestaAdt } from './transporte';
export { causaDeFallo, urlDelSistema, type CredencialesBasicas } from './transporte-http';

function conTiempo(tiempoMs: number | undefined): Pick<PeticionAdt, 'tiempoMs'> {
  return tiempoMs === undefined ? {} : { tiempoMs };
}

export class ConexionAdt {
  constructor(private readonly transporte: TransporteAdt, private readonly registrar?: (m: string) => void) {}

  descubrir(signal?: AbortSignal): Promise<RespuestaAdt> {
    return this.enviar({ metodo: 'GET', ruta: RUTA_DISCOVERY, cabeceras: { accept: ACCEPT_DISCOVERY } }, signal);
  }

  get(ruta: string, parametros?: Record<string, string>, accept?: string, signal?: AbortSignal, tiempoMs?: number): Promise<RespuestaAdt> {
    const cabeceras: Record<string, string> = accept ? { accept } : {};
    return this.enviar({ metodo: 'GET', ruta, parametros, cabeceras, ...conTiempo(tiempoMs) }, signal);
  }

  post(
    ruta: string, cuerpo: string, contentType: string, accept?: string, signal?: AbortSignal, parametros?: Record<string, string>,
    tiempoMs?: number,
  ): Promise<RespuestaAdt> {
    const cabeceras: Record<string, string> = { 'content-type': contentType };
    if (accept) { cabeceras['accept'] = accept; }
    return this.enviar({ metodo: 'POST', ruta, parametros, cabeceras, cuerpo, ...conTiempo(tiempoMs) }, signal);
  }

  private async enviar(peticion: PeticionAdt, signal: AbortSignal | undefined): Promise<RespuestaAdt> {
    return this.validar(await this.transporte.peticion(peticion, signal), peticion.ruta);
  }

  private validar(datos: RespuestaAdt, ruta: string): RespuestaAdt {
    if (datos.estado < 200 || datos.estado > 299) {
      throw new ErrorAdt(`ADT ${rutaParaLog(ruta)}: respuesta ${datos.estado}`, datos.estado, ruta, datos.cuerpo);
    }
    return datos;
  }
}
