import assert from 'node:assert/strict';
import type { ObjetoOrden, OrdenDeObjeto } from '../../src/adt/transportes-modelo';
import {
  MSG_TIPO_NO_SOPORTADO,
  TITULO_ORDENES,
  avisoDe,
  avisoTruncado,
  etiquetaItemObjeto,
  itemsObjetos,
  itemsOrdenes,
} from '../../src/objeto/orden-objeto-modelo';

function orden(numero: string, estado: OrdenDeObjeto['estado'], extra: Partial<OrdenDeObjeto> = {}): OrdenDeObjeto {
  return {
    numero,
    estado,
    estadoCrudo: estado === 'modificable' ? 'D' : 'R',
    propietario: 'USUARIO_1',
    fecha: '2026-10-01',
    hora: '',
    partes: [],
    ...extra,
  };
}

const MODIFICABLE = orden('DEVK900001', 'modificable', {
  descripcion: 'Descripción de ejemplo 1',
  tarea: 'DEVK900002',
  destino: 'QAS',
});
const LIBERADA = orden('DEVK900003', 'liberada', { descripcion: 'Descripción de ejemplo 2' });

suite('orden-objeto-modelo', () => {
  test('itemsOrdenes: etiquetas, descripción y detalle', () => {
    const [a, b] = itemsOrdenes([MODIFICABLE, LIBERADA]);
    assert.strictEqual(a?.label, '$(package) DEVK900001');
    assert.strictEqual(a?.description, 'Descripción de ejemplo 1');
    assert.strictEqual(a?.detail, 'modificable · tarea DEVK900002 · USUARIO_1 · 2026-10-01 → QAS');
    assert.strictEqual(b?.label, '$(check) DEVK900003');
    assert.strictEqual(b?.detail, 'liberada · USUARIO_1 · 2026-10-01');
    assert.strictEqual(a?.orden, MODIFICABLE);
  });

  test('itemsOrdenes: otro estado usa el círculo', () => {
    const [item] = itemsOrdenes([orden('DEVK900004', 'otro')]);
    assert.strictEqual(item?.label, '$(circle-outline) DEVK900004');
  });

  test('itemsOrdenes: si todas están liberadas, el primero avisa', () => {
    const items = itemsOrdenes([LIBERADA, orden('DEVK900005', 'liberada')]);
    assert.ok(items[0]?.detail?.endsWith(' · La última orden está liberada: el próximo cambio pedirá una orden nueva'));
    assert.ok(!items[1]?.detail?.includes('La última orden'));
  });

  test('avisoDe', () => {
    assert.strictEqual(avisoDe([], 'Z_EJEMPLO_1'), 'Z_EJEMPLO_1 no está en ninguna orden');
    assert.strictEqual(avisoDe([LIBERADA], 'Z_EJEMPLO_1'), 'La última orden de Z_EJEMPLO_1 está liberada (DEVK900003)');
    assert.strictEqual(avisoDe([MODIFICABLE], 'Z_EJEMPLO_1'), undefined);
  });

  test('itemsObjetos marca el activo sin distinguir mayúsculas y termina en copiar y organizador', () => {
    const objetos: ObjetoOrden[] = [
      { pgmid: 'R3TR', tipo: 'CLAS', nombre: 'Z_EJEMPLO_1', descripcion: 'Clase de ejemplo' },
      { pgmid: 'R3TR', tipo: 'PROG', nombre: 'Z_EJEMPLO_2' },
    ];
    const items = itemsObjetos(objetos, 'z_ejemplo_1');
    assert.strictEqual(items.length, 4);
    const [a, b, c, d] = items;
    assert.ok(a?.clase === 'objeto' && a.activo && a.label.startsWith('$(arrow-right) '));
    assert.ok(b?.clase === 'objeto' && !b.activo && !b.label.startsWith('$(arrow-right)'));
    assert.strictEqual(c?.clase, 'copiar');
    assert.strictEqual(d?.clase, 'organizador');
  });

  test('etiquetaItemObjeto: los objetos conservan la suya y las filas fijas llevan texto e icono', () => {
    const objeto: ObjetoOrden = { pgmid: 'R3TR', tipo: 'CLAS', nombre: 'Z_EJEMPLO_1', descripcion: 'Clase de ejemplo' };
    const [item] = itemsObjetos([objeto], 'Z_EJEMPLO_2');
    assert.ok(item);
    assert.deepStrictEqual(etiquetaItemObjeto(item), { label: 'Z_EJEMPLO_1', description: 'CLAS · Clase de ejemplo' });
    assert.deepStrictEqual(etiquetaItemObjeto({ clase: 'copiar' }), { label: '$(copy) Copiar número' });
    assert.deepStrictEqual(etiquetaItemObjeto({ clase: 'organizador' }), { label: '$(package) Abrir en el organizador de la oficial' });
  });

  test('TITULO_ORDENES dice el alcance de un grupo de funciones', () => {
    assert.strictEqual(TITULO_ORDENES('ZCL_X'), 'ZCL_X · órdenes');
    assert.strictEqual(TITULO_ORDENES('ZCL_X', 'objeto'), 'ZCL_X · órdenes');
    assert.strictEqual(TITULO_ORDENES('ZFG_X', 'grupo'), 'ZFG_X · órdenes (grupo y sus includes)');
    assert.strictEqual(TITULO_ORDENES('ZFG_X', 'soloModulo'), 'ZFG_X · órdenes (solo este módulo)');
  });

  test('avisoTruncado y el aviso de tipo no soportado', () => {
    assert.strictEqual(avisoTruncado({ recibidas: 5000, total: 7200 }), 'Lista incompleta (5000 de 7200)');
    assert.match(MSG_TIPO_NO_SOPORTADO, /tipo no soportado/);
  });
});
