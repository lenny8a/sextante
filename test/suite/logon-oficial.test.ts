import * as assert from 'assert';
import { ejecutarComandoOficial, MENSAJE_OFICIAL_NO_INSTALADA } from '../../src/bridge/extension-oficial';
import { conectarDestino, estadoConexion, uriRaizDestino } from '../../src/bridge/logon-oficial';

suite('Logon con la extensión oficial', () => {
  test('uriRaizDestino codifica el id', () => {
    assert.strictEqual(uriRaizDestino('A B').toString(), 'abap:/repotree-v1/A%20B');
    assert.strictEqual(uriRaizDestino('A#B').toString(), 'abap:/repotree-v1/A%23B');
    assert.strictEqual(uriRaizDestino('A%B').toString(), 'abap:/repotree-v1/A%25B');
  });

  test('sin proveedor abap el estado es desconocido', async () => {
    assert.strictEqual(await estadoConexion('DEST', 2000), 'desconocido');
  });

  test('sin la oficial conectarDestino devuelve error sin lanzar', async () => {
    const r = await conectarDestino('DEST', { timeoutMs: 1000, intervaloMs: 100 });
    assert.strictEqual(r.estado, 'error');
    assert.ok(r.error);
    assert.strictEqual(r.error, MENSAJE_OFICIAL_NO_INSTALADA);
  });

  test('ejecutarComandoOficial sin la oficial falla con un texto claro, no con command not found', async () => {
    await assert.rejects(ejecutarComandoOficial('adt-vscode.logonToDestination'), (err: unknown) => {
      return err instanceof Error && err.message === MENSAJE_OFICIAL_NO_INSTALADA;
    });
  });

  test('sin la oficial conectarDestino responde rápido aunque el timeout sea largo', async () => {
    const inicio = Date.now();
    const r = await conectarDestino('DEST', { timeoutMs: 180_000 });
    assert.strictEqual(r.estado, 'error');
    assert.ok(Date.now() - inicio < 2000);
  });

  test('estadoConexion con timeout corto resuelve desconocido', async () => {
    assert.strictEqual(await estadoConexion('DEST', 50), 'desconocido');
  });
});
