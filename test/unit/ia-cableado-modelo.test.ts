import assert from 'node:assert/strict';
import type { EstadoDestino } from '../../src/bridge/logon-oficial';
import {
  ESPERA_PUERTO_MS,
  INTENTOS_PUERTO,
  esperarLogonEnCurso,
  generarToken,
  sondear,
  tomarPuerto,
  type OpcionesSondeo,
} from '../../src/ia/cableado-modelo';

function errorDeCodigo(code: string): Error {
  return Object.assign(new Error(`fallo ${code}`), { code });
}

interface Falso {
  arrancar(p: number): Promise<number>;
  esperar(ms: number): Promise<void>;
  pedirCesion(): Promise<void>;
  /** Orden de las llamadas: `arrancar:<resultado>`, `esperar` o `ceder`. */
  traza: string[];
  puertos: number[];
  esperas: number[];
}

function falso(respuestas: (number | Error)[]): Falso {
  const puertos: number[] = [];
  const esperas: number[] = [];
  const traza: string[] = [];
  return {
    puertos,
    esperas,
    traza,
    arrancar(p) {
      puertos.push(p);
      const r = respuestas[puertos.length - 1] ?? errorDeCodigo('EADDRINUSE');
      traza.push(`arrancar:${r instanceof Error ? String((r as Error & { code?: unknown }).code) : r}`);
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    esperar(ms) {
      esperas.push(ms);
      traza.push('esperar');
      return Promise.resolve();
    },
    pedirCesion() {
      traza.push('ceder');
      return Promise.resolve();
    },
  };
}

function cesiones(f: Falso): number {
  return f.traza.filter((t) => t === 'ceder').length;
}

suite('ia cableado-modelo', () => {
  suite('tomarPuerto', () => {
    test('puerto siempre ocupado → ocupado tras INTENTOS_PUERTO intentos, con una sola petición de cesión', async () => {
      const f = falso([]);
      const r = await tomarPuerto(f.arrancar, 2237, () => true, f.esperar, f.pedirCesion);
      assert.equal(r, 'ocupado');
      assert.equal(INTENTOS_PUERTO, 6);
      assert.deepEqual(f.puertos, [2237, 2237, 2237, 2237, 2237, 2237]);
      assert.deepEqual(f.esperas, Array<number>(5).fill(ESPERA_PUERTO_MS));
      assert.equal(cesiones(f), 1);
    });

    test('éxito al tercer intento → devuelve el puerto y deja de reintentar', async () => {
      const f = falso([errorDeCodigo('EADDRINUSE'), errorDeCodigo('EADDRINUSE'), 2237]);
      const r = await tomarPuerto(f.arrancar, 2237, () => true, f.esperar, f.pedirCesion);
      assert.equal(r, 2237);
      assert.equal(f.puertos.length, 3);
      assert.deepEqual(f.esperas, [ESPERA_PUERTO_MS, ESPERA_PUERTO_MS]);
    });

    test('pide la cesión una sola vez, justo tras el primer EADDRINUSE', async () => {
      const f = falso([errorDeCodigo('EADDRINUSE'), errorDeCodigo('EADDRINUSE'), 2237]);
      await tomarPuerto(f.arrancar, 2237, () => true, f.esperar, f.pedirCesion);
      assert.deepEqual(f.traza, ['arrancar:EADDRINUSE', 'ceder', 'esperar', 'arrancar:EADDRINUSE', 'esperar', 'arrancar:2237']);
    });

    test('puerto libre al primer intento → no pide la cesión', async () => {
      const f = falso([2237]);
      assert.equal(await tomarPuerto(f.arrancar, 2237, () => true, f.esperar, f.pedirCesion), 2237);
      assert.equal(cesiones(f), 0);
    });

    test('perder el foco corta los reintentos → sinFoco', async () => {
      const f = falso([]);
      let foco = true;
      const esperar = async (ms: number): Promise<void> => {
        await f.esperar(ms);
        foco = false;
      };
      const r = await tomarPuerto(f.arrancar, 2237, () => foco, esperar, f.pedirCesion);
      assert.equal(r, 'sinFoco');
      assert.equal(f.puertos.length, 1);
    });

    test('sin foco desde el principio → sinFoco sin intentar ni pedir la cesión', async () => {
      const f = falso([2237]);
      const r = await tomarPuerto(f.arrancar, 2237, () => false, f.esperar, f.pedirCesion);
      assert.equal(r, 'sinFoco');
      assert.equal(f.puertos.length, 0);
      assert.equal(cesiones(f), 0);
    });

    test('un error distinto de EADDRINUSE se propaga sin reintentar ni pedir la cesión', async () => {
      const f = falso([errorDeCodigo('EACCES')]);
      await assert.rejects(tomarPuerto(f.arrancar, 2237, () => true, f.esperar, f.pedirCesion), /EACCES/);
      assert.equal(f.puertos.length, 1);
      assert.equal(f.esperas.length, 0);
      assert.equal(cesiones(f), 0);
    });
  });

  suite('generarToken', () => {
    test('64 caracteres hexadecimales', () => {
      assert.match(generarToken(), /^[0-9a-f]{64}$/);
    });

    test('distinto en cada llamada', () => {
      assert.notEqual(generarToken(), generarToken());
    });
  });

  suite('sondear', () => {
    const reloj = (intervaloMs: number, limiteMs: number): OpcionesSondeo & { esperas: number[] } => {
      let t = 0;
      const esperas: number[] = [];
      return {
        intervaloMs,
        limiteMs,
        esperas,
        ahora: () => t,
        esperar: async (ms) => {
          esperas.push(ms);
          t += ms;
        },
      };
    };

    test('true a la primera no espera', async () => {
      const r = reloj(250, 3000);
      assert.equal(await sondear(() => true, r), true);
      assert.deepEqual(r.esperas, []);
    });

    test('espera de intervalo en intervalo hasta que se cumple', async () => {
      const r = reloj(250, 3000);
      let vueltas = 0;
      assert.equal(await sondear(() => ++vueltas === 3, r), true);
      assert.deepEqual(r.esperas, [250, 250]);
    });

    test('se rinde al agotar el plazo y la última espera no lo pasa', async () => {
      const r = reloj(400, 1000);
      assert.equal(await sondear(async () => false, r), false);
      assert.deepEqual(r.esperas, [400, 400, 200]);
    });
  });

  suite('esperarLogonEnCurso', () => {
    const opciones = (): OpcionesSondeo & { esperas: number[] } => {
      let t = 0;
      const esperas: number[] = [];
      return {
        intervaloMs: 500,
        limiteMs: 60_000,
        esperas,
        ahora: () => t,
        esperar: async (ms) => {
          esperas.push(ms);
          t += ms;
        },
      };
    };

    test('sondea en silencio cada 500 ms hasta que el destino queda conectado', async () => {
      const estados: EstadoDestino[] = ['desconectado', 'desconectado', 'conectado'];
      const silencios: boolean[] = [];
      const o = opciones();
      const deps = {
        estaConectando: () => true,
        estadoDe: async (_id: string, silencioso: boolean): Promise<EstadoDestino> => {
          silencios.push(silencioso);
          return estados.shift() ?? 'conectado';
        },
      };
      assert.equal(await esperarLogonEnCurso('DEST', deps, o), true);
      assert.deepEqual(o.esperas, [500, 500]);
      assert.deepEqual(silencios, [true, true, true]);
    });

    test('termina en cuanto el logon en curso acaba aunque no conectara (cancelado o fallido)', async () => {
      let enCurso = 2;
      const o = opciones();
      const deps = { estaConectando: () => enCurso-- > 0, estadoDe: async (): Promise<EstadoDestino> => 'desconectado' };
      assert.equal(await esperarLogonEnCurso('DEST', deps, o), true);
      assert.deepEqual(o.esperas, [500, 500]);
    });

    test('con el logon aún en curso al agotar el plazo devuelve false', async () => {
      const o = opciones();
      const deps = { estaConectando: () => true, estadoDe: async (): Promise<EstadoDestino> => 'desconectado' };
      assert.equal(await esperarLogonEnCurso('DEST', deps, o), false);
      assert.equal(o.esperas.reduce((a, b) => a + b, 0), 60_000);
    });
  });
});
