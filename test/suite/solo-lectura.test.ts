import * as assert from 'assert';
import * as vscode from 'vscode';
import { decidirProteccion } from '../../src/proteccion/proteccion-modelo';
import { COMANDO_SOLO_LECTURA_SESION } from '../../src/proteccion/comandos-solo-lectura';

suite('Solo lectura', () => {
  test('con un documento untitled no se aplica protección y el comando de solo lectura existe', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'x' });
    const editor = await vscode.window.showTextDocument(doc);
    assert.ok((await vscode.commands.getCommands(true)).includes(COMANDO_SOLO_LECTURA_SESION));
    assert.deepStrictEqual(decidirProteccion(editor.document.uri, () => 'PRD'), { proteger: false });
  });
});
