import * as assert from 'node:assert/strict';
import type { RolSistema } from '../../src/config/navegador-config';
import { textoIndicador } from '../../src/indicador/indicador-modelo';

const uriAbap = { scheme: 'abap', path: '/repotree-v1/QAS-X/System Library/ZPAQ1' };

function rol(valor: RolSistema | undefined): (id: string) => RolSistema | undefined {
  return () => valor;
}

suite('textoIndicador', () => {
  test('QAS muestra advertencia', () => {
    assert.deepEqual(textoIndicador(uriAbap, rol('QAS')), {
      texto: '$(server) QAS-X · QAS',
      tooltip: 'Sistema del editor activo: QAS-X (QAS)',
      fondo: 'warning',
    });
  });

  test('PRD muestra error', () => {
    assert.equal(textoIndicador(uriAbap, rol('PRD'))?.fondo, 'error');
  });

  test('DEV no tiene fondo', () => {
    const t = textoIndicador(uriAbap, rol('DEV'));
    assert.equal(t?.texto, '$(server) QAS-X · DEV');
    assert.equal(t?.fondo, undefined);
  });

  test('sin rol indica rol sin definir', () => {
    const t = textoIndicador(uriAbap, rol(undefined));
    assert.equal(t?.texto, '$(server) QAS-X · rol sin definir');
    assert.equal(t?.fondo, undefined);
  });

  test('uri no abap o ausente devuelve undefined', () => {
    assert.equal(textoIndicador({ scheme: 'file', path: '/a/b' }, rol('DEV')), undefined);
    assert.equal(textoIndicador(undefined, rol('DEV')), undefined);
  });
});
