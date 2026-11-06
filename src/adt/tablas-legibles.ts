/** Lista cerrada de tablas que el puente puede leer con `RFC_READ_TABLE`. */
export const TABLAS_LEGIBLES = ['SNAP'] as const;
export type TablaLegible = (typeof TABLAS_LEGIBLES)[number];

/** Ancho de una línea de `OPTIONS` de `RFC_READ_TABLE`. */
export const LONGITUD_MAXIMA_CONDICION = 72;

export interface ConsultaTabla { tabla: TablaLegible; campos: string[]; condiciones: string[]; filasMax?: number }
export interface ColumnaTabla { nombre: string; longitud: number }
export interface ResultadoTabla { columnas: ColumnaTabla[]; filas: string[][] }

export interface LectorDeTablas {
  tabla(destino: string, consulta: ConsultaTabla, tiempoMs?: number): Promise<ResultadoTabla>;
}

const CAMPO_VALIDO = /^[A-Z0-9_]{1,30}$/;

/** `undefined` si la consulta es válida; si no, el motivo. */
export function validarConsulta(consulta: ConsultaTabla): string | undefined {
  if (!(TABLAS_LEGIBLES as readonly string[]).includes(consulta.tabla)) {
    return `tabla no legible: ${consulta.tabla}`;
  }
  if (consulta.campos.length === 0) {
    return 'sin campos';
  }
  const campoInvalido = consulta.campos.find((campo) => !CAMPO_VALIDO.test(campo));
  if (campoInvalido !== undefined) {
    return `campo no válido: ${campoInvalido}`;
  }
  if (consulta.condiciones.some((condicion) => condicion.length > LONGITUD_MAXIMA_CONDICION)) {
    return `condición de más de ${LONGITUD_MAXIMA_CONDICION} caracteres`;
  }
  return undefined;
}
