import * as assert from 'node:assert/strict';
import { CacheTtl } from '../../src/util/cache-ttl';

function crear(): { cache: CacheTtl; reloj: { ahora: number } } {
  const reloj = { ahora: 1_000 };
  return { cache: new CacheTtl(() => reloj.ahora), reloj };
}

suite('cache-ttl', () => {
  test('dos obtener concurrentes con la misma clave calculan una sola vez', async () => {
    const { cache } = crear();
    let llamadas = 0;
    const calcular = async (): Promise<number> => { llamadas++; return 7; };
    const [a, b] = await Promise.all([cache.obtener('A|x', 100, calcular), cache.obtener('A|x', 100, calcular)]);
    assert.equal(a, 7);
    assert.equal(b, 7);
    assert.equal(llamadas, 1);
  });

  test('tras el ttl vuelve a calcular', async () => {
    const { cache, reloj } = crear();
    let llamadas = 0;
    const calcular = async (): Promise<number> => ++llamadas;
    assert.equal(await cache.obtener('A|x', 100, calcular), 1);
    reloj.ahora += 99;
    assert.equal(await cache.obtener('A|x', 100, calcular), 1);
    reloj.ahora += 1;
    assert.equal(await cache.obtener('A|x', 100, calcular), 2);
  });

  test('un rechazo no queda en caché', async () => {
    const { cache } = crear();
    let llamadas = 0;
    const calcular = async (): Promise<string> => {
      llamadas++;
      if (llamadas === 1) { throw new Error('caído'); }
      return 'bien';
    };
    await assert.rejects(cache.obtener('A|x', 100, calcular), /caído/);
    assert.equal(await cache.obtener('A|x', 100, calcular), 'bien');
    assert.equal(llamadas, 2);
  });

  test('un undefined resuelto sí queda en caché', async () => {
    const { cache } = crear();
    let llamadas = 0;
    const calcular = async (): Promise<undefined> => { llamadas++; return undefined; };
    await cache.obtener('A|x', 100, calcular);
    await cache.obtener('A|x', 100, calcular);
    assert.equal(llamadas, 1);
  });

  test('vaciar con prefijo borra solo esas claves; sin prefijo, todas', async () => {
    const { cache } = crear();
    const llamadas: string[] = [];
    const calcular = (clave: string) => async (): Promise<string> => { llamadas.push(clave); return clave; };
    for (const clave of ['A|1', 'A|2', 'AB|1', 'B|1']) {
      await cache.obtener(clave, 100, calcular(clave));
    }
    cache.vaciar('A|');
    for (const clave of ['A|1', 'A|2', 'AB|1', 'B|1']) {
      await cache.obtener(clave, 100, calcular(clave));
    }
    assert.deepEqual(llamadas.slice(4), ['A|1', 'A|2']);
    cache.vaciar();
    await cache.obtener('B|1', 100, calcular('B|1'));
    assert.deepEqual(llamadas.slice(6), ['B|1']);
  });
});
