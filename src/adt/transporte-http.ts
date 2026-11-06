import { ACCEPT_DISCOVERY, ErrorAdt, RUTA_DISCOVERY, rutaParaLog, type PeticionAdt, type RespuestaAdt, type TransporteAdt } from './transporte';

export interface CredencialesBasicas { usuario: string; contrasena: string }

export interface OpcionesTransporteHttp {
  url: string;
  cliente?: string;
  idioma?: string;
  credenciales: CredencialesBasicas;
  fetchFn?: typeof fetch;
  tiempoMs?: number;
  registrar?: (m: string) => void;
}

const TIEMPO_POR_DEFECTO_MS = 10_000;
const PETICION_TOKEN: PeticionAdt = { metodo: 'GET', ruta: RUTA_DISCOVERY, cabeceras: { accept: ACCEPT_DISCOVERY } };

/** `TypeError (DEPTH_ZERO_SELF_SIGNED_CERT)`: nombre del error y código de su causa, sin host ni mensaje. */
export function causaDeFallo(error: unknown): string {
  const causa = error instanceof Error ? error.cause : undefined;
  const codigo = typeof causa === 'object' && causa !== null && 'code' in causa ? String(causa.code) : undefined;
  const nombre = error instanceof Error ? error.name : typeof error;
  return codigo ? `${nombre} (${codigo})` : nombre;
}

function esTiempoAgotado(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

// Solo rutas relativas al origen base: una uri absoluta llevaría Basic y cookies a otro host.
export function urlDelSistema(ruta: string, base: string): URL | undefined {
  if (!ruta.startsWith('/') || ruta.startsWith('//')) {
    return undefined;
  }
  const url = new URL(ruta, base);
  return url.origin === new URL(base).origin ? url : undefined;
}

function esExito(respuesta: RespuestaAdt): boolean {
  return respuesta.estado >= 200 && respuesta.estado <= 299;
}

interface RespuestaHttp { datos: RespuestaAdt; token?: string }

export class TransporteHttp implements TransporteAdt {
  private readonly cookies = new Map<string, string>();
  private tokenCsrf: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly tiempoMs: number;

  constructor(private readonly opciones: OpcionesTransporteHttp) {
    this.fetchFn = opciones.fetchFn ?? fetch;
    this.tiempoMs = opciones.tiempoMs ?? TIEMPO_POR_DEFECTO_MS;
  }

  async peticion(p: PeticionAdt, signal?: AbortSignal): Promise<RespuestaAdt> {
    if (p.metodo === 'GET') {
      return p.ruta === RUTA_DISCOVERY ? this.pedirToken(p, signal) : (await this.enviar(p, p.cabeceras, signal)).datos;
    }
    this.url(p); // valida la ruta antes de pedir token
    if (this.tokenCsrf === undefined) {
      const discovery = await this.pedirToken(PETICION_TOKEN, signal);
      if (!esExito(discovery)) { return discovery; }
    }
    let resultado = await this.enviarConToken(p, signal);
    // NO VERIFICADO: que un 403 con `x-csrf-token: Required` signifique token caducado y baste con pedir otro.
    if (resultado.datos.estado === 403 && resultado.token?.toLowerCase() === 'required') {
      const discovery = await this.pedirToken(PETICION_TOKEN, signal);
      if (!esExito(discovery)) { return discovery; }
      resultado = await this.enviarConToken(p, signal);
    }
    return resultado.datos;
  }

  private async pedirToken(p: PeticionAdt, signal: AbortSignal | undefined): Promise<RespuestaAdt> {
    const { datos, token } = await this.enviar(p, { ...p.cabeceras, 'x-csrf-token': 'fetch' }, signal);
    if (token !== undefined && token.toLowerCase() !== 'required') { this.tokenCsrf = token; }
    return datos;
  }

  private enviarConToken(p: PeticionAdt, signal: AbortSignal | undefined): Promise<RespuestaHttp> {
    return this.enviar(p, { ...p.cabeceras, 'x-csrf-token': this.tokenCsrf ?? 'fetch' }, signal);
  }

  private url(p: PeticionAdt): URL {
    const url = urlDelSistema(p.ruta, this.opciones.url);
    if (!url) {
      throw new ErrorAdt('Ruta fuera del sistema', 0, '');
    }
    for (const [clave, valor] of Object.entries(p.parametros ?? {})) { url.searchParams.set(clave, valor); }
    if (this.opciones.cliente) { url.searchParams.set('sap-client', this.opciones.cliente); }
    if (this.opciones.idioma) { url.searchParams.set('sap-language', this.opciones.idioma); }
    return url;
  }

  private async enviar(p: PeticionAdt, cabecerasExtra: Record<string, string>, signalExterna: AbortSignal | undefined): Promise<RespuestaHttp> {
    const { metodo, ruta } = p;
    const rutaLog = rutaParaLog(ruta);
    const url = this.url(p);
    const { usuario, contrasena } = this.opciones.credenciales;
    const cabeceras = new Headers(cabecerasExtra);
    cabeceras.set('authorization', `Basic ${Buffer.from(`${usuario}:${contrasena}`).toString('base64')}`);
    if (this.cookies.size > 0) {
      cabeceras.set('cookie', [...this.cookies].map(([nombre, valor]) => `${nombre}=${valor}`).join('; '));
    }

    const senales = [AbortSignal.timeout(this.tiempoMs)];
    if (signalExterna) { senales.push(signalExterna); }
    let respuesta: Response;
    try {
      // Un 3xx no se sigue: una redirección al logon SAML acabaría en un 200 y en una sesión "ok" falsa.
      respuesta = await this.fetchFn(url.toString(), {
        method: metodo, headers: cabeceras, body: p.cuerpo, signal: AbortSignal.any(senales), redirect: 'manual',
      });
    } catch (error) {
      if (signalExterna?.aborted) { throw error; }
      const motivo = esTiempoAgotado(error) ? `sin respuesta en ${this.tiempoMs} ms` : `fallo de red (${causaDeFallo(error)})`;
      this.opciones.registrar?.(`ADT ${metodo} ${rutaLog} → ${motivo}`);
      throw new ErrorAdt(`ADT ${metodo} ${rutaLog}: ${motivo}`, 0, ruta);
    }

    this.guardarCookies(respuesta.headers);
    const texto = await respuesta.text();
    this.opciones.registrar?.(`ADT ${metodo} ${rutaLog} → ${respuesta.status} (${Buffer.byteLength(texto)} bytes)`);
    return {
      datos: {
        estado: respuesta.status,
        cuerpo: texto,
        tipoContenido: respuesta.headers.get('content-type') ?? undefined,
        cabeceras: [...new Set(respuesta.headers.keys())],
      },
      token: respuesta.headers.get('x-csrf-token') ?? undefined,
    };
  }

  private guardarCookies(cabeceras: Headers): void {
    for (const linea of cabeceras.getSetCookie()) {
      const par = linea.split(';', 1)[0];
      const igual = par.indexOf('=');
      if (igual > 0) { this.cookies.set(par.slice(0, igual).trim(), par.slice(igual + 1).trim()); }
    }
  }
}
