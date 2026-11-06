import { tipoObjetoDe, type TipoObjeto } from '../bridge/adt-uri';
import type { EntradaRepotree } from '../bridge/repotree-oficial';
import { iconoDeTipo } from './iconos';

export type ClaseNodoPaquete = 'biblioteca' | 'paquete' | 'categoria' | 'tipo' | 'objeto' | 'archivo';

/**
 * Clase de nodo según su profundidad bajo la raíz del destino. La carpeta bajo `Local Objects ($TMP)`
 * (`ABAP` en ECC, el nombre del usuario en S/4) cae en "paquete" por nivel.
 * // NO VERIFICADO: su contenido no se ha explorado.
 */
export const CLASES_POR_NIVEL: readonly ClaseNodoPaquete[] = ['biblioteca', 'paquete', 'categoria', 'tipo', 'objeto', 'archivo'];

export interface NodoPaquete {
  id: string;
  clase: ClaseNodoPaquete;
  etiqueta: string;
  ruta: string;
  icono: string;
  tipoObjeto?: TipoObjeto;
  esCarpeta: boolean;
}

const NIVEL_PAQUETE = 1;
const NIVEL_ARCHIVO = CLASES_POR_NIVEL.length - 1;

/** El icono de "objeto" depende de su carpeta de tipo; este es solo el respaldo. */
const ICONO_CLASE: Record<ClaseNodoPaquete, string> = {
  biblioteca: 'library',
  paquete: 'package',
  categoria: 'folder',
  tipo: 'folder-library',
  objeto: iconoDeTipo('desconocido'),
  archivo: 'file-code',
};

export function nivelDeHijos(nodo: NodoPaquete): number {
  return CLASES_POR_NIVEL.indexOf(nodo.clase) + 1;
}

export function nodosDesdeEntradas(rutaPadre: string, nivel: number, entradas: EntradaRepotree[]): NodoPaquete[] {
  const clase = CLASES_POR_NIVEL[Math.min(nivel, NIVEL_ARCHIVO)];
  const quiereCarpetas = clase !== 'archivo';
  const tipoObjeto = clase === 'objeto' ? tipoObjetoDe(ultimoSegmento(rutaPadre), undefined) : undefined;
  const icono = tipoObjeto === undefined ? ICONO_CLASE[clase] : iconoDeTipo(tipoObjeto);
  const nodos = entradas
    .filter((entrada) => entrada.esCarpeta === quiereCarpetas)
    .map((entrada): NodoPaquete => {
      const ruta = `${rutaPadre}/${entrada.nombre}`;
      return {
        id: ruta,
        clase,
        etiqueta: entrada.nombre,
        ruta,
        icono,
        ...(tipoObjeto !== undefined && { tipoObjeto }),
        esCarpeta: entrada.esCarpeta,
      };
    });
  return nivel === NIVEL_PAQUETE ? nodos.sort((a, b) => compararTexto(a.etiqueta, b.etiqueta)) : nodos;
}

// NO VERIFICADO: que `(NS)NAME` del repotree equivale siempre a `/NS/NAME` (deducido de la etiqueta, sin respuesta ADT).
/** `(IWBEP)FRAMEWORK` es como la oficial muestra el paquete `/IWBEP/FRAMEWORK`. */
export function nombreAbapDePaquete(etiqueta: string): string {
  return etiqueta.replace(/^\(([^)]+)\)/, '/$1/');
}

// NO VERIFICADO: la inversa de `nombreAbapDePaquete`, con la misma deducción.
/** `/IWBEP/FRAMEWORK` se muestra en el repotree como `(IWBEP)FRAMEWORK`; sin namespace, igual. */
export function etiquetaRepotreeDePaquete(nombreAbap: string): string {
  return nombreAbap.replace(/^\/([^/]+)\/(?=.)/, '($1)');
}

function ultimoSegmento(ruta: string): string | undefined {
  return ruta.split('/').filter((segmento) => segmento.length > 0).pop();
}

function compararTexto(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
