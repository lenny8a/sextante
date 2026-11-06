import { Dump, esDeHoy, fechaHoraLocal, horaLocal, usuarioValido } from './dumps-modelo';
import { agruparPorPadre, esAbrible, etiquetaTipo, filtrarMios, ObjetoInactivo } from './inactivos-modelo';
import { ObjetoMonitor, objetosDeOrdenMonitor, OrdenMonitor } from './ordenes-modelo';

export type EstadoSeccion<T> =
  | { fase: 'cargando' }
  | { fase: 'ok'; elementos: readonly T[]; llena: boolean }
  | { fase: 'error'; mensaje: string };

export type SeccionMonitor = 'dumps' | 'inactivos' | 'ordenes';

export type MotivoRaiz = 'sinSistema' | 'sinRfc' | 'conectar';

export interface EstadoMonitor {
  destino?: string;
  descripcionDestino?: string;
  /** Usuario del destino (válido) para "míos". */
  usuario?: string;
  motivo?: MotivoRaiz;
  /** Con `sinRfc`: texto de `mensajeSinRfc`. */
  textoMotivo?: string;
  /** Instante para "hoy"; ausente = `new Date()`. */
  ahora?: Date;
  dumps: EstadoSeccion<Dump>;
  dumpsTodos: boolean;
  inactivos: EstadoSeccion<ObjetoInactivo>;
  inactivosTodos: boolean;
  /** Ausente = sin fuente (nodo "pendiente"). */
  ordenes?: EstadoSeccion<OrdenMonitor>;
}

export type NodoMonitor =
  | { clase: 'aviso'; texto: string; seccion?: SeccionMonitor }
  | { clase: 'conectar'; destino: string }
  | { clase: 'seccion'; seccion: SeccionMonitor }
  | { clase: 'dump'; dump: Dump }
  | { clase: 'masDumps' }
  | { clase: 'inactivo'; objeto: ObjetoInactivo; padre?: ObjetoInactivo; padreAusente?: string }
  | { clase: 'orden'; orden: OrdenMonitor }
  | { clase: 'objetoOrden'; orden: OrdenMonitor; objeto: ObjetoMonitor }
  | { clase: 'pendiente' };

export interface EtiquetaNodo {
  label: string;
  description?: string;
  tooltip?: string;
  contextValue: string;
  colapsable: 'no' | 'abierto' | 'cerrado';
}

export const TEXTO_SIN_SISTEMA = 'Elige un sistema en la vista Sistemas';
export const TEXTO_SIN_DUMPS = 'Sin dumps de hoy';
export const TEXTO_SIN_INACTIVOS = 'Nada inactivo';
export const TEXTO_SIN_ORDENES = 'Sin órdenes modificables';
export const TEXTO_PENDIENTE = 'pendiente (entrega de la sesión 3)';

const TEXTO_CARGANDO = 'Cargando…';

export function estadoInicial(): EstadoMonitor {
  return {
    dumps: { fase: 'ok', elementos: [], llena: false },
    dumpsTodos: false,
    inactivos: { fase: 'ok', elementos: [], llena: false },
    inactivosTodos: false,
  };
}

export function dumpsDeHoy(estado: EstadoMonitor, ahora: Date): Dump[] {
  if (estado.dumps.fase !== 'ok') {
    return [];
  }
  return estado.dumps.elementos
    .filter((d) => esDeHoy(d, ahora))
    .sort((a, b) => new Date(b.publicado).getTime() - new Date(a.publicado).getTime());
}

function inactivosVisibles(estado: EstadoMonitor): ObjetoInactivo[] {
  if (estado.inactivos.fase !== 'ok') {
    return [];
  }
  const usuario = estado.inactivosTodos ? undefined : estado.usuario;
  return filtrarMios([...estado.inactivos.elementos], usuario);
}

function avisoDeFase<T>(estadoSeccion: EstadoSeccion<T>, seccion: SeccionMonitor): NodoMonitor[] | undefined {
  if (estadoSeccion.fase === 'cargando') {
    return [{ clase: 'aviso', texto: TEXTO_CARGANDO, seccion }];
  }
  if (estadoSeccion.fase === 'error') {
    return [{ clase: 'aviso', texto: `Error: ${estadoSeccion.mensaje}`, seccion }];
  }
  return undefined;
}

export function nodosRaiz(estado: EstadoMonitor): NodoMonitor[] {
  if (estado.destino === undefined) {
    return [{ clase: 'aviso', texto: TEXTO_SIN_SISTEMA }];
  }
  if (estado.motivo === 'sinRfc') {
    return [{ clase: 'aviso', texto: estado.textoMotivo ?? '' }];
  }
  if (estado.motivo === 'conectar') {
    return [{ clase: 'conectar', destino: estado.destino }];
  }
  return [
    { clase: 'seccion', seccion: 'dumps' },
    { clase: 'seccion', seccion: 'inactivos' },
    { clase: 'seccion', seccion: 'ordenes' },
  ];
}

function hijosDeDumps(estado: EstadoMonitor): NodoMonitor[] {
  const aviso = avisoDeFase(estado.dumps, 'dumps');
  if (aviso !== undefined) {
    return aviso;
  }
  const dumps = dumpsDeHoy(estado, estado.ahora ?? new Date());
  if (dumps.length === 0) {
    return [{ clase: 'aviso', texto: TEXTO_SIN_DUMPS, seccion: 'dumps' }];
  }
  const nodos: NodoMonitor[] = dumps.map((dump) => ({ clase: 'dump', dump }));
  if (estado.dumps.fase === 'ok' && estado.dumps.llena) {
    nodos.push({ clase: 'masDumps' });
  }
  return nodos;
}

function hijosDeInactivos(estado: EstadoMonitor): NodoMonitor[] {
  const aviso = avisoDeFase(estado.inactivos, 'inactivos');
  if (aviso !== undefined) {
    return aviso;
  }
  const grupos = agruparPorPadre(inactivosVisibles(estado));
  if (grupos.length === 0) {
    return [{ clase: 'aviso', texto: TEXTO_SIN_INACTIVOS, seccion: 'inactivos' }];
  }
  return grupos.map((g) => ({
    clase: 'inactivo',
    objeto: g.objeto,
    ...(g.padreAusente !== undefined ? { padreAusente: g.padreAusente } : {}),
  }));
}

function hijosDeOrdenes(estado: EstadoMonitor): NodoMonitor[] {
  if (estado.ordenes === undefined) {
    return [{ clase: 'pendiente' }];
  }
  const aviso = avisoDeFase(estado.ordenes, 'ordenes');
  if (aviso !== undefined) {
    return aviso;
  }
  if (estado.ordenes.fase === 'ok' && estado.ordenes.elementos.length > 0) {
    return estado.ordenes.elementos.map((orden) => ({ clase: 'orden', orden }));
  }
  return [{ clase: 'aviso', texto: TEXTO_SIN_ORDENES, seccion: 'ordenes' }];
}

export function hijosDe(nodo: NodoMonitor, estado: EstadoMonitor): NodoMonitor[] {
  if (nodo.clase === 'seccion') {
    if (nodo.seccion === 'dumps') {
      return hijosDeDumps(estado);
    }
    return nodo.seccion === 'inactivos' ? hijosDeInactivos(estado) : hijosDeOrdenes(estado);
  }
  if (nodo.clase === 'inactivo') {
    if (nodo.padre !== undefined || nodo.padreAusente !== undefined) {
      return [];
    }
    const grupo = agruparPorPadre(inactivosVisibles(estado)).find((g) => g.objeto.uriAdt === nodo.objeto.uriAdt);
    return (grupo?.hijos ?? []).map((hijo) => ({ clase: 'inactivo', objeto: hijo, padre: nodo.objeto }));
  }
  if (nodo.clase === 'orden') {
    return objetosDeOrdenMonitor(nodo.orden).map((objeto) => ({ clase: 'objetoOrden', orden: nodo.orden, objeto }));
  }
  return [];
}

function descripcionFiltro(todos: boolean, usuario: string | undefined): string {
  if (!usuarioValido(usuario)) {
    return 'todos (sin usuario en el destino)';
  }
  return todos ? 'todos' : 'míos';
}

function etiquetaSeccion(seccion: SeccionMonitor, estado: EstadoMonitor): EtiquetaNodo {
  if (seccion === 'dumps') {
    const conteo = estado.dumps.fase === 'ok' ? ` (${dumpsDeHoy(estado, estado.ahora ?? new Date()).length})` : '';
    return {
      label: `Dumps de hoy${conteo}`,
      description: descripcionFiltro(estado.dumpsTodos, estado.usuario),
      contextValue: 'seccionDumps',
      colapsable: 'abierto',
    };
  }
  if (seccion === 'inactivos') {
    const conteo = estado.inactivos.fase === 'ok' ? ` (${inactivosVisibles(estado).length})` : '';
    return {
      label: `Inactivos${conteo}`,
      description: descripcionFiltro(estado.inactivosTodos, estado.usuario),
      contextValue: 'seccionInactivos',
      colapsable: 'abierto',
    };
  }
  const conteo = estado.ordenes?.fase === 'ok' ? ` (${estado.ordenes.elementos.length})` : '';
  return { label: `Órdenes${conteo}`, contextValue: 'seccionOrdenes', colapsable: 'abierto' };
}

function etiquetaDump(dump: Dump): EtiquetaNodo {
  return {
    label: `${horaLocal(dump.publicado)}  ${dump.errorEjecucion}  ${dump.programa}`,
    description: dump.marco !== undefined ? `${dump.marco.include} : ${dump.marco.linea}` : dump.programa,
    tooltip: `${dump.textoCorto}\n${dump.usuario} · ${fechaHoraLocal(dump.publicado)}`,
    contextValue: 'dump',
    colapsable: 'no',
  };
}

function etiquetaInactivo(nodo: Extract<NodoMonitor, { clase: 'inactivo' }>, estado: EstadoMonitor): EtiquetaNodo {
  const { objeto } = nodo;
  const partes = [etiquetaTipo(objeto.tipo)];
  if (estado.inactivosTodos) {
    partes.push(objeto.usuario);
  }
  if (objeto.borrado) {
    partes.push('borrado');
  }
  if (nodo.padreAusente !== undefined) {
    partes.push(`de ${nodo.padreAusente}`);
  }
  return {
    label: objeto.nombre,
    description: partes.join(' · '),
    contextValue: esAbrible(objeto) ? 'inactivo' : 'inactivoSinApertura',
    colapsable: hijosDe(nodo, estado).length > 0 ? 'abierto' : 'no',
  };
}

export function etiquetaDe(nodo: NodoMonitor, estado: EstadoMonitor): EtiquetaNodo {
  switch (nodo.clase) {
    case 'aviso':
      return { label: nodo.texto, contextValue: 'aviso', colapsable: 'no' };
    case 'conectar':
      return { label: `Conectar a ${nodo.destino}…`, contextValue: 'conectar', colapsable: 'no' };
    case 'seccion':
      return etiquetaSeccion(nodo.seccion, estado);
    case 'dump':
      return etiquetaDump(nodo.dump);
    case 'masDumps':
      return { label: 'Más…', contextValue: 'masDumps', colapsable: 'no' };
    case 'inactivo':
      return etiquetaInactivo(nodo, estado);
    case 'orden':
      return {
        label: `${nodo.orden.numero} · ${nodo.orden.descripcion}`,
        description: nodo.orden.destino,
        tooltip: `${nodo.orden.numero} · ${nodo.orden.propietario}`,
        contextValue: 'orden',
        colapsable: 'cerrado',
      };
    case 'objetoOrden':
      return {
        label: nodo.objeto.nombre,
        description: nodo.objeto.info,
        contextValue: nodo.objeto.tipoWb !== undefined ? 'objetoOrden' : 'objetoOrdenSinApertura',
        colapsable: 'no',
      };
    case 'pendiente':
      return { label: TEXTO_PENDIENTE, contextValue: 'pendiente', colapsable: 'no' };
  }
}

export function iconoDe(nodo: NodoMonitor): string | undefined {
  switch (nodo.clase) {
    case 'seccion':
      return { dumps: 'flame', inactivos: 'circle-outline', ordenes: 'package' }[nodo.seccion];
    case 'dump':
      return 'flame';
    case 'inactivo':
      return 'edit';
    case 'orden':
      return 'package';
    case 'objetoOrden':
      return 'file';
    case 'conectar':
      return 'plug';
    case 'masDumps':
      return 'ellipsis';
    case 'aviso':
      return 'info';
    case 'pendiente':
      return 'clock';
  }
}

export function idDe(nodo: NodoMonitor): string {
  switch (nodo.clase) {
    case 'seccion':
      return `seccion:${nodo.seccion}`;
    case 'dump':
      return `dump:${nodo.dump.id}`;
    case 'inactivo':
      return `inactivo:${nodo.objeto.uriAdt}`;
    case 'orden':
      return `orden:${nodo.orden.numero}`;
    case 'objetoOrden':
      return `objetoOrden:${nodo.orden.numero}:${nodo.objeto.tipoWb ?? ''}:${nodo.objeto.nombre}`;
    case 'conectar':
      return `conectar:${nodo.destino}`;
    case 'masDumps':
      return 'masDumps';
    case 'pendiente':
      return 'pendiente';
    case 'aviso':
      return `aviso:${nodo.seccion ?? 'raiz'}:${nodo.texto}`;
  }
}
