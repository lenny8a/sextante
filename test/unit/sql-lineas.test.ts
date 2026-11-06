import assert from 'node:assert/strict';
import { FIN_LINEA_DATAPREVIEW, MAX_LINEA_DATAPREVIEW, partirSqlEnLineas } from '../../src/adt/sql-lineas';
import { consultaOrdenesDeObjetoFiltro, filtroOrdenesDeObjeto } from '../../src/objeto/consulta-ordenes-objeto';

function maxLinea(sql: string): number {
  return Math.max(...sql.split('\r\n').map((l) => l.length));
}

suite('partirSqlEnLineas', () => {
  test('una consulta que cabe queda igual', () => {
    const sql = "SELECT A, B FROM T WHERE A = 'X'";
    assert.equal(partirSqlEnLineas(sql), sql);
  });

  test('una consulta larga queda en líneas de 255 como máximo y se recompone con espacios', () => {
    const sql = `SELECT ${Array.from({ length: 80 }, (_, i) => `T~CAMPO_${i}`).join(', ')} FROM T WHERE X = 'Y'`;
    assert.ok(sql.length > 255);
    const partido = partirSqlEnLineas(sql);
    assert.ok(maxLinea(partido) <= MAX_LINEA_DATAPREVIEW);
    assert.equal(partido.replace(/\r\n/g, ' '), sql);
  });

  test('no corta dentro de un literal con espacios', () => {
    const relleno = 'A'.repeat(230);
    const sql = `SELECT ${relleno} FROM T WHERE X = 'UNO DOS TRES' AND Y = 1`;
    const partido = partirSqlEnLineas(sql);
    assert.ok(partido.includes("'UNO DOS TRES'"));
    assert.ok(maxLinea(partido) <= MAX_LINEA_DATAPREVIEW);
    assert.equal(partido.replace(/\r\n/g, ' '), sql);
  });

  test('es idempotente', () => {
    const sql = `SELECT ${'CAMPO, '.repeat(100)}X FROM T`;
    const una = partirSqlEnLineas(sql);
    assert.equal(partirSqlEnLineas(una), una);
  });

  test('un token más largo que el límite queda solo en su línea', () => {
    const sql = `SELECT ${'A'.repeat(300)} FROM T`;
    const partido = partirSqlEnLineas(sql);
    assert.equal(partido.replace(/\r\n/g, ' '), sql);
    assert.ok(partido.split('\r\n').includes('A'.repeat(300)));
  });

  test('la consulta real de órdenes de una clase cabe en líneas de 255', () => {
    const filtro = filtroOrdenesDeObjeto('Z_EJEMPLO_1', 'clase');
    assert.ok(filtro);
    const sql = consultaOrdenesDeObjetoFiltro(filtro);
    const partido = partirSqlEnLineas(sql);
    assert.ok(maxLinea(partido) <= MAX_LINEA_DATAPREVIEW);
    assert.equal(partido.replace(/\r\n/g, ' '), sql);
  });

  test('una consulta de grupo de funciones con muchos OBJ_NAME IN cabe', () => {
    const archivos = Array.from({ length: 40 }, (_, i) => `zfg_ejemplo.fugr.z_modulo_ejemplo_${i}.func.abap`);
    const filtro = filtroOrdenesDeObjeto('ZFG_EJEMPLO', 'grupoFunciones', archivos);
    assert.ok(filtro);
    const sql = consultaOrdenesDeObjetoFiltro(filtro);
    assert.ok(sql.length > 255);
    const partido = partirSqlEnLineas(sql);
    assert.ok(maxLinea(partido) <= MAX_LINEA_DATAPREVIEW);
    assert.equal(partido.replace(/\s+/g, ''), sql.replace(/\s+/g, ''));
    assert.ok(partido.split('\r\n').every((l) => (l.match(/'/g) ?? []).length % 2 === 0));
  });

  test('une con CR+LF y no deja ningún LF suelto', () => {
    const partido = partirSqlEnLineas(`SELECT ${'CAMPO, '.repeat(100)}X FROM T`);
    assert.equal(FIN_LINEA_DATAPREVIEW, '\r\n');
    assert.ok(partido.includes('\r\n'));
    assert.ok(!/(?<!\r)\n/.test(partido));
  });

  test('es idempotente con entrada CRLF y con entrada LF (la salida pasa a CRLF)', () => {
    const sql = `SELECT ${'CAMPO, '.repeat(100)}X FROM T`;
    const crlf = partirSqlEnLineas(sql);
    assert.equal(partirSqlEnLineas(crlf), crlf);
    assert.equal(partirSqlEnLineas(crlf.replace(/\r\n/g, '\n')), crlf);
  });
});
