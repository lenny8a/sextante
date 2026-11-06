import { clasificarArchivoFugr, type TipoObjeto } from '../bridge/adt-uri';
import { TIPOS_E071_POR_TIPO, consultaOrdenesDeObjeto, type Fila } from '../adt/transportes-modelo';
import { nombreValido } from '../diccionario/modelo';

/** `grupo`: grupo de funciones con sus includes y módulos de la carpeta; `soloModulo`: de la carpeta solo se conoce el abierto. */
export type AlcanceOrdenes = 'objeto' | 'grupo' | 'soloModulo';

export interface FiltroOrdenesObjeto {
  /** En mayúsculas y validado. */
  nombre: string;
  tipos: readonly string[];
  /** `OBJ_NAME LIKE '<prefijo>%'`: includes locales de una clase (`<CLASE>====…CCAU`). */
  prefijos: readonly string[];
  /** `OBJ_NAME IN (…)`: programa principal, includes y módulos de un grupo de funciones. */
  exactos: readonly string[];
  alcance: AlcanceOrdenes;
}

const PATRON_PREFIJO = /^[A-Z0-9_/]{1,30}=$/;
const ESPACIO_DE_NOMBRES = /^(\/[A-Z0-9_]+\/)?(.+)$/;

export function tipoConOrdenes(tipo: TipoObjeto): boolean {
  return TIPOS_E071_POR_TIPO[tipo].length > 0;
}

/**
 * `ZFG` → `SAPLZFG`, `LZFGTOP`, `LZFGUXX`; con espacio de nombres `/NS/FG` → `/NS/SAPLFG`, `/NS/LFGTOP`, `/NS/LFGUXX`.
 * Se descartan los que no caben en 30 caracteres.
 * NO VERIFICADO: la forma con espacio de nombres (convención SAP, sin respuesta real).
 */
export function includesFijosDeGrupo(grupo: string): string[] {
  const partes = ESPACIO_DE_NOMBRES.exec(grupo.toUpperCase());
  const espacio = partes?.[1] ?? '';
  const base = partes?.[2] ?? grupo.toUpperCase();
  return [`${espacio}SAPL${base}`, `${espacio}L${base}TOP`, `${espacio}L${base}UXX`].filter(nombreValido);
}

/** Módulos, includes y programa principal que nombra la carpeta del grupo (`<grupo>.fugr.<nombre>.func|reps.abap`). */
function nombresDeCarpetaFugr(archivos: readonly string[]): string[] {
  const nombres = archivos.flatMap((archivo) => {
    const clasificado = clasificarArchivoFugr(archivo);
    return clasificado === undefined || clasificado.clase === 'otro' ? [] : [clasificado.nombre];
  });
  return [...new Set(nombres.filter(nombreValido))];
}

/**
 * Qué filas de E071 son del objeto. Clase: además de `NOMBRE` y `NOMBRE  MIEMBRO`, sus includes `LIMU CINC`
 * (`<CLASE>` rellena con `=` hasta 30 más `CCAU`/`CCDEF`/`CCIMP`/`CCMAC`; NO VERIFICADO con respuesta real).
 * Grupo de funciones: los nombres reales que se conocen en cliente (SAPL, TOP, UXX y lo que liste la carpeta).
 * `undefined` = nombre no válido o tipo sin órdenes.
 */
export function filtroOrdenesDeObjeto(nombre: string, tipo: TipoObjeto, archivos: readonly string[] = []): FiltroOrdenesObjeto | undefined {
  if (!nombreValido(nombre) || !tipoConOrdenes(tipo)) {
    return undefined;
  }
  const n = nombre.toUpperCase();
  const base: FiltroOrdenesObjeto = { nombre: n, tipos: TIPOS_E071_POR_TIPO[tipo], prefijos: [], exactos: [], alcance: 'objeto' };
  if (tipo === 'clase') {
    // NO VERIFICADO: el relleno con `=` de los includes CINC (`<CLASE>====…CCAU`); una clase de 30 caracteres no lo lleva.
    return { ...base, prefijos: [`${n}=`] };
  }
  if (tipo === 'grupoFunciones') {
    // NO VERIFICADO: que LIMU FUNC lleve el nombre del módulo y LIMU REPS `SAPL<g>`/`L<g>…` (convención SAP, sin respuesta real).
    const deCarpeta = nombresDeCarpetaFugr(archivos);
    const exactos = [...new Set([...includesFijosDeGrupo(n), ...deCarpeta])].filter((x) => x !== n);
    return { ...base, exactos, alcance: deCarpeta.length > 1 ? 'grupo' : 'soloModulo' };
  }
  return base;
}

/**
 * La consulta del modelo (vía rápida `OBJ_NAME = 'X' OR OBJ_NAME LIKE 'X %'`, sin ORDER BY) con los prefijos y
 * nombres exactos del filtro añadidos dentro del mismo paréntesis. Todo identificador se valida antes.
 */
export function consultaOrdenesDeObjetoFiltro(filtro: FiltroOrdenesObjeto): string {
  const base = consultaOrdenesDeObjeto(filtro.nombre, filtro.tipos);
  const prefijos = filtro.prefijos.map((p) => p.toUpperCase());
  const exactos = filtro.exactos.map((e) => e.toUpperCase());
  if (!prefijos.every((p) => PATRON_PREFIJO.test(p)) || !exactos.every(nombreValido)) {
    throw new Error('nombre no válido');
  }
  const extras = [
    ...prefijos.map((p) => `E071~OBJ_NAME LIKE '${p}%'`),
    ...(exactos.length === 0 ? [] : [`E071~OBJ_NAME IN (${exactos.map((e) => `'${e}'`).join(',')})`]),
  ];
  if (extras.length === 0) {
    return base;
  }
  const cierre = `E071~OBJ_NAME LIKE '${filtro.nombre} %' )`;
  if (!base.includes(cierre)) {
    throw new Error('consulta de órdenes inesperada');
  }
  return base.replace(cierre, () => `E071~OBJ_NAME LIKE '${filtro.nombre} %' OR ${extras.join(' OR ')} )`);
}

/** Filtro exacto en cliente, el mismo que el SQL: el `_` del `LIKE` es comodín y deja pasar nombres que solo se parecen. */
export function esDelObjeto(fila: Fila, filtro: FiltroOrdenesObjeto): boolean {
  const objeto = (fila.OBJ_NAME ?? '').toUpperCase();
  return (
    objeto === filtro.nombre ||
    objeto.startsWith(`${filtro.nombre} `) ||
    filtro.prefijos.some((p) => objeto.startsWith(p.toUpperCase())) ||
    filtro.exactos.some((e) => objeto === e.toUpperCase())
  );
}
