import assert from 'node:assert/strict';
import { rutaParaLog } from '../../src/adt/transporte';

const CASOS: ReadonlyArray<readonly [string, string]> = [
  ['/sap/bc/adt/ddic/tables/zt_ejemplo', '/sap/bc/adt/ddic/tables/<objeto>'],
  ['/sap/bc/adt/ddic/structures/zs_ejemplo/source/main', '/sap/bc/adt/ddic/structures/<objeto>/source/main'],
  ['/sap/bc/adt/ddic/dataelements/%2fns%2fz_ejemplo', '/sap/bc/adt/ddic/dataelements/<objeto>'],
  ['/sap/bc/adt/ddic/domains/zd_ejemplo', '/sap/bc/adt/ddic/domains/<objeto>'],
  ['/sap/bc/adt/ddic/ddl/sources/zi_ejemplo', '/sap/bc/adt/ddic/ddl/sources/<objeto>'],
  ['/sap/bc/adt/oo/classes/zcl_ejemplo', '/sap/bc/adt/oo/classes/<objeto>'],
  ['/sap/bc/adt/oo/classes/zcl_ejemplo/source/main', '/sap/bc/adt/oo/classes/<objeto>/source/main'],
  ['/sap/bc/adt/oo/interfaces/zif_ejemplo', '/sap/bc/adt/oo/interfaces/<objeto>'],
  ['/sap/bc/adt/programs/programs/zr_ejemplo', '/sap/bc/adt/programs/programs/<objeto>'],
  ['/sap/bc/adt/programs/includes/zi_ejemplo_top', '/sap/bc/adt/programs/includes/<objeto>'],
  ['/sap/bc/adt/functions/groups/zfg_ejemplo', '/sap/bc/adt/functions/groups/<objeto>'],
  ['/sap/bc/adt/functions/groups/zfg_ejemplo/fmodules/z_fm_ejemplo', '/sap/bc/adt/functions/groups/<objeto>/fmodules/<objeto>'],
  ['/sap/bc/adt/packages/zpaq1', '/sap/bc/adt/packages/<objeto>'],
];

const SIN_CAMBIO: readonly string[] = [
  '/sap/bc/adt/discovery',
  '/sap/bc/adt/ddic/tables',
  '/sap/bc/adt/datapreview/freestyle',
  '/sap/bc/adt/datapreview/ddic',
  '/sap/bc/adt/repository/informationsystem/search',
  '/sap/bc/adt/repository/nodestructure',
  '/sap/bc/adt/x',
  '',
];

suite('rutaParaLog', () => {
  for (const [ruta, esperada] of CASOS) {
    test(`enmascara ${esperada}`, () => {
      assert.equal(rutaParaLog(ruta), esperada);
    });
  }

  test('las rutas sin nombre de objeto quedan igual', () => {
    for (const ruta of SIN_CAMBIO) {
      assert.equal(rutaParaLog(ruta), ruta);
    }
  });

  test('no deja el nombre del objeto en ningún caso de la tabla', () => {
    for (const [ruta] of CASOS) {
      assert.ok(!rutaParaLog(ruta).includes('ejemplo') && !rutaParaLog(ruta).includes('zpaq1'), ruta);
    }
  });
});
