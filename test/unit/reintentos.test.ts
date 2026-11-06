import assert from 'node:assert/strict';
import { conReintentos } from '../../src/util/reintentos';

function secuencia<T>(respuestas: T[][]): { fn: () => Promise<T[]>; llamadas: () => number } {
  let llamadas = 0;
  return {
    fn: async () => respuestas[Math.min(llamadas++, respuestas.length - 1)],
    llamadas: () => llamadas,
  };
}

suite('conReintentos', () => {
  test('reintenta mientras el listado venga vacío y devuelve el primero con entradas', async () => {
    const { fn, llamadas } = secuencia([[], [], ['a', 'b']]);
    const pausas: number[] = [];
    const reintentos: number[] = [];
    const resultado = await conReintentos(fn, {
      reintentos: 3,
      esperaMs: 1000,
      pausa: async (ms) => {
        pausas.push(ms);
      },
      alReintentar: (n) => reintentos.push(n),
    });
    assert.deepStrictEqual(resultado, ['a', 'b']);
    assert.strictEqual(llamadas(), 3);
    assert.deepStrictEqual(pausas, [1000, 1000]);
    assert.deepStrictEqual(reintentos, [1, 2]);
  });

  test('sin entradas tras agotar los reintentos devuelve vacío', async () => {
    const { fn, llamadas } = secuencia<string>([[]]);
    const resultado = await conReintentos(fn, { reintentos: 2, esperaMs: 5, pausa: async () => undefined });
    assert.deepStrictEqual(resultado, []);
    assert.strictEqual(llamadas(), 3);
  });

  test('con entradas a la primera no espera', async () => {
    const { fn, llamadas } = secuencia([['x']]);
    let pausas = 0;
    const resultado = await conReintentos(fn, {
      reintentos: 3,
      esperaMs: 1000,
      pausa: async () => {
        pausas++;
      },
    });
    assert.deepStrictEqual(resultado, ['x']);
    assert.strictEqual(llamadas(), 1);
    assert.strictEqual(pausas, 0);
  });

  test('un error no se reintenta: se propaga', async () => {
    let llamadas = 0;
    const fn = async (): Promise<string[]> => {
      llamadas++;
      throw new Error('fallo');
    };
    await assert.rejects(conReintentos(fn, { reintentos: 3, esperaMs: 0, pausa: async () => undefined }), /fallo/);
    assert.strictEqual(llamadas, 1);
  });
});
