import * as path from 'path';
import Mocha from 'mocha';
import { globSync } from 'glob';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true });
  const directorio = __dirname;
  for (const archivo of globSync('**/*.test.js', { cwd: directorio })) {
    mocha.addFile(path.resolve(directorio, archivo));
  }
  await new Promise<void>((resolver, rechazar) => {
    mocha.run((fallos) => {
      if (fallos > 0) {
        rechazar(new Error(`${fallos} tests fallaron`));
      } else {
        resolver();
      }
    });
  });
}
