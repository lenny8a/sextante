import assert from 'node:assert/strict';
import { ConexionAdt, ErrorAdt, RUTA_DISCOVERY, type RespuestaAdt } from '../../src/adt/conexion-adt';
import type { PeticionAdt, TransporteAdt } from '../../src/adt/transporte';

interface TransporteFalso extends TransporteAdt { peticiones: PeticionAdt[]; senales: Array<AbortSignal | undefined> }

function crearTransporteFalso(respuesta: RespuestaAdt = { estado: 200, cuerpo: 'ok' }): TransporteFalso {
  const peticiones: PeticionAdt[] = [];
  const senales: Array<AbortSignal | undefined> = [];
  return {
    peticiones,
    senales,
    peticion: async (p, signal) => {
      peticiones.push(p);
      senales.push(signal);
      return respuesta;
    },
  };
}

suite('ConexionAdt', () => {
  test('descubrir hace un GET al discovery con Accept atomsvc+xml', async () => {
    const transporte = crearTransporteFalso();
    const respuesta = await new ConexionAdt(transporte).descubrir();
    assert.strictEqual(respuesta.cuerpo, 'ok');
    assert.deepStrictEqual(transporte.peticiones, [{ metodo: 'GET', ruta: RUTA_DISCOVERY, cabeceras: { accept: 'application/atomsvc+xml' } }]);
  });

  test('get pasa la ruta, los parámetros, el accept y la señal', async () => {
    const transporte = crearTransporteFalso();
    const senal = new AbortController().signal;
    await new ConexionAdt(transporte).get('/sap/bc/adt/x', { a: '1' }, 'text/xml', senal);
    assert.deepStrictEqual(transporte.peticiones, [
      { metodo: 'GET', ruta: '/sap/bc/adt/x', parametros: { a: '1' }, cabeceras: { accept: 'text/xml' } },
    ]);
    assert.strictEqual(transporte.senales[0], senal);
  });

  test('get sin accept no manda cabeceras', async () => {
    const transporte = crearTransporteFalso();
    await new ConexionAdt(transporte).get('/sap/bc/adt/x');
    assert.deepStrictEqual(transporte.peticiones[0].cabeceras, {});
  });

  test('post pasa el cuerpo, el content-type, el accept, los parámetros y la señal, sin token', async () => {
    const transporte = crearTransporteFalso();
    const senal = new AbortController().signal;
    await new ConexionAdt(transporte).post('/sap/bc/adt/z', 'SELECT', 'text/plain', 'application/xml', senal, { rowNumber: '1' });
    assert.deepStrictEqual(transporte.peticiones, [{
      metodo: 'POST', ruta: '/sap/bc/adt/z', parametros: { rowNumber: '1' }, cuerpo: 'SELECT',
      cabeceras: { 'content-type': 'text/plain', accept: 'application/xml' },
    }]);
    assert.strictEqual(transporte.senales[0], senal);
  });

  test('get y post copian tiempoMs a la petición solo si se indica', async () => {
    const transporte = crearTransporteFalso();
    const conexion = new ConexionAdt(transporte);
    await conexion.get('/sap/bc/adt/x', undefined, 'text/xml', undefined, 5000);
    await conexion.post('/sap/bc/adt/z', 'SELECT', 'text/plain', undefined, undefined, undefined, 3000);
    await conexion.get('/sap/bc/adt/x');
    assert.strictEqual(transporte.peticiones[0].tiempoMs, 5000);
    assert.strictEqual(transporte.peticiones[1].tiempoMs, 3000);
    assert.ok(!('tiempoMs' in transporte.peticiones[2]));
  });

  test('un error lleva el cuerpo de la respuesta aparte, sin meterlo en el mensaje', async () => {
    const cuerpo = '<exc:exception xmlns:exc="x"><message lang="EN">fallo</message></exc:exception>';
    const conexion = new ConexionAdt(crearTransporteFalso({ estado: 400, cuerpo }));
    await assert.rejects(conexion.post('/sap/bc/adt/z', 'SELECT', 'text/plain'), (e: unknown) =>
      e instanceof ErrorAdt && e.estado === 400 && e.cuerpo === cuerpo && e.message === 'ADT /sap/bc/adt/z: respuesta 400');
  });

  test('un 404 lanza ErrorAdt con su estado y la ruta sin query', async () => {
    const conexion = new ConexionAdt(crearTransporteFalso({ estado: 404, cuerpo: '' }));
    await assert.rejects(conexion.get('/sap/bc/adt/x', { a: '1' }), (e: unknown) =>
      e instanceof ErrorAdt && e.estado === 404 && e.ruta === '/sap/bc/adt/x' && e.message === 'ADT /sap/bc/adt/x: respuesta 404');
  });

  test('fuera de 2xx también lanza en descubrir y post', async () => {
    const conexion = new ConexionAdt(crearTransporteFalso({ estado: 302, cuerpo: '' }));
    await assert.rejects(conexion.descubrir(), (e: unknown) => e instanceof ErrorAdt && e.estado === 302);
    await assert.rejects(conexion.post('/sap/bc/adt/z', 'x', 'text/plain'), (e: unknown) => e instanceof ErrorAdt && e.estado === 302);
  });

  test('el mensaje del error enmascara el nombre del objeto; la ruta del error queda completa', async () => {
    const conexion = new ConexionAdt(crearTransporteFalso({ estado: 500, cuerpo: '' }));
    await assert.rejects(conexion.get('/sap/bc/adt/ddic/tables/zt_ejemplo'), (e: unknown) =>
      e instanceof ErrorAdt && e.ruta === '/sap/bc/adt/ddic/tables/zt_ejemplo'
        && e.message === 'ADT /sap/bc/adt/ddic/tables/<objeto>: respuesta 500');
  });
});
