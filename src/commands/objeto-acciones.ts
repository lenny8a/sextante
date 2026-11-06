import type { TipoObjeto } from '../bridge/adt-uri';
import type { RolSistema } from '../config/navegador-config';
import { ETIQUETA_TIPO } from '../tree/objeto-modelo';

export const MSG_SIN_OBJETO_ABIERTO = 'Abre primero un objeto ABAP';
export const MSG_CONECTA_PRIMERO = 'Conecta primero al sistema';
export const ACCION_CONECTAR = 'Conectar';
export const MSG_PESTANA_AJENA = 'La pestaña activa no es el objeto mostrado en la vista Objeto';
export const MSG_BLOQUE_SIN_GUARDAR = 'No se pudo guardar el bloque';

export interface AccionObjeto {
  id: string;
  titulo: string;
  icono: string;
  comandoOficial?: string;
  requiereEscritura: boolean;
  /** Si está, la acción solo aplica a esos tipos de objeto. */
  tipos?: readonly TipoObjeto[];
}

export const ACCIONES_OBJETO: readonly AccionObjeto[] = [
  // NO VERIFICADO: comportamiento de adt-vscode.activate sobre el editor activo
  { id: 'activar', titulo: 'Activar', icono: 'zap', comandoOficial: 'adt-vscode.activate', requiereEscritura: true },
  // Sin argumentos en la oficial: abre su lista «Your Inactive Objects in <destino>» y el usuario marca ahí qué activar.
  {
    id: 'activarTodo',
    titulo: 'Activar todo…',
    icono: 'run-all',
    comandoOficial: 'adt-vscode.activateAll',
    requiereEscritura: true,
  },
  { id: 'verificar', titulo: 'Verificar sintaxis', icono: 'check', comandoOficial: 'adt-vscode.checkObject', requiereEscritura: false },
  // Verificado en el bundle 1.2.0: espera a que termine el ATC y publica los hallazgos como diagnósticos `source` «ATC».
  { id: 'atc', titulo: 'ATC', icono: 'checklist', comandoOficial: 'adt-vscode.runAtcOnObject', requiereEscritura: false },
  // NO VERIFICADO: comportamiento de adt-vscode.runAbapUnitTests
  { id: 'unitTests', titulo: 'Unit tests', icono: 'beaker', comandoOficial: 'adt-vscode.runAbapUnitTests', requiereEscritura: false },
  // NO VERIFICADO: comportamiento de adt-vscode.compareWithLatest
  {
    id: 'compararUltima',
    titulo: 'Comparar con la última versión',
    icono: 'history',
    comandoOficial: 'adt-vscode.compareWithLatest',
    requiereEscritura: false,
  },
  { id: 'transporte', titulo: 'Transporte', icono: 'package', requiereEscritura: true },
  { id: 'copiarNombre', titulo: 'Copiar nombre', icono: 'copy', requiereEscritura: false },
  // NO VERIFICADO: comportamiento de adt-vscode.runApplication sobre el editor activo
  {
    id: 'ejecutar',
    titulo: 'Ejecutar',
    icono: 'play',
    comandoOficial: 'adt-vscode.runApplication',
    requiereEscritura: false,
    tipos: ['programa'],
  },
  // NO VERIFICADO: comportamiento de adt-vscode.openDocumentation sobre el editor activo
  {
    id: 'documentacion',
    titulo: 'Documentación',
    icono: 'book',
    comandoOficial: 'adt-vscode.openDocumentation',
    requiereEscritura: false,
  },
  { id: 'versiones', titulo: 'Historial de versiones', icono: 'history', requiereEscritura: false },
];

// NO VERIFICADO: comando de foco que VS Code genera para la vista contribuida por la oficial
export const COMANDO_FOCO_TRANSPORTES = 'adt-vscode.transportOrganizer.focus';
// NO VERIFICADO: comando de foco que VS Code genera para la vista abapTimeline de la oficial
export const COMANDO_FOCO_VERSIONES = 'adt-vscode.abapTimeline.focus';
// NO VERIFICADO: comando de foco que VS Code genera para la vista feedReader de la oficial
export const COMANDO_FOCO_DUMPS = 'adt-vscode.feedReader.focus';
export const COMANDO_EXPLORER = 'workbench.view.explorer';

export type DecisionAccion = { ejecutar: true } | { ejecutar: false; motivo: string };

export function decidirAccion(
  accion: AccionObjeto,
  objeto: { protegido: boolean; rol?: RolSistema; tipo: TipoObjeto } | undefined,
): DecisionAccion {
  if (objeto === undefined) {
    return { ejecutar: false, motivo: MSG_SIN_OBJETO_ABIERTO };
  }
  if (accion.tipos !== undefined && !accion.tipos.includes(objeto.tipo)) {
    const tipos = accion.tipos.map((t) => ETIQUETA_TIPO[t]).join(', ');
    return { ejecutar: false, motivo: `${accion.titulo}: solo para ${tipos}` };
  }
  if (objeto.protegido && accion.requiereEscritura) {
    return { ejecutar: false, motivo: `Sistema ${objeto.rol}: ${accion.titulo} deshabilitado en solo lectura` };
  }
  return { ejecutar: true };
}
