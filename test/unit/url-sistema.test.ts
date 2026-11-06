import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { candidatosUrl, deducirUrl, restDisponible } from '../../src/adt/url-sistema';
import { analizarDestinos, Destino } from '../../src/config/destinos';

function destino(extra: Partial<Destino> = {}): Destino {
  return { id: 'DEST', protocolo: 'rfc', servidorAplicacion: 'host.local', numeroSistema: '00', ssoActivado: false, ...extra };
}

suite('url del sistema', () => {
  test('restDisponible rechaza SSO, SNC y destinos sin servidor', () => {
    assert.deepStrictEqual(restDisponible(destino({ ssoActivado: true })), { disponible: false, motivo: 'sso' });
    assert.deepStrictEqual(restDisponible(destino({ tipoSnc: 'snc' })), { disponible: false, motivo: 'snc' });
    assert.deepStrictEqual(restDisponible(destino({ tipoSnc: '1' })), { disponible: false, motivo: 'snc' });
    assert.deepStrictEqual(restDisponible(destino({ servidorAplicacion: undefined })), { disponible: false, motivo: 'sinServidor' });
    assert.deepStrictEqual(restDisponible(destino({ numeroSistema: undefined })), { disponible: false, motivo: 'sinServidor' });
    assert.deepStrictEqual(restDisponible(destino({ numeroSistema: 'abc' })), { disponible: false, motivo: 'sinServidor' });
  });

  test("restDisponible trata sncType '0' o vacío como sin SNC", () => {
    assert.deepStrictEqual(restDisponible(destino({ tipoSnc: '0' })), { disponible: true });
    assert.deepStrictEqual(restDisponible(destino({ tipoSnc: ' 0 ' })), { disponible: true });
    assert.deepStrictEqual(restDisponible(destino({ tipoSnc: '' })), { disponible: true });
  });

  test('restDisponible acepta el destino DEV-X de la fixture', () => {
    const ruta = path.resolve(__dirname, '../../../test/fixtures/destinations.anonimizado.json');
    const dev = analizarDestinos(fs.readFileSync(ruta, 'utf8')).find((d) => d.id === 'DEV-X');
    assert.ok(dev);
    assert.deepStrictEqual(restDisponible(dev), { disponible: true });
  });

  test('candidatosUrl compone puertos a partir del número de sistema', () => {
    assert.deepStrictEqual(candidatosUrl(destino()), ['https://host.local:44300', 'http://host.local:8000']);
    assert.deepStrictEqual(candidatosUrl(destino({ numeroSistema: '7' })), ['https://host.local:44307', 'http://host.local:8007']);
  });

  test('candidatosUrl devuelve vacío sin servidor válido', () => {
    assert.deepStrictEqual(candidatosUrl(destino({ servidorAplicacion: undefined })), []);
  });

  test('deducirUrl devuelve el primer candidato que responde, en orden', async () => {
    const probadas: string[] = [];
    const url = await deducirUrl(['a', 'b', 'c'], async (u) => {
      probadas.push(u);
      return u !== 'a';
    });
    assert.strictEqual(url, 'b');
    assert.deepStrictEqual(probadas, ['a', 'b']);
  });

  test('deducirUrl devuelve undefined si ninguno responde o responde lanza', async () => {
    assert.strictEqual(await deducirUrl(['a', 'b'], async () => false), undefined);
    assert.strictEqual(await deducirUrl(['a', 'b'], async () => { throw new Error('red'); }), undefined);
  });

  test('deducirUrl trata un responde que lanza como false y sigue', async () => {
    const url = await deducirUrl(['a', 'b'], async (u) => {
      if (u === 'a') { throw new Error('red'); }
      return true;
    });
    assert.strictEqual(url, 'b');
  });
});
