import * as assert from 'node:assert/strict';
import { LINEAS_ATRAS } from '../../src/diccionario/contexto';
import {
  contextoLlamadaEn,
  finDeSentenciaEn,
  lectorDeLineas,
  type ContextoLlamada,
} from '../../src/firmas/contexto-llamada';

interface Caso {
  nombre: string;
  codigo: string;
  esperado: ContextoLlamada | undefined;
}

/** El cursor se marca con `|` (se quita antes de llamar). */
function evaluar(codigo: string): ContextoLlamada | undefined {
  const lineas = codigo.split('\n');
  const fila = lineas.findIndex((l) => l.includes('|'));
  assert.ok(fila >= 0, 'el caso no marca el cursor');
  const columna = lineas[fila].indexOf('|');
  lineas[fila] = lineas[fila].slice(0, columna) + lineas[fila].slice(columna + 1);
  return contextoLlamadaEn(lectorDeLineas(lineas), fila, columna);
}

const funcion = (nombre: string): ContextoLlamada => ({ clase: 'funcion', nombre });
const clase = (nombre: string): ContextoLlamada => ({ clase: 'clase', nombre });
const metodo = (objeto: string, nombreMetodo: string, receptor: string): ContextoLlamada => ({
  clase: 'metodo',
  objeto,
  metodo: nombreMetodo,
  receptor,
});

const relleno = (n: number): string => Array.from({ length: n }, () => '    lv_n = lv_n + 1.').join('\n');

/** Clase global con la definición a más de `LINEAS_ATRAS` líneas del cursor. */
const claseH = (cuerpo: string): string =>
  [
    'CLASS zcl_h DEFINITION PUBLIC CREATE PUBLIC INHERITING FROM zcl_base.',
    '  PUBLIC SECTION.',
    '    METHODS run.',
    '    METHODS validar.',
    '  PRIVATE SECTION.',
    '    DATA mo_grid TYPE REF TO cl_gui_alv_grid.',
    'ENDCLASS.',
    '',
    'CLASS zcl_h IMPLEMENTATION.',
    '  METHOD validar.',
    relleno(300),
    '  ENDMETHOD.',
    '',
    '  METHOD run.',
    cuerpo,
    '  ENDMETHOD.',
    'ENDCLASS.',
  ].join('\n');

/** Dos métodos de una clase: `lo_x` se declara en el primero y se usa en el segundo. */
const claseConMetodos = (atributo: string): string =>
  [
    'CLASS zcl_m DEFINITION PUBLIC.',
    '  PUBLIC SECTION.',
    '    METHODS a.',
    '    METHODS b.',
    '  PRIVATE SECTION.',
    atributo,
    'ENDCLASS.',
    '',
    'CLASS zcl_m IMPLEMENTATION.',
    '  METHOD a.',
    '    DATA lo_x TYPE REF TO zcl_a.',
    '  ENDMETHOD.',
    '',
    '  METHOD b.',
    '    lo_x->r|un( ).',
    '  ENDMETHOD.',
    'ENDCLASS.',
  ].join('\n');

/** Report con `go_alv` global arriba, lo que diga `antes` y el cuerpo de `FORM b`. */
const reporteAlv = (cuerpoB: string, antes: string[]): string =>
  [
    'REPORT zr_ejemplo.',
    'DATA go_alv TYPE REF TO cl_salv_table.',
    'START-OF-SELECTION.',
    '  PERFORM b.',
    ...antes,
    '',
    'FORM b.',
    cuerpoB,
    'ENDFORM.',
  ].join('\n');

function ejecutar(casos: Caso[]): void {
  for (const c of casos) {
    test(c.nombre, () => assert.deepEqual(evaluar(c.codigo), c.esperado));
  }
}

suite('firmas-contexto-llamada', () => {
  suite('módulos de funciones', () => {
    ejecutar([
      {
        nombre: 'cursor dentro del literal',
        codigo: "CALL FUNCTION 'DDIF_FIELD|INFO_GET'\n  EXPORTING\n    tabname = 'MARA'.",
        esperado: funcion('DDIF_FIELDINFO_GET'),
      },
      {
        nombre: 'cursor sobre la comilla de apertura',
        codigo: "CALL FUNCTION |'DDIF_FIELDINFO_GET'.",
        esperado: funcion('DDIF_FIELDINFO_GET'),
      },
      {
        nombre: 'fuera de las comillas (sobre FUNCTION)',
        codigo: "CALL FUNC|TION 'DDIF_FIELDINFO_GET'.",
        esperado: undefined,
      },
      { nombre: 'dinámico sin contexto', codigo: 'CALL FUNCTION lv_|fm.', esperado: undefined },
      {
        nombre: 'otro literal de la misma sentencia',
        codigo: "CALL FUNCTION 'Z_EJEMPLO' DESTINATION 'NO|NE'.",
        esperado: undefined,
      },
      { nombre: 'literal suelto', codigo: "lv_fm = 'DDIF_FIELD|INFO_GET'.", esperado: undefined },
    ]);
  });

  suite('métodos estáticos y clases', () => {
    ejecutar([
      {
        nombre: 'cl=>m( sobre el método',
        codigo: 'cl_salv_table=>fac|tory( IMPORTING r_salv_table = lo_alv ).',
        esperado: metodo('CL_SALV_TABLE', 'FACTORY', 'cl_salv_table=>'),
      },
      {
        nombre: 'cl=>m( sobre la clase',
        codigo: 'cl_salv_table|=>factory( IMPORTING r_salv_table = lo_alv ).',
        esperado: clase('CL_SALV_TABLE'),
      },
      { nombre: 'cl=>m. a solas', codigo: 'zcl_x=>ej|ecutar.', esperado: metodo('ZCL_X', 'EJECUTAR', 'zcl_x=>') },
      {
        nombre: 'CALL METHOD cl=>m',
        codigo: 'CALL METHOD zcl_x=>ejec|utar\n  EXPORTING\n    iv_a = 1.',
        esperado: metodo('ZCL_X', 'EJECUTAR', 'zcl_x=>'),
      },
      { nombre: 'atributo estático no es llamada', codigo: 'lv_x = zcl_x=>gv_v|alor.', esperado: undefined },
      { nombre: 'NEW x(', codigo: 'DATA(lo) = NEW zcl|_x( ).', esperado: clase('ZCL_X') },
      { nombre: 'RAISE EXCEPTION TYPE', codigo: 'RAISE EXCEPTION TYPE zcx|_e.', esperado: clase('ZCX_E') },
      { nombre: 'TYPE REF TO', codigo: 'DATA lo TYPE REF TO zcl|_x.', esperado: clase('ZCL_X') },
      { nombre: 'TYPE REF TO data no es clase', codigo: 'DATA lr TYPE REF TO da|ta.', esperado: undefined },
      {
        nombre: 'INHERITING FROM',
        codigo: 'CLASS lcl_a DEFINITION\n  INHERITING FROM lcl|_base.',
        esperado: clase('LCL_BASE'),
      },
      { nombre: 'CREATE OBJECT lo TYPE x', codigo: 'CREATE OBJECT lo TYPE zcl|_x.', esperado: clase('ZCL_X') },
    ]);
  });

  suite('métodos de instancia', () => {
    ejecutar([
      {
        nombre: 'receptor declarado con TYPE REF TO',
        codigo: 'DATA lo_alv TYPE REF TO cl_salv_table.\n\nlo_alv->dis|play( ).',
        esperado: metodo('CL_SALV_TABLE', 'DISPLAY', 'lo_alv'),
      },
      {
        nombre: 'receptor DATA(lo) = NEW',
        codigo: 'DATA(lo_x) = NEW zcl_x( ).\nlo_x->r|un( ).',
        esperado: metodo('ZCL_X', 'RUN', 'lo_x'),
      },
      {
        nombre: 'receptor DATA(lo) = CAST',
        codigo: 'DATA(lo_x) = CAST zcl_x( lo_obj ).\nlo_x->r|un( ).',
        esperado: metodo('ZCL_X', 'RUN', 'lo_x'),
      },
      {
        nombre: 'receptor lo = NEW',
        codigo: 'lo_x = NEW zcl_x( ).\nlo_x->r|un( ).',
        esperado: metodo('ZCL_X', 'RUN', 'lo_x'),
      },
      {
        nombre: 'receptor CREATE OBJECT lo TYPE zcl_x',
        codigo: 'DATA lo TYPE REF TO zif_x.\nCREATE OBJECT lo TYPE zcl_x.\nlo->|m( ).',
        esperado: metodo('ZCL_X', 'M', 'lo'),
      },
      {
        nombre: 'receptor CREATE OBJECT lo TYPE zcl_x EXPORTING en otra línea',
        codigo: 'CREATE OBJECT lo TYPE zcl_x\n  EXPORTING iv_a = 1.\nlo->|m( ).',
        esperado: metodo('ZCL_X', 'M', 'lo'),
      },
      {
        nombre: 'receptor CREATE OBJECT lo TYPE (dinámico) no se resuelve',
        codigo: 'DATA lo TYPE REF TO zif_x.\nCREATE OBJECT lo TYPE (lv_dyn).\nlo->|m( ).',
        esperado: undefined,
      },
      { nombre: 'receptor desconocido', codigo: 'lo_y->r|un( ).', esperado: undefined },
      {
        nombre: 'receptor de origen no resoluble',
        codigo: 'DATA(lo_x) = lo_fabrica->crear( ).\nlo_x->r|un( ).',
        esperado: undefined,
      },
      {
        nombre: 'método de interfaz con ~',
        codigo: 'DATA(lo_x) = NEW zcl_x( ).\nlo_x->zif_a~r|un( ).',
        esperado: metodo('ZCL_X', 'ZIF_A~RUN', 'lo_x'),
      },
      {
        nombre: 'receptor tipado con una interfaz',
        codigo: 'DATA lo TYPE REF TO zif_x.\nlo->|m( ).',
        esperado: metodo('ZIF_X', 'M', 'lo'),
      },
      {
        nombre: 'CALL METHOD lo->m',
        codigo: 'DATA lo_alv TYPE REF TO cl_salv_table.\nCALL METHOD lo_alv->dis|play.',
        esperado: metodo('CL_SALV_TABLE', 'DISPLAY', 'lo_alv'),
      },
      {
        nombre: 'cursor sobre el receptor',
        codigo: 'DATA lo_alv TYPE REF TO cl_salv_table.\nlo_|alv->display( ).',
        esperado: undefined,
      },
      {
        nombre: 'comentario con "',
        codigo: 'DATA lo_alv TYPE REF TO cl_salv_table.\n  " lo_alv->dis|play( )',
        esperado: undefined,
      },
      {
        nombre: 'comentario con *',
        codigo: 'DATA lo_alv TYPE REF TO cl_salv_table.\n* lo_alv->dis|play( )',
        esperado: undefined,
      },
      {
        nombre: 'dentro de un literal',
        codigo: "DATA lo_alv TYPE REF TO cl_salv_table.\nlv_t = 'lo_alv->dis|play( )'.",
        esperado: undefined,
      },
    ]);
  });

  suite('clase envolvente', () => {
    ejecutar([
      {
        nombre: 'atributo de la definición a más de 200 líneas',
        codigo: claseH('    me->mo_grid->refresh_ta|ble_display( ).'),
        esperado: metodo('CL_GUI_ALV_GRID', 'REFRESH_TABLE_DISPLAY', 'me->mo_grid'),
      },
      {
        nombre: 'atributo sin me->',
        codigo: claseH('    mo_grid->refresh_ta|ble_display( ).'),
        esperado: metodo('CL_GUI_ALV_GRID', 'REFRESH_TABLE_DISPLAY', 'mo_grid'),
      },
      {
        nombre: 'me->m(',
        codigo: claseH('    me->vali|dar( ).'),
        esperado: metodo('ZCL_H', 'VALIDAR', 'me'),
      },
      {
        nombre: 'super->m(',
        codigo: claseH('    super->construc|tor( ).'),
        esperado: { clase: 'metodo', objeto: 'ZCL_H', metodo: 'CONSTRUCTOR', receptor: 'super', viaSuper: true },
      },
      {
        nombre: 'm( a solas',
        codigo: claseH('    vali|dar( ).'),
        esperado: metodo('ZCL_H', 'VALIDAR', ''),
      },
      { nombre: 'función predefinida', codigo: claseH('    li|nes( lt_x ).'), esperado: undefined },
      {
        nombre: 'función predefinida en una expresión',
        codigo: claseH('    lv_n = li|nes( lt_x ).'),
        esperado: undefined,
      },
      { nombre: 'DATA( no es llamada', codigo: claseH('    DA|TA(lo_x) = NEW zcl_x( ).'), esperado: undefined },
      { nombre: 'IF no es llamada', codigo: claseH('    I|F( lv_n > 0 ).'), esperado: undefined },
      { nombre: 'me->m( en un REPORT', codigo: 'REPORT zr_ejemplo.\n\nme->vali|dar( ).', esperado: undefined },
      {
        nombre: 'm( después de cerrar la clase',
        codigo: 'CLASS lcl_a IMPLEMENTATION.\nENDCLASS.\n\nSTART-OF-SELECTION.\n  vali|dar( ).',
        esperado: undefined,
      },
      {
        nombre: 'atributo no declarado',
        codigo: claseH('    me->mo_otro->refre|sh( ).'),
        esperado: undefined,
      },
    ]);
  });

  suite('revisión 1', () => {
    ejecutar([
      {
        nombre: 'NEW … )->otro( ) no da la clase del receptor',
        codigo: 'DATA(lo) = NEW zcl_builder( )->build( ).\nlo->r|un( ).',
        esperado: undefined,
      },
      {
        nombre: 'CAST … )->otro( ) en varias líneas no da la clase del receptor',
        codigo: 'DATA(lo) = CAST zcl_builder(\n  lo_obj )->build( ).\nlo->r|un( ).',
        esperado: undefined,
      },
      {
        nombre: 'la ventana no cruza ENDMETHOD',
        codigo: claseConMetodos('    DATA mo_grid TYPE REF TO cl_gui_alv_grid.'),
        esperado: undefined,
      },
      {
        nombre: 'tras ENDMETHOD se usa el atributo de la definición',
        codigo: claseConMetodos('    DATA lo_x TYPE REF TO zcl_atributo.'),
        esperado: metodo('ZCL_ATRIBUTO', 'RUN', 'lo_x'),
      },
      {
        nombre: 'la ventana no cruza ENDFORM',
        codigo: 'FORM a.\n  DATA lo_x TYPE REF TO zcl_a.\nENDFORM.\n\nFORM b.\n  lo_x->r|un( ).\nENDFORM.',
        esperado: undefined,
      },
      { nombre: 'acceso por desplazamiento no es llamada', codigo: claseH("    lv_te|xt(3) = 'ABC'."), esperado: undefined },
      { nombre: 'FINAL( no es llamada', codigo: claseH('    FIN|AL(lv) = 1.'), esperado: undefined },
    ]);
  });

  suite('revisión 2: variables globales del programa', () => {
    ejecutar([
      {
        nombre: 'global arriba, FORM a con locales, uso en FORM b',
        codigo: reporteAlv('  go_alv->dis|play( ).', ['FORM a.', '  DATA lo_tmp TYPE REF TO zcl_a.', 'ENDFORM.']),
        esperado: metodo('CL_SALV_TABLE', 'DISPLAY', 'go_alv'),
      },
      {
        nombre: 'la local de otro FORM nunca se toma',
        codigo: reporteAlv('  lo_tmp->r|un( ).', ['FORM a.', '  DATA lo_tmp TYPE REF TO zcl_a.', 'ENDFORM.']),
        esperado: undefined,
      },
      {
        nombre: 'global a 300 líneas del FORM',
        codigo: reporteAlv('  go_alv->dis|play( ).', [relleno(300)]),
        esperado: metodo('CL_SALV_TABLE', 'DISPLAY', 'go_alv'),
      },
      {
        nombre: 'la local de un método de otra clase nunca se toma',
        codigo: reporteAlv('  lo_tmp->r|un( ).', [
          'CLASS lcl_a IMPLEMENTATION.',
          '  METHOD m.',
          '    DATA lo_tmp TYPE REF TO zcl_a.',
          '  ENDMETHOD.',
          'ENDCLASS.',
        ]),
        esperado: undefined,
      },
    ]);
  });

  suite('finDeSentenciaEn', () => {
    const lector = lectorDeLineas(["CALL FUNCTION 'Z_EJEMPLO'", '  EXPORTING', '    iv_a = 1.', 'lv_n = 2.']);
    test('desde la primera fila da la fila del punto', () => assert.equal(finDeSentenciaEn(lector, 0), 2));
    test('desde una fila intermedia', () => assert.equal(finDeSentenciaEn(lector, 1), 2));
    test('sentencia de una línea', () => assert.equal(finDeSentenciaEn(lector, 3), 3));
    test('llamada de 25 parámetros da la fila del punto final', () => {
      const parametros = Array.from({ length: 25 }, (_, k) => `    iv_p${k} = ${k}`);
      parametros[24] += '.';
      const lineas = ["CALL FUNCTION 'Z_EJEMPLO'", '  EXPORTING', ...parametros, 'lv_n = 2.'];
      assert.equal(finDeSentenciaEn(lectorDeLineas(lineas), 0), 26);
    });
    test('sin punto dentro del límite da undefined', () => {
      const lineas = ["CALL FUNCTION 'Z_EJEMPLO'", ...Array.from({ length: LINEAS_ATRAS + 5 }, () => '    iv_a = 1'), '.'];
      assert.equal(finDeSentenciaEn(lectorDeLineas(lineas), 0), undefined);
    });
  });

  suite('límites', () => {
    test('fila fuera del documento', () => assert.equal(contextoLlamadaEn(lectorDeLineas(['a( ).']), 5, 0), undefined));
    test('columna negativa', () => assert.equal(contextoLlamadaEn(lectorDeLineas(['a( ).']), 0, -1), undefined));
  });
});
