import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EntradaRepotree } from '../../src/bridge/repotree-oficial';
import { etiquetaRepotreeDePaquete, nodosDesdeEntradas, nombreAbapDePaquete } from '../../src/tree/paquete-modelo';

interface CarpetaRepotree {
  ruta: string;
  entradas: { nombre: string; tipo: 'carpeta' | 'archivo' }[];
}

const CARPETAS = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/repotree/carpetas.json'), 'utf8'),
) as CarpetaRepotree[];

function entradasDe(ruta: string): EntradaRepotree[] {
  const carpeta = CARPETAS.find((c) => decodeURIComponent(c.ruta) === `abap:${ruta}`);
  assert.ok(carpeta, ruta);
  return carpeta.entradas.map((e) => ({ nombre: e.nombre, esCarpeta: e.tipo === 'carpeta' }));
}

const RAIZ = '/repotree-v1/DEST';
const ZPAQ1 = `${RAIZ}/System Library/ZPAQ1`;
const CLASSES = `${ZPAQ1}/Source Library/Classes`;

suite('modelo de nodos de paquetes', () => {
  test('raíz: dos bibliotecas', () => {
    const nodos = nodosDesdeEntradas(RAIZ, 0, entradasDe(RAIZ));
    assert.deepStrictEqual(nodos.map((n) => n.clase), ['biblioteca', 'biblioteca']);
    assert.deepStrictEqual(nodos.map((n) => n.icono), ['library', 'library']);
    assert.deepStrictEqual(nodos.map((n) => n.etiqueta), ['Local Objects ($TMP)', 'System Library']);
  });

  test('paquete: descarta el devck.jsonc y clasifica categorías', () => {
    const nodos = nodosDesdeEntradas(ZPAQ1, 2, entradasDe(ZPAQ1));
    assert.strictEqual(nodos.length, 5);
    assert.ok(nodos.every((n) => n.clase === 'categoria' && n.icono === 'folder' && n.esCarpeta));
    assert.ok(!nodos.some((n) => n.etiqueta === 'zpaq1.devck.jsonc'));
    assert.deepStrictEqual(
      nodos.map((n) => n.etiqueta),
      ['Source Library', 'Dictionary', 'Message Classes', 'Connectivity', 'Others'],
    );
  });

  test('objetos de Classes llevan icono de clase y ruta con espacios sin codificar', () => {
    const nodos = nodosDesdeEntradas(CLASSES, 4, entradasDe(CLASSES));
    assert.strictEqual(nodos[0].clase, 'objeto');
    assert.strictEqual(nodos[0].icono, 'symbol-class');
    assert.strictEqual(nodos[0].tipoObjeto, 'clase');
    assert.strictEqual(nodos[0].ruta, '/repotree-v1/DEST/System Library/ZPAQ1/Source Library/Classes/ZCL_EJEMPLO_2');
    assert.strictEqual(nodos[0].id, nodos[0].ruta);
  });

  test('paquetes se ordenan alfabéticamente y conservan namespaces', () => {
    const entradas: EntradaRepotree[] = ['(IWBEP)FRAMEWORK', 'ZPAQ2', 'ZPAQ1'].map((nombre) => ({ nombre, esCarpeta: true }));
    const nodos = nodosDesdeEntradas(`${RAIZ}/System Library`, 1, entradas);
    assert.deepStrictEqual(nodos.map((n) => n.etiqueta), ['(IWBEP)FRAMEWORK', 'ZPAQ1', 'ZPAQ2']);
    assert.ok(nodos.every((n) => n.clase === 'paquete' && n.icono === 'package'));
    assert.strictEqual(nombreAbapDePaquete('(IWBEP)FRAMEWORK'), '/IWBEP/FRAMEWORK');
    assert.strictEqual(nombreAbapDePaquete('ZPAQ1'), 'ZPAQ1');
  });

  test('etiquetaRepotreeDePaquete es la inversa de nombreAbapDePaquete', () => {
    assert.strictEqual(etiquetaRepotreeDePaquete('/IWBEP/FRAMEWORK'), '(IWBEP)FRAMEWORK');
    assert.strictEqual(etiquetaRepotreeDePaquete('ZPAQ1'), 'ZPAQ1');
    assert.strictEqual(etiquetaRepotreeDePaquete('$TMP'), '$TMP');
    assert.strictEqual(nombreAbapDePaquete(etiquetaRepotreeDePaquete('/ZNS/ZPAQ1')), '/ZNS/ZPAQ1');
  });

  test('nivel 5 solo archivos', () => {
    const entradas: EntradaRepotree[] = [
      { nombre: 'Sub', esCarpeta: true },
      { nombre: 'zcl_ejemplo.clas.abap', esCarpeta: false },
      { nombre: 'zcl_ejemplo.clas.json', esCarpeta: false },
    ];
    const nodos = nodosDesdeEntradas(`${CLASSES}/ZCL_EJEMPLO`, 5, entradas);
    assert.deepStrictEqual(nodos.map((n) => n.clase), ['archivo', 'archivo']);
    assert.ok(nodos.every((n) => n.icono === 'file-code' && !n.esCarpeta));
  });
});
