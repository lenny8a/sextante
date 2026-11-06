import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analizarDestinos } from '../../src/config/destinos';
import { configVacia, conRol } from '../../src/config/navegador-config';
import { construirNodosSistemas, descripcionDe, opcionesConectar } from '../../src/tree/sistemas-modelo';

function leerFixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures', nombre), 'utf8');
}

suite('modelo de nodos de sistemas', () => {
  const destinos = analizarDestinos(leerFixture('destinations.anonimizado.json'));
  const cfg = conRol(configVacia(), 'QAS-X', 'QAS');

  test('activo primero y luego alfabético', () => {
    const nodos = construirNodosSistemas(destinos, cfg, {}, 'QAS-X');
    assert.deepStrictEqual(nodos.map((n) => n.id), ['QAS-X', 'DEV-X']);
  });

  test('descripción con rol y sin rol', () => {
    const conDev = construirNodosSistemas(destinos, conRol(configVacia(), 'DEV-X', 'DEV'), {});
    assert.strictEqual(conDev[0].id, 'DEV-X');
    assert.strictEqual(conDev[0].descripcion, 'DEV · 100 · USUARIO · DEV');
    assert.strictEqual(conDev[1].descripcion, 'QAS · 200 · OTRO · rol sin definir');
  });

  test('descripcionDe añade la vía resuelta: RFC, REST, búsqueda oficial o nada', () => {
    const destino = destinos.find((d) => d.id === 'DEV-X');
    assert.ok(destino);
    assert.strictEqual(descripcionDe(destino, 'DEV', 'rfc'), 'DEV · 100 · USUARIO · DEV · RFC');
    assert.strictEqual(descripcionDe(destino, 'DEV', 'http'), 'DEV · 100 · USUARIO · DEV · REST');
    assert.strictEqual(descripcionDe(destino, undefined, 'oficial'), 'DEV · 100 · USUARIO · rol sin definir · búsqueda oficial');
    assert.strictEqual(descripcionDe(destino, 'DEV', undefined), 'DEV · 100 · USUARIO · DEV');
  });

  test('los nodos llevan la vía que devuelve viaDe para cada destino', () => {
    const vias: Record<string, 'rfc' | 'http' | 'oficial'> = { 'DEV-X': 'rfc', 'QAS-X': 'oficial' };
    const nodos = construirNodosSistemas(destinos, conRol(configVacia(), 'DEV-X', 'DEV'), {}, undefined, (id) => vias[id]);
    assert.strictEqual(nodos[0].descripcion, 'DEV · 100 · USUARIO · DEV · RFC');
    assert.strictEqual(nodos[1].descripcion, 'QAS · 200 · OTRO · rol sin definir · búsqueda oficial');
  });

  test('conserva el systemId del destino', () => {
    const nodos = construirNodosSistemas(destinos, cfg, {});
    assert.strictEqual(nodos.find((n) => n.id === 'QAS-X')?.systemId, 'QAS');
  });

  test('protegido solo con QAS/PRD', () => {
    const nodos = construirNodosSistemas(destinos, cfg, {});
    assert.strictEqual(nodos.find((n) => n.id === 'QAS-X')?.protegido, true);
    assert.strictEqual(nodos.find((n) => n.id === 'DEV-X')?.protegido, false);
  });

  test('estado por defecto desconocido', () => {
    assert.strictEqual(construirNodosSistemas(destinos, cfg, { 'DEV-X': 'conectado' })[1].estado, 'desconocido');
  });

  test('activo marcado', () => {
    assert.strictEqual(construirNodosSistemas(destinos, cfg, {}, 'DEV-X')[0].activo, true);
  });
});

suite('opciones del comando conectar', () => {
  test('marca el sistema activo salvo que se pida explícitamente lo contrario', () => {
    assert.deepStrictEqual(opcionesConectar(undefined), { marcarActivo: true });
    assert.deepStrictEqual(opcionesConectar([]), { marcarActivo: true });
    assert.deepStrictEqual(opcionesConectar({ marcarActivo: true }), { marcarActivo: true });
    assert.deepStrictEqual(opcionesConectar({ marcarActivo: 'no' }), { marcarActivo: true });
    assert.deepStrictEqual(opcionesConectar({ marcarActivo: false }), { marcarActivo: false });
  });
});
