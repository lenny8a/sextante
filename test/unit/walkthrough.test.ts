import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Paso {
  id: string;
  description: string;
  media: { image?: string; altText?: string };
  completionEvents?: string[];
}

interface ManifiestoTutorial {
  contributes: {
    commands: { command: string }[];
    views: Record<string, { id: string }[]>;
    walkthroughs: { id: string; steps: Paso[] }[];
  };
}

const raiz = path.resolve(__dirname, '../../..');
const manifiesto = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')) as ManifiestoTutorial;
const comandos = new Set(manifiesto.contributes.commands.map((c) => c.command));
const vistas = new Set(Object.values(manifiesto.contributes.views).flat().map((v) => v.id));
const pasos = manifiesto.contributes.walkthroughs.flatMap((w) => w.steps);

suite('Tutorial de primeros pasos (walkthrough)', () => {
  test('hay un tutorial con pasos', () => {
    assert.equal(manifiesto.contributes.walkthroughs.length, 1);
    assert.ok(pasos.length >= 5);
  });

  test('cada paso tiene una imagen PNG existente con texto alternativo', () => {
    for (const paso of pasos) {
      assert.ok(paso.media.image?.endsWith('.png'), paso.id);
      assert.ok(fs.existsSync(path.join(raiz, paso.media.image ?? '')), `falta ${paso.media.image}`);
      assert.ok((paso.media.altText ?? '').length > 10, paso.id);
    }
  });

  test('los enlaces y eventos apuntan a comandos y vistas que existen', () => {
    for (const paso of pasos) {
      for (const [, id] of paso.description.matchAll(/\(command:([\w.]+)\)/g)) {
        assert.ok(id.startsWith('workbench.') || comandos.has(id), `${paso.id}: comando ${id}`);
      }
      for (const evento of paso.completionEvents ?? []) {
        const [tipo, id] = evento.split(':');
        if (tipo === 'onCommand') {
          assert.ok(comandos.has(id), `${paso.id}: ${evento}`);
        } else if (tipo === 'onView') {
          assert.ok(vistas.has(id), `${paso.id}: ${evento}`);
        }
      }
    }
  });
});
