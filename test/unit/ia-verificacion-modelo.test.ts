import assert from 'node:assert/strict';
import type { Diagnostico } from '../../src/ia/herramientas-escritura';
import {
  INDICACION_INCLUDES_SIN_ACTIVAR,
  ORIGEN_ACTIVACION,
  esArchivoPrincipalDePrograma,
  indicacionPorErrores,
  normalizarDiagnostico,
} from '../../src/ia/verificacion-modelo';

const CARPETA = 'abap:/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library';
const PRINCIPAL = `${CARPETA}/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap`;
const METADATOS = `${CARPETA}/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.json`;
const INCLUDE = `${CARPETA}/Includes/ZPROG_EJEMPLO_TOP/zprog_ejemplo_top.prog.abap`;
const CLASE = `${CARPETA}/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap`;

const ACTIVADO: Diagnostico = { severidad: 'error', linea: 1, columna: 1, mensaje: 'Objeto(s) activado(s)', origen: ORIGEN_ACTIVACION };
const ERROR: Diagnostico = { severidad: 'error', linea: 3, columna: 5, mensaje: 'El tipo LCL_APP es desconocido', origen: 'ABAP' };

suite('IA: modelo de la verificación', () => {
  test('el mensaje de activación en el .json de metadatos pasa a info', () => {
    assert.equal(ORIGEN_ACTIVACION, 'abapActivation');
    assert.deepEqual(normalizarDiagnostico(ACTIVADO, METADATOS), { ...ACTIVADO, severidad: 'info' });
    assert.deepEqual(normalizarDiagnostico(ACTIVADO, METADATOS.replace(/ /g, '%20')), { ...ACTIVADO, severidad: 'info' });
  });

  test('el mismo origen sobre un .abap no cambia', () => {
    assert.deepEqual(normalizarDiagnostico(ACTIVADO, PRINCIPAL), ACTIVADO);
  });

  test('otros orígenes no cambian, tampoco en el .json', () => {
    assert.deepEqual(normalizarDiagnostico(ERROR, METADATOS), ERROR);
    const sinOrigen: Diagnostico = { severidad: 'error', linea: 1, columna: 1, mensaje: 'x' };
    assert.deepEqual(normalizarDiagnostico(sinOrigen, METADATOS), sinOrigen);
  });

  test('esArchivoPrincipalDePrograma: solo el .prog.abap en la carpeta de un programa', () => {
    assert.equal(esArchivoPrincipalDePrograma(PRINCIPAL), true);
    assert.equal(esArchivoPrincipalDePrograma(PRINCIPAL.replace(/ /g, '%20')), true);
    assert.equal(esArchivoPrincipalDePrograma(METADATOS), false);
    assert.equal(esArchivoPrincipalDePrograma(INCLUDE), false);
    assert.equal(esArchivoPrincipalDePrograma(CLASE), false);
    assert.equal(esArchivoPrincipalDePrograma('file:///c/zprog.prog.abap'), false);
  });

  test('indicacionPorErrores: solo con algún error y sobre el programa principal', () => {
    assert.equal(indicacionPorErrores([ERROR], PRINCIPAL), INDICACION_INCLUDES_SIN_ACTIVAR);
    assert.equal(indicacionPorErrores([{ ...ERROR, severidad: 'aviso' }], PRINCIPAL), undefined);
    assert.equal(indicacionPorErrores([], PRINCIPAL), undefined);
    assert.equal(indicacionPorErrores([ERROR], INCLUDE), undefined);
    assert.equal(indicacionPorErrores([ERROR], CLASE), undefined);
    assert.equal(
      INDICACION_INCLUDES_SIN_ACTIVAR,
      'si el programa tiene includes sin activar, los errores de tipos o subrutinas desconocidos pueden deberse a eso: activa con activar { todo: true } y vuelve a verificar',
    );
  });
});
