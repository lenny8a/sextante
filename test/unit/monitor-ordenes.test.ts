import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analizarOrdenes, esModificable, objetosDeOrden } from '../../src/adt/transportes-modelo';
import { objetosDeOrdenMonitor, type OrdenMonitor } from '../../src/monitor/ordenes-modelo';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

suite('monitor: órdenes del analizador de transportes', () => {
  test('las órdenes modificables son asignables a OrdenMonitor sin adaptador', () => {
    const ordenes: OrdenMonitor[] = analizarOrdenes(fixture('ordenes-lista.xml')).filter(esModificable);
    assert.ok(ordenes.length > 0);
  });

  test('objetosDeOrdenMonitor devuelve los mismos objetos que objetosDeOrden', () => {
    const ordenes = analizarOrdenes(fixture('ordenes-lista.xml'));
    assert.ok(ordenes.length > 0);
    for (const orden of ordenes) {
      const esperado = objetosDeOrden(orden).map((o) => [o.tipoWb, o.nombre]);
      const real = objetosDeOrdenMonitor(orden).map((o) => [o.tipoWb, o.nombre]);
      assert.deepEqual(real, esperado);
    }
  });

  test('una lista vacía no da órdenes', () => {
    assert.deepEqual(analizarOrdenes(fixture('ordenes-vacia.xml')).filter(esModificable), []);
  });
});
