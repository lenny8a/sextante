import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Comando {
  command: string;
  title: string;
  category?: string;
}

interface EntradaPaleta {
  command: string;
  when?: string;
}

interface Manifiesto {
  name: string;
  displayName: string;
  description?: string;
  publisher: string;
  version: string;
  preview?: boolean;
  license?: string;
  icon?: string;
  categories: string[];
  keywords?: string[];
  extensionDependencies?: string[];
  engines: { vscode: string };
  devDependencies: Record<string, string>;
  contributes: {
    commands: Comando[];
    menus: { commandPalette: EntradaPaleta[] };
    viewsContainers: { activitybar: { title: string; icon: string }[] };
  };
}

const raiz = path.resolve(__dirname, '../../..');
const manifiesto = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')) as Manifiesto;

suite('Manifiesto para el Marketplace', () => {
  test('los campos que exige o muestra el Marketplace están presentes', () => {
    assert.equal(manifiesto.name, 'sextante');
    assert.equal(manifiesto.displayName, 'Sextante');
    assert.ok(manifiesto.description && manifiesto.description.length > 20);
    assert.equal(manifiesto.preview, true);
    assert.equal(manifiesto.license, 'MIT');
    assert.ok(manifiesto.categories.includes('Programming Languages'));
    assert.ok((manifiesto.keywords?.length ?? 0) <= 5, 'el Marketplace admite 5 keywords');
    assert.equal(manifiesto.extensionDependencies, undefined, 'con extensionDependencies VS Code no activa sin la oficial (tests y aviso propio)');
    assert.match(manifiesto.version, /^\d+\.\d+\.\d+$/);
  });

  test('el nombre público no usa marcas de SAP', () => {
    for (const texto of [manifiesto.name, manifiesto.displayName]) {
      assert.doesNotMatch(texto, /abap|sap/i, texto);
    }
    assert.doesNotMatch(manifiesto.contributes.viewsContainers.activitybar[0].title, /abap|sap/i);
  });

  test('el icono PNG, la licencia, el README y el CHANGELOG existen', () => {
    assert.ok(manifiesto.icon?.endsWith('.png'), 'el Marketplace no acepta SVG como icono');
    for (const archivo of [manifiesto.icon ?? '', 'LICENSE.md', 'README.md', 'CHANGELOG.md']) {
      assert.ok(fs.existsSync(path.join(raiz, archivo)), `falta ${archivo}`);
    }
  });

  test('los comandos de nodo de Versiones quedan fuera de la paleta; elegir sistemas a comparar está en ella', () => {
    const paleta = manifiesto.contributes.menus.commandPalette;
    for (const id of ['abapNavigator.versiones.abrirDiff', 'abapNavigator.versiones.abrirVersion', 'abapNavigator.versiones.copiarOrden']) {
      assert.equal(paleta.find((e) => e.command === id)?.when, 'false', id);
    }
    const configurar = manifiesto.contributes.commands.find((c) => c.command === 'abapNavigator.objeto.compararConfigurar');
    assert.equal(configurar?.category, 'Sextante');
    assert.equal(configurar?.title, 'Comparar con otro sistema: elegir sistemas…');
    assert.equal(paleta.find((e) => e.command === 'abapNavigator.objeto.compararConfigurar')?.when, undefined);
  });

  test('la vista y los ajustes de la IA están declarados; abrirLlamada no sale en la paleta', () => {
    const ia = manifiesto.contributes as unknown as {
      views: { abapNavigator: { id: string; visibility?: string }[] };
      configuration: { properties: Record<string, { default: unknown; minimum?: number; maximum?: number }> };
    };
    assert.equal(ia.views.abapNavigator.find((v) => v.id === 'abapNavigator.ia')?.visibility, 'collapsed');
    assert.equal(ia.configuration.properties['abapNavigator.ia.servidor'].default, true);
    assert.equal(ia.configuration.properties['abapNavigator.ia.puerto'].default, 2237);
    const ids = manifiesto.contributes.commands.map((c) => c.command);
    for (const id of ['arrancar', 'parar', 'conectarAgente', 'copiarConfiguracion', 'regenerarToken', 'abrirLlamada']) {
      assert.ok(ids.includes(`abapNavigator.ia.${id}`), id);
    }
    assert.equal(
      manifiesto.contributes.menus.commandPalette.find((e) => e.command === 'abapNavigator.ia.abrirLlamada')?.when,
      'false',
    );
  });

  test('@types/vscode no supera el engine declarado (vsce lo rechaza)', () => {
    const tipos = JSON.parse(
      fs.readFileSync(path.join(raiz, 'node_modules', '@types', 'vscode', 'package.json'), 'utf8'),
    ) as { version: string };
    const menor = (v: string): number => Number(v.replace(/^\D*/, '').split('.')[1]);
    assert.ok(menor(tipos.version) <= menor(manifiesto.engines.vscode), `${tipos.version} > ${manifiesto.engines.vscode}`);
  });
});
