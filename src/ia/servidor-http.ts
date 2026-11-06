import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CODIGOS, analizarCuerpo, esPeticion, respuestaError, type RespuestaJsonRpc } from './jsonrpc-modelo';
import { despachar, type DependenciasDespacho } from './mcp-modelo';

export const RUTA_MCP = '/mcp';
/** Otra ventana que gana el foco pide a esta que suelte el puerto. */
export const RUTA_CEDER = '/ceder';
export const PUERTO_POR_DEFECTO = 2237;
export const MAX_CUERPO_BYTES = 2 * 1024 * 1024;
export const CABECERA_SESION = 'mcp-session-id';

const HOST = '127.0.0.1';
const ORIGEN_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export interface OpcionesServidor {
  token: string;
  despacho: DependenciasDespacho;
  registrar?(mensaje: string): void;
  /** Se llama tras responder 204 a un `POST /ceder` autorizado. */
  alCeder?(): void;
}

function tokenValido(cabecera: string | undefined, token: string): boolean {
  const esperado = Buffer.from(token);
  const recibido = Buffer.from((cabecera ?? '').replace(/^Bearer /, ''));
  return cabecera?.startsWith('Bearer ') === true && recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

function enviarJson(res: ServerResponse, estado: number, cuerpo: unknown, extra: Record<string, string> = {}): void {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(estado, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(texto), ...extra });
  res.end(texto);
}

function enviarVacio(res: ServerResponse, estado: number, extra: Record<string, string> = {}): void {
  res.writeHead(estado, { 'Content-Type': 'application/json', 'Content-Length': 0, ...extra });
  res.end();
}

export class ServidorHttpMcp {
  private servidor: Server | undefined;
  private readonly _sesiones = new Set<string>();

  constructor(private readonly opciones: OpcionesServidor) {}

  get puerto(): number | undefined {
    const dir = this.servidor?.address();
    return dir && typeof dir === 'object' ? dir.port : undefined;
  }

  get sesiones(): number {
    return this._sesiones.size;
  }

  arrancar(puerto: number): Promise<number> {
    return new Promise((resolver, rechazar) => {
      const servidor = createServer((req, res) => {
        this.atender(req, res).catch((e: unknown) => this.falloInterno(res, e));
      });
      servidor.once('error', rechazar);
      servidor.listen(puerto, HOST, () => {
        servidor.off('error', rechazar);
        // Sin oyente, un error al aceptar conexiones (EMFILE…) sería una excepción no capturada en el host.
        servidor.on('error', (e) => this.opciones.registrar?.(`IA: error del servidor (${e.name})`));
        this.servidor = servidor;
        resolver((servidor.address() as AddressInfo).port);
      });
    });
  }

  cerrar(): Promise<void> {
    const servidor = this.servidor;
    this.servidor = undefined;
    this._sesiones.clear();
    if (!servidor) return Promise.resolve();
    return new Promise((resolver) => {
      servidor.close(() => resolver());
      servidor.closeAllConnections();
    });
  }

  private falloInterno(res: ServerResponse, error: unknown): void {
    const nombre = error instanceof Error ? error.constructor.name : typeof error;
    this.opciones.registrar?.(`IA: error interno del servidor (${nombre})`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    enviarJson(res, 500, respuestaError(null, CODIGOS.interno, 'Error interno'));
  }

  private async atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? '').split('?')[0];
    if (url !== RUTA_MCP && url !== RUTA_CEDER) return enviarVacio(res, 404);
    const origen = req.headers.origin;
    if (origen !== undefined && !ORIGEN_LOCAL.test(origen)) return enviarVacio(res, 403);
    if (!tokenValido(req.headers.authorization, this.opciones.token)) {
      return enviarJson(res, 401, respuestaError(null, -32000, 'No autorizado'));
    }
    if (url === RUTA_CEDER) return this.ceder(req, res);
    const sesion = req.headers[CABECERA_SESION];
    const idSesion = typeof sesion === 'string' && sesion !== '' ? sesion : undefined;
    if (req.method === 'DELETE') {
      if (idSesion) this._sesiones.delete(idSesion);
      return enviarVacio(res, 204);
    }
    if (req.method !== 'POST') return enviarVacio(res, 405, { Allow: 'POST, DELETE' });

    const cuerpo = await this.leerCuerpo(req, res);
    if (cuerpo === undefined) return;
    const analisis = analizarCuerpo(cuerpo);
    if (!analisis.ok) return enviarJson(res, 200, analisis.respuesta);

    const cabeceras: Record<string, string> = {};
    if (analisis.mensajes.some((m) => m.method === 'initialize')) {
      const nueva = randomUUID();
      this._sesiones.add(nueva);
      cabeceras['Mcp-Session-Id'] = nueva;
    } else if (idSesion) {
      this._sesiones.add(idSesion);
    }

    const respuestas: RespuestaJsonRpc[] = [];
    for (const mensaje of analisis.mensajes) {
      const r = await despachar(mensaje, this.opciones.despacho);
      if (r && esPeticion(mensaje)) respuestas.push(r);
    }
    if (respuestas.length === 0) return enviarVacio(res, 202, cabeceras);
    enviarJson(res, 200, analisis.lote ? respuestas : respuestas[0], cabeceras);
  }

  private ceder(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') return enviarVacio(res, 405, { Allow: 'POST' });
    req.resume();
    res.writeHead(204, { Connection: 'close' });
    res.end(() => this.opciones.alCeder?.());
  }

  private leerCuerpo(req: IncomingMessage, res: ServerResponse): Promise<string | undefined> {
    return new Promise((resolver, rechazar) => {
      const trozos: Buffer[] = [];
      let total = 0;
      req.on('data', (trozo: Buffer) => {
        total += trozo.length;
        if (total > MAX_CUERPO_BYTES) {
          req.removeAllListeners('data');
          req.removeAllListeners('end');
          trozos.length = 0;
          const texto = JSON.stringify(respuestaError(null, CODIGOS.peticionInvalida, 'Cuerpo demasiado grande'));
          res.writeHead(413, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(texto), Connection: 'close' });
          res.end(texto, () => req.destroy());
          resolver(undefined);
          return;
        }
        trozos.push(trozo);
      });
      req.on('end', () => resolver(Buffer.concat(trozos).toString('utf8')));
      req.on('error', rechazar);
    });
  }
}
