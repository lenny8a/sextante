import * as fs from 'node:fs';
import * as path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const RAIZ_REPO = path.resolve(__dirname, '../..');
const FUENTE = path.join(RAIZ_REPO, 'media', 'icono.svg');
const SALIDA = path.join(RAIZ_REPO, 'media', 'sextante.png');
const LADO = 128;

function principal(): void {
  const svg = fs.readFileSync(FUENTE, 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: LADO } }).render().asPng();
  fs.writeFileSync(SALIDA, png);
  console.log(`generar-icono: ${path.relative(RAIZ_REPO, SALIDA)} (${LADO}x${LADO}, ${png.length} bytes)`);
}

principal();
