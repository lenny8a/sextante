import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buscar, MAX_RESULTADOS_PAQUETE, paqueteSinFiltro, RUTA_BUSQUEDA } from '../../src/adt/busqueda-cliente';
import { FILTROS_TIPO } from '../../src/adt/busqueda-modelo';
import { ConexionAdt } from '../../src/adt/conexion-adt';
import type { PeticionAdt } from '../../src/adt/transporte';

function leerFixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function conexionCon(cuerpo: string, peticiones: PeticionAdt[]): ConexionAdt {
  return new ConexionAdt({
    peticion: async (p) => {
      peticiones.push(p);
      return { estado: 200, cuerpo };
    },
  });
}

suite('busqueda-cliente: buscar', () => {
  test('con filtro de clase pide objectType=CLAS/OC y lee la respuesta real (busq-clas.xml)', async () => {
    const peticiones: PeticionAdt[] = [];
    const clase = FILTROS_TIPO.find((f) => f.id === 'clase');
    const resultados = await buscar(conexionCon(leerFixture('busq-clas.xml'), peticiones), { patron: 'Z*', filtro: clase }, undefined, 10);
    assert.equal(resultados.length, 10);
    assert.ok(resultados.every((r) => r.tipo === 'CLAS/OC' && r.paquete === ''));
    assert.deepEqual(peticiones, [{
      metodo: 'GET',
      ruta: RUTA_BUSQUEDA,
      parametros: { operation: 'quickSearch', query: 'Z*', maxResults: '10', objectType: 'CLAS/OC' },
      cabeceras: { accept: 'application/xml' },
    }]);
    assert.equal(RUTA_BUSQUEDA, '/sap/bc/adt/repository/informationsystem/search');
  });

  test('un tipo que el servidor no conoce da una lista vacía (busq-tipo-malo.xml)', async () => {
    const peticiones: PeticionAdt[] = [];
    assert.deepEqual(await buscar(conexionCon(leerFixture('busq-tipo-malo.xml'), peticiones), { patron: 'Z*' }), []);
    assert.equal(peticiones.length, 1);
  });

  test('un nombre con espacio de nombres llega con su uri codificada (busq-namespace.xml)', async () => {
    const [primero] = await buscar(conexionCon(leerFixture('busq-namespace.xml'), []), { patron: '/ACCGO/A*' });
    assert.equal(primero.nombre, '/ACCGO/ABD');
    assert.equal(primero.uriAdt, '/sap/bc/adt/messageclass/%2faccgo%2fabd');
  });
});

suite('busqueda-cliente: paqueteSinFiltro', () => {
  test('busca el nombre exacto sin objectType y toma el paquete del mismo nombre y tipo (busq-xml.xml)', async () => {
    const peticiones: PeticionAdt[] = [];
    const conexion = conexionCon(leerFixture('busq-xml.xml'), peticiones);
    assert.equal(await paqueteSinFiltro(conexion, 'Z_EJEMPLO_3', 'PROG/P'), '$TMP');
    assert.deepEqual(peticiones[0].parametros, {
      operation: 'quickSearch',
      query: 'Z_EJEMPLO_3',
      maxResults: String(MAX_RESULTADOS_PAQUETE),
    });
    assert.equal(peticiones[0].ruta, RUTA_BUSQUEDA);
    assert.equal(await paqueteSinFiltro(conexion, 'Z_EJEMPLO_1', 'FUGR/F'), 'Z_EJEMPLO_2');
  });

  test('otro tipo con el mismo nombre no cuenta', async () => {
    assert.equal(await paqueteSinFiltro(conexionCon(leerFixture('busq-xml.xml'), []), 'Z_EJEMPLO_1', 'CLAS/OC'), undefined);
  });

  test('una respuesta sin packageName, como la filtrada, no da paquete vacío sino undefined (busq-clas.xml)', async () => {
    assert.equal(await paqueteSinFiltro(conexionCon(leerFixture('busq-clas.xml'), []), 'Z_EJEMPLO_9', 'CLAS/OC'), undefined);
  });
});
