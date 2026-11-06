import type * as vscode from 'vscode';
import { analizarNombreAff, analizarUriAbap, tipoObjetoDe, type TipoObjeto } from '../bridge/adt-uri';
import type { Version } from '../adt/versiones-modelo';
import { extensionDe, type PiezaFuente } from '../adt/fuente-adt';

export type EstadoCargaPieza = 'pendiente' | 'cargando' | 'ok' | 'noExiste' | 'sinConexion' | 'error';

export interface PiezaVersiones {
  pieza: PiezaFuente;
  estado: EstadoCargaPieza;
  versiones: Version[];
  mensaje?: string;
}

export interface EstadoVersiones {
  documento?: { uri: vscode.Uri; destino: string; nombre: string; tipo: TipoObjeto; extension: string };
  piezas: PiezaVersiones[];
  motivoVacio?: 'sinDocumento' | 'conectar' | 'sinVia' | 'desconocido';
}

export type NodoVersiones =
  | { clase: 'aviso'; texto: string; motivo: NonNullable<EstadoVersiones['motivoVacio']> | 'noExiste' | 'error' | 'cargando' }
  | { clase: 'pieza'; pieza: PiezaVersiones; expandida: boolean }
  | { clase: 'version'; pieza: PiezaVersiones; version: Version };

export const MSG_SELECCIONA_DOS = 'Selecciona dos versiones de la misma parte';

const TEXTO_VACIO: Record<NonNullable<EstadoVersiones['motivoVacio']>, string> = {
  sinDocumento: 'Abre un objeto para ver sus versiones',
  conectar: 'Conéctate al sistema para ver las versiones',
  sinVia: 'Sin conexión RFC con este sistema: no hay versiones',
  desconocido: 'Este objeto no tiene historial de versiones',
};

const TEXTO_NO_EXISTE = 'Sin historial de versiones';
const TEXTO_CARGANDO = 'Cargando…';

function nodoVersion(pieza: PiezaVersiones, version: Version): NodoVersiones {
  return { clase: 'version', pieza, version };
}

function avisoDe(pieza: PiezaVersiones): NodoVersiones {
  switch (pieza.estado) {
    case 'pendiente':
    case 'cargando':
      return { clase: 'aviso', texto: TEXTO_CARGANDO, motivo: 'cargando' };
    case 'noExiste':
      return { clase: 'aviso', texto: TEXTO_NO_EXISTE, motivo: 'noExiste' };
    case 'sinConexion':
      return { clase: 'aviso', texto: TEXTO_VACIO.conectar, motivo: 'conectar' };
    default:
      return { clase: 'aviso', texto: pieza.mensaje ?? 'No se pudieron leer las versiones', motivo: 'error' };
  }
}

export function raicesDe(estado: EstadoVersiones): NodoVersiones[] {
  if (estado.documento === undefined) {
    const motivo = estado.motivoVacio ?? 'sinDocumento';
    return [{ clase: 'aviso', texto: TEXTO_VACIO[motivo], motivo }];
  }
  const visibles = estado.piezas.filter((p) => p.estado !== 'noExiste');
  if (visibles.length === 0) {
    return estado.piezas.length === 0
      ? [{ clase: 'aviso', texto: TEXTO_VACIO.desconocido, motivo: 'desconocido' }]
      : [{ clase: 'aviso', texto: TEXTO_NO_EXISTE, motivo: 'noExiste' }];
  }
  if (estado.piezas.length === 1) {
    return hijosDe({ clase: 'pieza', pieza: visibles[0], expandida: true });
  }
  return visibles.map((pieza, i): NodoVersiones => ({ clase: 'pieza', pieza, expandida: i === 0 }));
}

export function hijosDe(nodo: NodoVersiones): NodoVersiones[] {
  if (nodo.clase !== 'pieza') {
    return [];
  }
  const { pieza } = nodo;
  if (pieza.estado === 'ok') {
    return pieza.versiones.length === 0
      ? [{ clase: 'aviso', texto: TEXTO_NO_EXISTE, motivo: 'noExiste' }]
      : pieza.versiones.map((v) => nodoVersion(pieza, v));
  }
  return [avisoDe(pieza)];
}

export interface EtiquetaVersion {
  label: string;
  description: string;
  tooltip: string;
  icono: string;
  contextValue: 'version' | 'versionConOrden';
}

export function etiquetaVersion(v: Version, fecha: (iso: string) => string): EtiquetaVersion {
  const conOrden = v.orden !== undefined && v.orden !== '';
  const base = `${fecha(v.fecha)} · ${v.autor}`;
  const orden = conOrden ? `${v.orden}${v.textoOrden ? `  ${v.textoOrden}` : ''}` : undefined;
  const lineas = [v.activa ? 'Versión activa' : `Versión ${v.id}`, `Fecha: ${fecha(v.fecha)}`, `Autor: ${v.autor}`];
  if (orden !== undefined) {
    lineas.push(`Orden: ${orden}`);
  }
  return {
    label: v.activa ? 'Activa' : v.id,
    description: orden === undefined ? base : `${base} · ${orden}`,
    tooltip: lineas.join('\n'),
    icono: v.activa ? 'circle-filled' : 'history',
    contextValue: conOrden ? 'versionConOrden' : 'version',
  };
}

function antiguaPrimero(a: Version, b: Version): number {
  const fa = Date.parse(a.fecha);
  const fb = Date.parse(b.fecha);
  if (fa !== fb && !Number.isNaN(fa) && !Number.isNaN(fb)) {
    return fa - fb;
  }
  return a.fecha === b.fecha ? a.id.localeCompare(b.id) : a.fecha.localeCompare(b.fecha);
}

export function paresParaDiff(
  seleccion: NodoVersiones[],
): { pieza: PiezaVersiones; antigua: Version; nueva: Version } | undefined {
  if (seleccion.length !== 2) {
    return undefined;
  }
  const [a, b] = seleccion;
  if (a.clase !== 'version' || b.clase !== 'version' || a.pieza.pieza.rutaFuente !== b.pieza.pieza.rutaFuente) {
    return undefined;
  }
  const [antigua, nueva] = [a.version, b.version].sort(antiguaPrimero);
  return { pieza: a.pieza, antigua, nueva };
}

function nombreVersion(v: Version, fecha: (iso: string) => string): string {
  return `${v.activa ? 'Activa' : v.id} (${fecha(v.fecha).split(' ')[0]})`;
}

export function tituloDiffVersion(
  nombre: string,
  izquierda: Version,
  derecha: Version | 'editor',
  fecha: (iso: string) => string,
): string {
  const der = derecha === 'editor' ? 'editor' : nombreVersion(derecha, fecha);
  return `${nombre}: ${nombreVersion(izquierda, fecha)} ↔ ${der}`;
}

/** El objeto abierto en el editor, si es un archivo de código de la oficial (no un JSON de metadatos). */
export function documentoDe(uri: vscode.Uri | undefined): EstadoVersiones['documento'] {
  if (uri === undefined) {
    return undefined;
  }
  const analisis = analizarUriAbap(uri);
  if (analisis?.objeto === undefined || analisis.archivo === undefined) {
    return undefined;
  }
  const aff = analizarNombreAff(analisis.archivo);
  if (aff === undefined || /(^|\.)jsonc?$/.test(aff.extension)) {
    return undefined;
  }
  return {
    uri,
    destino: analisis.destino,
    nombre: analisis.objeto.nombre,
    tipo: tipoObjetoDe(analisis.objeto.tipoCarpeta, aff.tipo),
    extension: extensionDe(analisis.archivo),
  };
}
