import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analizarFeedDumps, horaLocal } from '../../src/monitor/dumps-modelo';
import { analizarInactivos } from '../../src/monitor/inactivos-modelo';
import { OrdenMonitor } from '../../src/monitor/ordenes-modelo';
import {
  dumpsDeHoy,
  estadoInicial,
  etiquetaDe,
  hijosDe,
  idDe,
  iconoDe,
  nodosRaiz,
  TEXTO_SIN_DUMPS,
  TEXTO_SIN_SISTEMA,
} from '../../src/monitor/panel-modelo';
import type { Orden } from '../../src/adt/transportes-modelo';

function leerFixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function dumpFixture() {
  return analizarFeedDumps(leerFixture('dumps.xml'))[0];
}

suite('monitor panel-modelo', () => {
  test('sin sistema → un único aviso', () => {
    const n = nodosRaiz({ ...estadoInicial() });
    assert.deepEqual(n, [{ clase: 'aviso', texto: TEXTO_SIN_SISTEMA }]);
  });

  test('sin RFC → aviso con el motivo; conectar → nodo conectar', () => {
    assert.deepEqual(nodosRaiz({ ...estadoInicial(), destino: 'DEST', motivo: 'sinRfc', textoMotivo: 'X' }), [
      { clase: 'aviso', texto: 'X' },
    ]);
    assert.deepEqual(nodosRaiz({ ...estadoInicial(), destino: 'DEST', motivo: 'conectar' }), [
      { clase: 'conectar', destino: 'DEST' },
    ]);
    assert.equal(etiquetaDe({ clase: 'conectar', destino: 'DEST' }, estadoInicial()).label, 'Conectar a DEST…');
  });

  test('con destino → tres secciones en orden', () => {
    const n = nodosRaiz({ ...estadoInicial(), destino: 'DEST' });
    assert.deepEqual(
      n.map((x) => x.clase === 'seccion' && x.seccion),
      ['dumps', 'inactivos', 'ordenes'],
    );
  });

  test('sección dumps: etiqueta con conteo, descripción del filtro, hijos y "Más…" solo si llena', () => {
    const d = dumpFixture();
    const estado = {
      ...estadoInicial(),
      destino: 'DEST',
      usuario: 'USUARIO_1',
      ahora: new Date(d.publicado),
      dumps: { fase: 'ok', elementos: [d], llena: false } as const,
    };
    const seccion = { clase: 'seccion', seccion: 'dumps' } as const;
    assert.equal(etiquetaDe(seccion, estado).label, 'Dumps de hoy (1)');
    assert.equal(etiquetaDe(seccion, estado).description, 'míos');
    assert.deepEqual(hijosDe(seccion, estado), [{ clase: 'dump', dump: d }]);
    const llena = { ...estado, dumps: { fase: 'ok', elementos: [d], llena: true } as const };
    assert.deepEqual(hijosDe(seccion, llena).at(-1), { clase: 'masDumps' });
    assert.deepEqual(hijosDe(seccion, { ...estado, dumps: { fase: 'ok', elementos: [], llena: false } }), [
      { clase: 'aviso', texto: TEXTO_SIN_DUMPS, seccion: 'dumps' },
    ]);
    assert.deepEqual(hijosDe(seccion, { ...estado, dumps: { fase: 'cargando' } }), [
      { clase: 'aviso', texto: 'Cargando…', seccion: 'dumps' },
    ]);
    assert.deepEqual(hijosDe(seccion, { ...estado, dumps: { fase: 'error', mensaje: 'E' } }), [
      { clase: 'aviso', texto: 'Error: E', seccion: 'dumps' },
    ]);
  });

  test('descripción sin filtro: sin usuario válido o con "todos"', () => {
    const seccion = { clase: 'seccion', seccion: 'dumps' } as const;
    assert.equal(
      etiquetaDe(seccion, { ...estadoInicial(), destino: 'DEST' }).description,
      'todos (sin usuario en el destino)',
    );
    assert.equal(
      etiquetaDe(seccion, { ...estadoInicial(), destino: 'DEST', usuario: 'USUARIO_1', dumpsTodos: true }).description,
      'todos',
    );
  });

  test('nodo dump: HH:MM, error, programa; descripción include : línea; tooltip', () => {
    const d = dumpFixture();
    const e = etiquetaDe({ clase: 'dump', dump: d }, estadoInicial());
    assert.equal(e.label, `${horaLocal(d.publicado)}  ASSERTION_FAILED  Z_EJEMPLO_1`);
    assert.equal(e.description, 'Z_EJEMPLO_1 : 8');
    assert.ok(e.tooltip?.includes('The ASSERT condition was violated.') && e.tooltip.includes('USUARIO_1'));
    assert.equal(e.contextValue, 'dump');
    assert.equal(
      etiquetaDe({ clase: 'dump', dump: { ...d, marco: undefined, posicion: undefined } }, estadoInicial()).description,
      d.programa,
    );
    assert.equal(iconoDe({ clase: 'dump', dump: d }), 'flame');
  });

  test('dumpsDeHoy filtra por fecha local y ordena desc', () => {
    const d = dumpFixture();
    const ayer = { ...d, id: 'b', publicado: new Date(new Date(d.publicado).getTime() - 86_400_000).toISOString() };
    const antes = { ...d, id: 'c', publicado: new Date(new Date(d.publicado).getTime() - 60_000).toISOString() };
    const estado = { ...estadoInicial(), dumps: { fase: 'ok', elementos: [antes, ayer, d], llena: false } as const };
    assert.deepEqual(
      dumpsDeHoy(estado, new Date(d.publicado)).map((x) => x.id),
      [d.id, 'c'],
    );
  });

  test('sección inactivos: agrupa, etiqueta tipo, "de todos" añade usuario, borrado sin apertura', () => {
    const o = analizarInactivos(leerFixture('inactivos.xml'));
    const estado = {
      ...estadoInicial(),
      destino: 'DEST',
      usuario: 'USUARIO_1',
      inactivos: { fase: 'ok', elementos: o, llena: false } as const,
    };
    const seccion = { clase: 'seccion', seccion: 'inactivos' } as const;
    assert.equal(etiquetaDe(seccion, estado).label, 'Inactivos (4)');
    const hijos = hijosDe(seccion, estado);
    assert.equal(hijos.length, 3);
    assert.equal(etiquetaDe(hijos[0], estado).description, 'Clase');
    assert.equal(etiquetaDe(hijos[0], estado).colapsable, 'abierto');
    assert.equal(etiquetaDe(hijosDe(hijos[0], estado)[0], estado).description, 'Include');
    assert.equal(etiquetaDe(hijos[0], { ...estado, inactivosTodos: true }).description, 'Clase · USUARIO_1');
    const borrado = { clase: 'inactivo', objeto: { ...o[0], borrado: true } } as const;
    assert.equal(etiquetaDe(borrado, estado).contextValue, 'inactivoSinApertura');
    assert.equal(etiquetaDe(borrado, estado).description, 'Clase · borrado');
    assert.equal(etiquetaDe(hijos[2], estado).contextValue, 'inactivoSinApertura');
    assert.equal(etiquetaDe(hijos[0], estado).contextValue, 'inactivo');
  });

  test('sección órdenes: pendiente sin fuente; con fuente, órdenes y objetos', () => {
    const seccion = { clase: 'seccion', seccion: 'ordenes' } as const;
    assert.deepEqual(hijosDe(seccion, { ...estadoInicial(), destino: 'DEST' }), [{ clase: 'pendiente' }]);
    assert.equal(etiquetaDe(seccion, { ...estadoInicial(), destino: 'DEST' }).label, 'Órdenes');
    const orden: OrdenMonitor = {
      numero: 'DEVK900001',
      propietario: 'USUARIO_1',
      descripcion: 'Prueba',
      destino: 'QAS',
      tareas: [
        { numero: 'DEVK900002', propietario: 'USUARIO_1', objetos: [{ nombre: 'Z_EJEMPLO_1', tipoWb: 'CLAS/OC' }] },
      ],
      objetos: [{ nombre: 'Z_EJEMPLO_2' }],
    };
    const estado = {
      ...estadoInicial(),
      destino: 'DEST',
      ordenes: { fase: 'ok', elementos: [orden], llena: false } as const,
    };
    assert.equal(etiquetaDe(seccion, estado).label, 'Órdenes (1)');
    const [n] = hijosDe(seccion, estado);
    assert.equal(etiquetaDe(n, estado).label, 'DEVK900001 · Prueba');
    assert.equal(etiquetaDe(n, estado).description, 'QAS');
    const objetos = hijosDe(n, estado);
    assert.equal(objetos.length, 2);
    assert.equal(etiquetaDe(objetos[1], estado).contextValue, 'objetoOrden');
    assert.equal(etiquetaDe(objetos[0], estado).contextValue, 'objetoOrdenSinApertura');
  });

  test('Orden de transportes-modelo es asignable a OrdenMonitor', () => {
    const real: Orden = {
      numero: 'DEVK900001',
      propietario: 'USUARIO_1',
      descripcion: 'Prueba',
      estado: 'modificable',
      estadoCrudo: 'D',
      categoria: 'workbench',
      tareas: [],
      objetos: [],
    } as unknown as Orden;
    const monitor: OrdenMonitor = real;
    assert.equal(monitor.numero, 'DEVK900001');
  });

  test('idDe es estable y distinto por nodo', () => {
    const d = dumpFixture();
    assert.notEqual(idDe({ clase: 'dump', dump: d }), idDe({ clase: 'dump', dump: { ...d, id: 'otro' } }));
    assert.equal(idDe({ clase: 'seccion', seccion: 'dumps' }), 'seccion:dumps');
  });

  test('ids únicos en toda la vista con las tres secciones cargando o en error', () => {
    const casos = [{ fase: 'cargando' } as const, { fase: 'error', mensaje: 'Falló' } as const];
    for (const fase of casos) {
      const estado = { ...estadoInicial(), destino: 'DEST', dumps: fase, inactivos: fase, ordenes: fase };
      const ids = nodosRaiz(estado)
        .flatMap((n) => [n, ...hijosDe(n, estado)])
        .map(idDe);
      assert.equal(new Set(ids).size, ids.length, ids.join(' | '));
    }
  });
});
