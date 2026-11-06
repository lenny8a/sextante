import * as assert from 'assert';
import { decidirAviso, decidirColoresPropios } from '../../src/commands/tema-modelo';

suite('decidirColoresPropios', () => {
  test('con el override en false (propios activos) lo quita', () => {
    const r = decidirColoresPropios(false);
    assert.strictEqual(r.nuevoValor, undefined);
    assert.match(r.mensaje, /desactivados/);
  });

  for (const actual of [undefined, true]) {
    test(`con valor actual ${String(actual)} escribe false`, () => {
      const r = decidirColoresPropios(actual);
      assert.strictEqual(r.nuevoValor, false);
      assert.match(r.mensaje, /activados en tus ajustes de usuario/);
    });
  }
});

suite('decidirAviso', () => {
  const TEMA = 'Sextante Oscuro';
  const casos: { tema: string | undefined; override: boolean | undefined; avisado: boolean; esperado: boolean }[] = [
    { tema: TEMA, override: undefined, avisado: false, esperado: true },
    { tema: TEMA, override: true, avisado: false, esperado: true },
    { tema: TEMA, override: false, avisado: false, esperado: false },
    { tema: TEMA, override: undefined, avisado: true, esperado: false },
    { tema: 'Default Dark Modern', override: undefined, avisado: false, esperado: false },
    { tema: undefined, override: undefined, avisado: false, esperado: false },
  ];

  for (const c of casos) {
    test(`tema ${String(c.tema)}, override ${String(c.override)}, avisado ${String(c.avisado)} → ${String(c.esperado)}`, () => {
      assert.strictEqual(decidirAviso(c.tema, c.override, c.avisado), c.esperado);
    });
  }
});
