import assert from 'node:assert/strict';
import { validarConsulta, type ConsultaTabla, type TablaLegible } from '../../src/adt/tablas-legibles';

const VALIDA: ConsultaTabla = { tabla: 'SNAP', campos: ['SEQNO', 'FLIST'], condiciones: ["DATUM EQ '20261103'"] };

suite('validarConsulta (lista blanca de tablas)', () => {
  test('una consulta válida no tiene motivo de rechazo', () => {
    assert.equal(validarConsulta(VALIDA), undefined);
  });

  test('una tabla fuera de la lista se rechaza', () => {
    assert.equal(validarConsulta({ ...VALIDA, tabla: 'MARA' as TablaLegible }), 'tabla no legible: MARA');
  });

  test('un campo con caracteres no válidos se rechaza', () => {
    assert.equal(validarConsulta({ ...VALIDA, campos: ['FL IST'] }), 'campo no válido: FL IST');
  });

  test('una condición de más de 72 caracteres se rechaza', () => {
    assert.equal(validarConsulta({ ...VALIDA, condiciones: ['X'.repeat(73)] }), 'condición de más de 72 caracteres');
    assert.equal(validarConsulta({ ...VALIDA, condiciones: ['X'.repeat(72)] }), undefined);
  });

  test('sin campos se rechaza', () => {
    assert.equal(validarConsulta({ ...VALIDA, campos: [] }), 'sin campos');
  });
});
