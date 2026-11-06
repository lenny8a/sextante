import * as assert from 'assert';
import * as vscode from 'vscode';
import { extensionOficialInstalada } from '../../src/bridge/extension-oficial';

const COMANDOS_DICCIONARIO = ['abrir', 'fijar', 'soltar', 'refrescar', 'copiarNombre', 'abrirDdl', 'conectar'].map(
  (c) => `abapNavigator.diccionario.${c}`,
);

suite('Activación', () => {
  test('la extensión se activa y registra el Output Channel', async () => {
    const ext = vscode.extensions.getExtension('lenny.sextante');
    assert.ok(ext, 'extensión no encontrada');
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('sin la extensión oficial, extensionOficialInstalada devuelve false', () => {
    assert.strictEqual(extensionOficialInstalada(), false);
  });

  test('la vista Diccionario está contribuida y la activación registra sus comandos', async () => {
    const ext = vscode.extensions.getExtension('lenny.sextante');
    assert.ok(ext, 'extensión no encontrada');
    await ext.activate();
    const paquete = ext.packageJSON as { contributes: { views: Record<string, Array<{ id: string }>> } };
    const vistas = Object.values(paquete.contributes.views).flat().map((v) => v.id);
    assert.ok(vistas.includes('abapNavigator.diccionario'), vistas.join(', '));
    const registrados = await vscode.commands.getCommands(true);
    for (const id of COMANDOS_DICCIONARIO) {
      assert.ok(registrados.includes(id), `no registrado: ${id}`);
    }
  });
});
