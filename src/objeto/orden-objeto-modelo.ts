import type { ObjetoOrden, OrdenDeObjeto } from '../adt/transportes-modelo';
import type { AlcanceOrdenes } from './consulta-ordenes-objeto';
import type { Truncado } from './servicio';

export interface ItemOrden {
  label: string;
  description: string;
  detail?: string;
  orden: OrdenDeObjeto;
}

export type ItemObjeto =
  | { clase: 'objeto'; label: string; description: string; objeto: ObjetoOrden; activo: boolean }
  | { clase: 'copiar' }
  | { clase: 'organizador' };

const SUFIJO_ALCANCE: Record<AlcanceOrdenes, string> = {
  objeto: '',
  grupo: ' (grupo y sus includes)',
  soloModulo: ' (solo este módulo)',
};

export const TITULO_ORDENES = (nombre: string, alcance: AlcanceOrdenes = 'objeto'): string =>
  `${nombre} · órdenes${SUFIJO_ALCANCE[alcance]}`;

export const MSG_TIPO_NO_SOPORTADO = 'Orden del objeto: tipo no soportado';

export function avisoTruncado(truncado: Truncado): string {
  return `Lista incompleta (${truncado.recibidas} de ${truncado.total})`;
}

const AVISO_ULTIMA_LIBERADA = 'La última orden está liberada: el próximo cambio pedirá una orden nueva';

const ICONO_POR_ESTADO: Record<OrdenDeObjeto['estado'], string> = {
  modificable: '$(package)',
  liberada: '$(check)',
  otro: '$(circle-outline)',
};

function todasLiberadas(ordenes: OrdenDeObjeto[]): boolean {
  return ordenes.length > 0 && ordenes.every((o) => o.estado === 'liberada');
}

function detalleDe(orden: OrdenDeObjeto): string {
  const estado = orden.estado === 'otro' ? orden.estadoCrudo : orden.estado;
  const trozos = [estado, orden.tarea ? `tarea ${orden.tarea}` : '', orden.propietario, orden.fecha].filter((t) => t !== '');
  const base = trozos.join(' · ');
  return orden.destino ? `${base} → ${orden.destino}` : base;
}

export function itemsOrdenes(ordenes: OrdenDeObjeto[]): ItemOrden[] {
  const avisar = todasLiberadas(ordenes);
  return ordenes.map((orden, i) => {
    const detalle = detalleDe(orden);
    return {
      label: `${ICONO_POR_ESTADO[orden.estado]} ${orden.numero}`,
      description: orden.descripcion ?? '',
      detail: avisar && i === 0 ? `${detalle} · ${AVISO_ULTIMA_LIBERADA}` : detalle,
      orden,
    };
  });
}

export function avisoDe(ordenes: OrdenDeObjeto[], nombre: string): string | undefined {
  if (ordenes.length === 0) {
    return `${nombre} no está en ninguna orden`;
  }
  if (todasLiberadas(ordenes)) {
    const ultima = ordenes[0] as OrdenDeObjeto;
    return `La última orden de ${nombre} está liberada (${ultima.numero})`;
  }
  return undefined;
}

export function itemsObjetos(objetos: ObjetoOrden[], nombreActivo: string): ItemObjeto[] {
  const activoUpper = nombreActivo.toUpperCase();
  const items: ItemObjeto[] = objetos.map((objeto) => {
    const activo = objeto.nombre.toUpperCase() === activoUpper;
    return {
      clase: 'objeto',
      label: `${activo ? '$(arrow-right) ' : ''}${objeto.nombre}`,
      description: [objeto.tipo, objeto.descripcion].filter((t) => t).join(' · '),
      objeto,
      activo,
    };
  });
  return [...items, { clase: 'copiar' }, { clase: 'organizador' }];
}

const ETIQUETA_FIJA: Record<Exclude<ItemObjeto['clase'], 'objeto'>, string> = {
  copiar: '$(copy) Copiar número',
  organizador: '$(package) Abrir en el organizador de la oficial',
};

/** Lo que muestra el QuickPick de cada fila: los objetos su etiqueta y descripción; las dos filas fijas su texto. */
export function etiquetaItemObjeto(item: ItemObjeto): { label: string; description?: string } {
  return item.clase === 'objeto' ? { label: item.label, description: item.description } : { label: ETIQUETA_FIJA[item.clase] };
}
