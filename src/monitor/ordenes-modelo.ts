export interface ObjetoMonitor {
  nombre: string;
  tipoWb?: string;
  info?: string;
}

export interface TareaMonitor {
  numero: string;
  propietario: string;
  objetos: ObjetoMonitor[];
}

export interface OrdenMonitor {
  numero: string;
  propietario: string;
  descripcion: string;
  destino?: string;
  tareas: TareaMonitor[];
  objetos: ObjetoMonitor[];
}

export interface FuenteOrdenes {
  ordenesAbiertas(destino: string): Promise<OrdenMonitor[]>;
}

export function objetosDeOrdenMonitor(orden: OrdenMonitor): ObjetoMonitor[] {
  const vistos = new Set<string>();
  const resultado: ObjetoMonitor[] = [];
  const todos = [...orden.objetos, ...orden.tareas.flatMap((t) => t.objetos)];
  for (const objeto of todos) {
    const clave = `${objeto.tipoWb ?? ''}\u0000${objeto.nombre}`;
    if (!vistos.has(clave)) {
      vistos.add(clave);
      resultado.push(objeto);
    }
  }
  return resultado;
}
