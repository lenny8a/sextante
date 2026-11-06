import * as assert from 'node:assert/strict';
import {
  camposParaGenerar,
  conIndentacion,
  escaparSnippet,
  generarCase,
  generarData,
  generarSelect,
  generarTablaInterna,
  generarTypes,
  MAX_VALORES_CASE_SIN_PREGUNTAR,
  tieneValoresFijos,
  variableCase,
} from '../../src/diccionario/generar';
import type { CampoDiccionario, Dominio } from '../../src/diccionario/modelo';
import type { NodoDiccionario } from '../../src/diccionario/panel-modelo';

function campo(posicion: number, nombre: string, extra: Partial<CampoDiccionario> = {}): CampoDiccionario {
  return { posicion, nombre, clave: false, elementoDatos: nombre, tipo: 'CHAR', longitud: 4, decimales: 0, texto: '', ...extra };
}

const MANDT = campo(1, 'MANDT', { clave: true, tipo: 'CLNT', longitud: 3 });
const MATNR = campo(2, 'MATNR', { clave: true, longitud: 40 });
const MTART = campo(3, 'MTART');
const MATKL = campo(4, 'MATKL', { include: 'ZINCL_EJEMPLO' });
const CATALOGO = [MANDT, MATNR, MTART, MATKL];

function nodoCampo(c: CampoDiccionario): NodoDiccionario {
  return { clase: 'campo', tabla: 'MARA', campo: c };
}

suite('diccionario/generar: código ABAP', () => {
  test('generarTypes para MARA con MATNR y MTART', () => {
    assert.strictEqual(
      generarTypes({ tabla: 'MARA', campos: [MATNR, MTART] }),
      'TYPES: BEGIN OF ty_mara,\n         matnr TYPE mara-matnr,\n         mtart TYPE mara-mtart,\n       END OF ty_mara.',
    );
  });

  test('generarTypes alinea TYPE tras el nombre más largo', () => {
    assert.strictEqual(
      generarTypes({ tabla: 'MARA', campos: [campo(1, 'MATNR'), campo(2, 'BRGEW_EJ')] }),
      'TYPES: BEGIN OF ty_mara,\n         matnr    TYPE mara-matnr,\n         brgew_ej TYPE mara-brgew_ej,\n       END OF ty_mara.',
    );
  });

  test('generarSelect para MARA con MATNR y MTART', () => {
    assert.strictEqual(
      generarSelect({ tabla: 'MARA', campos: [MATNR, MTART] }),
      'SELECT matnr,\n       mtart\n  FROM mara\n  INTO TABLE @DATA(lt_mara)\n  UP TO 100 ROWS.',
    );
  });

  test('generarSelect con un solo campo no lleva coma', () => {
    assert.strictEqual(
      generarSelect({ tabla: 'MARA', campos: [MATNR] }),
      'SELECT matnr\n  FROM mara\n  INTO TABLE @DATA(lt_mara)\n  UP TO 100 ROWS.',
    );
  });

  test('generarData y generarTablaInterna para MARA', () => {
    assert.strictEqual(generarData('MARA'), 'DATA ls_mara TYPE mara.');
    assert.strictEqual(generarTablaInterna('MARA'), 'DATA lt_mara TYPE STANDARD TABLE OF mara WITH EMPTY KEY.');
  });

  test('nombre por defecto ty_/lt_ y nombre explícito', () => {
    assert.ok(generarTypes({ tabla: 'MARA', campos: [MATNR] }).startsWith('TYPES: BEGIN OF ty_mara,\n'));
    assert.ok(generarSelect({ tabla: 'MARA', campos: [MATNR] }).includes('@DATA(lt_mara)'));
    assert.strictEqual(
      generarTypes({ tabla: 'MARA', campos: [MATNR], nombre: 'ty_material' }),
      'TYPES: BEGIN OF ty_material,\n         matnr TYPE mara-matnr,\n       END OF ty_material.',
    );
    assert.ok(generarSelect({ tabla: 'MARA', campos: [MATNR], nombre: 'lt_material' }).includes('@DATA(lt_material)'));
  });

  test('nombres con espacio de nombres: identificador sin barras y referencia con el espacio de nombres', () => {
    const clave = campo(1, '/BOBF/KEY');
    assert.strictEqual(
      generarTypes({ tabla: '/BOBF/S_FRW_KEY', campos: [clave] }),
      'TYPES: BEGIN OF ty_bobf_s_frw_key,\n         /bobf/key TYPE /bobf/s_frw_key-/bobf/key,\n       END OF ty_bobf_s_frw_key.',
    );
    assert.strictEqual(
      generarSelect({ tabla: '/BOBF/S_FRW_KEY', campos: [clave] }),
      'SELECT /bobf/key\n  FROM /bobf/s_frw_key\n  INTO TABLE @DATA(lt_bobf_s_frw_key)\n  UP TO 100 ROWS.',
    );
    assert.strictEqual(generarData('/BOBF/S_FRW_KEY'), 'DATA ls_bobf_s_frw_key TYPE /bobf/s_frw_key.');
    assert.strictEqual(
      generarTablaInterna('/BOBF/S_FRW_KEY'),
      'DATA lt_bobf_s_frw_key TYPE STANDARD TABLE OF /bobf/s_frw_key WITH EMPTY KEY.',
    );
  });

  test('el identificador no pasa de 30 caracteres', () => {
    const tabla = 'ZTABLA_DE_EJEMPLO_MUY_LARGA_30';
    assert.strictEqual(tabla.length, 30);
    assert.strictEqual(generarData(tabla), `DATA ls_ztabla_de_ejemplo_muy_larga TYPE ${tabla.toLowerCase()}.`);
  });

  test('los campos de include van con su nombre y los pseudocampos nunca aparecen', () => {
    const pseudo = campo(5, '.INCLUDE');
    assert.strictEqual(
      generarSelect({ tabla: 'MARA', campos: [MATNR, MATKL, pseudo] }),
      'SELECT matnr,\n       matkl\n  FROM mara\n  INTO TABLE @DATA(lt_mara)\n  UP TO 100 ROWS.',
    );
    assert.ok(!generarTypes({ tabla: 'MARA', campos: [MATNR, pseudo] }).includes('.include'));
  });

  test("conIndentacion('a\\nb', '    ') indenta todas las líneas salvo la primera", () => {
    assert.strictEqual(conIndentacion('a\nb', '    '), 'a\n    b');
    assert.strictEqual(conIndentacion('a', '  '), 'a');
    assert.strictEqual(conIndentacion('a\nb\nc', '\t'), 'a\n\tb\n\tc');
  });

  test("conIndentacion deja en la columna 1 las líneas de comentario con '*'", () => {
    assert.strictEqual(conIndentacion('a\n*b\nc', '  '), 'a\n*b\n  c');
    assert.strictEqual(conIndentacion('a\n  " b', '  '), 'a\n    " b');
  });
});

suite('diccionario/generar: campos desde el panel', () => {
  const mostrado = { tabla: 'MARA', campos: CATALOGO };

  test('selección de campos: en el orden del catálogo y sin repetidos', () => {
    const nodo = nodoCampo(MTART);
    const seleccion = [nodoCampo(MTART), nodoCampo(MATNR), nodoCampo(MTART)];
    assert.deepStrictEqual(camposParaGenerar(nodo, seleccion, mostrado), { tabla: 'MARA', campos: [MATNR, MTART] });
  });

  test('un campo seleccionado explícitamente se respeta aunque sea MANDT', () => {
    assert.deepStrictEqual(camposParaGenerar(nodoCampo(MANDT), [nodoCampo(MANDT)], mostrado), { tabla: 'MARA', campos: [MANDT] });
  });

  test('sin selección (o si el nodo no está en ella) vale el nodo pulsado', () => {
    assert.deepStrictEqual(camposParaGenerar(nodoCampo(MTART), undefined, mostrado), { tabla: 'MARA', campos: [MTART] });
    assert.deepStrictEqual(camposParaGenerar(nodoCampo(MTART), [nodoCampo(MATNR)], mostrado), { tabla: 'MARA', campos: [MTART] });
  });

  test('la selección ignora los nodos que no son campos', () => {
    const seleccion: NodoDiccionario[] = [nodoCampo(MATNR), { clase: 'grupoCampos', total: 4 }];
    assert.deepStrictEqual(camposParaGenerar(nodoCampo(MATNR), seleccion, mostrado), { tabla: 'MARA', campos: [MATNR] });
  });

  test('cabecera o grupo de campos: todos los del catálogo salvo MANDT', () => {
    const objeto = { nombre: 'MARA', tipo: 'tabla' as const, tipoAdt: 'TABL/DT', descripcion: '', uriAdt: '/sap/bc/adt/ddic/tables/mara' };
    const esperado = { tabla: 'MARA', campos: [MATNR, MTART, MATKL] };
    assert.deepStrictEqual(camposParaGenerar({ clase: 'cabecera', objeto, fijado: false }, undefined, mostrado), esperado);
    assert.deepStrictEqual(camposParaGenerar({ clase: 'grupoCampos', total: 4 }, undefined, mostrado), esperado);
  });

  test('include: los campos del include', () => {
    const nodo: NodoDiccionario = { clase: 'include', nombre: 'ZINCL_EJEMPLO', campos: [MATKL] };
    assert.deepStrictEqual(camposParaGenerar(nodo, undefined, mostrado), { tabla: 'MARA', campos: [MATKL] });
  });

  test('sin objeto con campos o desde otro nodo: undefined', () => {
    assert.strictEqual(camposParaGenerar({ clase: 'grupoCampos', total: 0 }, undefined, undefined), undefined);
    assert.strictEqual(camposParaGenerar({ clase: 'valor', valor: 'A', texto: '' }, undefined, mostrado), undefined);
  });
});

function dominio(valores: Dominio['valores']): Dominio {
  return { nombre: 'MTART', descripcion: 'Tipo de material', tipo: 'CHAR', longitud: 4, valores };
}

const TRES_VALORES = dominio([
  { valor: 'FERT', texto: 'Producto terminado' },
  { valor: 'HALB', texto: 'Producto semiterminado' },
  { valor: 'ROH', texto: 'Materia prima' },
]);

suite('diccionario/generar: CASE desde un dominio', () => {
  test('tres valores con texto: el bloque de la spec 4.5, comentarios a dos espacios del WHEN más largo', () => {
    assert.strictEqual(generarCase(TRES_VALORES, 'ls_mara-mtart'), [
      'CASE ls_mara-mtart.',
      `  WHEN 'FERT'.  " Producto terminado`,
      `  WHEN 'HALB'.  " Producto semiterminado`,
      `  WHEN 'ROH'.   " Materia prima`,
      '  WHEN OTHERS.',
      'ENDCASE.',
    ].join('\n'));
  });

  test('valor sin texto: WHEN sin comentario', () => {
    const d = dominio([{ valor: 'X', texto: '' }, { valor: 'LARGO', texto: 'Con texto' }]);
    assert.strictEqual(generarCase(d, 'lv_x'), [
      'CASE lv_x.',
      `  WHEN 'X'.`,
      `  WHEN 'LARGO'.  " Con texto`,
      '  WHEN OTHERS.',
      'ENDCASE.',
    ].join('\n'));
  });

  test('intervalo: comentario sin WHEN para él', () => {
    const d = dominio([{ valor: 'A', valorAlto: 'Z', texto: 'Letras' }, { valor: '1', texto: 'Uno' }]);
    assert.strictEqual(generarCase(d, 'lv_x'), [
      'CASE lv_x.',
      `  " intervalo 'A' - 'Z' no generado`,
      `  WHEN '1'.  " Uno`,
      '  WHEN OTHERS.',
      'ENDCASE.',
    ].join('\n'));
  });

  test(`comillas simples dentro del valor se duplican: O'NEIL → 'O''NEIL'`, () => {
    assert.ok(generarCase(dominio([{ valor: `O'NEIL`, texto: '' }]), 'lv_x').includes(`  WHEN 'O''NEIL'.`));
  });

  test('la variable entra tal cual, también como tabulación del snippet', () => {
    assert.strictEqual(generarCase(TRES_VALORES, '${1:lv_mtart}').split('\n')[0], 'CASE ${1:lv_mtart}.');
  });

  test('el texto y el valor del sistema pasan por el escape de snippet', () => {
    const lineas = generarCase(dominio([{ valor: '$', texto: 'a$b' }]), 'lv_x').split('\n');
    assert.strictEqual(lineas[1], String.raw`  WHEN '\$'.  " a\$b`);
  });

  test('escaparSnippet escapa $, } y la barra invertida', () => {
    assert.strictEqual(escaparSnippet(String.raw`a$b}c\d`), String.raw`a\$b\}c\\d`);
  });

  test('variableCase: tabulación lv_<nombre> en minúsculas, sin barras y como mucho 30 caracteres', () => {
    assert.strictEqual(variableCase('MTART'), '${1:lv_mtart}');
    assert.strictEqual(variableCase('/BOBF/STATUS'), '${1:lv_bobf_status}');
    assert.strictEqual(variableCase('A'.repeat(40)), '${1:lv_' + 'a'.repeat(27) + '}');
  });

  test('tieneValoresFijos y MAX_VALORES_CASE_SIN_PREGUNTAR (más de 50 se pregunta)', () => {
    assert.strictEqual(MAX_VALORES_CASE_SIN_PREGUNTAR, 50);
    assert.strictEqual(tieneValoresFijos(TRES_VALORES), true);
    assert.strictEqual(tieneValoresFijos(dominio([])), false);
    assert.strictEqual(tieneValoresFijos(undefined), false);
  });
});
