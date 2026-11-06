import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ESQUEMA_BLOQUE,
  analizarRutaBloque,
  buscarBloque,
  comprobarBloque,
  ajustarSaltoFinal,
  rutaDeBloque,
  textoDeRango,
  tipoBloqueDe,
  uriOrigenDe,
} from '../../src/bloques/bloque-modelo';
import type { SimboloDocumento } from '../../src/tree/objeto-modelo';

function simbolosDe(nombre: string): SimboloDocumento[] {
  const ruta = path.resolve(__dirname, '../../../test/fixtures/repotree', `${nombre}.json`);
  return (JSON.parse(fs.readFileSync(ruta, 'utf8')) as { informe: { simbolos: SimboloDocumento[] } }).informe.simbolos;
}

function simbolo(nombre: string, nombreKind: string, hijos: SimboloDocumento[] = []): SimboloDocumento {
  return { nombre, kind: 0, nombreKind, rango: [0, 0, 0, 0], hijos };
}

const RUTA_CLASE = '/repotree-v1/DEST/System Library/ZPAQ1/Source Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap';
const RUTA_LOCAL = '/repotree-v1/DEST/Local Objects ($TMP)/ZPAQ1/Source Library/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap';

suite('modelo del editor de bloque', () => {
  test('rutaDeBloque cuelga el bloque del archivo origen con su tipo', () => {
    assert.equal(rutaDeBloque(RUTA_CLASE, 'METODO_2', 'method'), `${RUTA_CLASE}/METODO_2.method.abap`);
    assert.equal(rutaDeBloque(RUTA_LOCAL, 'FORM_1', 'form'), `${RUTA_LOCAL}/FORM_1.form.abap`);
  });

  test('analizarRutaBloque devuelve origen, nombre y tipo con espacios y paréntesis', () => {
    assert.deepEqual(analizarRutaBloque(`${RUTA_CLASE}/METODO_2.method.abap`), {
      rutaOrigen: RUTA_CLASE,
      nombre: 'METODO_2',
      tipo: 'method',
    });
    assert.deepEqual(analizarRutaBloque(`${RUTA_LOCAL}/FORM_1.form.abap`), {
      rutaOrigen: RUTA_LOCAL,
      nombre: 'FORM_1',
      tipo: 'form',
    });
  });

  test('analizarRutaBloque rechaza rutas sin bloque', () => {
    assert.equal(analizarRutaBloque(RUTA_CLASE), undefined);
    assert.equal(analizarRutaBloque(`${RUTA_CLASE}/METODO_2.clas.abap`), undefined);
    assert.equal(analizarRutaBloque(`${RUTA_CLASE}/.method.abap`), undefined);
    assert.equal(analizarRutaBloque('/METODO_2.method.abap'), undefined);
  });

  test('un nombre con barras (espacio de nombres) ida y vuelta', () => {
    const ruta = rutaDeBloque(RUTA_CLASE, '/NS/IF_EJEMPLO~METODO', 'method');
    assert.ok(ruta.startsWith(`${RUTA_CLASE}/`));
    assert.equal(ruta.split('/').length, RUTA_CLASE.split('/').length + 1);
    assert.deepEqual(analizarRutaBloque(ruta), { rutaOrigen: RUTA_CLASE, nombre: '/NS/IF_EJEMPLO~METODO', tipo: 'method' });
    assert.equal(analizarRutaBloque(rutaDeBloque(RUTA_CLASE, 'A%2FB', 'method'))?.nombre, 'A%2FB');
  });

  test('tipoBloqueDe: Method en clase o interfaz, Function en programas', () => {
    assert.equal(tipoBloqueDe('Method', 'clase'), 'method');
    assert.equal(tipoBloqueDe('Method', 'interfaz'), 'method');
    assert.equal(tipoBloqueDe('Function', 'programa'), 'form');
    assert.equal(tipoBloqueDe('Function', 'include'), 'form');
    assert.equal(tipoBloqueDe('Function', 'grupoFunciones'), 'form');
    assert.equal(tipoBloqueDe('Method', 'programa'), undefined);
    assert.equal(tipoBloqueDe('Function', 'clase'), undefined);
    assert.equal(tipoBloqueDe('Property', 'clase'), undefined);
    assert.equal(tipoBloqueDe('Class', 'programa'), undefined);
  });

  test('buscarBloque: método de la última Class (la implementación), sin distinguir mayúsculas', () => {
    const simbolos = simbolosDe('clase');
    const esperado = simbolos[1].hijos.find((h) => h.nombre === 'METODO_2')?.rango;
    assert.deepEqual(esperado, [131, 2, 148, 12]);
    assert.deepEqual(buscarBloque(simbolos, 'metodo_2', 'method'), esperado);
    assert.equal(buscarBloque(simbolos, 'NO_EXISTE', 'method'), undefined);
    assert.equal(buscarBloque(simbolos, 'METODO_2', 'form'), undefined);
  });

  test('buscarBloque: la Class de definición no cuenta aunque tenga el método', () => {
    const definicion = simbolo('ZCL_X', 'Class', [{ ...simbolo('M', 'Method'), rango: [1, 0, 1, 10] }]);
    const implementacion = simbolo('ZCL_X', 'Class', [{ ...simbolo('M', 'Method'), rango: [5, 2, 9, 12] }]);
    assert.deepEqual(buscarBloque([definicion, implementacion], 'm', 'method'), [5, 2, 9, 12]);
  });

  test('buscarBloque: sin Class, Method de primer nivel o dentro de la Interface', () => {
    const suelto = { ...simbolo('M', 'Method'), rango: [3, 0, 4, 0] as [number, number, number, number] };
    assert.deepEqual(buscarBloque([suelto], 'M', 'method'), [3, 0, 4, 0]);
    const interfaz = simbolo('ZIF_X', 'Interface', [{ ...simbolo('M2', 'Method'), rango: [7, 2, 8, 30] }]);
    assert.deepEqual(buscarBloque([interfaz], 'm2', 'method'), [7, 2, 8, 30]);
  });

  test('buscarBloque: FORM de primer nivel del programa', () => {
    const simbolos = simbolosDe('programa');
    assert.deepEqual(buscarBloque(simbolos, 'form_1', 'form'), [144, 0, 185, 8]);
    assert.equal(buscarBloque(simbolos, 'VAR_1', 'form'), undefined);
    assert.equal(buscarBloque(simbolos, 'FORM_1', 'method'), undefined);
  });

  test('textoDeRango: 0-based, fin exclusivo en columna, varias líneas y CRLF', () => {
    const texto = ['CLASS x IMPLEMENTATION.', '  METHOD m.', '    WRITE 1.', '  ENDMETHOD.', 'ENDCLASS.'].join('\n');
    assert.equal(textoDeRango(texto, [1, 2, 3, 12]), 'METHOD m.\n    WRITE 1.\n  ENDMETHOD.');
    assert.equal(textoDeRango(texto, [0, 0, 0, 5]), 'CLASS');
    assert.equal(textoDeRango(texto, [4, 0, 4, 9]), 'ENDCLASS.');
    assert.equal(textoDeRango(texto.replace(/\n/g, '\r\n'), [1, 2, 3, 12]), 'METHOD m.\r\n    WRITE 1.\r\n  ENDMETHOD.');
    assert.equal(textoDeRango(texto, [3, 2, 99, 0]), 'ENDMETHOD.\nENDCLASS.');
  });

  test('comprobarBloque: inicio que nombra el bloque, cierre ENDMETHOD/ENDFORM y sin otro bloque dentro', () => {
    const texto = [
      'CLASS x IMPLEMENTATION.',
      '  METHOD metodo_1.',
      '    WRITE 1.',
      '  ENDMETHOD.',
      '  METHOD metodo_2.',
      '    WRITE 2.',
      '    WRITE 3.',
      '  ENDMETHOD.',
      '  METHOD metodo_3.',
      '    WRITE 4.',
      '  ENDMETHOD.',
      'ENDCLASS.',
    ].join('\n');
    assert.equal(comprobarBloque(texto, [4, 2, 7, 12], 'METODO_2', 'method'), 'vigente');
    assert.equal(comprobarBloque(texto, [5, 0, 7, 12], 'METODO_2', 'method'), 'desplazado');
    assert.equal(comprobarBloque(texto, [99, 0, 99, 0], 'METODO_2', 'method'), 'desplazado');
    // Guardado anterior que creció o encogió: el inicio sigue en su sitio y el fin no.
    assert.equal(comprobarBloque(texto, [4, 2, 6, 12], 'METODO_2', 'method'), 'redimensionado');
    assert.equal(comprobarBloque(texto, [4, 2, 10, 12], 'METODO_2', 'method'), 'redimensionado');
    assert.equal(comprobarBloque(texto, [4, 2, 9, 12], 'METODO_2', 'method'), 'redimensionado');
    assert.equal(comprobarBloque(texto, [4, 2, 7, 6], 'METODO_2', 'method'), 'redimensionado');
    assert.equal(comprobarBloque(texto, [4, 2, 7, 12], 'METODO_2', 'form'), 'redimensionado');
    const programa = ['FORM form_1 USING p.', '  WRITE p.', 'ENDFORM.', 'FORM form_2.', 'ENDFORM.'].join('\r\n');
    assert.equal(comprobarBloque(programa, [0, 0, 2, 8], 'FORM_1', 'form'), 'vigente');
    assert.equal(comprobarBloque(programa, [0, 0, 4, 8], 'FORM_1', 'form'), 'redimensionado');
    assert.equal(comprobarBloque(programa, [0, 0, 1, 9], 'FORM_1', 'form'), 'redimensionado');
  });

  test('comprobarBloque: columna final más allá de la línea, parámetros llamados form/method y cierres comentados', () => {
    const corto = ['  METHOD m.', '    x = 1.', 'ENDMETHOD.', '  METHOD n.'].join('\n');
    assert.equal(comprobarBloque(corto, [0, 2, 2, 10], 'M', 'method'), 'vigente');
    assert.equal(comprobarBloque(corto, [0, 2, 2, 12], 'M', 'method'), 'redimensionado');
    const conParametros = [
      'FORM imprimir.',
      "  CALL FUNCTION 'OPEN_FORM'",
      '    EXPORTING',
      "      form = 'ZF'",
      "      method = 'POST'.",
      'ENDFORM.',
    ].join('\n');
    assert.equal(comprobarBloque(conParametros, [0, 0, 5, 8], 'IMPRIMIR', 'form'), 'vigente');
    const metodo = ['  METHOD m.', "    DATA(x) = VALUE t( method = 'POST' ).", '  ENDMETHOD.'].join('\n');
    assert.equal(comprobarBloque(metodo, [0, 2, 2, 12], 'M', 'method'), 'vigente');
    const conOtro = ['  METHOD m.', '  METHOD otro.', '  ENDMETHOD.'].join('\n');
    assert.equal(comprobarBloque(conOtro, [0, 2, 2, 12], 'M', 'method'), 'redimensionado');
    const comentado = ['  METHOD m.', '    x = 1.', '* ENDMETHOD.'].join('\n');
    assert.equal(comprobarBloque(comentado, [0, 2, 2, 12], 'M', 'method'), 'redimensionado');
    const trasComillas = ['  METHOD m.', '    x = 1. " ENDMETHOD.'].join('\n');
    assert.equal(comprobarBloque(trasComillas, [0, 2, 1, 23], 'M', 'method'), 'redimensionado');
  });

  test('textoDeRango no lee más allá del final de la línea', () => {
    const texto = ['  METHOD m.', 'ENDMETHOD.', 'siguiente'].join('\r\n');
    assert.equal(textoDeRango(texto, [0, 2, 1, 12]), 'METHOD m.\r\nENDMETHOD.');
    assert.equal(textoDeRango(texto, [0, 20, 0, 30]), '');
  });

  test('ajustarSaltoFinal: quita un salto final que el bloque del origen no tenía', () => {
    assert.equal(ajustarSaltoFinal('METHOD m.\nENDMETHOD.\n', 'METHOD m.\nENDMETHOD.'), 'METHOD m.\nENDMETHOD.');
    assert.equal(ajustarSaltoFinal('METHOD m.\r\nENDMETHOD.\r\n', 'METHOD m.\r\nENDMETHOD.'), 'METHOD m.\r\nENDMETHOD.');
    assert.equal(ajustarSaltoFinal('METHOD m.\nENDMETHOD.\n\n', 'x'), 'METHOD m.\nENDMETHOD.\n');
    assert.equal(ajustarSaltoFinal('METHOD m.\nENDMETHOD.\n', 'x\n'), 'METHOD m.\nENDMETHOD.\n');
    assert.equal(ajustarSaltoFinal('METHOD m.\nENDMETHOD.', 'x'), 'METHOD m.\nENDMETHOD.');
  });

  test('uriOrigenDe: un bloque se evalúa como su archivo abap; el resto tal cual', () => {
    const bloque = { scheme: ESQUEMA_BLOQUE, path: `${RUTA_CLASE}/METODO_2.method.abap` };
    assert.deepEqual(uriOrigenDe(bloque), { scheme: 'abap', path: RUTA_CLASE });
    const abap = { scheme: 'abap', path: RUTA_CLASE };
    assert.equal(uriOrigenDe(abap), abap);
    const raro = { scheme: ESQUEMA_BLOQUE, path: RUTA_CLASE };
    assert.equal(uriOrigenDe(raro), raro);
    assert.equal(uriOrigenDe(undefined), undefined);
  });
});
