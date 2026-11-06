import assert from 'node:assert/strict';
import { ACCIONES_OBJETO, MSG_SIN_OBJETO_ABIERTO, decidirAccion, type AccionObjeto } from '../../src/commands/objeto-acciones';

function accion(id: string): AccionObjeto {
  const encontrada = ACCIONES_OBJETO.find((a) => a.id === id);
  assert.ok(encontrada, id);
  return encontrada;
}

suite('Acciones del objeto', () => {
  test('las once acciones en orden y solo activar, activar todo y transporte requieren escritura', () => {
    assert.deepStrictEqual(
      ACCIONES_OBJETO.map((a) => a.id),
      [
        'activar',
        'activarTodo',
        'verificar',
        'atc',
        'unitTests',
        'compararUltima',
        'transporte',
        'copiarNombre',
        'ejecutar',
        'documentacion',
        'versiones',
      ],
    );
    assert.deepStrictEqual(
      ACCIONES_OBJETO.filter((a) => a.requiereEscritura).map((a) => a.id),
      ['activar', 'activarTodo', 'transporte'],
    );
  });

  test('activar todo usa la lista «Activate All» de la oficial y se deshabilita en solo lectura', () => {
    const activarTodo = accion('activarTodo');
    assert.deepStrictEqual(activarTodo, {
      id: 'activarTodo',
      titulo: 'Activar todo…',
      icono: 'run-all',
      comandoOficial: 'adt-vscode.activateAll',
      requiereEscritura: true,
    });
    for (const rol of ['QAS', 'PRD'] as const) {
      assert.deepStrictEqual(decidirAccion(activarTodo, { protegido: true, rol, tipo: 'programa' }), {
        ejecutar: false,
        motivo: `Sistema ${rol}: Activar todo… deshabilitado en solo lectura`,
      });
    }
    assert.deepStrictEqual(decidirAccion(activarTodo, { protegido: false, rol: 'DEV', tipo: 'programa' }), { ejecutar: true });
  });

  test('las acciones nuevas con su comando oficial e icono', () => {
    assert.deepStrictEqual(accion('ejecutar'), {
      id: 'ejecutar',
      titulo: 'Ejecutar',
      icono: 'play',
      comandoOficial: 'adt-vscode.runApplication',
      requiereEscritura: false,
      tipos: ['programa'],
    });
    assert.deepStrictEqual(accion('documentacion'), {
      id: 'documentacion',
      titulo: 'Documentación',
      icono: 'book',
      comandoOficial: 'adt-vscode.openDocumentation',
      requiereEscritura: false,
    });
    assert.deepStrictEqual(accion('versiones'), {
      id: 'versiones',
      titulo: 'Historial de versiones',
      icono: 'history',
      requiereEscritura: false,
    });
  });

  test('decidirAccion sin objeto, en QAS con escritura, en QAS sin escritura, en DEV', () => {
    const activar = accion('activar');
    const verificar = accion('verificar');
    assert.deepStrictEqual(decidirAccion(activar, undefined), { ejecutar: false, motivo: MSG_SIN_OBJETO_ABIERTO });
    assert.deepStrictEqual(decidirAccion(activar, { protegido: true, rol: 'QAS', tipo: 'clase' }), {
      ejecutar: false,
      motivo: 'Sistema QAS: Activar deshabilitado en solo lectura',
    });
    assert.deepStrictEqual(decidirAccion(verificar, { protegido: true, rol: 'QAS', tipo: 'clase' }), {
      ejecutar: true,
    });
    assert.deepStrictEqual(decidirAccion(activar, { protegido: false, rol: 'DEV', tipo: 'clase' }), {
      ejecutar: true,
    });
  });

  test('ejecutar solo aplica a programas', () => {
    const ejecutar = accion('ejecutar');
    assert.deepStrictEqual(decidirAccion(ejecutar, { protegido: false, rol: 'DEV', tipo: 'clase' }), {
      ejecutar: false,
      motivo: 'Ejecutar: solo para Programa',
    });
    assert.deepStrictEqual(decidirAccion(ejecutar, { protegido: false, rol: 'DEV', tipo: 'programa' }), {
      ejecutar: true,
    });
    assert.deepStrictEqual(decidirAccion(ejecutar, { protegido: true, rol: 'PRD', tipo: 'programa' }), {
      ejecutar: true,
    });
  });

  test('las acciones sin tipos aplican a cualquier tipo', () => {
    for (const a of ACCIONES_OBJETO.filter((x) => x.tipos === undefined && !x.requiereEscritura)) {
      for (const tipo of ['clase', 'programa', 'tabla', 'desconocido'] as const) {
        assert.deepStrictEqual(decidirAccion(a, { protegido: false, rol: 'DEV', tipo }), { ejecutar: true }, a.id);
      }
    }
  });
});
