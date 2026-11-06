import * as assert from 'assert';
import * as vscode from 'vscode';
import { ESQUEMA_BLOQUE } from '../../src/bloques/bloque-modelo';
import { ControladorIndicador, type BarraIndicador } from '../../src/indicador/indicador-sistema';
import type { TextoIndicador } from '../../src/indicador/indicador-modelo';

suite('ControladorIndicador', () => {
  function crear(): { controlador: ControladorIndicador; mostrados: TextoIndicador[]; ocultados: number[] } {
    const mostrados: TextoIndicador[] = [];
    const ocultados: number[] = [];
    const barra: BarraIndicador = {
      mostrar: (t) => mostrados.push(t),
      ocultar: () => ocultados.push(1),
    };
    return { controlador: new ControladorIndicador({ barra, rolDe: () => 'QAS' }), mostrados, ocultados };
  }

  test('oculta sin editor o con documento no abap', () => {
    const { controlador, mostrados, ocultados } = crear();
    controlador.evaluar(undefined);
    controlador.evaluar(vscode.Uri.parse('untitled:Sin-titulo'));
    assert.strictEqual(ocultados.length, 2);
    assert.strictEqual(mostrados.length, 0);
  });

  test('muestra el sistema de un uri abap', () => {
    const { controlador, mostrados } = crear();
    controlador.evaluar(vscode.Uri.from({ scheme: 'abap', path: '/repotree-v1/QAS-X/System Library/ZPAQ1' }));
    assert.strictEqual(mostrados.length, 1);
    assert.strictEqual(mostrados[0].texto, '$(server) QAS-X · QAS');
    assert.strictEqual(mostrados[0].fondo, 'warning');
  });

  test('en un editor de bloque muestra el sistema de su archivo origen', () => {
    const { controlador, mostrados } = crear();
    const ruta = '/repotree-v1/QAS-X/System Library/ZPAQ1/Source Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap';
    controlador.evaluar(vscode.Uri.from({ scheme: ESQUEMA_BLOQUE, path: `${ruta}/METODO_2.method.abap` }));
    assert.strictEqual(mostrados.length, 1);
    assert.strictEqual(mostrados[0].texto, '$(server) QAS-X · QAS');
  });
});
