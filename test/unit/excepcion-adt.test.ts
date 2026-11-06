import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mensajeDeExcepcionAdt, mensajeLegibleDe } from '../../src/adt/excepcion-adt';
import { ErrorAdt } from '../../src/adt/transporte';

function leerFixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

suite('excepcion-adt: mensajeDeExcepcionAdt', () => {
  test('un error SQL del Data Preview devuelve el texto de localizedMessage (dp-sql-malo.xml)', () => {
    assert.equal(
      mensajeDeExcepcionAdt(leerFixture('dp-sql-malo.xml')),
      'Nombre de columna desconocido "NOCOLUMNA" until runtime, you cannot specify a field list.',
    );
  });

  test('el 406 por Accept indebido nombra el tipo que el servidor acepta (dp-tstc-sin-csrf.xml)', () => {
    const texto = mensajeDeExcepcionAdt(leerFixture('dp-tstc-sin-csrf.xml')) ?? '';
    assert.ok(texto.includes('application/vnd.sap.adt.datapreview.table.v1+xml'), texto);
    assert.ok(!texto.includes('<'), texto);
  });

  test('sin localizedMessage usa message y descodifica entidades', () => {
    const xml = '<exc:exception xmlns:exc="x"><message lang="EN">a &lt; b &amp; &quot;c&quot;</message></exc:exception>';
    assert.equal(mensajeDeExcepcionAdt(xml), 'a < b & "c"');
  });

  test('un localizedMessage vacío cae a message', () => {
    const xml = '<exc:exception xmlns:exc="x"><message>texto</message><localizedMessage lang="ES"/></exc:exception>';
    assert.equal(mensajeDeExcepcionAdt(xml), 'texto');
  });

  test('un cuerpo que no es una excepción de ADT devuelve undefined', () => {
    assert.equal(mensajeDeExcepcionAdt(''), undefined);
    assert.equal(mensajeDeExcepcionAdt('<html><message>no</message></html>'), undefined);
    assert.equal(mensajeDeExcepcionAdt(leerFixture('dp-tstc-se38.xml')), undefined);
    assert.equal(mensajeDeExcepcionAdt('<exc:exception xmlns:exc="x"><properties/></exc:exception>'), undefined);
  });
});

suite('excepcion-adt: mensajeLegibleDe', () => {
  test('un ErrorAdt con cuerpo exc:exception muestra el texto del servidor, no el XML', () => {
    const error = new ErrorAdt('ADT /sap/bc/adt/datapreview/freestyle: respuesta 400', 400, '/r', leerFixture('dp-sql-malo.xml'));
    assert.equal(mensajeLegibleDe(error), 'Nombre de columna desconocido "NOCOLUMNA" until runtime, you cannot specify a field list.');
  });

  test('sin excepción legible conserva el mensaje del error', () => {
    assert.equal(mensajeLegibleDe(new ErrorAdt('ADT /r: respuesta 500', 500, '/r', '<html/>')), 'ADT /r: respuesta 500');
    assert.equal(mensajeLegibleDe(new ErrorAdt('ADT /r: respuesta 404', 404, '/r')), 'ADT /r: respuesta 404');
    assert.equal(mensajeLegibleDe(new Error('otro')), 'otro');
    assert.equal(mensajeLegibleDe('texto'), 'texto');
  });
});
