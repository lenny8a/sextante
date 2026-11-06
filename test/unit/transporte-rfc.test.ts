import assert from 'node:assert/strict';
import { ErrorDelPuente, type PuenteRfc, type RespuestaPuente } from '../../src/adt/puente-rfc';
import { ErrorAdt, type PeticionAdt } from '../../src/adt/transporte';
import { ErrorSoloLectura, esLecturaPermitida, LECTURAS_PERMITIDAS, TransporteRfc } from '../../src/adt/transporte-rfc';

type Puente = Pick<PuenteRfc, 'peticion'>;

function puenteFalso(resultado: RespuestaPuente | Error): { puente: Puente; llamadas: Array<{ destino: string; p: PeticionAdt }> } {
  const llamadas: Array<{ destino: string; p: PeticionAdt }> = [];
  const puente: Puente = {
    async peticion(destino, p) {
      llamadas.push({ destino, p });
      if (resultado instanceof Error) { throw resultado; }
      return resultado;
    },
  };
  return { puente, llamadas };
}

const GET: PeticionAdt = { metodo: 'GET', ruta: '/sap/bc/adt/discovery', parametros: { query: 'ZCLIENTE*' }, cabeceras: {} };

suite('TransporteRfc', () => {
  test('GET devuelve la respuesta con cuerpo decodificado, tipo y cabeceras en minúscula', async () => {
    const { puente, llamadas } = puenteFalso({
      estado: 200, razon: 'OK', cuerpo: Buffer.from('héllo', 'utf8'),
      cabeceras: { 'Content-Type': 'text/plain', 'X-Otra': '1' },
    });
    const transporte = new TransporteRfc({ puente, destino: 'DEST', soloLectura: false });
    const r = await transporte.peticion(GET);
    assert.equal(r.estado, 200);
    assert.equal(r.cuerpo, 'héllo');
    assert.equal(r.tipoContenido, 'text/plain');
    assert.deepEqual(r.cabeceras, ['content-type', 'x-otra']);
    assert.equal(llamadas[0].destino, 'DEST');
    assert.deepEqual(llamadas[0].p, GET);
  });

  test('devuelve cualquier estado sin validarlo', async () => {
    const { puente } = puenteFalso({ estado: 404, razon: 'Not Found', cuerpo: Buffer.alloc(0), cabeceras: {} });
    const r = await new TransporteRfc({ puente, destino: 'DEST', soloLectura: false }).peticion(GET);
    assert.equal(r.estado, 404);
    assert.equal(r.tipoContenido, undefined);
  });

  test('POST en solo lectura lanza ErrorSoloLectura sin llamar al puente', async () => {
    const { puente, llamadas } = puenteFalso(new Error('no debe llamarse'));
    const transporte = new TransporteRfc({ puente, destino: 'DEST', soloLectura: true });
    await assert.rejects(
      transporte.peticion({ metodo: 'POST', ruta: '/sap/bc/adt/x', cabeceras: {} }),
      (e: unknown) => e instanceof ErrorSoloLectura && e instanceof ErrorAdt && e.estado === 0
        && e.ruta === '/sap/bc/adt/x' && e.message === 'Sistema de solo lectura: POST no permitido',
    );
    assert.equal(llamadas.length, 0);
  });

  test('en solo lectura pasan los POST de la lista blanca y se rechazan rutas hermanas y otros métodos', async () => {
    const { puente, llamadas } = puenteFalso({ estado: 200, razon: 'OK', cuerpo: Buffer.alloc(0), cabeceras: {} });
    const transporte = new TransporteRfc({ puente, destino: 'DEST', soloLectura: true });
    for (const ruta of LECTURAS_PERMITIDAS) {
      await transporte.peticion({ metodo: 'POST', ruta, cabeceras: {} });
    }
    assert.equal(llamadas.length, LECTURAS_PERMITIDAS.length);
    await assert.rejects(
      transporte.peticion({ metodo: 'POST', ruta: '/sap/bc/adt/datapreview/freestyle/otra', cabeceras: {} }),
      ErrorSoloLectura,
    );
    await assert.rejects(
      transporte.peticion({ metodo: 'PUT', ruta: '/sap/bc/adt/datapreview/freestyle', cabeceras: {} }),
      ErrorSoloLectura,
    );
    assert.equal(llamadas.length, LECTURAS_PERMITIDAS.length);
    assert.equal(esLecturaPermitida({ metodo: 'POST', ruta: '/sap/bc/adt/datapreview/freestyle', cabeceras: {} }), true);
  });

  test('GET en solo lectura sí llega al puente', async () => {
    const { puente, llamadas } = puenteFalso({ estado: 200, razon: 'OK', cuerpo: Buffer.alloc(0), cabeceras: {} });
    await new TransporteRfc({ puente, destino: 'DEST', soloLectura: true }).peticion(GET);
    assert.equal(llamadas.length, 1);
  });

  test('solo lectura como función se evalúa en cada petición', async () => {
    const { puente, llamadas } = puenteFalso({ estado: 200, razon: 'OK', cuerpo: Buffer.alloc(0), cabeceras: {} });
    let protegido = false;
    const transporte = new TransporteRfc({ puente, destino: 'DEST', soloLectura: () => protegido });
    const post: PeticionAdt = { metodo: 'POST', ruta: '/sap/bc/adt/x', cabeceras: {} };
    await transporte.peticion(post);
    protegido = true;
    await assert.rejects(transporte.peticion(post), ErrorSoloLectura);
    assert.equal(llamadas.length, 1);
  });

  test('un error de proceso del puente avisa de la sesión perdida; los demás no', async () => {
    let avisos = 0;
    const alPerderSesion = (): void => { avisos += 1; };
    const proceso = puenteFalso(new ErrorDelPuente({ clase: 'proceso', mensaje: 'msg' }));
    await assert.rejects(
      new TransporteRfc({ puente: proceso.puente, destino: 'DEST', soloLectura: false, alPerderSesion }).peticion(GET),
      (e: unknown) => e instanceof ErrorAdt && e.estado === 0,
    );
    assert.equal(avisos, 1);
    const comunicacion = puenteFalso(new ErrorDelPuente({ clase: 'comunicacion', mensaje: 'msg' }));
    await assert.rejects(new TransporteRfc({ puente: comunicacion.puente, destino: 'DEST', soloLectura: false, alPerderSesion }).peticion(GET));
    assert.equal(avisos, 1);
  });

  test('un tiempo agotado no da la sesión por perdida y se registra con su clase', async () => {
    let avisos = 0;
    const lineas: string[] = [];
    const { puente } = puenteFalso(new ErrorDelPuente({ clase: 'tiempo', mensaje: 'sin respuesta en 5000 ms' }));
    const transporte = new TransporteRfc({
      puente, destino: 'DEST', soloLectura: false, registrar: (m) => lineas.push(m), alPerderSesion: () => { avisos += 1; },
    });
    await assert.rejects(
      transporte.peticion(GET),
      (e: unknown) => e instanceof ErrorAdt && e.estado === 0 && e.message === 'sin respuesta en 5000 ms' && e.ruta === GET.ruta,
    );
    assert.equal(avisos, 0);
    assert.deepEqual(lineas, ['ADT(rfc) GET /sap/bc/adt/discovery → error tiempo']);
  });

  const casos: Array<[ErrorDelPuente['detalle']['clase'], number, string]> = [
    ['logon', 401, 'msg'],
    ['comunicacion', 0, 'msg'],
    ['proceso', 0, 'msg'],
    ['tiempo', 0, 'msg'],
    ['funcion', 0, 'El sistema no expone SADT_REST_RFC_ENDPOINT'],
    ['protocolo', 0, 'msg'],
    ['otro', 0, 'msg'],
  ];
  for (const [clase, estado, mensaje] of casos) {
    test(`traduce el error de puente "${clase}" a ErrorAdt estado ${estado}`, async () => {
      const { puente } = puenteFalso(new ErrorDelPuente({ clase, mensaje: 'msg' }));
      const transporte = new TransporteRfc({ puente, destino: 'DEST', soloLectura: false });
      await assert.rejects(
        transporte.peticion(GET),
        (e: unknown) => e instanceof ErrorAdt && e.estado === estado && e.message === mensaje && e.ruta === GET.ruta,
      );
    });
  }

  test('relanza tal cual los errores que no son del puente', async () => {
    const error = new TypeError('otro');
    const { puente } = puenteFalso(error);
    await assert.rejects(new TransporteRfc({ puente, destino: 'DEST', soloLectura: false }).peticion(GET), (e: unknown) => e === error);
  });

  test('con la señal ya abortada no llama al puente', async () => {
    const { puente, llamadas } = puenteFalso({ estado: 200, razon: 'OK', cuerpo: Buffer.alloc(0), cabeceras: {} });
    const control = new AbortController();
    control.abort();
    await assert.rejects(new TransporteRfc({ puente, destino: 'DEST', soloLectura: false }).peticion(GET, control.signal));
    assert.equal(llamadas.length, 0);
  });

  test('registra la ruta sin query ni cuerpo, y solo la clase del fallo', async () => {
    const lineas: string[] = [];
    const ok = puenteFalso({ estado: 200, razon: 'OK', cuerpo: Buffer.from('abc'), cabeceras: {} });
    await new TransporteRfc({ puente: ok.puente, destino: 'DEST', soloLectura: false, registrar: (m) => lineas.push(m) })
      .peticion({ ...GET, ruta: '/sap/bc/adt/x?query=ZSECRETO' });
    const mal = puenteFalso(new ErrorDelPuente({ clase: 'comunicacion', mensaje: 'host sap.cliente.com' }));
    await assert.rejects(new TransporteRfc({ puente: mal.puente, destino: 'DEST', soloLectura: false, registrar: (m) => lineas.push(m) }).peticion(GET));
    assert.deepEqual(lineas, ['ADT(rfc) GET /sap/bc/adt/x → 200 (3 bytes)', 'ADT(rfc) GET /sap/bc/adt/discovery → error comunicacion']);
    assert.ok(lineas.every((l) => !l.includes('ZSECRETO') && !l.includes('ZCLIENTE') && !l.includes('cliente.com')));
  });

  test('enmascara el nombre del objeto en el registro, no en la ruta que llega al puente ni en el error', async () => {
    const lineas: string[] = [];
    const ok = puenteFalso({ estado: 200, razon: 'OK', cuerpo: Buffer.from('abc'), cabeceras: {} });
    const ruta = '/sap/bc/adt/ddic/tables/zt_ejemplo';
    await new TransporteRfc({ puente: ok.puente, destino: 'DEST', soloLectura: false, registrar: (m) => lineas.push(m) })
      .peticion({ ...GET, ruta });
    const rutaClase = '/sap/bc/adt/oo/classes/zcl_ejemplo/source/main';
    const mal = puenteFalso(new ErrorDelPuente({ clase: 'tiempo', mensaje: 'msg' }));
    await assert.rejects(
      new TransporteRfc({ puente: mal.puente, destino: 'DEST', soloLectura: false, registrar: (m) => lineas.push(m) })
        .peticion({ ...GET, ruta: rutaClase }),
      (e: unknown) => e instanceof ErrorAdt && e.ruta === rutaClase,
    );
    assert.deepEqual(lineas, [
      'ADT(rfc) GET /sap/bc/adt/ddic/tables/<objeto> → 200 (3 bytes)',
      'ADT(rfc) GET /sap/bc/adt/oo/classes/<objeto>/source/main → error tiempo',
    ]);
    assert.equal(ok.llamadas[0].p.ruta, ruta);
  });
});
