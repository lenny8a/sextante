export const PREFIJO_SECRETO = 'abapNavigator.contrasena.';

/** Subconjunto de vscode.SecretStorage: este módulo no importa vscode. */
export interface AlmacenSecretos {
  get(k: string): Thenable<string | undefined>;
  store(k: string, v: string): Thenable<void>;
  delete(k: string): Thenable<void>;
}

export type PedirContrasena = (destino: string, usuario: string) => Promise<string | undefined>;

export class Credenciales {
  constructor(private readonly secretos: AlmacenSecretos, private readonly pedir: PedirContrasena) {}

  async obtener(destino: string, usuario: string): Promise<string | undefined> {
    const guardada = await this.secretos.get(claveDe(destino));
    if (guardada) {
      return guardada;
    }
    const pedida = await this.pedir(destino, usuario);
    if (!pedida) {
      return undefined;
    }
    await this.secretos.store(claveDe(destino), pedida);
    return pedida;
  }

  /** Solo lo guardado: nunca pide la contraseña. */
  async obtenerSinPreguntar(destino: string): Promise<string | undefined> {
    return (await this.secretos.get(claveDe(destino))) || undefined;
  }

  async guardada(destino: string): Promise<boolean> {
    return (await this.obtenerSinPreguntar(destino)) !== undefined;
  }

  async olvidar(destino: string): Promise<void> {
    await this.secretos.delete(claveDe(destino));
  }
}

function claveDe(destino: string): string {
  return `${PREFIJO_SECRETO}${destino}`;
}
