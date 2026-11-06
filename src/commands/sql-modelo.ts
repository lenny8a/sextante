export const TIPO_NOTEBOOK_SQL = 'abap-sql-notebook';
export const LENGUAJE_SQL = 'abap-sql';
// NO VERIFICADO: comportamiento del comando (se supone que abre un notebook nuevo y pregunta el sistema)
export const COMANDO_NOTEBOOK_SQL = 'adt-vscode.dataPreview.sqlNotebook.new';
export const MSG_SIN_TABLA = 'Abre o selecciona una tabla para ver sus datos';
export const MSG_CONSULTA_COPIADA = 'Consulta copiada al portapapeles: pégala en una celda del notebook SQL';

/** Sin límite de filas: el notebook ya aplica su "max rows" por celda. */
export function consultaSelect(tabla: string): string {
  return `SELECT * FROM ${tabla.toUpperCase()}`;
}
