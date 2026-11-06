export interface PeticionJsonRpc {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface NotificacionJsonRpc {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type MensajeJsonRpc = PeticionJsonRpc | NotificacionJsonRpc;

export interface RespuestaJsonRpc {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const CODIGOS = {
  parse: -32700,
  peticionInvalida: -32600,
  metodoDesconocido: -32601,
  paramsInvalidos: -32602,
  interno: -32603,
} as const;

export type Analisis =
  | { ok: true; mensajes: MensajeJsonRpc[]; lote: boolean }
  | { ok: false; respuesta: RespuestaJsonRpc };

export function respuestaOk(id: PeticionJsonRpc['id'], result: unknown): RespuestaJsonRpc {
  return { jsonrpc: '2.0', id, result };
}

export function respuestaError(
  id: RespuestaJsonRpc['id'],
  code: number,
  message: string,
  data?: unknown,
): RespuestaJsonRpc {
  const error = data === undefined ? { code, message } : { code, message, data };
  return { jsonrpc: '2.0', id, error };
}

export function esPeticion(m: MensajeJsonRpc): m is PeticionJsonRpc {
  return 'id' in m;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function comoMensaje(valor: unknown): MensajeJsonRpc | undefined {
  if (!esObjeto(valor) || valor.jsonrpc !== '2.0' || typeof valor.method !== 'string') {
    return undefined;
  }
  if ('id' in valor && typeof valor.id !== 'number' && typeof valor.id !== 'string') {
    return undefined;
  }
  return valor as unknown as MensajeJsonRpc;
}

export function analizarCuerpo(cuerpo: string): Analisis {
  let json: unknown;
  try {
    json = JSON.parse(cuerpo);
  } catch {
    return { ok: false, respuesta: respuestaError(null, CODIGOS.parse, 'JSON inválido') };
  }
  const lote = Array.isArray(json);
  const candidatos: unknown[] = Array.isArray(json) ? json : [json];
  const mensajes: MensajeJsonRpc[] = [];
  for (const candidato of candidatos) {
    const mensaje = comoMensaje(candidato);
    if (!mensaje) {
      return { ok: false, respuesta: respuestaError(null, CODIGOS.peticionInvalida, 'Petición inválida') };
    }
    mensajes.push(mensaje);
  }
  if (mensajes.length === 0) {
    return { ok: false, respuesta: respuestaError(null, CODIGOS.peticionInvalida, 'Lote vacío') };
  }
  return { ok: true, mensajes, lote };
}
