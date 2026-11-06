/** Decisiones puras de «Insertar llamada»: en qué sistema, con qué filtros, dónde se escribe el patrón y con qué receptor. */
import type { ResultadoAbrir } from '../adt/abrir-resultado';
import { FILTROS_TIPO, type FiltroTipo } from '../adt/busqueda-modelo';
import { ESQUEMA_ABAP, analizarUriAbap, type UriMinimo } from '../bridge/adt-uri';
import { finDeSentenciaEn, type LectorLineas } from './contexto-llamada';
import type { PeticionAbrirFirma, PeticionInsertar } from './hover-modelo';
import { uriClase, type FirmaMetodo } from './modelo';

const TIPO_CLASE = 'CLAS/OC';
const TIPO_INTERFAZ = 'INTF/OI';

/**
 * `nuevaLinea`: el patrón va en una línea nueva en `fila` (debajo de la sentencia, que acaba en `fila - 1`).
 * `sinFin`: no hay punto en las filas siguientes; el patrón va en la propia fila del cursor.
 */
export interface PosicionInsercion {
  fila: number;
  nuevaLinea: boolean;
  sinFin?: true;
}

/** Fila en blanco → ella misma; con código → la fila siguiente al punto que cierra su sentencia. */
export function posicionDeInsercion(doc: LectorLineas, fila: number): PosicionInsercion {
  if (doc.linea(fila).trim() === '') {
    return { fila, nuevaLinea: false };
  }
  const fin = finDeSentenciaEn(doc, fila);
  return fin === undefined ? { fila, nuevaLinea: false, sinFin: true } : { fila: fin + 1, nuevaLinea: true };
}

/** El receptor del código (`lo_alv`, `cl_x=>`, `me`); vacío para que `patronLlamada` lo decida por la firma. */
export function receptorPara(peticion: PeticionInsertar, firma: FirmaMetodo): string {
  if (peticion.firma.tipo !== 'metodo') {
    return '';
  }
  const receptor = peticion.receptor.trim();
  // `cl_x=>m` sobre un método de instancia no compila: mejor la variable que propone el patrón.
  return receptor.endsWith('=>') && !firma.estatico ? '' : receptor;
}

const IDS_FILTRO_FIRMAS = ['funcion', 'clase', 'interfaz'];

/** Los botones del QuickPick de la paleta: módulo de funciones (el inicial), clase e interfaz. */
export const FILTROS_FIRMAS: readonly FiltroTipo[] = IDS_FILTRO_FIRMAS
  .map((id) => FILTROS_TIPO.find((f) => f.id === id))
  .filter((f): f is FiltroTipo => f !== undefined);

export type DestinoPaleta = { destino: string } | { motivo: 'editorSinRfc' | 'sinSistema' };

/**
 * Con un editor `abap:` solo vale su propio sistema (nunca se inserta código leído de otro); si no tiene diccionario
 * (SSO, SNC, sin RFC), no hay destino. El sistema activo solo cuenta con otro tipo de editor.
 */
export function destinoParaPaleta<U extends UriMinimo>(
  uri: U, destinoDe: (uri: U) => string | undefined, destinoActivo: () => string | undefined,
): DestinoPaleta {
  if (uri.scheme === ESQUEMA_ABAP) {
    const propio = analizarUriAbap(uri)?.destino;
    return propio !== undefined && destinoDe(uri) === propio ? { destino: propio } : { motivo: 'editorSinRfc' };
  }
  const activo = destinoActivo();
  return activo === undefined ? { motivo: 'sinSistema' } : { destino: activo };
}

/**
 * Un receptor `TYPE REF TO zif_x` deja la firma con la URI de clase: si así no se localiza, se prueba una vez como
 * interfaz. Cualquier otro caso, `undefined`.
 */
export function reintentoComoInterfaz(peticion: PeticionAbrirFirma, resultado: ResultadoAbrir): PeticionAbrirFirma | undefined {
  if (peticion.tipoAdt !== TIPO_CLASE || resultado !== 'noLocalizado') {
    return undefined;
  }
  return { ...peticion, tipoAdt: TIPO_INTERFAZ, uriAdt: uriClase(peticion.nombre, true) };
}

/** La paleta sobre el sistema activo: las firmas solo se leen por RFC. */
export function mensajeSistemaSinRfc(destino: string): string {
  return `El sistema ${destino} no tiene conexión RFC; no se puede leer la firma`;
}
