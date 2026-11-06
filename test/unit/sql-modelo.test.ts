import * as assert from 'node:assert/strict';
import {
  COMANDO_NOTEBOOK_SQL,
  LENGUAJE_SQL,
  MSG_CONSULTA_COPIADA,
  MSG_SIN_TABLA,
  TIPO_NOTEBOOK_SQL,
  consultaSelect,
} from '../../src/commands/sql-modelo';

suite('sql-modelo', () => {
  test('consultaSelect pasa el nombre a mayúsculas y no limita filas', () => {
    assert.equal(consultaSelect('zmm_tienda'), 'SELECT * FROM ZMM_TIENDA');
  });

  test('constantes de la oficial', () => {
    assert.equal(TIPO_NOTEBOOK_SQL, 'abap-sql-notebook');
    assert.equal(LENGUAJE_SQL, 'abap-sql');
    assert.equal(COMANDO_NOTEBOOK_SQL, 'adt-vscode.dataPreview.sqlNotebook.new');
    assert.ok(MSG_SIN_TABLA.length > 0 && MSG_CONSULTA_COPIADA.length > 0);
  });
});
