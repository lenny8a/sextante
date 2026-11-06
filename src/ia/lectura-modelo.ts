import { MAX_ARCHIVOS_FORM, includesDe, rutaDeInclude, type LectorTexto } from '../navegacion/perform-modelo';

export const MAX_ARCHIVOS_PROGRAMA = MAX_ARCHIVOS_FORM;
export const MAX_LINEAS_POR_DEFECTO = 2000;

export interface ArchivoLeido {
  ruta: string;
  texto?: string;
  motivo?: 'noLegible';
}

export interface OpcionesFormato {
  maxLineasPorArchivo: number;
}

/** Un salto final cierra la última línea, no abre otra: `'a\nb\n'` son 2 líneas y `''` ninguna. */
function lineasDe(texto: string): string[] {
  if (texto === '') {
    return [];
  }
  const lineas = texto.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (texto.endsWith('\n')) {
    lineas.pop();
  }
  return lineas;
}

export function contarLineas(texto: string): number {
  return lineasDe(texto).length;
}

/** Origen y sus includes (también los de los includes) en anchura, sin repetir y con tope de archivos leídos. */
export async function recopilarPrograma(rutaOrigen: string, leer: LectorTexto, incluirIncludes: boolean): Promise<ArchivoLeido[]> {
  const resultado: ArchivoLeido[] = [];
  const visitadas = new Set<string>([rutaOrigen]);
  const pendientes: string[] = [rutaOrigen];
  let leidos = 0;
  while (pendientes.length > 0 && leidos < MAX_ARCHIVOS_PROGRAMA) {
    const ruta = pendientes.shift() as string;
    const texto = await leer(ruta);
    if (texto === undefined) {
      resultado.push({ ruta, motivo: 'noLegible' });
      continue;
    }
    leidos++;
    resultado.push({ ruta, texto });
    if (!incluirIncludes) {
      break;
    }
    for (const include of includesDe(texto)) {
      const rutaInclude = rutaDeInclude(ruta, include);
      if (rutaInclude !== undefined && !visitadas.has(rutaInclude)) {
        visitadas.add(rutaInclude);
        pendientes.push(rutaInclude);
      }
    }
  }
  return resultado;
}

/** Líneas `desdeLinea`..`hastaLinea` (1-based, inclusivo) como `  12| texto`, con el número alineado al mayor del archivo. */
export function numerarLineas(texto: string, desdeLinea: number, hastaLinea: number): string {
  const lineas = lineasDe(texto);
  const ancho = String(lineas.length).length;
  const salida: string[] = [];
  for (let n = Math.max(desdeLinea, 1); n <= Math.min(hastaLinea, lineas.length); n++) {
    salida.push(`${String(n).padStart(ancho)}| ${lineas[n - 1]}`);
  }
  return salida.join('\n');
}

export function formatearPrograma(archivos: ArchivoLeido[], opciones: OpcionesFormato): string {
  const bloques = archivos.map((archivo) => {
    if (archivo.texto === undefined) {
      return `=== ${archivo.ruta} === no se pudo leer`;
    }
    const total = lineasDe(archivo.texto).length;
    const mostradas = Math.min(total, opciones.maxLineasPorArchivo);
    const partes = [`=== ${archivo.ruta} (${total} líneas) ===`];
    if (mostradas > 0) {
      partes.push(numerarLineas(archivo.texto, 1, mostradas));
    }
    if (mostradas < total) {
      partes.push(`… ${total - mostradas} líneas más: leer_archivo desde la ${mostradas + 1}`);
    }
    return partes.join('\n');
  });
  return bloques.join('\n\n');
}

export function rangoValido(
  desde: number,
  hasta: number,
  totalLineas: number,
): { ok: true; desde: number; hasta: number } | { ok: false; motivo: string } {
  if (desde < 1) {
    return { ok: false, motivo: `desde (${desde}) debe ser al menos 1` };
  }
  if (desde > hasta) {
    return { ok: false, motivo: `desde (${desde}) es mayor que hasta (${hasta})` };
  }
  if (hasta > totalLineas) {
    return { ok: false, motivo: `hasta (${hasta}) supera el total de líneas (${totalLineas})` };
  }
  return { ok: true, desde, hasta };
}
