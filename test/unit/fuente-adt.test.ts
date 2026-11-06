import assert from 'node:assert/strict';
import { ErrorAdt } from '../../src/adt/transporte';
import {
  compararFuentes,
  esNoExiste,
  extensionDe,
  includeDeArchivo,
  INCLUDES_CLASE,
  normalizarFuente,
  piezasDe,
  segmentoAdt,
} from '../../src/adt/fuente-adt';

suite('fuente-adt', () => {
  test('includeDeArchivo reconoce los includes de clase', () => {
    assert.equal(includeDeArchivo('zcl_x.clas.abap'), 'main');
    assert.equal(includeDeArchivo('zcl_x.clas.locals_def.abap'), 'definitions');
    assert.equal(includeDeArchivo('zcl_x.clas.definitions.abap'), 'definitions');
    assert.equal(includeDeArchivo('zcl_x.clas.locals_imp.abap'), 'implementations');
    assert.equal(includeDeArchivo('zcl_x.clas.implementations.abap'), 'implementations');
    assert.equal(includeDeArchivo('zcl_x.clas.macros.abap'), 'macros');
    assert.equal(includeDeArchivo('zcl_x.clas.testclasses.abap'), 'testclasses');
    assert.equal(includeDeArchivo('zcl_x.clas.json'), undefined);
  });

  test('INCLUDES_CLASE en orden', () => {
    assert.deepEqual([...INCLUDES_CLASE], ['main', 'definitions', 'implementations', 'macros', 'testclasses']);
  });

  test('clase: cinco piezas con la del archivo abierto primero', () => {
    const piezas = piezasDe({ tipo: 'clase', nombre: 'ZCL_X' }, 'zcl_x.clas.implementations.abap');
    assert.equal(piezas.length, 5);
    assert.equal(piezas[0].include, 'implementations');
    assert.equal(piezas[0].rutaFuente, '/sap/bc/adt/oo/classes/zcl_x/includes/implementations');
    assert.equal(piezas[0].rutaVersiones, '/sap/bc/adt/oo/classes/zcl_x/includes/implementations/versions');
    const main = piezas.find((p) => p.include === 'main');
    assert.equal(main?.rutaFuente, '/sap/bc/adt/oo/classes/zcl_x/source/main');
    assert.equal(main?.rutaVersiones, '/sap/bc/adt/oo/classes/zcl_x/includes/main/versions');
    assert.equal(main?.etiqueta, 'Clase (principal)');
  });

  test('clase con lista de archivos: solo los includes presentes', () => {
    const piezas = piezasDe({ tipo: 'clase', nombre: 'ZCL_X', archivos: ['zcl_x.clas.abap', 'zcl_x.clas.json'] });
    assert.equal(piezas.length, 1);
    assert.equal(piezas[0].archivo, 'zcl_x.clas.abap');
  });

  test('interfaz, programa, include, tabla y estructura', () => {
    const intf = piezasDe({ tipo: 'interfaz', nombre: 'ZIF_X' })[0];
    assert.equal(intf.rutaFuente, '/sap/bc/adt/oo/interfaces/zif_x/source/main');
    assert.equal(intf.rutaVersiones, '/sap/bc/adt/oo/interfaces/zif_x/source/main/versions');
    assert.equal(piezasDe({ tipo: 'programa', nombre: 'ZP' })[0].rutaFuente, '/sap/bc/adt/programs/programs/zp/source/main');
    assert.equal(piezasDe({ tipo: 'include', nombre: 'ZI' })[0].rutaFuente, '/sap/bc/adt/programs/includes/zi/source/main');
    assert.equal(piezasDe({ tipo: 'tabla', nombre: 'ZT' })[0].rutaFuente, '/sap/bc/adt/ddic/tables/zt/source/main');
    assert.equal(
      piezasDe({ tipo: 'estructura', nombre: 'ZS' })[0].rutaVersiones,
      '/sap/bc/adt/ddic/structures/zs/source/main/versions',
    );
  });

  test('cds: las versiones no llevan source/main', () => {
    const pieza = piezasDe({ tipo: 'cds', nombre: 'ZCDS' })[0];
    assert.equal(pieza.rutaFuente, '/sap/bc/adt/ddic/ddl/sources/zcds/source/main');
    assert.equal(pieza.rutaVersiones, '/sap/bc/adt/ddic/ddl/sources/zcds/versions');
  });

  test('grupo de funciones: una pieza según el archivo abierto', () => {
    const g = { tipo: 'grupoFunciones', nombre: 'ZGF' } as const;
    assert.equal(
      piezasDe(g, 'zgf.fugr.z_fm.func.abap')[0].rutaFuente,
      '/sap/bc/adt/functions/groups/zgf/fmodules/z_fm/source/main',
    );
    assert.equal(
      piezasDe(g, 'zgf.fugr.lzgfu01.reps.abap')[0].rutaFuente,
      '/sap/bc/adt/functions/groups/zgf/includes/lzgfu01/source/main',
    );
    assert.equal(
      piezasDe(g, 'zgf.fugr.saplzgf.reps.abap')[0].rutaFuente,
      '/sap/bc/adt/functions/groups/zgf/source/main',
    );
    const sin = piezasDe(g);
    assert.equal(sin.length, 1);
    assert.equal(sin[0].rutaFuente, '/sap/bc/adt/functions/groups/zgf/source/main');
    assert.equal(sin[0].rutaVersiones, '/sap/bc/adt/functions/groups/zgf/source/main/versions');
  });

  test('tipo desconocido no tiene piezas', () => {
    assert.deepEqual(piezasDe({ tipo: 'desconocido', nombre: 'X' }), []);
  });

  test('segmentoAdt escapa la barra', () => {
    assert.equal(segmentoAdt('/BOBF/CL_X'), '%2fbobf%2fcl_x');
  });

  test('normalización: fin de línea y espacios finales no cuentan', () => {
    assert.deepEqual(compararFuentes('a\r\nb  \r\n', 'a\nb\n'), { igual: true, lineas: 0 });
    assert.deepEqual(normalizarFuente('a  \r\n\r\n'), ['a']);
  });

  test('compararFuentes cuenta las líneas distintas', () => {
    assert.deepEqual(compararFuentes('a\nb\nc', 'a\nx'), { igual: false, lineas: 2 });
  });

  test('mismo contenido en otro orden: distinto con al menos una línea', () => {
    assert.deepEqual(compararFuentes('a\nb', 'b\na'),{ igual: false, lineas: 1 });
  });

  test('un lado vacío es distinto con las líneas del otro', () => {
    assert.deepEqual(compararFuentes('', 'a\nb'), { igual: false, lineas: 2 });
    assert.deepEqual(compararFuentes('a\nb', ''), { igual: false, lineas: 2 });
    assert.deepEqual(compararFuentes('', ''), { igual: true, lineas: 0 });
  });

  test('esNoExiste solo con 404', () => {
    assert.equal(esNoExiste(new ErrorAdt('x', 404, '/r')), true);
    assert.equal(esNoExiste(new ErrorAdt('x', 500, '/r')), false);
    assert.equal(esNoExiste(new Error('x')), false);
  });

  test('extensionDe', () => {
    assert.equal(extensionDe('ztab.tabl.ddic'), 'ddic');
    assert.equal(extensionDe('zcds.ddls.acds'), 'acds');
    assert.equal(extensionDe('zcl.clas.abap'), 'abap');
    assert.equal(extensionDe(undefined), 'abap');
  });
});
