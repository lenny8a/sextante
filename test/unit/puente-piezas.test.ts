import assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  compararVersiones, localizarPiezas, rutaJarParaClasspath, versionDelNombre, type ListadorDirectorios,
} from '../../src/adt/puente-piezas';

const RAIZ = path.join('C:', 'ext', 'sapse.adt-vscode-1.2.0-win32-x64');
const PLUGINS = path.join(RAIZ, 'adt-ls', 'win32', 'win32', 'x86_64', 'plugins');
const JRE = 'com.sap.adt.jvm.sapmachineminimal.win32.x86_64_';

function javaDe(carpetaJre: string): string {
  return path.join(PLUGINS, carpetaJre, 'jre', 'bin', 'java.exe');
}

/** Árbol falso: carpetas con sus entradas y archivos sueltos. */
function listadorFalso(carpetas: Record<string, string[]>, archivos: string[] = []): ListadorDirectorios {
  const conjunto = new Set(archivos);
  return {
    existe: (ruta) => ruta in carpetas || conjunto.has(ruta),
    listar: (ruta) => carpetas[ruta] ?? [],
  };
}

function oficialCompleta(plugins: string[], javas: string[]): ListadorDirectorios {
  return listadorFalso(
    { [RAIZ]: ['adt-ls'], [path.join(RAIZ, 'adt-ls')]: ['win32'], [PLUGINS]: plugins },
    javas,
  );
}

const TRES_PIEZAS = [
  `${JRE}21.12.2`,
  'com.sap.conn.jco.eclipse_1.34.0.jar',
  'com.sap.conn.jco.win32.x86_64_3.1.14.jar',
  'com.sap.conn.jco_3.1.14.jar',
];

suite('Piezas de la oficial para el puente', () => {
  test('con las tres piezas devuelve sus rutas', () => {
    const resultado = localizarPiezas(RAIZ, 'win32', 'x64', oficialCompleta(TRES_PIEZAS, [javaDe(`${JRE}21.12.2`)]));
    assert.deepEqual(resultado, {
      ok: true,
      piezas: {
        java: javaDe(`${JRE}21.12.2`),
        jarJco: path.join(PLUGINS, 'com.sap.conn.jco_3.1.14.jar'),
        fragmentoNativo: path.join(PLUGINS, 'com.sap.conn.jco.win32.x86_64_3.1.14.jar'),
        raiz: RAIZ,
      },
    });
  });

  test('sin carpeta adt-ls responde sinAdtLs', () => {
    const resultado = localizarPiezas(RAIZ, 'win32', 'x64', listadorFalso({ [RAIZ]: [] }));
    assert.deepEqual(resultado, { ok: false, motivo: 'sinAdtLs' });
  });

  test('con dos versiones del JRE elige la mayor por versión, no por texto', () => {
    const plugins = [`${JRE}21.9.0`, `${JRE}21.12.2`, ...TRES_PIEZAS.slice(1)];
    const javas = [javaDe(`${JRE}21.9.0`), javaDe(`${JRE}21.12.2`)];
    const resultado = localizarPiezas(RAIZ, 'win32', 'x64', oficialCompleta(plugins, javas));
    assert.ok(resultado.ok);
    assert.equal(resultado.piezas.java, javaDe(`${JRE}21.12.2`));
  });

  test('con dos versiones de JCo elige la mayor', () => {
    const plugins = [...TRES_PIEZAS, 'com.sap.conn.jco_3.1.9.jar', 'com.sap.conn.jco.win32.x86_64_3.1.9.jar'];
    const resultado = localizarPiezas(RAIZ, 'win32', 'x64', oficialCompleta(plugins, [javaDe(`${JRE}21.12.2`)]));
    assert.ok(resultado.ok);
    assert.equal(resultado.piezas.jarJco, path.join(PLUGINS, 'com.sap.conn.jco_3.1.14.jar'));
    assert.equal(resultado.piezas.fragmentoNativo, path.join(PLUGINS, 'com.sap.conn.jco.win32.x86_64_3.1.14.jar'));
  });

  test('linux responde plataforma', () => {
    const resultado = localizarPiezas(RAIZ, 'linux', 'x64', oficialCompleta(TRES_PIEZAS, [javaDe(`${JRE}21.12.2`)]));
    assert.deepEqual(resultado, { ok: false, motivo: 'plataforma' });
  });

  test('Windows en arm64 responde plataforma', () => {
    const resultado = localizarPiezas(RAIZ, 'win32', 'arm64', oficialCompleta(TRES_PIEZAS, [javaDe(`${JRE}21.12.2`)]));
    assert.deepEqual(resultado, { ok: false, motivo: 'plataforma' });
  });

  test('sin la oficial responde sinOficial', () => {
    assert.deepEqual(localizarPiezas(undefined, 'win32', 'x64', listadorFalso({})), { ok: false, motivo: 'sinOficial' });
  });

  test('sin java.exe en la carpeta del JRE responde sinJre', () => {
    const resultado = localizarPiezas(RAIZ, 'win32', 'x64', oficialCompleta(TRES_PIEZAS, []));
    assert.deepEqual(resultado, { ok: false, motivo: 'sinJre' });
  });

  test('sin el JAR de JCo responde sinJco (el de eclipse no cuenta)', () => {
    const plugins = TRES_PIEZAS.filter((nombre) => !nombre.startsWith('com.sap.conn.jco_'));
    const resultado = localizarPiezas(RAIZ, 'win32', 'x64', oficialCompleta(plugins, [javaDe(`${JRE}21.12.2`)]));
    assert.deepEqual(resultado, { ok: false, motivo: 'sinJco' });
  });

  test('sin el fragmento nativo responde sinNativa', () => {
    const plugins = TRES_PIEZAS.filter((nombre) => !nombre.startsWith('com.sap.conn.jco.win32'));
    const resultado = localizarPiezas(RAIZ, 'win32', 'x64', oficialCompleta(plugins, [javaDe(`${JRE}21.12.2`)]));
    assert.deepEqual(resultado, { ok: false, motivo: 'sinNativa' });
  });

  test('rutaJarParaClasspath usa el nombre con guion dentro de carpetaLib', () => {
    const carpetaLib = path.join('C:', 'almacen', 'puente', 'lib');
    assert.equal(
      rutaJarParaClasspath(path.join(PLUGINS, 'com.sap.conn.jco_3.1.14.jar'), carpetaLib),
      path.join(carpetaLib, 'com.sap.conn.jco-3.1.14.jar'),
    );
  });

  test('versionDelNombre lee la versión de carpetas y JAR, y compararVersiones ordena por número', () => {
    assert.deepEqual(versionDelNombre('com.sap.conn.jco_3.1.14.jar'), [3, 1, 14]);
    assert.deepEqual(versionDelNombre(`${JRE}21.12.2`), [21, 12, 2]);
    assert.deepEqual(versionDelNombre('sin-version'), []);
    assert.ok(compararVersiones([21, 12, 2], [21, 9, 0]) > 0);
    assert.ok(compararVersiones([3, 1], [3, 1, 1]) < 0);
    assert.equal(compararVersiones([3, 1, 0], [3, 1]), 0);
  });
});
