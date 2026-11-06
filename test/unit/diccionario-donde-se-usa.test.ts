import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  ACCEPT_USOS,
  CONTENT_TYPE_USOS,
  RUTA_USOS,
  TIEMPO_USOS_MS,
  agruparUsos,
  analizarUsos,
  cuerpoUsos,
  esPropio,
  esUsoPropio,
  filtrarUsos,
  namespacesNoPropios,
  type Uso,
} from '../../src/diccionario/donde-se-usa';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function uso(parcial: Partial<Uso>): Uso {
  return { nombre: 'Z_EJEMPLO_1', tipoAdt: 'PROG/P', descripcion: '', uriAdt: '/sap/bc/adt/programs/programs/z_ejemplo_1', paquete: 'ZPAQ1', esUso: true, ...parcial };
}

const CUERPO_SIN_PAQUETE =
  '<?xml version="1.0" encoding="UTF-8"?><usagereferences:usageReferenceRequest xmlns:usagereferences="http://www.sap.com/adt/ris/usageReferences"><usagereferences:affectedObjects/></usagereferences:usageReferenceRequest>';

suite('diccionario-donde-se-usa', () => {
  test('constantes de la petición', () => {
    assert.equal(RUTA_USOS, '/sap/bc/adt/repository/informationsystem/usageReferences');
    assert.equal(ACCEPT_USOS, 'application/vnd.sap.adt.repository.usagereferences.result.v1+xml');
    assert.equal(CONTENT_TYPE_USOS, 'application/vnd.sap.adt.repository.usagereferences.request.v1+xml');
    assert.equal(TIEMPO_USOS_MS, 120_000);
  });

  suite('cuerpoUsos', () => {
    test('sin paquete: el cuerpo exacto que respondió 200 en el sistema real', () => {
      assert.equal(cuerpoUsos(), CUERPO_SIN_PAQUETE);
    });

    test('sin parámetro de paquete: packageRef no acota en el servidor (verificado 2026-10-31), se acota en cliente', () => {
      assert.equal(cuerpoUsos.length, 0);
      assert.ok(!cuerpoUsos().includes('packageRef'));
    });
  });

  suite('analizarUsos', () => {
    test('whereused-mara.xml: total 6848 y un uso por referencedObject', () => {
      const { total, usos } = analizarUsos(fixture('whereused-mara.xml'));
      assert.equal(total, 6848);
      assert.equal(usos.length, 10);
      assert.equal(usos.filter((u) => u.esUso).length, 9);
    });

    test('esUso: isResult="true" o con usageInformation; el contenedor puro (FUGR/F sin usageInformation) no', () => {
      const { usos } = analizarUsos(fixture('whereused-mara.xml'));
      const porNombre = new Map(usos.map((u) => [u.nombre, u]));
      for (const cds of ['Z_EJEMPLO_1', 'Z_EJEMPLO_2', 'Z_EJEMPLO_3']) {
        assert.equal(porNombre.get(cds)?.esUso, true, `${cds}: isResult="false" pero gradeDirect`);
      }
      assert.equal(porNombre.get('Z_EJEMPLO_4')?.esUso, true);
      assert.equal(porNombre.get('Z_EJEMPLO_5')?.esUso, false);
    });

    test('uriAdt, tipoAdt, nombre, descripción y paquete de cada uso', () => {
      const { usos } = analizarUsos(fixture('whereused-mara.xml'));
      const porNombre = new Map(usos.map((u) => [u.nombre, u]));
      assert.deepEqual(porNombre.get('Z_EJEMPLO_4'), {
        nombre: 'Z_EJEMPLO_4',
        tipoAdt: 'TABL/DT',
        descripcion: 'Descripción de ejemplo 4',
        uriAdt: '/sap/bc/adt/ddic/tables/z_ejemplo_4',
        paquete: 'ZPAQ2',
        esUso: true,
      });
      assert.equal(porNombre.get('/ACCGO/APP_S_FLDCAT_POS_DPQS')?.paquete, '/ACCGO/ACM_NET');
      assert.equal(porNombre.get('Z_EJEMPLO_7')?.paquete, '$TMP');
      assert.equal(porNombre.get('DEQUEUE_EMMARAE')?.descripcion, '');
    });

    test('sin /packages/ en parentUri (módulo de función) el paquete sale del packageRef', () => {
      const { usos } = analizarUsos(fixture('whereused-mara.xml'));
      const porNombre = new Map(usos.map((u) => [u.nombre, u]));
      assert.equal(porNombre.get('Z_EJEMPLO_6')?.paquete, 'ZPAQ3');
      assert.equal(porNombre.get('DEQUEUE_EMMARAE')?.paquete, '$ENQ');
    });

    test('sin paquete en ningún sitio: paquete vacío; entidades descodificadas; respuesta vacía → total 0', () => {
      const xml = '<usageReferences:usageReferenceResult numberOfResults="1" xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences"><usageReferences:referencedObjects>' +
        '<usageReferences:referencedObject uri="/sap/bc/adt/programs/programs/z_ejemplo_9" isResult="true"><usageReferences:adtObject adtcore:name="Z_EJEMPLO_9" adtcore:type="PROG/P" adtcore:description="A &amp; B" xmlns:adtcore="http://www.sap.com/adt/core"/></usageReferences:referencedObject>' +
        '</usageReferences:referencedObjects></usageReferences:usageReferenceResult>';
      const { total, usos } = analizarUsos(xml);
      assert.equal(total, 1);
      assert.deepEqual(usos.map((u) => [u.nombre, u.paquete, u.descripcion]), [['Z_EJEMPLO_9', '', 'A & B']]);
      assert.deepEqual(analizarUsos('<usageReferences:usageReferenceResult/>'), { total: 0, usos: [] });
    });
  });

  suite('esPropio', () => {
    test('Z/Y por prefijo y namespaces solo si están en la lista', () => {
      assert.equal(esPropio('ZCDS_X', ['Z', 'Y']), true);
      assert.equal(esPropio('ycl_x', ['Z', 'Y']), true);
      assert.equal(esPropio('MARA', ['Z', 'Y']), false);
      assert.equal(esPropio('/ACCGO/ABD', ['Z', 'Y']), false);
      assert.equal(esPropio('/ACCGO/ABD', ['Z', '/ACCGO/']), true);
      assert.equal(esPropio('/accgo/abd', ['Z', '/accgo/']), true);
      assert.equal(esPropio('/ACCGOX/ABD', ['/ACCGO/']), false);
      assert.equal(esPropio('ZX', []), false);
    });
  });

  suite('esUsoPropio', () => {
    test('nombres generados de grupos de funciones y module pools con prefijo propio son propios', () => {
      const lzfootop = uso({ nombre: 'LZFOOTOP', tipoAdt: 'FUGR/I', uriAdt: '/sap/bc/adt/functions/groups/zfoo/includes/lzfootop' });
      assert.equal(esUsoPropio(lzfootop, ['Z']), true);
      assert.equal(esUsoPropio(uso({ nombre: 'LZFOOTOP', tipoAdt: 'FUGR/I', uriAdt: '' }), ['Z']), true);
      assert.equal(esUsoPropio(uso({ nombre: 'SAPMZBAR', tipoAdt: 'PROG/P', uriAdt: '/sap/bc/adt/programs/programs/sapmzbar' }), ['Z']), true);
      assert.equal(esUsoPropio(uso({ nombre: 'MZBARI01', tipoAdt: 'PROG/I', uriAdt: '/sap/bc/adt/programs/includes/mzbari01' }), ['Z']), true);
      assert.equal(esUsoPropio(uso({ nombre: 'SAPLZFOO', tipoAdt: 'FUGR/F', uriAdt: '' }), ['Z']), true);
    });

    test('FUGR/I: decide el grupo de la uri, no el nombre del include', () => {
      const deGrupoZ = uso({ nombre: 'LXYZTOP', tipoAdt: 'FUGR/I', uriAdt: '/sap/bc/adt/functions/groups/zfoo/includes/lxyztop' });
      assert.equal(esUsoPropio(deGrupoZ, ['Z']), true);
      const deGrupoNs = uso({ nombre: '/ACCGO/LABCTOP', tipoAdt: 'FUGR/I', uriAdt: '/sap/bc/adt/functions/groups/%2faccgo%2fabc/includes/%2faccgo%2flabctop' });
      assert.equal(esUsoPropio(deGrupoNs, ['Z', '/ACCGO/']), true);
      assert.equal(esUsoPropio(deGrupoNs, ['Z']), false);
    });

    test('estándar con nombres parecidos no es propio; el resto de tipos solo por prefijo', () => {
      assert.equal(esUsoPropio(uso({ nombre: 'MV45AFZZ', tipoAdt: 'PROG/I', uriAdt: '/sap/bc/adt/programs/includes/mv45afzz' }), ['Z', 'Y']), false);
      assert.equal(esUsoPropio(uso({ nombre: 'SAPLMGMM', tipoAdt: 'FUGR/F', uriAdt: '' }), ['Z', 'Y']), false);
      assert.equal(esUsoPropio(uso({ nombre: 'LZCLASE', tipoAdt: 'CLAS/OC', uriAdt: '/sap/bc/adt/oo/classes/lzclase' }), ['Z']), false);
      assert.equal(esUsoPropio(uso({ nombre: 'ZCL_X', tipoAdt: 'CLAS/OC', uriAdt: '/sap/bc/adt/oo/classes/zcl_x' }), ['Z']), true);
    });

    test('filtrarUsos lista como propios los includes generados', () => {
      const usos = [
        uso({ nombre: 'LZFOOTOP', tipoAdt: 'FUGR/I', uriAdt: '/sap/bc/adt/functions/groups/zfoo/includes/lzfootop' }),
        uso({ nombre: 'MV45AFZZ', tipoAdt: 'PROG/I', uriAdt: '/sap/bc/adt/programs/includes/mv45afzz' }),
      ];
      assert.deepEqual(filtrarUsos({ total: 2, usos }, ['Z', 'Y']).propios.map((u) => u.nombre), ['LZFOOTOP']);
    });
  });

  suite('namespacesNoPropios', () => {
    test('whereused-mara.xml con Z/Y ofrece /ACCGO/ una sola vez', () => {
      const { usos } = analizarUsos(fixture('whereused-mara.xml'));
      assert.deepEqual(namespacesNoPropios(usos, ['Z', 'Y']), ['/ACCGO/']);
      assert.deepEqual(namespacesNoPropios(usos, ['Z', 'Y', '/ACCGO/']), []);
    });

    test('ordenados y sin nombres sin namespace', () => {
      const usos = [uso({ nombre: '/XB/UNO' }), uso({ nombre: 'MARA' }), uso({ nombre: '/XA/DOS' }), uso({ nombre: '/XB/TRES' })];
      assert.deepEqual(namespacesNoPropios(usos, ['Z']), ['/XA/', '/XB/']);
    });
  });

  suite('filtrarUsos', () => {
    test('propios: solo usos propios (sin contenedores puros); namespaces de los usos no propios', () => {
      const resultado = analizarUsos(fixture('whereused-mara.xml'));
      const filtrado = filtrarUsos(resultado, ['Z', 'Y']);
      assert.equal(filtrado.total, 6848);
      assert.deepEqual(filtrado.propios.map((u) => u.nombre).sort(), [
        'Z_EJEMPLO_1', 'Z_EJEMPLO_2', 'Z_EJEMPLO_3', 'Z_EJEMPLO_4', 'Z_EJEMPLO_6', 'Z_EJEMPLO_7',
      ]);
      assert.deepEqual(filtrado.namespaces, ['/ACCGO/']);
      const conAccgo = filtrarUsos(resultado, ['Z', 'Y', '/ACCGO/']);
      assert.equal(conAccgo.propios.length, 8);
      assert.deepEqual(conAccgo.namespaces, []);
    });
  });

  suite('agruparUsos', () => {
    test('ordena por tipo, luego paquete, luego nombre y descarta los contenedores puros', () => {
      const usos = [
        uso({ nombre: 'Z_B', tipoAdt: 'TABL/DT', paquete: 'ZPAQ2' }),
        uso({ nombre: 'Z_C', tipoAdt: 'PROG/I', paquete: 'ZPAQ1' }),
        uso({ nombre: 'Z_A', tipoAdt: 'TABL/DT', paquete: 'ZPAQ2' }),
        uso({ nombre: 'Z_D', tipoAdt: 'TABL/DT', paquete: 'ZPAQ1' }),
        uso({ nombre: 'Z_E', tipoAdt: 'FUGR/F', paquete: 'ZPAQ1', esUso: false }),
      ];
      const grupos = agruparUsos(usos);
      assert.deepEqual(grupos.map((g) => g.tipoAdt), ['PROG/I', 'TABL/DT']);
      assert.deepEqual(grupos[1].paquetes.map((p) => [p.paquete, p.usos.map((u) => u.nombre)]), [
        ['ZPAQ1', ['Z_D']],
        ['ZPAQ2', ['Z_A', 'Z_B']],
      ]);
    });

    test('sin usos: ningún grupo', () => {
      assert.deepEqual(agruparUsos([]), []);
    });
  });
});
