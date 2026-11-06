import * as assert from 'assert';
import * as vscode from 'vscode';
import { Credenciales, PREFIJO_SECRETO } from '../../src/adt/credenciales';
import type { ApiDePrueba } from '../../src/extension';

const ID = 'DEST_PRUEBA_CREDENCIALES';

suite('Credenciales sobre SecretStorage', () => {
  let secretos: vscode.SecretStorage;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<ApiDePrueba | undefined>('lenny.sextante');
    assert.ok(ext, 'extensión no encontrada');
    const api = await ext.activate();
    assert.ok(api, 'la extensión no expone el contexto en modo de pruebas');
    secretos = api.contextoDePrueba.secrets;
    await secretos.delete(`${PREFIJO_SECRETO}${ID}`);
  });

  suiteTeardown(async () => {
    await secretos.delete(`${PREFIJO_SECRETO}${ID}`);
  });

  test('pide una vez, la segunda no pide y olvidar vuelve a pedir', async () => {
    const pedidas: Array<[string, string]> = [];
    const credenciales = new Credenciales(secretos, async (destino, usuario) => {
      pedidas.push([destino, usuario]);
      return `secreto-${pedidas.length}`;
    });

    assert.strictEqual(await credenciales.obtener(ID, 'USUARIO'), 'secreto-1');
    assert.strictEqual(await secretos.get(`${PREFIJO_SECRETO}${ID}`), 'secreto-1');
    assert.strictEqual(await credenciales.obtener(ID, 'USUARIO'), 'secreto-1');
    assert.deepStrictEqual(pedidas, [[ID, 'USUARIO']]);

    await credenciales.olvidar(ID);
    assert.strictEqual(await secretos.get(`${PREFIJO_SECRETO}${ID}`), undefined);
    assert.strictEqual(await credenciales.obtener(ID, 'USUARIO'), 'secreto-2');
    assert.strictEqual(pedidas.length, 2);
  });
});
