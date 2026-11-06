interface EntradaCache { hasta: number; valor: Promise<unknown> }

/**
 * Caché de promesas con caducidad: una sola promesa en vuelo por clave, un resultado (también `undefined`)
 * vale `ttl` milisegundos y un rechazo borra la entrada para que la próxima llamada lo vuelva a intentar.
 */
export class CacheTtl {
  private readonly entradas = new Map<string, EntradaCache>();

  constructor(private readonly ahora: () => number) {}

  obtener<T>(clave: string, ttl: number, calcular: () => Promise<T>): Promise<T> {
    const ahora = this.ahora();
    const existente = this.entradas.get(clave);
    if (existente && existente.hasta > ahora) {
      return existente.valor as Promise<T>;
    }
    const valor = calcular();
    const entrada: EntradaCache = { hasta: ahora + ttl, valor };
    this.entradas.set(clave, entrada);
    valor.catch(() => this.borrarSiEs(clave, entrada));
    return valor;
  }

  /** Sin prefijo vacía todo; con él, solo las claves que empiezan así (`'DEST|'`). */
  vaciar(prefijo?: string): void {
    if (prefijo === undefined) {
      this.entradas.clear();
      return;
    }
    for (const clave of [...this.entradas.keys()]) {
      if (clave.startsWith(prefijo)) {
        this.entradas.delete(clave);
      }
    }
  }

  private borrarSiEs(clave: string, entrada: EntradaCache): void {
    if (this.entradas.get(clave) === entrada) {
      this.entradas.delete(clave);
    }
  }
}
