import assert from 'node:assert/strict';
import { decidirProteccion } from '../../src/proteccion/proteccion-modelo';

const RUTA = '/repotree-v1/QAS-X/System Library/ZPAQ1/x.clas.abap';

suite('decidirProteccion', () => {
  test('uri abap de sistema QAS: proteger', () => {
    assert.deepStrictEqual(
      decidirProteccion({ scheme: 'abap', path: RUTA }, () => 'QAS'),
      { proteger: true, destino: 'QAS-X', rol: 'QAS' });
  });
  test('uri abap de sistema DEV: no proteger', () => {
    assert.deepStrictEqual(
      decidirProteccion({ scheme: 'abap', path: '/repotree-v1/DEV-X/ZPAQ1/x.clas.abap' }, () => 'DEV'),
      { proteger: false, destino: 'DEV-X', rol: 'DEV' });
  });
  test('uri abap sin rol: no proteger', () => {
    assert.deepStrictEqual(
      decidirProteccion({ scheme: 'abap', path: '/repotree-v1/X/ZPAQ1/x.clas.abap' }, () => undefined),
      { proteger: false, destino: 'X' });
  });
  test('uri file y uri ausente: no proteger sin destino', () => {
    assert.deepStrictEqual(decidirProteccion({ scheme: 'file', path: RUTA }, () => 'QAS'), { proteger: false });
    assert.deepStrictEqual(decidirProteccion(undefined, () => 'QAS'), { proteger: false });
  });
});
