import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generarDocumentoAdtOficial, localizarExtensionOficial, PaqueteExtension } from '../../src/bridge/adt-oficial-doc';

function leerFixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures', nombre), 'utf8');
}

function carpetaTemporalConDosVersiones(): string {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'adt-ext-'));
  fs.mkdirSync(path.join(carpeta, 'sapse.adt-vscode-1.1.0-win32-x64'));
  fs.mkdirSync(path.join(carpeta, 'sapse.adt-vscode-1.2.0-win32-x64'));
  return carpeta;
}

const fixture = JSON.parse(leerFixture('package.oficial.min.json')) as PaqueteExtension;

suite('adt-oficial-doc', () => {
  test('la cabecera lleva publisher, nombre, versión y ruta', () => {
    const doc = generarDocumentoAdtOficial(fixture, 'C:/ext/sapse.adt-vscode-9.9.9');
    assert.match(doc, /SAPSE\.adt-vscode 9\.9\.9/);
    assert.match(doc, /C:\/ext\/sapse\.adt-vscode-9\.9\.9/);
  });
  test('lista comandos, vistas, esquemas y settings en tablas', () => {
    const doc = generarDocumentoAdtOficial(fixture, 'x');
    assert.match(doc, /\| `adt-vscode\.activate` \|/);
    assert.match(doc, /\| `abap` \|/);
    assert.match(doc, /\| `adt\.enableCommunicationLog` \|/);
  });
  test('preserva las observaciones manuales', () => {
    const doc = generarDocumentoAdtOficial(fixture, 'x', '\nnota propia\n');
    assert.match(doc, /## Observaciones manuales\n\nnota propia/);
  });
  test('localiza la carpeta sapse.adt-vscode-* más reciente', () => {
    const carpeta = carpetaTemporalConDosVersiones();
    try {
      assert.match(localizarExtensionOficial(carpeta) ?? '', /1\.2\.0/);
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
    }
  });
  test('sin extensión devuelve undefined', () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'adt-ext-'));
    try {
      assert.strictEqual(localizarExtensionOficial(carpeta), undefined);
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
    }
  });
});
