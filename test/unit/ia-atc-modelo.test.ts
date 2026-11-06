import assert from 'node:assert/strict';
import {
  INDICACION_EN_CURSO,
  INDICACION_LIMPIO_SIN_SENAL,
  INDICACION_SIN_CONFIRMAR,
  MAX_HALLAZGOS_ATC,
  VIGENCIA_RESULTADO_ATC_MS,
  ordenarHallazgos,
  pasadaVigente,
  respuestaDeResultado,
  respuestaEnCurso,
  type HallazgoAtc,
} from '../../src/ia/atc-modelo';

function hallazgo(prioridad: HallazgoAtc['prioridad'], uri: string, linea: number): HallazgoAtc {
  return { uri, linea, prioridad, mensaje: 'm' };
}

suite('IA: atc-modelo', () => {
  test('ordena por prioridad, luego uri, luego línea', () => {
    const orden = ordenarHallazgos([
      hallazgo('info', 'a', 1),
      hallazgo('aviso', 'b', 5),
      hallazgo('error', 'b', 9),
      hallazgo('error', 'a', 20),
      hallazgo('error', 'a', 3),
    ]).map((h) => `${h.prioridad}${h.uri}${h.linea}`);
    assert.deepEqual(orden, ['errora3', 'errora20', 'errorb9', 'avisob5', 'infoa1']);
  });

  test('con hallazgos y señal: estado con hallazgos, contadores, sin indicación', () => {
    const r = respuestaDeResultado({ huboSenal: true, hallazgos: [hallazgo('error', 'a', 1), hallazgo('aviso', 'a', 2), hallazgo('aviso', 'a', 3)] });
    assert.equal(r.estado, 'con hallazgos');
    assert.equal(r.total, 3);
    assert.equal(r.errores, 1);
    assert.equal(r.avisos, 2);
    assert.equal(r.infos, 0);
    assert.equal(r.indicacion, undefined);
    assert.equal(r.truncado, undefined);
  });

  test('con hallazgos y sin señal: sin confirmar con indicación', () => {
    const r = respuestaDeResultado({ huboSenal: false, hallazgos: [hallazgo('error', 'a', 1)] });
    assert.equal(r.estado, 'sin confirmar');
    assert.equal(r.indicacion, INDICACION_SIN_CONFIRMAR);
  });

  test('sin hallazgos: con señal sin indicación, sin señal con indicación', () => {
    const con = respuestaDeResultado({ huboSenal: true, hallazgos: [] });
    assert.equal(con.estado, 'sin hallazgos');
    assert.equal(con.indicacion, undefined);
    const sin = respuestaDeResultado({ huboSenal: false, hallazgos: [] });
    assert.equal(sin.estado, 'sin hallazgos');
    assert.equal(sin.indicacion, INDICACION_LIMPIO_SIN_SENAL);
  });

  test('en curso: sin hallazgos ni contadores', () => {
    assert.deepEqual(respuestaEnCurso(), { estado: 'en curso', indicacion: INDICACION_EN_CURSO });
  });

  test('recorta a MAX_HALLAZGOS_ATC y los contadores cuentan todos', () => {
    const muchos = Array.from({ length: MAX_HALLAZGOS_ATC + 50 }, (_, i) => hallazgo(i < 10 ? 'error' : 'info', 'a', i + 1));
    const r = respuestaDeResultado({ huboSenal: true, hallazgos: muchos });
    assert.equal(r.hallazgos?.length, MAX_HALLAZGOS_ATC);
    assert.equal(r.truncado, true);
    assert.equal(r.total, MAX_HALLAZGOS_ATC + 50);
    assert.equal(r.errores, 10);
    assert.equal(r.infos, MAX_HALLAZGOS_ATC + 40);
    assert.equal(r.hallazgos?.[0]?.prioridad, 'error');
  });

  test('vigencia de una pasada', () => {
    assert.ok(pasadaVigente(1000, 1000 + VIGENCIA_RESULTADO_ATC_MS - 1));
    assert.ok(!pasadaVigente(1000, 1000 + VIGENCIA_RESULTADO_ATC_MS));
  });
});
