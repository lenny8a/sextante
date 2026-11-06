import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analizarOrdenes, type ObjetoOrden, type Orden } from '../../src/adt/transportes-modelo';
import {
  etiquetaDe,
  hijosDe,
  raicesDe,
  resultadoBusquedaDe,
  TEXTO_NO_ABRIBLE,
  type NodoOrdenes,
} from '../../src/objeto/ordenes-modelo';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

const ordenes = analizarOrdenes(fixture('ordenes-lista.xml'));

function objeto(parcial: Partial<ObjetoOrden>): ObjetoOrden {
  return { pgmid: 'R3TR', tipo: 'CLAS', nombre: 'Z_EJEMPLO_1', ...parcial };
}

function abrible(nodo: NodoOrdenes | undefined): boolean | undefined {
  return nodo?.clase === 'objeto' ? nodo.abrible : undefined;
}

suite('ordenes-modelo: raíces', () => {
  test('cargando da un único aviso', () => {
    const raices = raicesDe({ cargando: true });
    assert.equal(raices.length, 1);
    assert.equal(raices[0].clase === 'aviso' && raices[0].motivo, 'cargando');
  });

  test('sin destino, aviso sinSistema', () => {
    const [aviso] = raicesDe({ cargando: false });
    assert.equal(aviso.clase === 'aviso' && aviso.motivo, 'sinSistema');
  });

  test('sin datos ni error, aviso conectar con el destino', () => {
    const [aviso] = raicesDe({ destino: 'DEST', cargando: false });
    assert.deepEqual(aviso, { clase: 'aviso', motivo: 'conectar', destino: 'DEST' });
  });

  test('motivo sin vía y error', () => {
    const [sinVia] = raicesDe({ destino: 'DEST', cargando: false, motivoSinVia: 'sin puente' });
    assert.equal(sinVia.clase === 'aviso' && sinVia.motivo, 'sinVia');
    const [error] = raicesDe({ destino: 'DEST', cargando: false, error: 'falló' });
    assert.equal(error.clase === 'aviso' && error.mensaje, 'falló');
  });

  test('lista vacía da sinOrdenes', () => {
    const [aviso] = raicesDe({ destino: 'DEST', cargando: false, ordenes: [] });
    assert.equal(aviso.clase === 'aviso' && aviso.motivo, 'sinOrdenes');
  });

  test('el fixture da modificables (2) y liberadas (1), sin customizing', () => {
    const raices = raicesDe({ destino: 'DEST', cargando: false, ordenes });
    assert.deepEqual(
      raices.map((n) => n.clase === 'grupo' && [n.grupo, n.ordenes.length]),
      [['modificables', 2], ['liberadas', 1]],
    );
  });

  test('customizing aparece al final', () => {
    const custom: Orden = { ...ordenes[0], categoria: 'customizing' };
    const raices = raicesDe({ destino: 'DEST', cargando: false, ordenes: [custom, ...ordenes] });
    assert.deepEqual(raices.map((n) => n.clase === 'grupo' && n.grupo), ['modificables', 'liberadas', 'customizing']);
  });
});

suite('ordenes-modelo: hijos', () => {
  test('orden con objetos directos y 2 tareas: objetos y luego tareas', () => {
    const hijos = hijosDe({ clase: 'orden', orden: ordenes[0] });
    assert.deepEqual(hijos.map((h) => h.clase), ['objeto', 'objeto', 'tarea', 'tarea']);
  });

  test('tarea → sus objetos con el número de la tarea', () => {
    const tarea = ordenes[0].tareas[0];
    const hijos = hijosDe({ clase: 'tarea', orden: ordenes[0], tarea });
    assert.equal(hijos.length, tarea.objetos.length);
    assert.ok(hijos.every((h) => h.clase === 'objeto' && h.numero === tarea.numero));
  });

  test('grupo → órdenes; objeto y aviso no tienen hijos', () => {
    assert.equal(hijosDe({ clase: 'grupo', grupo: 'modificables', ordenes }).length, 3);
    assert.deepEqual(hijosDe({ clase: 'aviso', motivo: 'cargando' }), []);
    assert.deepEqual(hijosDe({ clase: 'objeto', numero: 'X', objeto: objeto({}), abrible: false }), []);
  });

  test('abrible solo en workbench con tipo conocido', () => {
    const directos = hijosDe({ clase: 'orden', orden: ordenes[0] });
    assert.equal(abrible(directos[0]), true);
    assert.equal(abrible(directos[1]), false);
    const custom: Orden = { ...ordenes[0], categoria: 'customizing' };
    assert.equal(abrible(hijosDe({ clase: 'orden', orden: custom })[0]), false);
  });
});

suite('ordenes-modelo: etiquetas', () => {
  test('objeto LIMU REPS', () => {
    const e = etiquetaDe({
      clase: 'objeto',
      numero: 'DEVK900001',
      abrible: true,
      objeto: objeto({ pgmid: 'LIMU', tipo: 'REPS', tipoWb: 'PROG/I', info: 'Source report', descripcion: 'Descripción de ejemplo 1' }),
    });
    assert.equal(e.description, 'Source report · LIMU REPS');
    assert.equal(e.icono, 'file-submodule');
    assert.equal(e.tooltip, 'Descripción de ejemplo 1');
    assert.equal(e.colapsable, 'no');
  });

  test('objeto R3TR sin tipoWb', () => {
    const e = etiquetaDe({ clase: 'objeto', numero: 'X', abrible: false, objeto: objeto({ info: 'Tabla' }) });
    assert.equal(e.description, 'Tabla');
    assert.equal(e.icono, 'symbol-misc');
  });

  test('grupos', () => {
    const etiqueta = (grupo: 'modificables' | 'liberadas' | 'customizing'): string =>
      etiquetaDe({ clase: 'grupo', grupo, ordenes }).label;
    assert.equal(etiqueta('modificables'), 'Modificables (3)');
    assert.equal(etiqueta('liberadas'), 'Liberadas · últimas 2 semanas (3)');
    assert.equal(etiqueta('customizing'), 'Customizing (3)');
  });

  test('orden y tarea', () => {
    const o = etiquetaDe({ clase: 'orden', orden: ordenes[0] });
    assert.equal(o.label, ordenes[0].numero);
    assert.equal(o.description, ordenes[0].descripcion);
    assert.equal(o.icono, 'package');
    assert.equal(o.contextValue, 'orden');
    assert.equal(etiquetaDe({ clase: 'orden', orden: ordenes[2] }).icono, 'check');
    const t = etiquetaDe({ clase: 'tarea', orden: ordenes[0], tarea: ordenes[0].tareas[0] });
    assert.equal(t.description, `tarea · ${ordenes[0].tareas[0].propietario}`);
    assert.equal(t.icono, 'tasklist');
    assert.equal(t.contextValue, 'tarea');
  });

  test('avisos', () => {
    const texto = (n: NodoOrdenes): string => etiquetaDe(n).label;
    assert.equal(texto({ clase: 'aviso', motivo: 'conectar', destino: 'DEST' }), 'Conéctate a DEST por RFC para ver tus órdenes');
    assert.equal(texto({ clase: 'aviso', motivo: 'sinOrdenes' }), 'Sin órdenes modificables');
    assert.equal(texto({ clase: 'aviso', motivo: 'sinSistema' }), 'Marca un sistema como activo');
    assert.equal(texto({ clase: 'aviso', motivo: 'sinVia', destino: 'DEST', mensaje: 'sin puente' }), 'DEST: sin puente');
    assert.equal(texto({ clase: 'aviso', motivo: 'cargando' }), 'Cargando órdenes…');
    assert.equal(texto({ clase: 'aviso', motivo: 'error', mensaje: 'falló' }), 'falló');
  });
});

suite('ordenes-modelo: resultadoBusquedaDe', () => {
  test('clase', () => {
    const r = resultadoBusquedaDe(objeto({ tipoWb: 'CLAS/OC', info: 'Clase' }));
    assert.deepEqual(r, { nombre: 'Z_EJEMPLO_1', tipo: 'CLAS/OC', uriAdt: '', descripcion: 'Clase', paquete: '' });
  });

  test('método → la clase', () => {
    const r = resultadoBusquedaDe(objeto({ tipo: 'METH', tipoWb: 'CLAS/OC', nombre: 'ZCL_X', info: 'método M' }));
    assert.equal(r?.nombre, 'ZCL_X');
    assert.equal(r?.tipo, 'CLAS/OC');
  });

  test('método real con nombre relleno', () => {
    const r = resultadoBusquedaDe(
      objeto({ pgmid: 'LIMU', tipo: 'METH', tipoWb: 'CLAS/OM', nombre: 'Z_EJEMPLO_9                   METODO_1' }),
    );
    assert.equal(r?.nombre, 'Z_EJEMPLO_9');
    assert.equal(r?.tipo, 'CLAS/OC');
  });

  test('sin tipo conocido no hay resultado', () => {
    assert.equal(resultadoBusquedaDe(objeto({ tipo: 'TABU' })), undefined);
    assert.equal(resultadoBusquedaDe(objeto({ tipoWb: 'ENHO/XH' })), undefined);
  });

  test('texto de no abrible', () => {
    assert.equal(TEXTO_NO_ABRIBLE(objeto({ tipo: 'TABU', nombre: 'MARA' })), 'MARA (TABU) no se puede abrir desde aquí');
  });
});
