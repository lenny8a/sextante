import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analizarVersiones, formatearFechaIso } from '../../src/adt/versiones-modelo';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

suite('versiones-modelo', () => {
  test('programa: dos versiones con orden y la activa al final', () => {
    const versiones = analizarVersiones(fixture('versiones-prog.xml'));
    assert.equal(versiones.length, 2);
    assert.equal(versiones[0].id, '00001');
    assert.equal(versiones[0].activa, false);
    assert.equal(versiones[0].autor, 'USUARIO_1');
    assert.equal(versiones[0].orden, 'DEVK900001');
    assert.equal(versiones[0].textoOrden, 'Descripción de ejemplo 1');
    assert.equal(versiones[0].fecha, '2026-06-08T15:51:37Z');
    assert.equal(versiones[1].activa, true);
    assert.ok(versiones[0].src.startsWith('/sap/bc/adt/programs/programs/'));
  });

  test('interfaz estándar: autor SAP y sin orden', () => {
    const versiones = analizarVersiones(fixture('versiones-intf.xml'));
    assert.equal(versiones.length, 1);
    assert.equal(versiones[0].autor, 'SAP');
    assert.equal(versiones[0].orden, undefined);
    assert.equal(versiones[0].textoOrden, undefined);
  });

  test('cds: el src cuelga de /ddl/sources/ y /versions/', () => {
    const versiones = analizarVersiones(fixture('versiones-cds.xml'));
    assert.equal(versiones.length, 2);
    assert.ok(versiones[0].src.includes('/ddl/sources/'));
    assert.ok(versiones[0].src.includes('/versions/'));
  });

  test('clase main: una versión', () => {
    assert.equal(analizarVersiones(fixture('versiones-clas-main.xml')).length, 1);
  });

  test('un 404 (exc:exception) no tiene versiones', () => {
    assert.deepEqual(analizarVersiones(fixture('versiones-404-testclasses.xml')), []);
  });

  test('entidades en el texto de la orden', () => {
    const xml =
      '<atom:feed><atom:entry><atom:author><atom:name>U</atom:name></atom:author>' +
      '<atom:content type="text/plain" src="/a/versions/1/00001/content"/><atom:id>00001</atom:id>' +
      '<atom:link adtcore:name="DEVK900001" href="/x" rel="http://www.sap.com/adt/relations/transport/request" title="A --&gt; B &amp; C"/>' +
      '<atom:updated>2026-01-01T00:00:00Z</atom:updated></atom:entry></atom:feed>';
    assert.equal(analizarVersiones(xml)[0].textoOrden, 'A --> B & C');
  });

  test('formatearFechaIso en UTC', () => {
    assert.equal(formatearFechaIso('2026-10-28T21:09:50Z', true), '2026-10-28 21:09');
  });

  test('formatearFechaIso con fecha ilegible devuelve el texto', () => {
    assert.equal(formatearFechaIso('no es fecha', true), 'no es fecha');
  });
});
