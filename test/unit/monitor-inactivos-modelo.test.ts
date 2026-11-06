import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  agruparPorPadre,
  analizarInactivos,
  esAbrible,
  etiquetaTipo,
  filtrarMios,
  resultadoBusquedaDe,
} from '../../src/monitor/inactivos-modelo';

function leerFixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

suite('monitor inactivos-modelo', () => {
  test('analiza la respuesta real (inactivos.xml)', () => {
    const o = analizarInactivos(leerFixture('inactivos.xml'));
    assert.equal(o.length, 4);
    assert.deepEqual(o[0], { nombre: 'Z_EJEMPLO_1', tipo: 'CLAS/OC', uriAdt: '/sap/bc/adt/oo/classes/z_ejemplo_1', usuario: 'USUARIO_1', borrado: false });
    assert.equal(o[1].tipo, 'CLAS/OCN/testclasses');
    assert.equal(o[1].uriPadre, '/sap/bc/adt/oo/classes/z_ejemplo_1');
    assert.equal(o[3].tipo, 'TABL/DTT');
  });
  test('filtrarMios por usuario; sin usuario, todos', () => {
    const o = analizarInactivos(leerFixture('inactivos.xml'));
    assert.equal(filtrarMios(o, 'USUARIO_1').length, 4);
    assert.equal(filtrarMios(o, 'OTRO').length, 0);
    assert.equal(filtrarMios(o, undefined).length, 4);
  });
  test('agruparPorPadre cuelga el include de su clase', () => {
    const g = agruparPorPadre(analizarInactivos(leerFixture('inactivos.xml')));
    assert.equal(g.length, 3);
    assert.equal(g[0].objeto.nombre, 'Z_EJEMPLO_1');
    assert.equal(g[0].hijos[0].tipo, 'CLAS/OCN/testclasses');
  });
  test('padre ausente → el include va a la raíz con el nombre del padre', () => {
    const o = analizarInactivos(leerFixture('inactivos.xml')).filter((x) => x.tipo !== 'CLAS/OC');
    const g = agruparPorPadre(o);
    assert.equal(g[0].objeto.tipo, 'CLAS/OCN/testclasses');
    assert.equal(g[0].padreAusente, 'Z_EJEMPLO_1');
  });
  test('etiquetaTipo y esAbrible', () => {
    assert.equal(etiquetaTipo('CLAS/OC'), 'Clase');
    assert.equal(etiquetaTipo('CLAS/OCN/testclasses'), 'Include');
    assert.equal(etiquetaTipo('TABL/DS'), 'Estructura');
    assert.equal(etiquetaTipo('DDLS/DF'), 'CDS');
    assert.equal(etiquetaTipo('TABL/DTT'), 'TABL/DTT');
    const o = analizarInactivos(leerFixture('inactivos.xml'));
    assert.equal(esAbrible(o[0]), true);
    assert.equal(esAbrible(o[1]), true);
    assert.equal(esAbrible(o[3]), false);
    assert.equal(esAbrible({ ...o[0], borrado: true }), false);
  });
  test('resultadoBusquedaDe: el include de clase abre la clase', () => {
    const o = analizarInactivos(leerFixture('inactivos.xml'));
    assert.deepEqual(resultadoBusquedaDe(o[0]), { nombre: 'Z_EJEMPLO_1', tipo: 'CLAS/OC', descripcion: '', paquete: '', uriAdt: '/sap/bc/adt/oo/classes/z_ejemplo_1' });
    assert.equal(resultadoBusquedaDe(o[1], o[0]).tipo, 'CLAS/OC');
    assert.equal(resultadoBusquedaDe(o[1]).tipo, 'CLAS/OC');
  });
});
