import * as assert from 'assert';
import type { ClaseParametro, Excepcion, FirmaFuncion, FirmaMetodo, Parametro } from '../../src/firmas/modelo';
import { escaparSnippet } from '../../src/diccionario/generar';
import { nombreReceptorPorDefecto, patronLlamada } from '../../src/firmas/patron';

function param(nombre: string, clase: ClaseParametro, extra: Partial<Parametro> = {}): Parametro {
  return { nombre, clase, posicion: 1, tipo: 'STRING', formaTipo: 'type', porValor: false, opcional: false, ...extra };
}

function funcion(parametros: Parametro[], excepciones: Excepcion[], nombre = 'DDIF_FIELDINFO_GET'): FirmaFuncion {
  return { tipo: 'funcion', nombre, grupo: 'SDIF', rfc: false, descripcion: '', parametros, excepciones, uriAdt: '' };
}

function metodo(nombre: string, clase: string, parametros: Parametro[], extra: Partial<FirmaMetodo> = {}): FirmaMetodo {
  return {
    tipo: 'metodo',
    clase,
    nombre,
    descripcion: '',
    estatico: false,
    visibilidad: 'publico',
    abstracto: false,
    excepcionesDeClase: false,
    parametros,
    excepciones: [],
    uriAdt: '',
    ...extra,
  };
}

const BLOQUE_SUBRC = [
  'IF sy-subrc <> 0.',
  '* MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno',
  '*   WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4.',
  'ENDIF.',
];

suite('patronLlamada: módulos de funciones', () => {
  const firma = funcion(
    [
      param('TABNAME', 'importing'),
      param('FIELDNAME', 'importing', { opcional: true, porDefecto: "' '" }),
      param('LANGU', 'importing', { opcional: true, porDefecto: 'SY-LANGU' }),
      param('X030L_WA', 'exporting'),
      param('DFIES_WA', 'exporting'),
      param('DFIES_TAB', 'tables', { opcional: true }),
    ],
    [{ nombre: 'NOT_FOUND' }, { nombre: 'INTERNAL_ERROR' }],
  );

  test('produce el bloque de SE37 con opcionales comentados', () => {
    const esperado = [
      "CALL FUNCTION 'DDIF_FIELDINFO_GET'",
      '  EXPORTING',
      '    tabname        = ${1}',
      "*   fieldname      = ' '",
      '*   langu          = sy-langu',
      '  IMPORTING',
      '    x030l_wa       = ${2}',
      '    dfies_wa       = ${3}',
      '*  TABLES',
      '*   dfies_tab      = ',
      '  EXCEPTIONS',
      '    not_found      = 1',
      '    internal_error = 2',
      '    OTHERS         = 3.',
      ...BLOQUE_SUBRC,
    ].join('\n');
    assert.strictEqual(patronLlamada(firma), esperado);
  });

  test('sin excepciones no hay EXCEPTIONS ni IF sy-subrc', () => {
    const sola = funcion([param('A', 'importing'), param('B', 'exporting'), param('C', 'changing')], [], 'Z_FM');
    const esperado = [
      "CALL FUNCTION 'Z_FM'",
      '  EXPORTING',
      '    a = ${1}',
      '  IMPORTING',
      '    b = ${2}',
      '  CHANGING',
      '    c = ${3}.',
    ].join('\n');
    assert.strictEqual(patronLlamada(sola), esperado);
  });

  test('sin parámetros ni excepciones', () => {
    assert.strictEqual(patronLlamada(funcion([], [], 'Z_FM')), "CALL FUNCTION 'Z_FM'.");
  });
});

suite('patronLlamada: métodos', () => {
  test('estático con TRY, opcionales comentados y bloques invertidos', () => {
    const firma = metodo(
      'FACTORY',
      'CL_SALV_TABLE',
      [
        param('LIST_DISPLAY', 'importing', { opcional: true, porDefecto: 'IF_SALV_C_BOOL_SAP=>FALSE' }),
        param('R_CONTAINER', 'importing', { opcional: true }),
        param('R_SALV_TABLE', 'exporting'),
        param('T_TABLE', 'changing'),
      ],
      { estatico: true, excepcionesDeClase: true, excepciones: [{ nombre: 'CX_SALV_MSG' }] },
    );
    const esperado = [
      'TRY.',
      '    cl_salv_table=>factory(',
      '*      EXPORTING',
      '*       list_display = if_salv_c_bool_sap=>false',
      '*       r_container  = ',
      '      IMPORTING',
      '        r_salv_table = ${1}',
      '      CHANGING',
      '        t_table      = ${2} ).',
      '  CATCH cx_salv_msg INTO DATA(lx_error).',
      'ENDTRY.',
    ].join('\n');
    assert.strictEqual(patronLlamada(firma, { receptor: '' }), esperado);
  });

  test('varias clases de excepción numeran lx_error', () => {
    const firma = metodo('M', 'CL_X', [], {
      estatico: true,
      excepcionesDeClase: true,
      excepciones: [{ nombre: 'CX_A' }, { nombre: 'CX_B' }],
    });
    const esperado = [
      'TRY.',
      '    cl_x=>m( ).',
      '  CATCH cx_a INTO DATA(lx_error).',
      '  CATCH cx_b INTO DATA(lx_error_2).',
      'ENDTRY.',
    ].join('\n');
    assert.strictEqual(patronLlamada(firma), esperado);
  });

  test('sin parámetros con receptor', () => {
    assert.strictEqual(patronLlamada(metodo('DISPLAY', 'CL_SALV_TABLE', []), { receptor: 'lo_alv' }), 'lo_alv->display( ).');
    assert.strictEqual(patronLlamada(metodo('DISPLAY', 'CL_SALV_TABLE', []), { receptor: 'lo_alv->' }), 'lo_alv->display( ).');
  });

  test('sin receptor usa un placeholder', () => {
    assert.strictEqual(patronLlamada(metodo('DISPLAY', 'CL_SALV_TABLE', [])), '${1:lo_salv_table}->display( ).');
  });

  test('me y super', () => {
    assert.strictEqual(patronLlamada(metodo('VALIDAR', 'ZCL_X', []), { receptor: 'me' }), 'me->validar( ).');
    assert.strictEqual(patronLlamada(metodo('VALIDAR', 'ZCL_X', []), { receptor: 'super' }), 'super->validar( ).');
  });

  test('excepción clásica y returning usan CALL METHOD con RECEIVING', () => {
    const firma = metodo(
      'DESCRIBE_BY_NAME',
      'CL_ABAP_TYPEDESCR',
      [param('P_NAME', 'importing'), param('P_DESCR_REF', 'returning')],
      { estatico: true, excepciones: [{ nombre: 'TYPE_NOT_FOUND' }] },
    );
    const esperado = [
      'CALL METHOD cl_abap_typedescr=>describe_by_name',
      '  EXPORTING',
      '    p_name         = ${1}',
      '  RECEIVING',
      '    p_descr_ref    = ${2}',
      '  EXCEPTIONS',
      '    type_not_found = 1',
      '    OTHERS         = 2.',
      ...BLOQUE_SUBRC,
    ].join('\n');
    assert.strictEqual(patronLlamada(firma), esperado);
  });

  test('constructor genera NEW', () => {
    const firma = metodo('CONSTRUCTOR', 'ZCL_X', [param('IV_A', 'importing')]);
    assert.strictEqual(patronLlamada(firma), 'DATA(${1:lo_x}) = NEW zcl_x( iv_a = ${2} ).');
  });

  test('constructor con opcional: NEW sin EXPORTING', () => {
    const firma = metodo('CONSTRUCTOR', 'ZCL_X', [
      param('IV_A', 'importing'),
      param('IV_B', 'importing', { opcional: true, porDefecto: 'ABAP_TRUE' }),
    ]);
    const esperado = [
      'DATA(${1:lo_x}) = NEW zcl_x(',
      '    iv_a = ${2} ).',
      '*   iv_b = abap_true',
    ].join('\n');
    assert.strictEqual(patronLlamada(firma), esperado);
  });

  test('constructor que no cabe en 80 columnas: NEW sin EXPORTING', () => {
    const firma = metodo('CONSTRUCTOR', 'ZCL_X', [
      param('IV_PARAMETRO_LARGO_UNO_XXXXXX', 'importing'),
      param('IV_PARAMETRO_LARGO_DOS_XXXXXX', 'importing'),
    ]);
    const esperado = [
      'DATA(${1:lo_x}) = NEW zcl_x(',
      '    iv_parametro_largo_uno_xxxxxx = ${2}',
      '    iv_parametro_largo_dos_xxxxxx = ${3} ).',
    ].join('\n');
    assert.strictEqual(patronLlamada(firma), esperado);
  });

  test('returning sin excepciones usa asignación funcional', () => {
    const firma = metodo('GET', 'ZCL_X', [param('IV_A', 'importing'), param('RV_RESULTADO', 'returning')]);
    assert.strictEqual(patronLlamada(firma, { receptor: 'lo_x' }), 'DATA(${1:lv_rv_resultado}) = lo_x->get( iv_a = ${2} ).');
  });

  test('dos importing obligatorios cortos caben en una línea', () => {
    const firma = metodo('M', 'ZCL_X', [param('IV_A', 'importing'), param('IV_B', 'importing')]);
    assert.strictEqual(patronLlamada(firma, { receptor: 'lo_x' }), 'lo_x->m( iv_a = ${1} iv_b = ${2} ).');
  });

  test('una llamada que no cabe en 80 columnas pasa a varias líneas', () => {
    const firma = metodo('M', 'ZCL_X', [
      param('IV_PARAMETRO_LARGO_UNO_XXXXXX', 'importing'),
      param('IV_PARAMETRO_LARGO_DOS_XXXXXX', 'importing'),
    ]);
    const esperado = [
      'lo_x->m(',
      '  EXPORTING',
      '    iv_parametro_largo_uno_xxxxxx = ${1}',
      '    iv_parametro_largo_dos_xxxxxx = ${2} ).',
    ].join('\n');
    assert.strictEqual(patronLlamada(firma, { receptor: 'lo_x' }), esperado);
  });

  test('escapa el texto del sistema', () => {
    const firma = metodo('M', '/BOBF/CL_X', [param('IV_X', 'importing', { opcional: true, porDefecto: "'$'" })], {
      estatico: true,
    });
    const esperado = ['/bobf/cl_x=>m( ).', '*  EXPORTING', "*   iv_x = '\\$'"].join('\n');
    assert.strictEqual(patronLlamada(firma), esperado);
  });
});

suite('escaparSnippet y nombreReceptorPorDefecto', () => {
  test('escapa $, } y \\', () => {
    assert.strictEqual(escaparSnippet('a$b}c\\d'), 'a\\$b\\}c\\\\d');
  });

  test('deduce el nombre del receptor', () => {
    assert.strictEqual(nombreReceptorPorDefecto('CL_SALV_TABLE'), 'lo_salv_table');
    assert.strictEqual(nombreReceptorPorDefecto('ZCL_X'), 'lo_x');
    assert.strictEqual(nombreReceptorPorDefecto('/BOBF/CL_Y'), 'lo_y');
  });
});
