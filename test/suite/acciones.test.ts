import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { lanzarAccion } from '../../src/commands/objeto';
import { ACCIONES_OBJETO, MSG_SIN_OBJETO_ABIERTO, type AccionObjeto } from '../../src/commands/objeto-acciones';
import type { EstadoBarra, NodoBarra } from '../../src/tree/acciones-modelo';
import { ProveedorAcciones } from '../../src/tree/acciones-proveedor';

interface EntradaMenu {
  command: string;
  when?: string;
  group?: string;
}

interface PaqueteJson {
  contributes: { views: Record<string, { id: string; name: string }[]>; menus: Record<string, EntradaMenu[]> };
}

const COMANDOS_NUEVOS = [
  'abapNavigator.objeto.ejecutar',
  'abapNavigator.objeto.documentacion',
  'abapNavigator.objeto.versiones',
  'abapNavigator.objeto.activarTodo',
  'abapNavigator.buscarTexto',
  'abapNavigator.dumps',
];

function leerPaquete(): PaqueteJson {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as PaqueteJson;
}

suite('Acciones: comandos nuevos', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('lenny.sextante')?.activate();
  });

  test('los comandos nuevos están registrados', async () => {
    const comandos = await vscode.commands.getCommands(true);
    for (const id of COMANDOS_NUEVOS) {
      assert.ok(comandos.includes(id), id);
    }
  });

  test('ejecutar y versiones sin objeto mostrado no ejecutan', async () => {
    const ejecutadas: string[] = [];
    const deps = {
      proveedor: { objeto: undefined, pertenece: () => false },
      ejecutar: async (a: AccionObjeto) => {
        ejecutadas.push(a.id);
      },
    };
    for (const id of ['ejecutar', 'versiones']) {
      const accion = ACCIONES_OBJETO.find((a) => a.id === id);
      assert.ok(accion, id);
      assert.deepStrictEqual(await lanzarAccion(accion, undefined, deps), {
        ejecutar: false,
        motivo: MSG_SIN_OBJETO_ABIERTO,
      });
    }
    assert.deepStrictEqual(ejecutadas, []);
  });
});

suite('Acciones: proveedor de la vista', () => {
  const crear = (estado: EstadoBarra): { proveedor: ProveedorAcciones; emisor: vscode.EventEmitter<unknown> } => {
    const emisor = new vscode.EventEmitter<unknown>();
    const proveedor = new ProveedorAcciones({
      objeto: () => estado.objeto,
      sistemaActivo: () => estado.sistemaActivo,
      onCambio: [emisor.event],
    });
    return { proveedor, emisor };
  };

  const accion = async (proveedor: ProveedorAcciones, id: string): Promise<NodoBarra> => {
    const grupos = await proveedor.getChildren();
    const nodo = grupos.flatMap((g) => g.hijos).find((n) => n.id === `accion:${id}`);
    assert.ok(nodo, id);
    return nodo;
  };

  test('getChildren devuelve los grupos expandidos y sus acciones', async () => {
    const { proveedor, emisor } = crear({});
    const grupos = await proveedor.getChildren();
    assert.deepStrictEqual(
      grupos.map((g) => g.etiqueta),
      ['Desarrollo', 'Transporte', 'Versiones', 'Herramientas'],
    );
    const item = proveedor.getTreeItem(grupos[0]);
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.strictEqual(item.iconPath, undefined);
    assert.deepStrictEqual(await proveedor.getChildren(grupos[0]), grupos[0].hijos);
    proveedor.dispose();
    emisor.dispose();
  });

  test('una acción habilitada lleva command; una deshabilitada no, y muestra el motivo', async () => {
    const { proveedor, emisor } = crear({
      objeto: { nombre: 'zcl_ejemplo', tipo: 'clase', protegido: true, rol: 'QAS', destino: 'DEST' },
    });
    const verificar = proveedor.getTreeItem(await accion(proveedor, 'verificar'));
    assert.deepStrictEqual(verificar.command, { command: 'abapNavigator.objeto.verificar', title: 'Verificar sintaxis' });
    assert.strictEqual(verificar.contextValue, 'accion');
    assert.strictEqual(verificar.tooltip, 'Verificar sintaxis');
    assert.strictEqual(verificar.description, undefined);
    assert.ok(verificar.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual(verificar.iconPath.id, 'check');
    assert.strictEqual(verificar.collapsibleState, vscode.TreeItemCollapsibleState.None);

    const activar = proveedor.getTreeItem(await accion(proveedor, 'activar'));
    assert.strictEqual(activar.command, undefined);
    assert.strictEqual(activar.description, 'Solo lectura (QAS)');
    assert.strictEqual(activar.contextValue, 'accionDeshabilitada');

    const activarTodo = proveedor.getTreeItem(await accion(proveedor, 'activarTodo'));
    assert.strictEqual(activarTodo.command, undefined);
    assert.strictEqual(activarTodo.description, 'Solo lectura (QAS)');
    assert.strictEqual(activarTodo.contextValue, 'accionDeshabilitada');
    proveedor.dispose();
    emisor.dispose();
  });

  test('Activar todo… va tras Activar y en DEV lleva su comando e icono', async () => {
    const { proveedor, emisor } = crear({
      objeto: { nombre: 'zprog_ejemplo', tipo: 'programa', protegido: false, rol: 'DEV', destino: 'DEST' },
    });
    const [desarrollo] = await proveedor.getChildren();
    assert.deepStrictEqual(
      desarrollo.hijos.slice(0, 2).map((n) => n.id),
      ['accion:activar', 'accion:activarTodo'],
    );
    const item = proveedor.getTreeItem(await accion(proveedor, 'activarTodo'));
    assert.strictEqual(item.label, 'Activar todo…');
    assert.deepStrictEqual(item.command, { command: 'abapNavigator.objeto.activarTodo', title: 'Activar todo…' });
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual(item.iconPath.id, 'run-all');
    proveedor.dispose();
    emisor.dispose();
  });

  test('estado() combina objeto y sistema activo', () => {
    const objeto: EstadoBarra['objeto'] = {
      nombre: 'zprog_ejemplo',
      tipo: 'programa',
      protegido: false,
      rol: 'DEV',
      destino: 'DEST',
    };
    const { proveedor, emisor } = crear({ objeto, sistemaActivo: 'DEST' });
    assert.deepStrictEqual(proveedor.estado(), { objeto, sistemaActivo: 'DEST' });
    proveedor.dispose();
    emisor.dispose();
  });

  test('al disparar onCambio se emite onDidChangeTreeData', () => {
    const { proveedor, emisor } = crear({});
    let avisos = 0;
    const suscripcion = proveedor.onDidChangeTreeData(() => {
      avisos += 1;
    });
    emisor.fire(undefined);
    proveedor.refrescar();
    assert.strictEqual(avisos, 2);
    suscripcion.dispose();
    proveedor.dispose();
    emisor.dispose();
  });
});

suite('Acciones: package.json', () => {
  test('la vista Acciones está entre Sistemas y Objeto', () => {
    const vistas = leerPaquete().contributes.views.abapNavigator;
    assert.deepStrictEqual(
      vistas.slice(0, 3).map((v) => v.id),
      ['abapNavigator.sistemas', 'abapNavigator.acciones', 'abapNavigator.objeto'],
    );
    assert.strictEqual(vistas[1].name, 'Acciones');
  });

  test('editor/title tiene los iconos de uso diario en abap, en el editor de bloque y en el diff de propuestas', () => {
    const todas = leerPaquete().contributes.menus['editor/title'];
    const editor = todas.filter((e) => e.command.startsWith('abapNavigator.objeto.'));
    const propuesta = 'resourceScheme == sextante-propuesta';
    assert.deepStrictEqual(
      todas.filter((e) => !e.command.startsWith('abapNavigator.objeto.')),
      [
        { command: 'abapNavigator.ia.aplicarPropuesta', when: propuesta, group: 'navigation@0' },
        { command: 'abapNavigator.ia.rechazarPropuesta', when: propuesta, group: 'navigation@1' },
      ],
    );
    const abap = 'resourceScheme == abap && resourceExtname == .abap && abapNavigator.objetoAbierto';
    const bloque = 'resourceScheme == abap-navigator-bloque && abapNavigator.objetoAbierto';
    const comunes = (base: string): EntradaMenu[] => [
      { command: 'abapNavigator.objeto.verificar', when: base, group: 'navigation@0' },
      { command: 'abapNavigator.objeto.atc', when: base, group: 'navigation@1' },
      { command: 'abapNavigator.objeto.unitTests', when: base, group: 'navigation@2' },
      { command: 'abapNavigator.objeto.activar', when: `${base} && !abapNavigator.objetoProtegido`, group: 'navigation@3' },
      { command: 'abapNavigator.objeto.activarTodo', when: `${base} && !abapNavigator.objetoProtegido`, group: 'navigation@4' },
    ];
    const ejecutar: EntradaMenu = {
      command: 'abapNavigator.objeto.ejecutar',
      when: `${abap} && abapNavigator.objetoTipo == programa`,
      group: 'navigation@5',
    };
    assert.deepStrictEqual(editor, [...comunes(abap), ejecutar, ...comunes(bloque)]);
    for (const entrada of editor) {
      assert.ok(entrada.when?.includes('abapNavigator.objetoAbierto'), entrada.command);
    }
  });

  test('view/item/context de la vista Actividad: Aplicar y Rechazar en línea solo en las propuestas pendientes', () => {
    const deIa = leerPaquete().contributes.menus['view/item/context'].filter((e) => e.when?.startsWith('view == abapNavigator.ia'));
    const pendiente = 'view == abapNavigator.ia && viewItem == propuestaPendiente';
    assert.deepStrictEqual(
      deIa.filter((e) => e.command.includes('Propuesta')),
      [
        { command: 'abapNavigator.ia.aplicarPropuesta', when: pendiente, group: 'inline@0' },
        { command: 'abapNavigator.ia.rechazarPropuesta', when: pendiente, group: 'inline@1' },
      ],
    );
  });

  test('view/title de Objeto conserva solo sus botones propios', () => {
    const titulo = leerPaquete().contributes.menus['view/title'];
    const deObjeto = titulo.filter((e) => e.when?.startsWith('view == abapNavigator.objeto')).map((e) => e.command);
    const quitados = ['verificar', 'atc', 'unitTests', 'activar', 'compararOtroSistema', 'compararUltima', 'transporte', 'copiarNombre'];
    for (const quitado of quitados) {
      assert.ok(!deObjeto.includes(`abapNavigator.objeto.${quitado}`), quitado);
    }
    for (const queda of ['refrescar', 'fijar', 'soltar', 'modoBloque.activar', 'modoBloque.desactivar']) {
      assert.ok(deObjeto.includes(`abapNavigator.objeto.${queda}`), queda);
    }
    assert.ok(!titulo.some((e) => e.when?.includes('view == abapNavigator.acciones')));
  });
});
