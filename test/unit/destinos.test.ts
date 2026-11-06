import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analizarDestinos, ErrorDestinos, leerDestinos } from '../../src/config/destinos';

function leerFixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures', nombre), 'utf8');
}

suite('analizarDestinos', () => {
  test('analiza la fixture y mapea campos', () => {
    const destinos = analizarDestinos(leerFixture('destinations.anonimizado.json'));
    assert.strictEqual(destinos.length, 2);
    assert.deepStrictEqual(destinos[0], { id: 'DEV-X', protocolo: 'rfc', systemId: 'DEV',
      mandante: '100', idioma: 'ES', usuario: 'USUARIO', servidorAplicacion: 'host.local',
      numeroSistema: '00', ssoActivado: false, tipoSnc: '' });
    assert.strictEqual(destinos[1].ssoActivado, true);
  });
  test('lee sapRouterString como rutaRouter', () => {
    const json = JSON.stringify({ destinations: [{ id: 'DEST', protocol: 'rfc', properties: {
      systemId: 'DEV', applicationServer: 'host', systemNumber: '10', client: '100', sapRouterString: '/H/router' } }] });
    assert.strictEqual(analizarDestinos(json)[0].rutaRouter, '/H/router');
  });
  test('sapRouterString vacío deja rutaRouter sin definir', () => {
    for (const valor of ['', '   ']) {
      const json = JSON.stringify({ destinations: [{ id: 'DEST', protocol: 'rfc', properties: {
        systemId: 'DEV', applicationServer: 'host', systemNumber: '10', client: '100', sapRouterString: valor } }] });
      assert.strictEqual(analizarDestinos(json)[0].rutaRouter, undefined);
    }
  });
  test('JSON roto lanza ErrorDestinos', () => {
    assert.throws(() => analizarDestinos('{'), ErrorDestinos);
  });
  test('sin array destinations lanza ErrorDestinos', () => {
    assert.throws(() => analizarDestinos('{"formatVersion":"1"}'), ErrorDestinos);
  });
  test('destino sin id lanza ErrorDestinos con el índice', () => {
    assert.throws(() => analizarDestinos('{"destinations":[{"protocol":"rfc"}]}'), /índice 0/);
  });
  test('archivo inexistente lanza ErrorDestinos', () => {
    assert.throws(() => leerDestinos('C:/no/existe.json'), (e: unknown) => e instanceof ErrorDestinos && e.message.endsWith('(ENOENT)'));
  });
});
