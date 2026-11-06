import assert from 'node:assert/strict';
import {
  MAX_ARCHIVOS_PROGRAMA,
  contarLineas,
  formatearPrograma,
  numerarLineas,
  rangoValido,
  recopilarPrograma,
} from '../../src/ia/lectura-modelo';

const RUTA_PROG = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap';
const RUTA_TOP = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Includes/ZPROG_EJEMPLO_TOP/zprog_ejemplo_top.prog.abap';
const RUTA_F01 = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Includes/ZPROG_EJEMPLO_F01/zprog_ejemplo_f01.prog.abap';

const textos: Record<string, string> = {
  [RUTA_PROG]: 'REPORT zprog_ejemplo.\nINCLUDE zprog_ejemplo_top.\nINCLUDE zprog_ejemplo_f01.',
  [RUTA_TOP]: 'DATA gv_x TYPE i.\nINCLUDE zprog_ejemplo_f01.',
  [RUTA_F01]: 'FORM calcular.\nENDFORM.',
};

function lector(leidas: string[], disponibles: Record<string, string> = textos) {
  return async (ruta: string): Promise<string | undefined> => {
    leidas.push(ruta);
    return disponibles[ruta];
  };
}

suite('lectura de programas: recopilar', () => {
  test('recopilarPrograma devuelve el origen primero y sus includes en anchura sin repetir', async () => {
    const archivos = await recopilarPrograma(RUTA_PROG, lector([]), true);
    assert.deepEqual(
      archivos.map((a) => a.ruta),
      [RUTA_PROG, RUTA_TOP, RUTA_F01],
    );
    assert.equal(archivos[2].texto, textos[RUTA_F01]);
  });

  test('un include no legible queda con motivo noLegible y no corta el resto', async () => {
    const sinTop = { ...textos };
    delete sinTop[RUTA_TOP];
    const archivos = await recopilarPrograma(RUTA_PROG, lector([], sinTop), true);
    assert.deepEqual(archivos, [
      { ruta: RUTA_PROG, texto: textos[RUTA_PROG] },
      { ruta: RUTA_TOP, motivo: 'noLegible' },
      { ruta: RUTA_F01, texto: textos[RUTA_F01] },
    ]);
  });

  test('incluirIncludes=false devuelve solo el origen', async () => {
    const leidas: string[] = [];
    const archivos = await recopilarPrograma(RUTA_PROG, lector(leidas), false);
    assert.equal(archivos.length, 1);
    assert.deepEqual(leidas, [RUTA_PROG]);
  });

  test('no lee más de MAX_ARCHIVOS_PROGRAMA archivos', async () => {
    const nombres = Array.from({ length: 60 }, (_, i) => `ZINC_${i}`);
    const disponibles: Record<string, string> = {
      [RUTA_PROG]: nombres.map((n) => `INCLUDE ${n}.`).join('\n'),
    };
    for (const n of nombres) {
      disponibles[RUTA_PROG.replace('Programs/ZPROG_EJEMPLO/zprog_ejemplo', `Includes/${n}/${n.toLowerCase()}`)] = 'DATA x TYPE i.';
    }
    const leidas: string[] = [];
    const archivos = await recopilarPrograma(RUTA_PROG, lector(leidas, disponibles), true);
    assert.equal(MAX_ARCHIVOS_PROGRAMA, 40);
    assert.equal(archivos.length, 40);
    assert.equal(leidas.length, 40);
  });
});

suite('lectura de programas: formato', () => {
  test('numerarLineas numera 1-based con ancho fijo y respeta CR+LF', () => {
    const texto = Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join('\r\n');
    assert.equal(numerarLineas(texto, 9, 12), ' 9| l9\n10| l10\n11| l11\n12| l12');
    assert.equal(numerarLineas('a\r\nb', 1, 2), '1| a\n2| b');
  });

  test('formatearPrograma pone cabecera por archivo, corta en maxLineasPorArchivo y dice cómo seguir', () => {
    const salida = formatearPrograma(
      [
        { ruta: '/a', texto: 'uno\ndos\ntres\ncuatro\ncinco' },
        { ruta: '/b', motivo: 'noLegible' },
        { ruta: '/c', texto: 'x' },
      ],
      { maxLineasPorArchivo: 3 },
    );
    assert.equal(
      salida,
      [
        '=== /a (5 líneas) ===',
        '1| uno',
        '2| dos',
        '3| tres',
        '… 2 líneas más: leer_archivo desde la 4',
        '',
        '=== /b === no se pudo leer',
        '',
        '=== /c (1 líneas) ===',
        '1| x',
      ].join('\n'),
    );
  });

  test('un salto de línea final no cuenta como línea; el texto vacío tiene 0 líneas', () => {
    assert.equal(contarLineas('a\nb\n'), 2);
    assert.equal(contarLineas('a\r\nb\r\n'), 2);
    assert.equal(contarLineas(''), 0);
    assert.equal(numerarLineas('a\nb\n', 1, 3), '1| a\n2| b');
    assert.equal(
      formatearPrograma([{ ruta: '/a', texto: 'a\nb\n' }, { ruta: '/v', texto: '' }], { maxLineasPorArchivo: 10 }),
      ['=== /a (2 líneas) ===', '1| a', '2| b', '', '=== /v (0 líneas) ==='].join('\n'),
    );
    assert.equal(rangoValido(1, 3, contarLineas('a\nb\n')).ok, false);
  });

  test('rangoValido rechaza desde>hasta, desde<1 y hasta>total con motivo', () => {
    assert.deepEqual(rangoValido(2, 5, 10), { ok: true, desde: 2, hasta: 5 });
    assert.deepEqual(rangoValido(0, 5, 10), { ok: false, motivo: 'desde (0) debe ser al menos 1' });
    assert.deepEqual(rangoValido(6, 5, 10), { ok: false, motivo: 'desde (6) es mayor que hasta (5)' });
    assert.deepEqual(rangoValido(1, 11, 10), { ok: false, motivo: 'hasta (11) supera el total de líneas (10)' });
  });
});
