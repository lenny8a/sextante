import assert from 'node:assert/strict';
import {
  analizarNombreAff,
  analizarUriAbap,
  archivoPrincipal,
  clasificarArchivoFugr,
  rutaConDestino,
  rutaDeObjeto,
  tipoObjetoDe,
} from '../../src/bridge/adt-uri';

const OBJETO_EJEMPLO = {
  biblioteca: 'System Library',
  paquete: 'ZPAQ1',
  categoria: 'Source Library',
  tipoCarpeta: 'Classes',
  nombre: 'ZCL_EJEMPLO',
};

suite('analizarUriAbap', () => {
  test('objeto en subpaquete', () => {
    assert.deepStrictEqual(
      analizarUriAbap({ scheme: 'abap', path: '/repotree-v1/DEST/ZPAQ/ZSUB/zcl_x.clas.abap' }),
      { destino: 'DEST', carpetas: ['ZPAQ', 'ZSUB'], archivo: 'zcl_x.clas.abap' });
  });
  test('layout real de fase 0 (anonimizado)', () => {
    assert.deepStrictEqual(
      analizarUriAbap({
        scheme: 'abap',
        path: '/repotree-v1/DEST/System Library/ZPAQ1/Source Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap',
      }),
      {
        destino: 'DEST',
        carpetas: ['System Library', 'ZPAQ1', 'Source Library', 'Classes', 'ZCL_EJEMPLO'],
        archivo: 'zcl_ejemplo.clas.abap',
        objeto: OBJETO_EJEMPLO,
      });
  });
  test('raíz del destino', () => {
    assert.deepStrictEqual(analizarUriAbap({ scheme: 'abap', path: '/repotree-v1/DEST' }),
      { destino: 'DEST', carpetas: [] });
  });
  test('layout real rellena objeto', () => {
    const r = analizarUriAbap({ scheme: 'abap', path: '/repotree-v1/DEST/System Library/ZPAQ1/Source Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap' });
    assert.deepStrictEqual(r?.objeto, OBJETO_EJEMPLO);
  });
  test('carpeta intermedia no tiene objeto', () => {
    assert.strictEqual(analizarUriAbap({ scheme: 'abap', path: '/repotree-v1/DEST/System Library/ZPAQ1' })?.objeto, undefined);
  });
  test('sin destino devuelve undefined', () => {
    assert.strictEqual(analizarUriAbap({ scheme: 'abap', path: '/repotree-v1' }), undefined);
  });
  test('otra raíz devuelve undefined', () => {
    assert.strictEqual(analizarUriAbap({ scheme: 'abap', path: '/otra/DEST/x.prog.abap' }), undefined);
  });
  test('otro esquema devuelve undefined', () => {
    assert.strictEqual(analizarUriAbap({ scheme: 'file', path: '/repotree-v1/DEST' }), undefined);
  });
});

suite('rutaConDestino', () => {
  test('sustituye solo el segmento de destino', () => {
    assert.strictEqual(rutaConDestino('/repotree-v1/DEV/ZPAQ/zcl_x.clas.abap', 'QAS'),
      '/repotree-v1/QAS/ZPAQ/zcl_x.clas.abap');
  });
});

suite('analizarNombreAff', () => {
  test('clase principal', () => {
    assert.deepStrictEqual(analizarNombreAff('zcl_x.clas.abap'),
      { nombre: 'zcl_x', tipo: 'clas', extension: 'abap' });
  });
  test('extensión compuesta', () => {
    assert.deepStrictEqual(analizarNombreAff('zcl_x.clas.testclasses.abap'),
      { nombre: 'zcl_x', tipo: 'clas', extension: 'testclasses.abap' });
  });
  test('namespace', () => {
    assert.deepStrictEqual(analizarNombreAff('(ns)zcl_x.clas.abap'),
      { nombre: '(ns)zcl_x', tipo: 'clas', extension: 'abap' });
  });
  test('sin tipo devuelve undefined', () => {
    assert.strictEqual(analizarNombreAff('launch.json'), undefined);
  });
});

suite('rutaDeObjeto', () => {
  test('reconstruye la ruta con y sin archivo', () => {
    assert.strictEqual(rutaDeObjeto('DEST', OBJETO_EJEMPLO, 'zcl_ejemplo.clas.abap'),
      '/repotree-v1/DEST/System Library/ZPAQ1/Source Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap');
    assert.strictEqual(rutaDeObjeto('DEST', OBJETO_EJEMPLO),
      '/repotree-v1/DEST/System Library/ZPAQ1/Source Library/Classes/ZCL_EJEMPLO');
  });
});

suite('tipoObjetoDe', () => {
  test('por carpeta, por AFF y desconocido', () => {
    assert.strictEqual(tipoObjetoDe('Includes', 'prog'), 'include');
    assert.strictEqual(tipoObjetoDe(undefined, 'prog'), 'programa');
    assert.strictEqual(tipoObjetoDe('ABAP DDL Sources', undefined), 'cds');
    assert.strictEqual(tipoObjetoDe('Views', undefined), 'desconocido');
    assert.strictEqual(tipoObjetoDe('Domains', 'doma'), 'desconocido');
  });
  test('layout S/4: tablas, estructuras y grupos de funciones', () => {
    assert.strictEqual(tipoObjetoDe('Database Tables', 'tabl'), 'tabla');
    assert.strictEqual(tipoObjetoDe('Structures', 'tabl'), 'estructura');
    assert.strictEqual(tipoObjetoDe('Function Groups', 'fugr'), 'grupoFunciones');
    assert.strictEqual(tipoObjetoDe(undefined, 'tabl'), 'tabla');
    assert.strictEqual(tipoObjetoDe(undefined, 'fugr'), 'grupoFunciones');
    assert.strictEqual(tipoObjetoDe('Function Groups', undefined), 'grupoFunciones');
  });
});

const ARCHIVOS_FUGR = [
  'zfg_ejemplo.fugr.json',
  'zfg_ejemplo.fugr.lzfg_ejemplotop.reps.abap',
  'zfg_ejemplo.fugr.lzfg_ejemplotop.reps.json',
  'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap',
  'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.json',
  'zfg_ejemplo.fugr.z_fm_ejemplo.func.abap',
  'zfg_ejemplo.fugr.z_fm_ejemplo.func.json',
];

suite('clasificarArchivoFugr', () => {
  test('módulo de función, include, principal y json', () => {
    assert.deepStrictEqual(clasificarArchivoFugr('zfg_ejemplo.fugr.z_fm_ejemplo.func.abap'),
      { archivo: 'zfg_ejemplo.fugr.z_fm_ejemplo.func.abap', clase: 'moduloFuncion', nombre: 'Z_FM_EJEMPLO' });
    assert.deepStrictEqual(clasificarArchivoFugr('zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap'),
      { archivo: 'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap', clase: 'principal', nombre: 'SAPLZFG_EJEMPLO' });
    assert.deepStrictEqual(clasificarArchivoFugr('zfg_ejemplo.fugr.lzfg_ejemplotop.reps.abap'),
      { archivo: 'zfg_ejemplo.fugr.lzfg_ejemplotop.reps.abap', clase: 'include', nombre: 'LZFG_EJEMPLOTOP' });
    assert.strictEqual(clasificarArchivoFugr('zfg_ejemplo.fugr.json'), undefined);
    assert.strictEqual(clasificarArchivoFugr('zfg_ejemplo.fugr.z_fm_ejemplo.func.json'), undefined);
    assert.strictEqual(clasificarArchivoFugr('zfg_ejemplo.fugr.saplzfg_ejemplo.reps.json'), undefined);
  });
  test('cualquier otro archivo es otro; un nombre no AFF es undefined', () => {
    assert.strictEqual(clasificarArchivoFugr('zfg_ejemplo.fugr.algo.xyz.abap')?.clase, 'otro');
    assert.strictEqual(clasificarArchivoFugr('launch.json'), undefined);
  });
});

suite('archivoPrincipal', () => {
  test('prefiere .abap de tres partes, luego .acds, nunca json', () => {
    assert.strictEqual(archivoPrincipal(['zcl_x.clas.json', 'zcl_x.clas.localtypes.abap', 'zcl_x.clas.abap']), 'zcl_x.clas.abap');
    assert.strictEqual(archivoPrincipal(['zcds.ddls.json', 'zcds.ddls.acds']), 'zcds.ddls.acds');
    assert.strictEqual(archivoPrincipal(['zpaq1.devck.jsonc']), undefined);
  });
  test('S/4: tabla por .ddic, grupo de funciones por su SAPL, json nunca', () => {
    assert.strictEqual(archivoPrincipal(['ztab_ejemplo.tabl.json', 'ztab_ejemplo.tabl.ddic']), 'ztab_ejemplo.tabl.ddic');
    assert.strictEqual(archivoPrincipal(ARCHIVOS_FUGR), 'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap');
    assert.strictEqual(archivoPrincipal(['zpaq_s4.devc.json']), undefined);
    assert.strictEqual(archivoPrincipal([]), undefined);
  });
  test('orden de preferencia: abap de tres partes > acds > ddic > SAPL > otro .abap > no json', () => {
    const fm = 'zfg_ejemplo.fugr.z_fm_ejemplo.func.abap';
    assert.strictEqual(archivoPrincipal([fm, 'x.tabl.ddic', 'x.ddls.acds', 'x.clas.abap']), 'x.clas.abap');
    assert.strictEqual(archivoPrincipal([fm, 'x.tabl.ddic', 'x.ddls.acds']), 'x.ddls.acds');
    assert.strictEqual(archivoPrincipal([fm, 'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap', 'x.tabl.ddic']), 'x.tabl.ddic');
    assert.strictEqual(archivoPrincipal([fm, 'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap']), 'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap');
    assert.strictEqual(archivoPrincipal(['x.y.json', 'x.y.txt', fm]), fm);
    assert.strictEqual(archivoPrincipal(['x.y.json', 'x.y.txt']), 'x.y.txt');
  });
});
