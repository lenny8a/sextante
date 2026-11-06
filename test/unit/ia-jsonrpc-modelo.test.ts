import assert from 'node:assert/strict';
import { CODIGOS, analizarCuerpo, esPeticion, respuestaError, respuestaOk } from '../../src/ia/jsonrpc-modelo';

suite('IA: JSON-RPC', () => {
  test('un mensaje válido se analiza como petición; sin id es notificación', () => {
    const a = analizarCuerpo('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    assert.ok(a.ok && !a.lote && esPeticion(a.mensajes[0]) && a.mensajes[0].id === 1);
    const n = analizarCuerpo('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    assert.ok(n.ok && !esPeticion(n.mensajes[0]));
  });
  test('un lote devuelve varios mensajes y lote=true; un lote vacío es petición inválida', () => {
    const a = analizarCuerpo('[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"x"}]');
    assert.ok(a.ok && a.lote && a.mensajes.length === 2);
    const v = analizarCuerpo('[]');
    assert.ok(!v.ok && v.respuesta.error?.code === CODIGOS.peticionInvalida && v.respuesta.id === null);
  });
  test('JSON roto → -32700 con id null', () => {
    const a = analizarCuerpo('{nope');
    assert.ok(!a.ok && a.respuesta.error?.code === CODIGOS.parse);
  });
  test('sin jsonrpc 2.0, con id null o sin method → -32600', () => {
    for (const cuerpo of ['{"id":1,"method":"ping"}', '{"jsonrpc":"2.0","id":null,"method":"ping"}', '{"jsonrpc":"2.0","id":1}']) {
      const a = analizarCuerpo(cuerpo);
      assert.ok(!a.ok && a.respuesta.error?.code === CODIGOS.peticionInvalida, cuerpo);
    }
  });
  test('respuestaOk y respuestaError llevan jsonrpc 2.0 y el id', () => {
    assert.deepEqual(respuestaOk('a', { x: 1 }), { jsonrpc: '2.0', id: 'a', result: { x: 1 } });
    assert.deepEqual(respuestaError(null, -32601, 'no'), { jsonrpc: '2.0', id: null, error: { code: -32601, message: 'no' } });
  });
});
