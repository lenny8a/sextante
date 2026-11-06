import assert from 'node:assert/strict';
import {
  GRUPOS_BARRA,
  construirBarra,
  descripcionBarra,
  type EstadoBarra,
  type NodoBarra,
} from '../../src/tree/acciones-modelo';

const ORDEN: [string, string[]][] = [
  ['Desarrollo', ['activar', 'activarTodo', 'verificar', 'ejecutar', 'atc', 'unitTests', 'documentacion']],
  ['Transporte', ['ordenObjeto', 'transporte', 'copiarNombre']],
  ['Versiones', ['versiones', 'compararUltima', 'compararOtroSistema']],
  ['Herramientas', ['buscarObjeto', 'buscarTexto', 'consolaSql', 'dumps', 'nuevoObjeto']],
];

const NINGUNO = ['buscarObjeto', 'buscarTexto', 'consolaSql', 'dumps', 'nuevoObjeto'];

function acciones(barra: NodoBarra[]): NodoBarra[] {
  return barra.flatMap((g) => g.hijos);
}

function accion(barra: NodoBarra[], id: string): NodoBarra {
  const nodo = acciones(barra).find((n) => n.id === `accion:${id}`);
  assert.ok(nodo, id);
  return nodo;
}

const programaDev: EstadoBarra = {
  objeto: { nombre: 'zprog_ejemplo', tipo: 'programa', protegido: false, rol: 'DEV', destino: 'DEST' },
  sistemaActivo: 'DEST',
};
const claseDev: EstadoBarra = {
  objeto: { nombre: 'zcl_ejemplo', tipo: 'clase', protegido: false, rol: 'DEV', destino: 'DEST' },
};
const claseQas: EstadoBarra = {
  objeto: { nombre: 'zcl_ejemplo', tipo: 'clase', protegido: true, rol: 'QAS', destino: 'DEST' },
};

suite('Modelo de la barra de acciones', () => {
  test('sin estado: cuatro grupos expandidos con las acciones en orden', () => {
    const barra = construirBarra({});
    assert.deepStrictEqual(
      barra.map((g) => [g.etiqueta, g.hijos.map((a) => a.id.replace('accion:', ''))]),
      ORDEN,
    );
    for (const grupo of barra) {
      assert.strictEqual(grupo.clase, 'grupo');
      assert.ok(grupo.id.startsWith('grupo:'));
      assert.strictEqual(grupo.comando, undefined);
    }
  });

  test('sin estado: solo las de requisito ninguno están habilitadas', () => {
    for (const nodo of acciones(construirBarra({}))) {
      const id = nodo.id.replace('accion:', '');
      if (NINGUNO.includes(id)) {
        assert.strictEqual(nodo.habilitado, true, id);
        assert.ok(nodo.comando, id);
        assert.strictEqual(nodo.motivo, undefined, id);
      } else {
        assert.strictEqual(nodo.habilitado, false, id);
        assert.strictEqual(nodo.comando, undefined, id);
        assert.strictEqual(nodo.motivo, 'Abre un objeto', id);
      }
    }
  });

  test('con un programa en DEV todo está habilitado y con su comando', () => {
    for (const nodo of acciones(construirBarra(programaDev))) {
      assert.strictEqual(nodo.habilitado, true, nodo.id);
      assert.ok(nodo.comando, nodo.id);
      assert.strictEqual(nodo.motivo, undefined, nodo.id);
    }
    const barra = construirBarra(programaDev);
    assert.strictEqual(accion(barra, 'ejecutar').comando, 'abapNavigator.objeto.ejecutar');
    assert.strictEqual(accion(barra, 'activar').icono, 'zap');
    assert.strictEqual(accion(barra, 'activarTodo').icono, 'run-all');
    assert.strictEqual(accion(barra, 'activarTodo').etiqueta, 'Activar todo…');
    assert.strictEqual(accion(barra, 'activarTodo').comando, 'abapNavigator.objeto.activarTodo');
    assert.strictEqual(accion(barra, 'nuevoObjeto').comando, 'abapNavigator.crearObjeto');
    assert.strictEqual(accion(barra, 'buscarObjeto').comando, 'abapNavigator.buscar');
  });

  test('con una clase en DEV ejecutar está deshabilitado solo para programas', () => {
    const barra = construirBarra(claseDev);
    const ejecutar = accion(barra, 'ejecutar');
    assert.strictEqual(ejecutar.habilitado, false);
    assert.strictEqual(ejecutar.motivo, 'Solo para programas');
    assert.strictEqual(ejecutar.comando, undefined);
    assert.strictEqual(accion(barra, 'activar').habilitado, true);
  });

  test('con una clase en QAS activar, activar todo y transporte quedan en solo lectura, verificar habilitado', () => {
    const barra = construirBarra(claseQas);
    for (const id of ['activar', 'activarTodo', 'transporte']) {
      const nodo = accion(barra, id);
      assert.strictEqual(nodo.habilitado, false, id);
      assert.strictEqual(nodo.motivo, 'Solo lectura (QAS)', id);
      assert.strictEqual(nodo.comando, undefined, id);
    }
    assert.strictEqual(accion(barra, 'verificar').habilitado, true);
    assert.strictEqual(accion(barra, 'verificar').comando, 'abapNavigator.objeto.verificar');
  });

  test('Orden del objeto es la primera de Transporte y no requiere escritura: vale en QAS', () => {
    const transporte = GRUPOS_BARRA.find((g) => g.id === 'transporte');
    assert.strictEqual(transporte?.acciones[0]?.id, 'ordenObjeto');
    assert.strictEqual(transporte?.acciones[0]?.requiere, 'objeto');
    const nodo = accion(construirBarra(claseQas), 'ordenObjeto');
    assert.strictEqual(nodo.habilitado, true);
    assert.strictEqual(nodo.comando, 'abapNavigator.objeto.ordenes');
  });

  test('los ids de grupos y acciones son únicos', () => {
    const barra = construirBarra(programaDev);
    const ids = [...barra.map((g) => g.id), ...acciones(barra).map((a) => a.id)];
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.strictEqual(GRUPOS_BARRA.length, 4);
  });

  test('descripcionBarra con objeto, solo con sistema y sin nada', () => {
    assert.strictEqual(descripcionBarra(programaDev), 'DEST · DEV · ZPROG_EJEMPLO');
    assert.strictEqual(
      descripcionBarra({ objeto: { nombre: 'zcl_ejemplo', tipo: 'clase', protegido: false, destino: 'DEST' } }),
      'DEST · ? · ZCL_EJEMPLO',
    );
    assert.strictEqual(descripcionBarra({ sistemaActivo: 'DEST' }), 'DEST · sin objeto');
    assert.strictEqual(descripcionBarra({}), 'Sin sistema activo');
  });
});
