import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, 'suite/index');
  const carpetaDestinos = fs.mkdtempSync(path.join(os.tmpdir(), 'sextante-destinos-'));
  const rutaDestinos = path.join(carpetaDestinos, 'destinations.json');
  fs.copyFileSync(path.resolve(extensionDevelopmentPath, 'test/fixtures/destinations.anonimizado.json'), rutaDestinos);
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: { ABAP_NAVIGATOR_DESTINOS_PATH: rutaDestinos },
    });
  } finally {
    fs.rmSync(carpetaDestinos, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error('Fallaron los tests de integración', err);
  process.exit(1);
});
