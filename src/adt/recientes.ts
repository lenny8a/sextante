import { ResultadoBusqueda } from './busqueda-modelo';

export const MAX_RECIENTES = 30;
export const PREFIJO_RECIENTES = 'abapNavigator.recientes.';

const CAMPOS: readonly (keyof ResultadoBusqueda)[] = ['nombre', 'tipo', 'descripcion', 'paquete', 'uriAdt'];

export interface MementoMinimo {
  get<T>(clave: string): T | undefined;
  update(clave: string, valor: unknown): Thenable<void>;
}

export function anotarReciente(lista: ResultadoBusqueda[], nuevo: ResultadoBusqueda): ResultadoBusqueda[] {
  const resto = lista.filter((r) => r.tipo !== nuevo.tipo || r.nombre !== nuevo.nombre);
  return [nuevo, ...resto].slice(0, MAX_RECIENTES);
}

function esResultado(valor: unknown): valor is ResultadoBusqueda {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }
  const campos = valor as Record<string, unknown>;
  return CAMPOS.every((campo) => typeof campos[campo] === 'string');
}

function clave(destino: string): string {
  return `${PREFIJO_RECIENTES}${destino}`;
}

export class Recientes {
  constructor(private readonly memento: MementoMinimo) {}

  listar(destino: string): ResultadoBusqueda[] {
    const guardado = this.memento.get<unknown>(clave(destino));
    if (!Array.isArray(guardado) || !guardado.every(esResultado)) {
      return [];
    }
    return guardado;
  }

  async anotar(destino: string, r: ResultadoBusqueda): Promise<void> {
    await this.memento.update(clave(destino), anotarReciente(this.listar(destino), r));
  }

  async vaciar(destino: string): Promise<void> {
    await this.memento.update(clave(destino), undefined);
  }
}
