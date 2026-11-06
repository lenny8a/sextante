import assert from 'node:assert/strict';
import type { Destino } from '../../src/config/destinos';
import type { PiezaFuente } from '../../src/adt/fuente-adt';
import {
  candidatosConGuardados,
  consolidar,
  familiaDe,
  nuevosDeLaFamilia,
  hermanosPropuestos,
  ordenarPorRol,
  piezaParaDiff,
  resumenDe,
  tituloComparacion,
  type EstadoPieza,
  type PiezaComparada,
  type ResultadoSistema,
} from '../../src/objeto/comparar-sistemas-modelo';

function destino(id: string, rutaRouter?: string): Destino {
  return { id, protocolo: 'rfc', ssoActivado: false, ...(rutaRouter === undefined ? {} : { rutaRouter }) };
}

function pieza(estado: EstadoPieza, include?: PiezaFuente['include'], lineas = 3): PiezaComparada {
  const base: PiezaFuente = {
    tipo: 'clase',
    nombre: 'ZCL_EJEMPLO',
    etiqueta: include ?? 'ZCL_EJEMPLO',
    rutaFuente: `/r/${include ?? 'x'}`,
    rutaVersiones: `/r/${include ?? 'x'}/versions`,
  };
  if (include !== undefined) {
    base.include = include;
  }
  return { pieza: base, estado, lineas };
}

function resultado(partes: Partial<ResultadoSistema> & { piezas: PiezaComparada[] }): ResultadoSistema {
  return { destino: 'QAS-A', estado: consolidar(partes.piezas), soloArchivo: false, ...partes };
}

suite('comparar sistemas: modelo', () => {
  test('familiaDe quita el token de rol', () => {
    assert.equal(familiaDe('DEV-A'), 'A');
    assert.equal(familiaDe('A_QAS'), 'A');
    assert.equal(familiaDe('dev a'), 'A');
    assert.equal(familiaDe('PRD'), 'PRD');
    assert.equal(familiaDe('CLIE'), 'CLIE');
    assert.equal(familiaDe('X'), 'X');
  });

  test('hermanosPropuestos propone misma familia o mismo router y omite el actual', () => {
    const actual = destino('DEV-A', '/H/router/S/3299');
    const otros = [destino('DEV-A'), destino('QAS-A'), destino('DEV-B'), destino('X', '/H/router/S/3299'), destino('Y', '')];
    const resultado = hermanosPropuestos(actual, otros);
    assert.deepEqual(
      resultado.map((c) => [c.destino.id, c.propuesto]).sort(),
      [['DEV-B', false], ['QAS-A', true], ['X', true], ['Y', false]],
    );
    assert.ok(!resultado.some((c) => c.destino.id === 'DEV-A'));
  });

  test('un rutaRouter vacío no hace hermanos', () => {
    const r = hermanosPropuestos(destino('P', ''), [destino('Q', '')]);
    assert.equal(r[0].propuesto, false);
  });

  test('ordenarPorRol: DEV, QAS, PRD, sin rol y alfabético', () => {
    const roles: Record<string, 'DEV' | 'QAS' | 'PRD'> = { A: 'PRD', B: 'DEV', C: 'QAS', D: 'DEV' };
    assert.deepEqual(ordenarPorRol(['Z', 'A', 'D', 'C', 'B'], (id) => roles[id]), ['B', 'D', 'C', 'A', 'Z']);
  });

  test('consolidar', () => {
    assert.equal(consolidar([pieza('igual')]), 'igual');
    assert.equal(consolidar([pieza('igual'), pieza('distinto')]), 'distinto');
    assert.equal(consolidar([pieza('noExiste'), pieza('noExiste')]), 'noExiste');
    assert.equal(consolidar([pieza('soloAlli')]), 'distinto');
    assert.equal(consolidar([pieza('soloAqui'), pieza('igual')]), 'distinto');
  });

  test('resumenDe cubre cada estado', () => {
    assert.deepEqual(resumenDe(resultado({ piezas: [pieza('igual')] })), { icono: 'check', texto: 'igual' });
    assert.deepEqual(resumenDe(resultado({ piezas: [pieza('distinto', undefined, 7)] })), { icono: 'diff', texto: 'distinto (~7 líneas)' });
    assert.deepEqual(
      resumenDe(resultado({ piezas: [pieza('igual', 'main'), pieza('distinto', 'implementations'), pieza('distinto', 'macros')] })),
      { icono: 'diff', texto: 'distinto (implementations, macros)' },
    );
    assert.deepEqual(resumenDe(resultado({ piezas: [], estado: 'noExiste' })), { icono: 'circle-slash', texto: 'no existe' });
    assert.deepEqual(resumenDe(resultado({ piezas: [], estado: 'sinConexion', motivo: 'el destino usa SSO' })), {
      icono: 'debug-disconnect',
      texto: 'sin conexión: el destino usa SSO',
    });
    assert.deepEqual(resumenDe(resultado({ piezas: [], estado: 'error', motivo: 'HTTP 500' })), { icono: 'warning', texto: 'error: HTTP 500' });
  });

  test('resumenDe con soloArchivo añade el sufijo', () => {
    assert.equal(resumenDe(resultado({ piezas: [pieza('igual')], soloArchivo: true })).texto, 'igual · solo este módulo');
  });

  test('piezaParaDiff prefiere el include abierto si no es igual, si no la primera no igual, si no la primera', () => {
    const piezas = [pieza('igual', 'main'), pieza('distinto', 'implementations'), pieza('distinto', 'macros')];
    assert.equal(piezaParaDiff(resultado({ piezas }), 'macros')?.pieza.include, 'macros');
    assert.equal(piezaParaDiff(resultado({ piezas }), 'main')?.pieza.include, 'implementations');
    assert.equal(piezaParaDiff(resultado({ piezas }))?.pieza.include, 'implementations');
    const iguales = [pieza('igual', 'main'), pieza('igual', 'macros')];
    assert.equal(piezaParaDiff(resultado({ piezas: iguales }), 'macros')?.pieza.include, 'main');
    assert.equal(piezaParaDiff(resultado({ piezas: [] })), undefined);
  });

  test('tituloComparacion', () => {
    assert.equal(tituloComparacion('ZCL_X', 'PRD-A', 'DEV-A'), 'ZCL_X: PRD-A ↔ DEV-A');
  });

  test('candidatosConGuardados preselecciona los guardados; sin guardados deja la propuesta por familia', () => {
    const candidatos = hermanosPropuestos(destino('DEV-A'), [destino('DEV-A'), destino('QAS-A'), destino('PRD-A'), destino('DEV-B')]);
    const conGuardados = candidatosConGuardados(candidatos, ['QAS-A']);
    assert.deepEqual(
      conGuardados.map((c) => [c.destino.id, c.propuesto]),
      [['QAS-A', true], ['PRD-A', false], ['DEV-B', false]],
    );
    assert.deepEqual(candidatosConGuardados(candidatos, []), candidatos);
  });

  test('nuevosDeLaFamilia: los propuestos (familia o router) que no están guardados', () => {
    const candidatos = hermanosPropuestos(destino('DEV-A', '/H/r/'), [
      destino('QAS-A'),
      destino('PRD-A'),
      destino('DEV-B'),
      destino('OTRO', '/H/r/'),
    ]);
    assert.deepEqual(nuevosDeLaFamilia(candidatos, ['QAS-A']), ['PRD-A', 'OTRO']);
    assert.deepEqual(nuevosDeLaFamilia(candidatos, ['QAS-A', 'PRD-A', 'OTRO']), []);
  });
});
