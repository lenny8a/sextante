import assert from 'node:assert/strict';
import { consultaOrdenesDeObjeto } from '../../src/adt/transportes-modelo';
import {
  consultaOrdenesDeObjetoFiltro,
  esDelObjeto,
  filtroOrdenesDeObjeto,
  includesFijosDeGrupo,
  tipoConOrdenes,
} from '../../src/objeto/consulta-ordenes-objeto';

const ARCHIVOS_GRUPO = [
  'zfg_ejemplo.fugr.json',
  'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap',
  'zfg_ejemplo.fugr.lzfg_ejemplotop.reps.abap',
  'zfg_ejemplo.fugr.lzfg_ejemplof01.reps.abap',
  'zfg_ejemplo.fugr.z_ejemplo_1.func.abap',
  'zfg_ejemplo.fugr.z_ejemplo_1.func.json',
];

suite('consulta-ordenes-objeto', () => {
  test('sin extras (programa) la consulta es exactamente la del modelo congelado', () => {
    const filtro = filtroOrdenesDeObjeto('z_ejemplo_1', 'programa');
    assert.ok(filtro);
    assert.deepEqual(filtro.prefijos, []);
    assert.deepEqual(filtro.exactos, []);
    assert.equal(filtro.alcance, 'objeto');
    assert.equal(consultaOrdenesDeObjetoFiltro(filtro), consultaOrdenesDeObjeto('Z_EJEMPLO_1', ['PROG', 'REPS', 'REPT']));
  });

  test('clase: mantiene la vía rápida y añade LIKE <CLASE>=% para los includes CINC', () => {
    const filtro = filtroOrdenesDeObjeto('zcl_ejemplo', 'clase');
    assert.ok(filtro);
    assert.deepEqual(filtro.prefijos, ['ZCL_EJEMPLO=']);
    const sql = consultaOrdenesDeObjetoFiltro(filtro);
    assert.ok(
      sql.includes("WHERE ( E071~OBJ_NAME = 'ZCL_EJEMPLO' OR E071~OBJ_NAME LIKE 'ZCL_EJEMPLO %' OR E071~OBJ_NAME LIKE 'ZCL_EJEMPLO=%' ) AND E071~OBJECT IN ("),
      sql,
    );
    assert.ok(sql.includes("'CINC'"));
    assert.ok(!sql.includes('ORDER BY'));
  });

  test('clase: la fila CINC rellena con = casa; un homónimo ZAEX (el _ del LIKE) se descarta', () => {
    const filtro = filtroOrdenesDeObjeto('Z_EX', 'clase');
    assert.ok(filtro);
    assert.ok(esDelObjeto({ OBJ_NAME: 'Z_EX==========================CCAU' }, filtro));
    assert.ok(esDelObjeto({ OBJ_NAME: 'Z_EX==========================CCIMP' }, filtro));
    assert.ok(esDelObjeto({ OBJ_NAME: 'Z_EX' }, filtro));
    assert.ok(esDelObjeto({ OBJ_NAME: 'Z_EX                          METODO_1' }, filtro));
    assert.ok(!esDelObjeto({ OBJ_NAME: 'ZAEX' }, filtro));
    assert.ok(!esDelObjeto({ OBJ_NAME: 'ZAEX==========================CCAU' }, filtro));
    assert.ok(!esDelObjeto({ OBJ_NAME: 'Z_EXT=========================CCAU' }, filtro));
  });

  test('grupo de funciones: SAPL, TOP, UXX y los módulos e includes de la carpeta', () => {
    const filtro = filtroOrdenesDeObjeto('zfg_ejemplo', 'grupoFunciones', ARCHIVOS_GRUPO);
    assert.ok(filtro);
    assert.equal(filtro.alcance, 'grupo');
    assert.deepEqual(
      [...filtro.exactos].sort(),
      ['LZFG_EJEMPLOF01', 'LZFG_EJEMPLOTOP', 'LZFG_EJEMPLOUXX', 'SAPLZFG_EJEMPLO', 'Z_EJEMPLO_1'],
    );
    const sql = consultaOrdenesDeObjetoFiltro(filtro);
    assert.ok(sql.includes("E071~OBJ_NAME = 'ZFG_EJEMPLO' OR E071~OBJ_NAME LIKE 'ZFG_EJEMPLO %' OR E071~OBJ_NAME IN ("), sql);
    assert.ok(sql.includes("'Z_EJEMPLO_1'"));
    assert.ok(sql.includes("'SAPLZFG_EJEMPLO'"));
  });

  test('grupo de funciones: la fila LIMU FUNC del módulo y la REPS del include casan; otro módulo no', () => {
    const filtro = filtroOrdenesDeObjeto('ZFG_EJEMPLO', 'grupoFunciones', ARCHIVOS_GRUPO);
    assert.ok(filtro);
    assert.ok(esDelObjeto({ OBJECT: 'FUNC', OBJ_NAME: 'Z_EJEMPLO_1' }, filtro));
    assert.ok(esDelObjeto({ OBJECT: 'REPS', OBJ_NAME: 'LZFG_EJEMPLOTOP' }, filtro));
    assert.ok(esDelObjeto({ OBJECT: 'FUGR', OBJ_NAME: 'ZFG_EJEMPLO' }, filtro));
    assert.ok(!esDelObjeto({ OBJECT: 'FUNC', OBJ_NAME: 'Z_EJEMPLO_2' }, filtro));
    assert.ok(!esDelObjeto({ OBJECT: 'FUGR', OBJ_NAME: 'ZFGAEJEMPLO' }, filtro));
  });

  test('grupo de funciones sin la carpeta: solo los nombres fijos y alcance soloModulo', () => {
    const filtro = filtroOrdenesDeObjeto('ZFG_EJEMPLO', 'grupoFunciones', ['zfg_ejemplo.fugr.z_ejemplo_1.func.abap']);
    assert.ok(filtro);
    assert.equal(filtro.alcance, 'soloModulo');
    assert.ok(filtro.exactos.includes('Z_EJEMPLO_1'));
    assert.ok(filtro.exactos.includes('SAPLZFG_EJEMPLO'));
  });

  test('includesFijosDeGrupo respeta el espacio de nombres y descarta los que no caben en 30', () => {
    assert.deepEqual(includesFijosDeGrupo('ZFG'), ['SAPLZFG', 'LZFGTOP', 'LZFGUXX']);
    assert.deepEqual(includesFijosDeGrupo('/NS1/FG'), ['/NS1/SAPLFG', '/NS1/LFGTOP', '/NS1/LFGUXX']);
    assert.deepEqual(includesFijosDeGrupo('Z'.repeat(28)), []);
  });

  test('tipo desconocido o nombre no válido: sin filtro; tipoConOrdenes lo dice', () => {
    assert.equal(filtroOrdenesDeObjeto('Z_EJEMPLO_1', 'desconocido'), undefined);
    assert.equal(filtroOrdenesDeObjeto("Z'; DROP", 'clase'), undefined);
    assert.equal(tipoConOrdenes('desconocido'), false);
    assert.equal(tipoConOrdenes('clase'), true);
  });

  test('la consulta rechaza prefijos y nombres exactos no validados', () => {
    const base = filtroOrdenesDeObjeto('Z_EJEMPLO_1', 'clase');
    assert.ok(base);
    assert.throws(() => consultaOrdenesDeObjetoFiltro({ ...base, prefijos: ["Z' OR '1'='1="] }), /no válido/);
    assert.throws(() => consultaOrdenesDeObjetoFiltro({ ...base, exactos: ["X') OR ('1"] }), /no válido/);
  });
});
