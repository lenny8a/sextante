import assert from 'node:assert/strict';
import {
  MAX_ARCHIVOS_FORM,
  includesDe,
  lineaDeForm,
  localizarForm,
  performEnLinea,
  rutaDeInclude,
  rutaPrincipalDeObjeto,
} from '../../src/navegacion/perform-modelo';

const RUTA_PROG = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap';
const RUTA_TOP = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Includes/ZPROG_EJEMPLO_TOP/zprog_ejemplo_top.prog.abap';
const RUTA_F01 = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Includes/ZPROG_EJEMPLO_F01/zprog_ejemplo_f01.prog.abap';
const RUTA_FUGR = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Function Groups/ZFG_EJEMPLO/zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap';
const RUTA_CLASE = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap';

suite('navegación a FORM: sentencia PERFORM bajo el cursor', () => {
  const linea = '  PERFORM calcular_total USING lv_a CHANGING lv_b.';

  test('con el cursor sobre el nombre devuelve el FORM en mayúsculas', () => {
    assert.equal(performEnLinea(linea, linea.indexOf('calcular') + 3), 'CALCULAR_TOTAL');
  });

  test('con el cursor sobre la palabra PERFORM también', () => {
    assert.equal(performEnLinea(linea, 4), 'CALCULAR_TOTAL');
  });

  test('con el cursor sobre los parámetros no navega', () => {
    assert.equal(performEnLinea(linea, linea.indexOf('lv_a')), undefined);
  });

  test('acepta minúsculas, punto pegado y nombres con espacio de nombres', () => {
    assert.equal(performEnLinea('perform /ns/form_x.', 12), '/NS/FORM_X');
  });

  test('ignora comentarios de asterisco y de comillas', () => {
    assert.equal(performEnLinea('* PERFORM viejo.', 12), undefined);
    assert.equal(performEnLinea('  lv_x = 1. " PERFORM viejo.', 20), undefined);
  });

  test('no resuelve PERFORM dinámicos ni externos', () => {
    assert.equal(performEnLinea('  PERFORM (lv_form) IN PROGRAM (lv_prog).', 12), undefined);
    assert.equal(performEnLinea('  PERFORM externo(zprog_otro).', 12), undefined);
    assert.equal(performEnLinea('  PERFORM externo IN PROGRAM zprog_otro.', 12), undefined);
  });

  test('en una lista encadenada toma el nombre bajo el cursor', () => {
    const encadenada = '  PERFORM: inicio, proceso USING lv_x, fin.';
    assert.equal(performEnLinea(encadenada, encadenada.indexOf('proceso') + 2), 'PROCESO');
    assert.equal(performEnLinea(encadenada, encadenada.indexOf('fin')), 'FIN');
    assert.equal(performEnLinea(encadenada, encadenada.indexOf('lv_x')), undefined);
  });

  test('una línea que no es PERFORM no navega', () => {
    assert.equal(performEnLinea('  CALL FUNCTION zfm.', 8), undefined);
  });
});

suite('navegación a FORM: buscar el FORM en un texto', () => {
  const texto = [
    '*&---------------------------------------------------------------*',
    '* FORM calcular_total (comentario)',
    'FORM imprimir.',
    'ENDFORM.',
    '  FORM calcular_total_2 USING p.',
    '  ENDFORM.',
    'form calcular_total  USING p_a',
    '                     CHANGING p_b.',
    'ENDFORM.',
  ].join('\n');

  test('devuelve la línea y la columna del nombre, sin confundir prefijos ni comentarios', () => {
    assert.deepEqual(lineaDeForm(texto, 'CALCULAR_TOTAL'), { linea: 6, columna: 5 });
    assert.deepEqual(lineaDeForm(texto, 'calcular_total_2'), { linea: 4, columna: 7 });
    assert.deepEqual(lineaDeForm(texto, 'IMPRIMIR'), { linea: 2, columna: 5 });
  });

  test('sin el FORM devuelve undefined', () => {
    assert.equal(lineaDeForm(texto, 'NO_EXISTE'), undefined);
  });

  test('reconoce el FORM cuyo nombre cierra la línea (parámetros en la siguiente)', () => {
    assert.deepEqual(lineaDeForm('FORM solo_nombre\n  USING p.\nENDFORM.', 'SOLO_NOMBRE'), { linea: 0, columna: 5 });
  });

  test('acepta finales de línea CR+LF', () => {
    assert.deepEqual(lineaDeForm('DATA x.\r\nFORM uno.\r\nENDFORM.', 'UNO'), { linea: 1, columna: 5 });
  });
});

suite('navegación a FORM: includes de un texto', () => {
  test('lista los INCLUDE de programa en mayúsculas, sin repetidos ni comentarios', () => {
    const texto = [
      'REPORT zprog_ejemplo.',
      'INCLUDE zprog_ejemplo_top.',
      '* INCLUDE zprog_viejo.',
      '  include zprog_ejemplo_f01 .',
      'INCLUDE zprog_ejemplo_f01.',
      'INCLUDE zprog_ejemplo_o01 IF FOUND.',
      'INCLUDE: zprog_a, zprog_b.',
    ].join('\n');
    assert.deepEqual(includesDe(texto), [
      'ZPROG_EJEMPLO_TOP',
      'ZPROG_EJEMPLO_F01',
      'ZPROG_EJEMPLO_O01',
      'ZPROG_A',
      'ZPROG_B',
    ]);
  });

  test('no confunde INCLUDE TYPE, INCLUDE STRUCTURE ni INCLUDE METHODS', () => {
    const texto = ['TYPES: BEGIN OF ty.', '  INCLUDE TYPE ty_base.', 'INCLUDE STRUCTURE mara.', 'INCLUDE METHODS m.'].join('\n');
    assert.deepEqual(includesDe(texto), []);
  });
});

suite('navegación a FORM: ruta de un include junto al origen', () => {
  test('de un programa cuelga de la carpeta Includes del mismo paquete', () => {
    assert.equal(rutaDeInclude(RUTA_PROG, 'ZPROG_EJEMPLO_TOP'), RUTA_TOP);
  });

  test('de un include es un include hermano', () => {
    assert.equal(rutaDeInclude(RUTA_TOP, 'zprog_ejemplo_f01'), RUTA_F01);
  });

  test('de un grupo de funciones es un archivo reps del mismo grupo', () => {
    assert.equal(
      rutaDeInclude(RUTA_FUGR, 'LZFG_EJEMPLOF01'),
      '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Function Groups/ZFG_EJEMPLO/zfg_ejemplo.fugr.lzfg_ejemplof01.reps.abap',
    );
  });

  test('de una clase o de una ruta que no es de objeto no hay include', () => {
    assert.equal(rutaDeInclude(RUTA_CLASE, 'ZX'), undefined);
    assert.equal(rutaDeInclude('/otra/cosa', 'ZX'), undefined);
  });
});

suite('navegación a FORM: localizar el FORM entre el origen y sus includes', () => {
  const textos: Record<string, string> = {
    [RUTA_PROG]: 'REPORT zprog_ejemplo.\nINCLUDE zprog_ejemplo_top.\nINCLUDE zprog_ejemplo_f01.\nSTART-OF-SELECTION.\n  PERFORM calcular.',
    [RUTA_TOP]: 'DATA gv_x TYPE i.\nINCLUDE zprog_ejemplo_f01.',
    [RUTA_F01]: '*----*\nFORM calcular.\nENDFORM.\nFORM otro.\nENDFORM.',
  };
  const leer = (leidas: string[]) => async (ruta: string): Promise<string | undefined> => {
    leidas.push(ruta);
    return textos[ruta];
  };

  test('lo encuentra en el propio origen sin leer nada más', async () => {
    const leidas: string[] = [];
    const resultado = await localizarForm('OTRO', { ruta: RUTA_F01, texto: textos[RUTA_F01] }, leer(leidas));
    assert.deepEqual(resultado, { destino: { ruta: RUTA_F01, linea: 3, columna: 5 }, leidos: 1 });
    assert.deepEqual(leidas, []);
  });

  test('sigue los INCLUDE del origen en orden y se detiene en el primero que lo tiene', async () => {
    const leidas: string[] = [];
    const resultado = await localizarForm('CALCULAR', { ruta: RUTA_PROG, texto: textos[RUTA_PROG] }, leer(leidas));
    assert.deepEqual(resultado, { destino: { ruta: RUTA_F01, linea: 1, columna: 5 }, leidos: 3 });
    assert.deepEqual(leidas, [RUTA_TOP, RUTA_F01]);
  });

  test('desde un include busca también en el programa principal y en sus includes', async () => {
    const leidas: string[] = [];
    const resultado = await localizarForm(
      'CALCULAR',
      { ruta: RUTA_TOP, texto: textos[RUTA_TOP].split('\n')[0], rutaPrincipal: RUTA_PROG },
      leer(leidas),
    );
    assert.deepEqual(resultado?.destino, { ruta: RUTA_F01, linea: 1, columna: 5 });
    assert.deepEqual(leidas, [RUTA_PROG, RUTA_F01]);
  });

  test('un include que no se puede leer se salta y no se visita dos veces', async () => {
    const leidas: string[] = [];
    const sinTop = { ...textos };
    delete sinTop[RUTA_TOP];
    const resultado = await localizarForm('CALCULAR', { ruta: RUTA_PROG, texto: textos[RUTA_PROG] }, async (ruta: string) => {
      leidas.push(ruta);
      return sinTop[ruta];
    });
    assert.deepEqual(resultado?.destino, { ruta: RUTA_F01, linea: 1, columna: 5 });
    assert.deepEqual(leidas, [RUTA_TOP, RUTA_F01]);
  });

  test('sin el FORM devuelve el conteo de archivos mirados', async () => {
    const resultado = await localizarForm('NO_EXISTE', { ruta: RUTA_PROG, texto: textos[RUTA_PROG] }, leer([]));
    assert.deepEqual(resultado, { destino: undefined, leidos: 3 });
  });

  test('no lee más archivos que el máximo', async () => {
    const includes = Array.from({ length: MAX_ARCHIVOS_FORM + 10 }, (_, i) => `INCLUDE zinc_${i}.`).join('\n');
    const leidas: string[] = [];
    const resultado = await localizarForm('NO_EXISTE', { ruta: RUTA_PROG, texto: includes }, async (ruta: string) => {
      leidas.push(ruta);
      return 'DATA x.';
    });
    assert.equal(resultado.leidos, MAX_ARCHIVOS_FORM);
    assert.equal(leidas.length, MAX_ARCHIVOS_FORM - 1);
  });

  test('un origen que no es de objeto solo se busca a sí mismo', async () => {
    const resultado = await localizarForm('X', { ruta: '/otra/cosa', texto: 'INCLUDE zx.\nFORM x.\nENDFORM.' }, leer([]));
    assert.deepEqual(resultado, { destino: { ruta: '/otra/cosa', linea: 1, columna: 5 }, leidos: 1 });
  });
});

suite('navegación a FORM: archivo principal del objeto mostrado', () => {
  const objetoDe = (tipoCarpeta: string, nombre: string) => ({
    biblioteca: 'System Library',
    paquete: 'ZPAQ1',
    categoria: 'Source Code Library',
    tipoCarpeta,
    nombre,
  });

  test('de un programa es su .prog.abap', () => {
    const ruta = rutaPrincipalDeObjeto({
      tipo: 'programa',
      archivos: ['zprog_ejemplo.prog.json', 'zprog_ejemplo.prog.abap'],
      destino: 'DEST',
      objeto: objetoDe('Programs', 'ZPROG_EJEMPLO'),
    });
    assert.equal(ruta, RUTA_PROG);
  });

  test('de un grupo de funciones es el include sapl<grupo>', () => {
    const ruta = rutaPrincipalDeObjeto({
      tipo: 'grupoFunciones',
      archivos: ['zfg_ejemplo.fugr.json', 'zfg_ejemplo.fugr.z_fm_ejemplo.func.abap', 'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap'],
      destino: 'DEST',
      objeto: objetoDe('Function Groups', 'ZFG_EJEMPLO'),
    });
    assert.equal(ruta, RUTA_FUGR);
  });

  test('una clase o un include no tienen principal', () => {
    assert.equal(
      rutaPrincipalDeObjeto({ tipo: 'clase', archivos: ['zcl_ejemplo.clas.abap'], destino: 'DEST', objeto: objetoDe('Classes', 'ZCL_EJEMPLO') }),
      undefined,
    );
    assert.equal(
      rutaPrincipalDeObjeto({ tipo: 'include', archivos: ['zprog_ejemplo_top.prog.abap'], destino: 'DEST', objeto: objetoDe('Includes', 'ZPROG_EJEMPLO_TOP') }),
      undefined,
    );
  });
});
