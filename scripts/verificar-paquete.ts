import * as fs from 'node:fs';
import * as path from 'node:path';

const RAIZ_REPO = path.resolve(__dirname, '../..');

interface Manifiesto {
  icon?: string;
  license?: string;
  main?: string;
}

/** Lo que debe existir antes de `vsce package`; `compilar-puente` sale con 0 sin javac, así que aquí se exige. */
function faltas(): string[] {
  const manifiesto = JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, 'package.json'), 'utf8')) as Manifiesto;
  const resultado: string[] = [];
  const clasesPuente = path.join(RAIZ_REPO, 'out', 'puente-rfc');
  const clases = fs.existsSync(clasesPuente) ? fs.readdirSync(clasesPuente).filter((n) => n.endsWith('.class')) : [];
  if (!clases.includes('PuenteRfc.class')) {
    resultado.push('out/puente-rfc/PuenteRfc.class (ejecuta pnpm run compile con javac y la oficial instalada)');
  }
  for (const relativo of [manifiesto.main ?? '', manifiesto.icon ?? '', 'README.md', 'LICENSE.md', 'CHANGELOG.md']) {
    if (!relativo || !fs.existsSync(path.join(RAIZ_REPO, relativo))) {
      resultado.push(relativo || 'package.json sin main/icon');
    }
  }
  if (!manifiesto.license) {
    resultado.push('package.json sin campo license');
  }
  return resultado;
}

function principal(): void {
  const pendientes = faltas();
  if (pendientes.length) {
    console.error('verificar-paquete: falta\n  - ' + pendientes.join('\n  - '));
    process.exit(1);
  }
  console.log('verificar-paquete: listo para empaquetar');
}

principal();
