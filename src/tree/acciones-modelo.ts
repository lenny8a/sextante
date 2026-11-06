import type { TipoObjeto } from '../bridge/adt-uri';
import type { RolSistema } from '../config/navegador-config';

export type RequisitoBarra = 'ninguno' | 'objeto' | 'escritura' | 'programa';

export interface AccionBarra {
  id: string;
  etiqueta: string;
  icono: string;
  comando: string;
  requiere: RequisitoBarra;
}

export interface GrupoBarra {
  id: string;
  etiqueta: string;
  acciones: readonly AccionBarra[];
}

export interface EstadoBarra {
  objeto?: { nombre: string; tipo: TipoObjeto; protegido: boolean; rol?: RolSistema; destino: string };
  sistemaActivo?: string;
}

export interface NodoBarra {
  id: string;
  clase: 'grupo' | 'accion';
  etiqueta: string;
  icono?: string;
  comando?: string;
  habilitado: boolean;
  motivo?: string;
  hijos: NodoBarra[];
}

export const MOTIVO_SIN_OBJETO = 'Abre un objeto';
export const MOTIVO_SOLO_PROGRAMAS = 'Solo para programas';

const OBJETO = 'abapNavigator.objeto';

export const GRUPOS_BARRA: readonly GrupoBarra[] = [
  {
    id: 'desarrollo',
    etiqueta: 'Desarrollo',
    acciones: [
      { id: 'activar', etiqueta: 'Activar', icono: 'zap', comando: `${OBJETO}.activar`, requiere: 'escritura' },
      {
        id: 'activarTodo',
        etiqueta: 'Activar todo…',
        icono: 'run-all',
        comando: `${OBJETO}.activarTodo`,
        requiere: 'escritura',
      },
      { id: 'verificar', etiqueta: 'Verificar sintaxis', icono: 'check', comando: `${OBJETO}.verificar`, requiere: 'objeto' },
      { id: 'ejecutar', etiqueta: 'Ejecutar', icono: 'play', comando: `${OBJETO}.ejecutar`, requiere: 'programa' },
      { id: 'atc', etiqueta: 'ATC', icono: 'checklist', comando: `${OBJETO}.atc`, requiere: 'objeto' },
      { id: 'unitTests', etiqueta: 'Unit tests', icono: 'beaker', comando: `${OBJETO}.unitTests`, requiere: 'objeto' },
      {
        id: 'documentacion',
        etiqueta: 'Documentación',
        icono: 'book',
        comando: `${OBJETO}.documentacion`,
        requiere: 'objeto',
      },
    ],
  },
  {
    id: 'transporte',
    etiqueta: 'Transporte',
    acciones: [
      { id: 'ordenObjeto', etiqueta: 'Orden del objeto', icono: 'package', comando: `${OBJETO}.ordenes`, requiere: 'objeto' },
      {
        id: 'transporte',
        etiqueta: 'Organizador de transportes',
        icono: 'package',
        comando: `${OBJETO}.transporte`,
        requiere: 'escritura',
      },
      { id: 'copiarNombre', etiqueta: 'Copiar nombre', icono: 'copy', comando: `${OBJETO}.copiarNombre`, requiere: 'objeto' },
    ],
  },
  {
    id: 'versiones',
    etiqueta: 'Versiones',
    acciones: [
      {
        id: 'versiones',
        etiqueta: 'Historial de versiones',
        icono: 'history',
        comando: `${OBJETO}.versiones`,
        requiere: 'objeto',
      },
      {
        id: 'compararUltima',
        etiqueta: 'Comparar con la última versión',
        icono: 'diff',
        comando: `${OBJETO}.compararUltima`,
        requiere: 'objeto',
      },
      {
        id: 'compararOtroSistema',
        etiqueta: 'Comparar con otro sistema',
        icono: 'arrow-swap',
        comando: `${OBJETO}.compararOtroSistema`,
        requiere: 'objeto',
      },
    ],
  },
  {
    id: 'herramientas',
    etiqueta: 'Herramientas',
    acciones: [
      { id: 'buscarObjeto', etiqueta: 'Buscar objeto', icono: 'search', comando: 'abapNavigator.buscar', requiere: 'ninguno' },
      {
        id: 'buscarTexto',
        etiqueta: 'Buscar texto en ABAP',
        icono: 'regex',
        comando: 'abapNavigator.buscarTexto',
        requiere: 'ninguno',
      },
      { id: 'consolaSql', etiqueta: 'Consola SQL', icono: 'database', comando: 'abapNavigator.sql.consola', requiere: 'ninguno' },
      { id: 'dumps', etiqueta: 'Dumps y feeds', icono: 'flame', comando: 'abapNavigator.dumps', requiere: 'ninguno' },
      {
        id: 'nuevoObjeto',
        etiqueta: 'Nuevo objeto ABAP…',
        icono: 'add',
        comando: 'abapNavigator.crearObjeto',
        requiere: 'ninguno',
      },
    ],
  },
];

/** Motivo por el que la acción no aplica al estado; `undefined` si está habilitada. */
function motivoDe(requiere: RequisitoBarra, objeto: EstadoBarra['objeto']): string | undefined {
  if (requiere === 'ninguno') {
    return undefined;
  }
  if (objeto === undefined) {
    return MOTIVO_SIN_OBJETO;
  }
  if (requiere === 'escritura' && objeto.protegido) {
    return `Solo lectura (${objeto.rol})`;
  }
  if (requiere === 'programa' && objeto.tipo !== 'programa') {
    return MOTIVO_SOLO_PROGRAMAS;
  }
  return undefined;
}

function nodoAccion(accion: AccionBarra, estado: EstadoBarra): NodoBarra {
  const motivo = motivoDe(accion.requiere, estado.objeto);
  const base = { id: `accion:${accion.id}`, clase: 'accion' as const, etiqueta: accion.etiqueta, icono: accion.icono, hijos: [] };
  return motivo === undefined ? { ...base, comando: accion.comando, habilitado: true } : { ...base, habilitado: false, motivo };
}

export function construirBarra(estado: EstadoBarra): NodoBarra[] {
  return GRUPOS_BARRA.map((grupo) => ({
    id: `grupo:${grupo.id}`,
    clase: 'grupo',
    etiqueta: grupo.etiqueta,
    habilitado: true,
    hijos: grupo.acciones.map((accion) => nodoAccion(accion, estado)),
  }));
}

export function descripcionBarra(estado: EstadoBarra): string {
  const { objeto, sistemaActivo } = estado;
  if (objeto !== undefined) {
    return `${objeto.destino} · ${objeto.rol ?? '?'} · ${objeto.nombre.toUpperCase()}`;
  }
  return sistemaActivo === undefined ? 'Sin sistema activo' : `${sistemaActivo} · sin objeto`;
}
