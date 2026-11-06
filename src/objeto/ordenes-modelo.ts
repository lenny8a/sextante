import type { TipoObjeto } from '../bridge/adt-uri';
import { carpetaTipoDe } from '../adt/abrir-resultado';
import type { ResultadoBusqueda } from '../adt/busqueda-modelo';
import type { ObjetoOrden, Orden, Tarea } from '../adt/transportes-modelo';
import { iconoDeTipo } from '../tree/iconos';

export type MotivoAviso = 'sinSistema' | 'conectar' | 'sinVia' | 'cargando' | 'sinOrdenes' | 'error';
export type GrupoOrdenes = 'modificables' | 'liberadas' | 'customizing';

export type NodoOrdenes =
  | { clase: 'aviso'; motivo: MotivoAviso; destino?: string; mensaje?: string }
  | { clase: 'grupo'; grupo: GrupoOrdenes; ordenes: Orden[] }
  | { clase: 'orden'; orden: Orden }
  | { clase: 'tarea'; orden: Orden; tarea: Tarea }
  | { clase: 'objeto'; numero: string; objeto: ObjetoOrden; abrible: boolean };

export interface EstadoOrdenes {
  destino?: string;
  cargando: boolean;
  ordenes?: Orden[];
  error?: string;
  motivoSinVia?: string;
}

export interface EtiquetaOrdenes {
  label: string;
  description?: string;
  tooltip?: string;
  icono: string;
  contextValue: string;
  colapsable: 'no' | 'abierto' | 'cerrado';
}

export const TEXTO_NO_ABRIBLE = (o: ObjetoOrden): string => `${o.nombre} (${o.tipo}) no se puede abrir desde aquí`;

const ORDEN_GRUPOS: readonly GrupoOrdenes[] = ['modificables', 'liberadas', 'customizing'];

const ETIQUETA_GRUPO: Record<GrupoOrdenes, string> = {
  modificables: 'Modificables',
  liberadas: 'Liberadas · últimas 2 semanas',
  customizing: 'Customizing',
};

const ICONO_AVISO: Record<MotivoAviso, string> = {
  sinSistema: 'info',
  conectar: 'plug',
  sinVia: 'debug-disconnect',
  cargando: 'loading~spin',
  sinOrdenes: 'info',
  error: 'error',
};

/** Tipo del Workbench (`tm:wbtype`) → tipo de objeto del árbol, solo para elegir el icono. */
const TIPO_OBJETO_POR_WB: Readonly<Record<string, TipoObjeto>> = {
  'CLAS/OC': 'clase',
  'CLAS/OM': 'clase',
  'INTF/OI': 'interfaz',
  'PROG/P': 'programa',
  'PROG/I': 'include',
  'FUGR/F': 'grupoFunciones',
  'FUGR/FF': 'grupoFunciones',
  'TABL/DT': 'tabla',
  'TABL/DS': 'estructura',
  'DDLS/DF': 'cds',
};

const TIPO_METODO = 'METH';
const TIPO_FUNCION = 'FUNC';
const TIPO_CLASE_WB = 'CLAS/OC';

function gruposDe(ordenes: Orden[]): Array<Extract<NodoOrdenes, { clase: 'grupo' }>> {
  const porGrupo: Record<GrupoOrdenes, Orden[]> = {
    modificables: ordenes.filter((o) => o.categoria === 'workbench' && o.estado === 'modificable'),
    liberadas: ordenes.filter((o) => o.categoria === 'workbench' && o.estado === 'liberada'),
    customizing: ordenes.filter((o) => o.categoria === 'customizing'),
  };
  return ORDEN_GRUPOS.filter((g) => porGrupo[g].length > 0).map((grupo) => ({
    clase: 'grupo',
    grupo,
    ordenes: porGrupo[grupo],
  }));
}

function avisoDe(motivo: MotivoAviso, destino?: string, mensaje?: string): NodoOrdenes {
  const aviso: NodoOrdenes = { clase: 'aviso', motivo };
  if (destino !== undefined) {
    aviso.destino = destino;
  }
  if (mensaje !== undefined) {
    aviso.mensaje = mensaje;
  }
  return aviso;
}

/** Un aviso único, o los grupos no vacíos en el orden modificables, liberadas, customizing. */
export function raicesDe(estado: EstadoOrdenes): NodoOrdenes[] {
  if (estado.cargando) {
    return [avisoDe('cargando', estado.destino)];
  }
  if (estado.destino === undefined) {
    return [avisoDe('sinSistema')];
  }
  if (estado.motivoSinVia !== undefined) {
    return [avisoDe('sinVia', estado.destino, estado.motivoSinVia)];
  }
  if (estado.error !== undefined) {
    return [avisoDe('error', estado.destino, estado.error)];
  }
  if (estado.ordenes === undefined) {
    return [avisoDe('conectar', estado.destino)];
  }
  const grupos = gruposDe(estado.ordenes);
  return grupos.length > 0 ? grupos : [avisoDe('sinOrdenes', estado.destino)];
}

function nodoObjeto(numero: string, objeto: ObjetoOrden, orden: Orden): NodoOrdenes {
  return {
    clase: 'objeto',
    numero,
    objeto,
    abrible: orden.categoria === 'workbench' && resultadoBusquedaDe(objeto) !== undefined,
  };
}

/** Grupo → órdenes; orden → objetos directos y luego tareas; tarea → objetos. */
export function hijosDe(nodo: NodoOrdenes): NodoOrdenes[] {
  switch (nodo.clase) {
    case 'grupo':
      return nodo.ordenes.map((orden) => ({ clase: 'orden', orden }));
    case 'orden':
      return [
        ...nodo.orden.objetos.map((o) => nodoObjeto(nodo.orden.numero, o, nodo.orden)),
        ...nodo.orden.tareas.map((tarea): NodoOrdenes => ({ clase: 'tarea', orden: nodo.orden, tarea })),
      ];
    case 'tarea':
      return nodo.tarea.objetos.map((o) => nodoObjeto(nodo.tarea.numero, o, nodo.orden));
    default:
      return [];
  }
}

function textoAviso(nodo: Extract<NodoOrdenes, { clase: 'aviso' }>): string {
  switch (nodo.motivo) {
    case 'conectar':
      return `Conéctate a ${nodo.destino ?? 'el sistema'} por RFC para ver tus órdenes`;
    case 'sinOrdenes':
      return 'Sin órdenes modificables';
    case 'sinSistema':
      return 'Marca un sistema como activo';
    case 'sinVia':
      return `${nodo.destino ?? 'Sistema'}: ${nodo.mensaje ?? 'sin conexión RFC'}`;
    case 'cargando':
      return 'Cargando órdenes…';
    case 'error':
      return nodo.mensaje ?? 'No se pudieron leer las órdenes';
  }
}

function iconoDeObjeto(objeto: ObjetoOrden): string {
  const tipo = objeto.tipoWb === undefined ? undefined : TIPO_OBJETO_POR_WB[objeto.tipoWb];
  return tipo === undefined ? 'symbol-misc' : iconoDeTipo(tipo);
}

function etiquetaDeObjeto(objeto: ObjetoOrden): EtiquetaOrdenes {
  const partes: string[] = [];
  if (objeto.info !== undefined) {
    partes.push(objeto.info);
  }
  if (objeto.pgmid !== 'R3TR') {
    partes.push(`${objeto.pgmid} ${objeto.tipo}`);
  }
  return {
    label: objeto.nombre.replace(/\s+/g, ' ').trim(),
    description: partes.length > 0 ? partes.join(' · ') : undefined,
    tooltip: objeto.descripcion,
    icono: iconoDeObjeto(objeto),
    contextValue: 'objeto',
    colapsable: 'no',
  };
}

export function etiquetaDe(nodo: NodoOrdenes): EtiquetaOrdenes {
  switch (nodo.clase) {
    case 'aviso':
      return {
        label: textoAviso(nodo),
        icono: ICONO_AVISO[nodo.motivo],
        contextValue: 'aviso',
        colapsable: 'no',
      };
    case 'grupo':
      return {
        label: `${ETIQUETA_GRUPO[nodo.grupo]} (${nodo.ordenes.length})`,
        icono: 'folder',
        contextValue: 'grupo',
        colapsable: nodo.grupo === 'modificables' ? 'abierto' : 'cerrado',
      };
    case 'orden':
      return {
        label: nodo.orden.numero,
        description: nodo.orden.descripcion,
        tooltip: `${nodo.orden.propietario} · ${nodo.orden.estadoCrudo}`,
        icono: nodo.orden.estado === 'liberada' ? 'check' : 'package',
        contextValue: 'orden',
        colapsable: nodo.orden.objetos.length + nodo.orden.tareas.length > 0 ? 'cerrado' : 'no',
      };
    case 'tarea':
      return {
        label: nodo.tarea.numero,
        description: `tarea · ${nodo.tarea.propietario}`,
        tooltip: nodo.tarea.descripcion,
        icono: 'tasklist',
        contextValue: 'tarea',
        colapsable: nodo.tarea.objetos.length > 0 ? 'cerrado' : 'no',
      };
    case 'objeto':
      return etiquetaDeObjeto(nodo.objeto);
  }
}

/**
 * Búsqueda mínima para abrir un objeto de una orden desde su tipo del Workbench. Un método (`METH`) abre su
 * clase; el nombre de `LIMU METH` llega como clase rellena con espacios más el método.
 */
export function resultadoBusquedaDe(objeto: ObjetoOrden): ResultadoBusqueda | undefined {
  const esMetodo = objeto.tipo === TIPO_METODO;
  const tipo = esMetodo ? TIPO_CLASE_WB : objeto.tipoWb;
  if (tipo === undefined || carpetaTipoDe(tipo) === undefined) {
    return undefined;
  }
  return {
    nombre: esMetodo ? nombreBuscable(objeto) : objeto.nombre,
    tipo,
    uriAdt: '',
    descripcion: objeto.info ?? '',
    paquete: '',
  };
}

/** Nombre con el que se busca el objeto: la clase para un método, el nombre sin relleno para el resto. */
export function nombreBuscable(objeto: ObjetoOrden): string {
  return objeto.tipo === TIPO_METODO || objeto.tipo === TIPO_FUNCION
    ? (objeto.nombre.trim().split(/\s+/)[0] ?? objeto.nombre)
    : objeto.nombre.trim();
}
