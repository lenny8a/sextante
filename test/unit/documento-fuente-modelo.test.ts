import assert from 'node:assert/strict';
import { ESQUEMA_FUENTE, analizarUriFuente, partesUriFuente, textoError, type ClaveFuente } from '../../src/objeto/documento-fuente-modelo';

const CLAVE: ClaveFuente = {
  destino: 'DEV-A',
  ruta: '/sap/bc/adt/oo/classes/z%2fejemplo/includes/main',
  nombre: 'Z_EJEMPLO_1',
  extension: 'abap',
  etiqueta: 'clase-main',
};

suite('documento-fuente-modelo', () => {
  test('ida y vuelta de la URI conserva la clave', () => {
    assert.deepEqual(analizarUriFuente(partesUriFuente(CLAVE)), CLAVE);
    const activa: ClaveFuente = { ...CLAVE, version: 'active' };
    assert.deepEqual(analizarUriFuente(partesUriFuente(activa)), activa);
  });

  test('la ruta legible lleva etiqueta, nombre y extensión; destino y ruta van codificados', () => {
    const partes = partesUriFuente(CLAVE);
    assert.equal(partes.scheme, ESQUEMA_FUENTE);
    assert.equal(partes.path, '/clase-main/Z_EJEMPLO_1.abap');
    assert.equal(partes.query, `d=DEV-A&r=${encodeURIComponent(CLAVE.ruta)}`);
    assert.equal(partesUriFuente({ ...CLAVE, version: 'active' }).query.endsWith('&v=active'), true);
  });

  test('otro esquema no se analiza', () => {
    assert.equal(analizarUriFuente({ scheme: 'file', path: '/clase-main/Z_EJEMPLO_1.abap', query: 'd=DEV-A&r=x' }), undefined);
  });

  test('sin destino o ruta no se analiza', () => {
    assert.equal(analizarUriFuente({ scheme: ESQUEMA_FUENTE, path: '/a/B.abap', query: 'd=DEV-A' }), undefined);
  });

  test('textoError nombra el objeto, el sistema y el motivo', () => {
    assert.equal(textoError(CLAVE, 'no existe'), '* No se pudo leer Z_EJEMPLO_1 de DEV-A (no existe)');
  });
});
