import { execFile } from 'node:child_process';

export const NOMBRE_REGISTRO = 'sextante';

export type EstadoRegistro =
  | { estado: 'registrado'; puerto?: number }
  | { estado: 'noRegistrado' }
  | { estado: 'sinCli' }
  | { estado: 'desconocido' };

export interface EjecutorCli {
  ejecutar(programa: string, args: string[]): Promise<{ codigo: number; salida: string }>;
}

export function urlServidor(puerto: number): string {
  return `http://127.0.0.1:${puerto}/mcp`;
}

export function argumentosRegistro(puerto: number, token: string): string[] {
  return [
    'mcp', 'add', '--transport', 'http', '--scope', 'user', NOMBRE_REGISTRO,
    urlServidor(puerto), '--header', `Authorization: Bearer ${token}`,
  ];
}

export function argumentosBaja(): string[] {
  return ['mcp', 'remove', '--scope', 'user', NOMBRE_REGISTRO];
}

export function argumentosConsulta(): string[] {
  return ['mcp', 'get', NOMBRE_REGISTRO];
}

export function interpretarConsulta(salida: string, codigo: number): EstadoRegistro {
  const url = /https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/mcp/.exec(salida);
  if (url) {
    return { estado: 'registrado', puerto: Number(url[1]) };
  }
  if (codigo !== 0 || /not found|no mcp server/i.test(salida)) {
    return { estado: 'noRegistrado' };
  }
  return { estado: 'desconocido' };
}

export function textoConfiguracion(puerto: number, token: string): string {
  const url = urlServidor(puerto);
  return [
    'Codex (~/.codex/config.toml):',
    '',
    '[mcp_servers.sextante]',
    `url = "${url}"`,
    'bearer_token_env_var = "SEXTANTE_MCP_TOKEN"',
    '',
    `Define la variable de entorno antes de abrir Codex: export SEXTANTE_MCP_TOKEN=${token}`,
    '',
    'Cualquier cliente MCP (JSON):',
    '',
    JSON.stringify({ type: 'http', url, headers: { Authorization: `Bearer ${token}` } }, null, 2),
  ].join('\n');
}

export function comandoParaCopiar(puerto: number, token: string): string {
  const args = argumentosRegistro(puerto, token);
  const ultimo = args.length - 1;
  return `claude ${args.map((a, i) => (i === ultimo ? `"${a}"` : a)).join(' ')}`;
}

type ResultadoCli = { tipo: 'ok'; codigo: number; salida: string } | { tipo: 'sinCli' } | { tipo: 'fallo' };

function codigoDe(e: unknown): unknown {
  return typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
}

async function ejecutarClaude(cli: EjecutorCli, args: string[]): Promise<ResultadoCli> {
  try {
    const r = await cli.ejecutar('claude', args);
    return { tipo: 'ok', codigo: r.codigo, salida: r.salida };
  } catch (e) {
    const code = codigoDe(e);
    // NO VERIFICADO: EINVAL indica que `claude` resolvió a un shim .cmd/.bat (instalación npm) que no se puede ejecutar sin shell.
    return code === 'ENOENT' || code === 'EINVAL' ? { tipo: 'sinCli' } : { tipo: 'fallo' };
  }
}

/**
 * Baja y alta: tras regenerar el token hay que sustituir el registro anterior.
 * NO VERIFICADO: que `claude mcp add` rechace un nombre ya registrado; la baja previa lo evita en cualquier caso.
 * El resultado de la baja se ignora (no estar registrado es lo normal), salvo que falte la CLI.
 */
export async function registrarEnClaude(puerto: number, token: string, cli: EjecutorCli): Promise<EstadoRegistro> {
  const baja = await ejecutarClaude(cli, argumentosBaja());
  if (baja.tipo === 'sinCli') {
    return { estado: 'sinCli' };
  }
  const r = await ejecutarClaude(cli, argumentosRegistro(puerto, token));
  if (r.tipo === 'sinCli') {
    return { estado: 'sinCli' };
  }
  return r.tipo === 'ok' && r.codigo === 0 ? { estado: 'registrado', puerto } : { estado: 'desconocido' };
}

export async function consultarRegistro(cli: EjecutorCli): Promise<EstadoRegistro> {
  const r = await ejecutarClaude(cli, argumentosConsulta());
  if (r.tipo === 'sinCli') {
    return { estado: 'sinCli' };
  }
  return r.tipo === 'ok' ? interpretarConsulta(r.salida, r.codigo) : { estado: 'desconocido' };
}

export function lanzar(programa: string, args: string[]): Promise<{ codigo: number; salida: string }> {
  return new Promise((resolve, reject) => {
    const rechazar = (e: unknown): void => {
      const code = codigoDe(e);
      reject(Object.assign(new Error('La CLI de Claude Code no respondió'), typeof code === 'string' ? { code } : {}));
    };
    try {
      execFile(programa, args, { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        const salida = `${stdout}${stderr}`;
        if (!error) {
          resolve({ codigo: 0, salida });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (typeof code === 'number') {
          resolve({ codigo: code, salida });
          return;
        }
        rechazar(error);
      });
    } catch (e) {
      rechazar(e);
    }
  });
}

export function ejecutorCliPorDefecto(): EjecutorCli {
  return { ejecutar: lanzar };
}
