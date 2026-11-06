import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { CODIGOS } from '../../src/ia/jsonrpc-modelo';
import { ServidorHttpMcp, CABECERA_SESION } from '../../src/ia/servidor-http';
import type { DependenciasDespacho } from '../../src/ia/mcp-modelo';

const TOKEN = 'token-de-prueba-0123456789';
const despacho: DependenciasDespacho = { catalogo: [], version: '0.1.0', instrucciones: 'haz esto' };
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'c', version: '1' } } };

suite('IA: servidor HTTP del MCP', () => {
  let servidor: ServidorHttpMcp;
  let base = '';

  suiteSetup(async () => {
    servidor = new ServidorHttpMcp({ token: TOKEN, despacho });
    base = `http://127.0.0.1:${await servidor.arrancar(0)}`;
  });
  suiteTeardown(async () => {
    await servidor.cerrar();
  });

  const post = (cuerpo: unknown, cabeceras: Record<string, string> = {}, auth = true): Promise<Response> =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), ...cabeceras },
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    });

  test('sin token → 401 JSON-RPC; con token → initialize con Mcp-Session-Id', async () => {
    const sin = await post(init, {}, false);
    assert.equal(sin.status, 401);
    assert.match(sin.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await sin.json(), { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'No autorizado' } });
    const mala = await post(init, { authorization: 'Bearer otro' }, false);
    assert.equal(mala.status, 401);
    const ok = await post(init);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type') ?? '', /application\/json/);
    assert.ok(ok.headers.get(CABECERA_SESION));
    const cuerpo = (await ok.json()) as { result: { serverInfo: { name: string } } };
    assert.equal(cuerpo.result.serverInfo.name, 'sextante');
  });

  test('GET → 405 con Allow; ruta distinta → 404; DELETE borra la sesión y sesiones vuelve a 0', async () => {
    const get = await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST, DELETE');
    const otra = await fetch(`${base}/otra`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: '{}' });
    assert.equal(otra.status, 404);
    const antes = servidor.sesiones;
    const id = (await post(init)).headers.get(CABECERA_SESION) ?? '';
    assert.equal(servidor.sesiones, antes + 1);
    const del = await fetch(`${base}/mcp`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}`, [CABECERA_SESION]: id } });
    assert.equal(del.status, 204);
    assert.equal(servidor.sesiones, antes);
  });

  test('Origin ajena → 403; Origin localhost → 200', async () => {
    const ajena = await post(init, { origin: 'http://evil.example.com' });
    assert.equal(ajena.status, 403);
    assert.equal((await post(init, { origin: 'http://localhost:3000' })).status, 200);
    assert.equal((await post(init, { origin: 'http://127.0.0.1' })).status, 200);
    assert.equal((await post(init, { origin: 'http://localhost.evil.com' })).status, 403);
  });

  test('cuerpo mayor de 2 MB → 413', async () => {
    const r = await post(' '.repeat(2 * 1024 * 1024 + 1));
    assert.equal(r.status, 413);
  });

  test('JSON roto → 200 con error -32700 e id null', async () => {
    const r = await post('{roto');
    assert.equal(r.status, 200);
    const c = (await r.json()) as { id: unknown; error: { code: number } };
    assert.equal(c.id, null);
    assert.equal(c.error.code, CODIGOS.parse);
  });

  test('lote de dos peticiones → lote de dos respuestas; lote de notificaciones → 202 sin cuerpo', async () => {
    const r = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }]);
    assert.equal(r.status, 200);
    const c = (await r.json()) as { id: number }[];
    assert.deepEqual(c.map((x) => x.id), [1, 2]);
    const n = await post([{ jsonrpc: '2.0', method: 'notifications/initialized' }]);
    assert.equal(n.status, 202);
    assert.equal(await n.text(), '');
    const u = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(u.status, 202);
  });

  test('POST /ceder: 401 sin token, 403 con Origin ajena, 405 con GET, 204 con token y luego avisa a alCeder', async () => {
    let cedidas = 0;
    let avisado: () => void = () => undefined;
    const avisoRecibido = new Promise<void>((resolver) => {
      avisado = resolver;
    });
    const otro = new ServidorHttpMcp({
      token: TOKEN,
      despacho,
      alCeder: () => {
        cedidas++;
        avisado();
      },
    });
    const url = `http://127.0.0.1:${await otro.arrancar(0)}/ceder`;
    try {
      const sin = await fetch(url, { method: 'POST' });
      assert.equal(sin.status, 401);
      const ajena = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, origin: 'http://evil.example.com' } });
      assert.equal(ajena.status, 403);
      const get = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } });
      assert.equal(get.status, 405);
      assert.equal(cedidas, 0);
      const ok = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
      assert.equal(ok.status, 204);
      await avisoRecibido;
      assert.equal(cedidas, 1);
    } finally {
      await otro.cerrar();
    }
  });

  test('una sesión desconocida se acepta como nueva', async () => {
    const antes = servidor.sesiones;
    const r = await post({ jsonrpc: '2.0', id: 3, method: 'ping' }, { [CABECERA_SESION]: 'sesion-de-otra-ventana' });
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as { result: unknown }).result, {});
    assert.equal(servidor.sesiones, antes + 1);
  });

  test('arrancar dos veces en el mismo puerto rechaza con EADDRINUSE', async () => {
    const otro = new ServidorHttpMcp({ token: TOKEN, despacho });
    await assert.rejects(otro.arrancar(servidor.puerto ?? 0), (e: NodeJS.ErrnoException) => e.code === 'EADDRINUSE');
    await otro.cerrar();
  });

  test('un fallo del despacho → 500 con -32603 y registro sin token', async () => {
    const logs: string[] = [];
    const roto: DependenciasDespacho = { ...despacho, get catalogo(): never { throw new RangeError('x'); } };
    const s = new ServidorHttpMcp({ token: TOKEN, despacho: roto, registrar: (m) => logs.push(m) });
    const url = `http://127.0.0.1:${await s.arrancar(0)}/mcp`;
    try {
      const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      assert.equal(r.status, 500);
      assert.equal(((await r.json()) as { error: { code: number } }).error.code, CODIGOS.interno);
      assert.deepEqual(logs, ['IA: error interno del servidor (RangeError)']);
    } finally {
      await s.cerrar();
    }
  });

  test('un error del servidor ya escuchando (EMFILE al aceptar) se registra y no se lanza', async () => {
    const logs: string[] = [];
    const s = new ServidorHttpMcp({ token: TOKEN, despacho, registrar: (m) => logs.push(m) });
    await s.arrancar(0);
    try {
      // Acceso de prueba al http.Server privado: no se expone nada nuevo en la clase.
      const nodo = (s as unknown as { servidor: Server }).servidor;
      assert.doesNotThrow(() => nodo.emit('error', Object.assign(new Error('demasiados archivos'), { code: 'EMFILE' })));
      assert.deepEqual(logs, ['IA: error del servidor (Error)']);
      assert.notEqual(s.puerto, undefined);
    } finally {
      await s.cerrar();
    }
  });
});
