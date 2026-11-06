import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

interface EntradaMenu {
  command: string;
  when?: string;
}

suite('Consola SQL y Ver datos', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('lenny.sextante')?.activate();
  });

  test('los tres comandos están registrados', async () => {
    const comandos = await vscode.commands.getCommands(true);
    for (const id of ['abapNavigator.sql.consola', 'abapNavigator.sql.verDatos', 'abapNavigator.paquetes.verDatos']) {
      assert.ok(comandos.includes(id), id);
    }
  });

  test('verDatos sin tabla activa devuelve sinTabla', async () => {
    const resultado = await vscode.commands.executeCommand('abapNavigator.sql.verDatos');
    assert.strictEqual(resultado, 'sinTabla');
  });

  test('package.json tiene los botones con su when exacto', () => {
    const paquete = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
      contributes: { menus: Record<string, EntradaMenu[]> };
    };
    const titulo = paquete.contributes.menus['view/title'];
    const whens = (comando: string): (string | undefined)[] =>
      titulo.filter((e) => e.command === comando).map((e) => e.when);
    const consola = whens('abapNavigator.sql.consola');
    assert.ok(consola.includes('view == abapNavigator.objeto'));
    assert.ok(consola.includes('view == abapNavigator.paquetes'));
    assert.deepStrictEqual(whens('abapNavigator.sql.verDatos'), [
      'view == abapNavigator.objeto && abapNavigator.objetoTipo == tabla',
    ]);
    const item = paquete.contributes.menus['view/item/context'].filter(
      (e) => e.command === 'abapNavigator.paquetes.verDatos',
    );
    assert.deepStrictEqual(item.map((e) => e.when), ['view == abapNavigator.paquetes && viewItem == objeto.tabla']);
  });
});
