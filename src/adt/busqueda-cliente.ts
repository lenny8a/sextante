import { parametrosBusqueda, analizarRespuestaBusqueda, type Consulta, type ResultadoBusqueda } from './busqueda-modelo';
import type { ConexionAdt } from './conexion-adt';

export const RUTA_BUSQUEDA = '/sap/bc/adt/repository/informationsystem/search';

/** El servidor responde `application/xml; charset=utf-8` a este Accept (busq-xml.xml). */
export const ACCEPT_BUSQUEDA = 'application/xml';

/** El nombre exacto como consulta acota la respuesta; basta con unos pocos tipos que compartan nombre. */
export const MAX_RESULTADOS_PAQUETE = 10;

export async function buscar(
  conexion: ConexionAdt,
  consulta: Consulta,
  signal?: AbortSignal,
  maxResults = 50,
): Promise<ResultadoBusqueda[]> {
  const respuesta = await conexion.get(RUTA_BUSQUEDA, parametrosBusqueda(consulta, maxResults), ACCEPT_BUSQUEDA, signal);
  return analizarRespuestaBusqueda(respuesta.cuerpo);
}

/**
 * Paquete del objeto con ese nombre y tipo exactos. Con `objectType` el servidor no devuelve `packageName`
 * (busq-clas.xml); sin filtro sí (busq-xml.xml), así que se busca sin filtro. `undefined` si no aparece o viene vacío.
 */
export async function paqueteSinFiltro(
  conexion: ConexionAdt,
  nombre: string,
  tipo: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const resultados = await buscar(conexion, { patron: nombre }, signal, MAX_RESULTADOS_PAQUETE);
  const paquete = resultados.find((r) => r.nombre === nombre && r.tipo === tipo)?.paquete;
  return paquete === '' ? undefined : paquete;
}
