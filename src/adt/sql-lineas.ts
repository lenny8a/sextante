// VERIFICADO 2026-11-03: solo CR+LF cuenta como fin de línea; LF o CR solos → 400 "supera los 255 en la línea 1"
export const MAX_LINEA_DATAPREVIEW = 255;
export const FIN_LINEA_DATAPREVIEW = '\r\n';

interface Pieza {
  texto: string;
  /** Lo que la separa de la pieza anterior si caben en la misma línea. */
  separador: string;
}

/** Corta en espacios y tras las comas, siempre fuera de literales `'...'`. */
function piezasDe(linea: string): Pieza[] {
  const piezas: Pieza[] = [];
  let actual = '';
  let separador = '';
  let enLiteral = false;
  const cerrar = (siguiente: string): void => {
    if (actual !== '') {
      piezas.push({ texto: actual, separador });
    }
    actual = '';
    separador = siguiente;
  };
  for (const c of linea) {
    if (c === "'") {
      enLiteral = !enLiteral;
    }
    if (!enLiteral && c === ' ') {
      cerrar(' ');
      continue;
    }
    actual += c;
    if (!enLiteral && c === ',') {
      cerrar('');
    }
  }
  cerrar('');
  return piezas;
}

function partirLinea(linea: string, maximo: number): string[] {
  if (linea.length <= maximo) {
    return [linea];
  }
  const lineas: string[] = [];
  let actual = '';
  for (const { texto, separador } of piezasDe(linea)) {
    if (actual === '') {
      actual = texto;
    } else if (actual.length + separador.length + texto.length <= maximo) {
      actual += separador + texto;
    } else {
      lineas.push(actual);
      actual = texto;
    }
  }
  lineas.push(actual);
  return lineas;
}

/**
 * El Data Preview rechaza (HTTP 400) las líneas de más de 255 caracteres, y solo reconoce CR+LF como fin de
 * línea. Reparte el SQL en líneas de `maximo` como máximo unidas con CR+LF, cortando solo en espacios o tras
 * una coma fuera de literales (nunca dentro de un `'...'` ni de un identificador); tras una coma el corte
 * equivale a un espacio, que ABAP SQL admite en las listas. Un CR+LF o LF ya presente en la entrada es un
 * límite de línea (idempotente). Una pieza más larga que el límite queda sola en su línea: imposible con
 * identificadores validados (30 caracteres).
 */
export function partirSqlEnLineas(sql: string, maximo: number = MAX_LINEA_DATAPREVIEW): string {
  return sql
    .split(/\r?\n/)
    .flatMap((linea) => partirLinea(linea, maximo))
    .join(FIN_LINEA_DATAPREVIEW);
}
