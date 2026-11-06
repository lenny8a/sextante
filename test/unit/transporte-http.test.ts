import assert from 'node:assert/strict';
import { ErrorAdt, RUTA_DISCOVERY, type PeticionAdt } from '../../src/adt/transporte';
import { causaDeFallo, TransporteHttp, urlDelSistema } from '../../src/adt/transporte-http';

interface PeticionRegistrada { url: string; method: string; headers: Headers; body?: string; redirect?: RequestInit['redirect'] }
interface RespuestaFalsa { estado: number; cuerpo?: string; cabeceras?: Array<[string, string]> }

function crearFetchFalso(cola: RespuestaFalsa[]): { fetchFn: typeof fetch; peticiones: PeticionRegistrada[] } {
  const peticiones: PeticionRegistrada[] = [];
  const fetchFn = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    peticiones.push({
      url: String(entrada), method: init?.method ?? 'GET', headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined, redirect: init?.redirect,
    });
    const siguiente = cola.shift();
    assert.ok(siguiente, 'la cola de respuestas se agotó');
    const cabeceras = new Headers();
    for (const [nombre, valor] of siguiente.cabeceras ?? []) { cabeceras.append(nombre, valor); }
    return new Response(siguiente.cuerpo ?? '', { status: siguiente.estado, headers: cabeceras });
  }) as typeof fetch;
  return { fetchFn, peticiones };
}

function fetchQueEsperaAbortar(): typeof fetch {
  return ((_entrada: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> =>
    new Promise((_resolver, rechazar) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('abortado');
        error.name = 'AbortError';
        rechazar(error);
      });
    })) as typeof fetch;
}

interface ExtraTransporte { tiempoMs?: number; cliente?: string; idioma?: string; registrar?: (mensaje: string) => void }

function crearTransporte(fetchFn: typeof fetch, extra: ExtraTransporte = {}): TransporteHttp {
  return new TransporteHttp({ url: 'https://h:44300', credenciales: { usuario: 'u', contrasena: 'p' }, fetchFn, ...extra });
}

function obtener(ruta: string, extra: Partial<PeticionAdt> = {}): PeticionAdt {
  return { metodo: 'GET', ruta, cabeceras: {}, ...extra };
}

function enviar(ruta: string, extra: Partial<PeticionAdt> = {}): PeticionAdt {
  return { metodo: 'POST', ruta, cabeceras: { 'content-type': 'application/xml' }, cuerpo: '<a/>', ...extra };
}

suite('TransporteHttp', () => {
  test('añade Basic, sap-client, sap-language, los parámetros y las cabeceras de la petición', async () => {
    const { fetchFn, peticiones } = crearFetchFalso([{ estado: 200, cuerpo: 'ok' }]);
    const respuesta = await crearTransporte(fetchFn, { cliente: '100', idioma: 'ES' })
      .peticion(obtener('/sap/bc/adt/x', { parametros: { a: '1' }, cabeceras: { accept: 'text/xml' } }));
    assert.strictEqual(respuesta.estado, 200);
    assert.strictEqual(respuesta.cuerpo, 'ok');
    assert.strictEqual(peticiones[0].url, 'https://h:44300/sap/bc/adt/x?a=1&sap-client=100&sap-language=ES');
    assert.strictEqual(peticiones[0].headers.get('authorization'), 'Basic dTpw');
    assert.strictEqual(peticiones[0].headers.get('accept'), 'text/xml');
    assert.strictEqual(peticiones[0].headers.get('x-csrf-token'), null);
  });

  test('el GET al discovery pide el token y las cookies se reenvían', async () => {
    const { fetchFn, peticiones } = crearFetchFalso([
      { estado: 200, cabeceras: [['x-csrf-token', 'tok'], ['set-cookie', 'SAP_SESSIONID_X_100=abc; path=/; HttpOnly'], ['set-cookie', 'sap-usercontext=sap-client%3D100; path=/']] },
      { estado: 200 },
    ]);
    const transporte = crearTransporte(fetchFn);
    await transporte.peticion(obtener(RUTA_DISCOVERY, { cabeceras: { accept: 'application/atomsvc+xml' } }));
    await transporte.peticion(obtener('/sap/bc/adt/y'));
    assert.strictEqual(peticiones[0].url, `https://h:44300${RUTA_DISCOVERY}`);
    assert.strictEqual(peticiones[0].headers.get('x-csrf-token'), 'fetch');
    assert.strictEqual(peticiones[0].headers.get('accept'), 'application/atomsvc+xml');
    assert.strictEqual(peticiones[1].headers.get('cookie'), 'SAP_SESSIONID_X_100=abc; sap-usercontext=sap-client%3D100');
  });

  test('un POST sin token lo pide antes y reintenta una vez ante 403 Required', async () => {
    const { fetchFn, peticiones } = crearFetchFalso([
      { estado: 200, cabeceras: [['x-csrf-token', 'tok1']] },
      { estado: 403, cabeceras: [['x-csrf-token', 'Required']] },
      { estado: 200, cabeceras: [['x-csrf-token', 'tok2']] },
      { estado: 200, cuerpo: 'hecho' },
    ]);
    const respuesta = await crearTransporte(fetchFn).peticion(enviar('/sap/bc/adt/z'));
    assert.strictEqual(respuesta.cuerpo, 'hecho');
    assert.deepStrictEqual(peticiones.map(p => p.method), ['GET', 'POST', 'GET', 'POST']);
    assert.strictEqual(peticiones[0].url, `https://h:44300${RUTA_DISCOVERY}`);
    assert.strictEqual(peticiones[0].headers.get('x-csrf-token'), 'fetch');
    assert.strictEqual(peticiones[0].headers.get('accept'), 'application/atomsvc+xml');
    assert.strictEqual(peticiones[1].headers.get('x-csrf-token'), 'tok1');
    assert.strictEqual(peticiones[3].headers.get('x-csrf-token'), 'tok2');
    assert.strictEqual(peticiones[3].headers.get('content-type'), 'application/xml');
    assert.strictEqual(peticiones[3].body, '<a/>');
  });

  test('un segundo 403 Required no se reintenta más y se devuelve tal cual', async () => {
    const { fetchFn, peticiones } = crearFetchFalso([
      { estado: 200, cabeceras: [['x-csrf-token', 'tok1']] },
      { estado: 403, cabeceras: [['x-csrf-token', 'Required']] },
      { estado: 200, cabeceras: [['x-csrf-token', 'tok2']] },
      { estado: 403, cabeceras: [['x-csrf-token', 'Required']] },
    ]);
    const respuesta = await crearTransporte(fetchFn).peticion(enviar('/sap/bc/adt/z'));
    assert.strictEqual(respuesta.estado, 403);
    assert.strictEqual(peticiones.length, 4);
  });

  test('el token se reutiliza entre POST', async () => {
    const { fetchFn, peticiones } = crearFetchFalso([
      { estado: 200, cabeceras: [['x-csrf-token', 'tok']] },
      { estado: 200 },
      { estado: 200 },
    ]);
    const transporte = crearTransporte(fetchFn);
    await transporte.peticion(enviar('/sap/bc/adt/z'));
    await transporte.peticion(enviar('/sap/bc/adt/z'));
    assert.deepStrictEqual(peticiones.map(p => p.method), ['GET', 'POST', 'POST']);
    assert.strictEqual(peticiones[2].headers.get('x-csrf-token'), 'tok');
  });

  test('si pedir el token falla, devuelve esa respuesta sin enviar el POST', async () => {
    const { fetchFn, peticiones } = crearFetchFalso([{ estado: 401 }]);
    const respuesta = await crearTransporte(fetchFn).peticion(enviar('/sap/bc/adt/z'));
    assert.strictEqual(respuesta.estado, 401);
    assert.deepStrictEqual(peticiones.map(p => p.method), ['GET']);
  });

  test('devuelve cualquier estado sin lanzar', async () => {
    const { fetchFn } = crearFetchFalso([{ estado: 404, cuerpo: 'no está' }]);
    const respuesta = await crearTransporte(fetchFn).peticion(obtener('/sap/bc/adt/x'));
    assert.strictEqual(respuesta.estado, 404);
    assert.strictEqual(respuesta.cuerpo, 'no está');
  });

  test('la respuesta lleva solo los nombres de cabecera en minúsculas', async () => {
    const { fetchFn } = crearFetchFalso([
      { estado: 200, cabeceras: [['X-CSRF-Token', 'valor-token'], ['Set-Cookie', 'SAP_SESSIONID_X_100=abc; path=/'], ['Content-Type', 'text/xml']] },
    ]);
    const respuesta = await crearTransporte(fetchFn).peticion(obtener(RUTA_DISCOVERY));
    assert.deepStrictEqual([...(respuesta.cabeceras ?? [])].sort(), ['content-type', 'set-cookie', 'x-csrf-token']);
    assert.strictEqual(respuesta.tipoContenido, 'text/xml');
    assert.ok(!JSON.stringify(respuesta).includes('abc'));
    assert.ok(!JSON.stringify(respuesta).includes('valor-token'));
  });

  test('rechaza rutas absolutas o de otro origen sin llamar a fetch', async () => {
    for (const ruta of ['https://otro.local/x', '//otro.local/x', '/\\otro.local/x', 'sap/bc/adt/x']) {
      const { fetchFn, peticiones } = crearFetchFalso([]);
      const transporte = crearTransporte(fetchFn);
      await assert.rejects(transporte.peticion(obtener(ruta)), (e: unknown) =>
        e instanceof ErrorAdt && e.estado === 0 && e.message === 'Ruta fuera del sistema' && !e.ruta.includes('otro.local'));
      await assert.rejects(transporte.peticion(enviar(ruta)), (e: unknown) => e instanceof ErrorAdt && e.estado === 0);
      assert.equal(peticiones.length, 0);
    }
  });

  test('urlDelSistema acepta rutas del origen base', () => {
    assert.equal(urlDelSistema('/sap/bc/adt/x?a=1', 'https://h:44300')?.toString(), 'https://h:44300/sap/bc/adt/x?a=1');
    assert.equal(urlDelSistema('https://otro.local/x', 'https://h:44300'), undefined);
    assert.equal(urlDelSistema('//otro.local/x', 'https://h:44300'), undefined);
  });

  test('timeout lanza ErrorAdt con estado 0 y lo registra', async () => {
    const registro: string[] = [];
    const transporte = crearTransporte(fetchQueEsperaAbortar(), { tiempoMs: 20, registrar: (m) => registro.push(m) });
    await assert.rejects(transporte.peticion(obtener('/sap/bc/adt/x')), (e: unknown) =>
      e instanceof ErrorAdt && e.estado === 0 && e.message === 'ADT GET /sap/bc/adt/x: sin respuesta en 20 ms');
    assert.deepStrictEqual(registro, ['ADT GET /sap/bc/adt/x → sin respuesta en 20 ms']);
  });

  test('una cancelación externa se propaga tal cual, sin convertirla en ErrorAdt', async () => {
    const controlador = new AbortController();
    const promesa = crearTransporte(fetchQueEsperaAbortar()).peticion(obtener('/sap/bc/adt/x'), controlador.signal);
    controlador.abort();
    await assert.rejects(promesa, (e: unknown) => !(e instanceof ErrorAdt) && e instanceof Error && e.name === 'AbortError');
  });

  test('un fallo de red lleva nombre y código de la causa en el error y en el registro, sin host', async () => {
    const causa = Object.assign(new Error('self-signed certificate en h:44300'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    const fetchFn = (async (): Promise<Response> => {
      throw new TypeError('fetch failed', { cause: causa });
    }) as typeof fetch;
    const registro: string[] = [];
    const transporte = crearTransporte(fetchFn, { registrar: (m) => registro.push(m) });
    await assert.rejects(transporte.peticion(obtener('/sap/bc/adt/x', { parametros: { a: '1' } })), (e: unknown) =>
      e instanceof ErrorAdt && e.estado === 0 && e.message === 'ADT GET /sap/bc/adt/x: fallo de red (TypeError (DEPTH_ZERO_SELF_SIGNED_CERT))');
    assert.deepStrictEqual(registro, ['ADT GET /sap/bc/adt/x → fallo de red (TypeError (DEPTH_ZERO_SELF_SIGNED_CERT))']);
  });

  test('causaDeFallo: sin código solo el nombre', () => {
    assert.equal(causaDeFallo(new TypeError('fetch failed')), 'TypeError');
    assert.equal(causaDeFallo('texto'), 'string');
  });

  test('no sigue redirecciones: un 302 se devuelve con su estado', async () => {
    const { fetchFn, peticiones } = crearFetchFalso([{ estado: 302, cabeceras: [['location', 'https://idp.local/saml']] }]);
    const respuesta = await crearTransporte(fetchFn).peticion(obtener(RUTA_DISCOVERY));
    assert.equal(respuesta.estado, 302);
    assert.equal(peticiones.length, 1);
    assert.equal(peticiones[0].redirect, 'manual');
  });

  test('un POST envía los parámetros en la query y el registro solo lleva la ruta', async () => {
    const { fetchFn, peticiones } = crearFetchFalso([
      { estado: 200, cabeceras: [['x-csrf-token', 'tok']] },
      { estado: 200, cuerpo: 'hecho' },
    ]);
    const registro: string[] = [];
    const transporte = crearTransporte(fetchFn, { cliente: '100', registrar: (m) => registro.push(m) });
    await transporte.peticion(enviar('/sap/bc/adt/z', { parametros: { rowNumber: '1' }, cuerpo: 'SELECT' }));
    assert.equal(peticiones[0].redirect, 'manual');
    assert.equal(peticiones[1].url, 'https://h:44300/sap/bc/adt/z?rowNumber=1&sap-client=100');
    assert.equal(peticiones[1].redirect, 'manual');
    assert.ok(registro.length > 0);
    assert.ok(registro.every((linea) => !linea.includes('rowNumber') && !linea.includes('sap-client')), registro.join('\n'));
  });

  test('enmascara el nombre del objeto en el registro y en el mensaje del error, no en la URL pedida', async () => {
    const registro: string[] = [];
    const { fetchFn, peticiones } = crearFetchFalso([{ estado: 200, cuerpo: 'abc' }]);
    await crearTransporte(fetchFn, { registrar: (m) => registro.push(m) }).peticion(obtener('/sap/bc/adt/ddic/tables/zt_ejemplo'));
    assert.ok(peticiones[0].url.includes('/sap/bc/adt/ddic/tables/zt_ejemplo'));
    const lento = crearTransporte(fetchQueEsperaAbortar(), { tiempoMs: 20, registrar: (m) => registro.push(m) });
    await assert.rejects(lento.peticion(obtener('/sap/bc/adt/programs/programs/zr_ejemplo')), (e: unknown) =>
      e instanceof ErrorAdt && e.message === 'ADT GET /sap/bc/adt/programs/programs/<objeto>: sin respuesta en 20 ms'
        && e.ruta === '/sap/bc/adt/programs/programs/zr_ejemplo');
    assert.deepStrictEqual(registro, [
      'ADT GET /sap/bc/adt/ddic/tables/<objeto> → 200 (3 bytes)',
      'ADT GET /sap/bc/adt/programs/programs/<objeto> → sin respuesta en 20 ms',
    ]);
  });
});
