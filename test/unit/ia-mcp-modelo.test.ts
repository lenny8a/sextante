import assert from 'node:assert/strict';
import { CODIGOS, type PeticionJsonRpc } from '../../src/ia/jsonrpc-modelo';
import {
  INSTRUCCIONES_AGENTE,
  VERSION_POR_DEFECTO,
  despachar,
  negociarVersion,
  resumenDeArgs,
  type DependenciasDespacho,
  type HerramientaMcp,
  type RegistroLlamada,
} from '../../src/ia/mcp-modelo';

const eco: HerramientaMcp = { nombre: 'eco', descripcion: 'devuelve', inputSchema: { type: 'object', properties: { t: { type: 'string', description: 'texto' } }, required: ['t'], additionalProperties: false }, ejecutar: async (a) => ({ texto: `eco:${String(a.t)}` }) };
const rota: HerramientaMcp = { ...eco, nombre: 'rota', ejecutar: async () => { throw new TypeError('x'); } };
const deps = (llamadas: RegistroLlamada[] = []): DependenciasDespacho => ({ catalogo: [eco, rota], version: '0.1.0', instrucciones: 'haz esto', registrar: (l) => llamadas.push(l), ahora: () => 1000 });
const peticion = (method: string, params?: unknown): PeticionJsonRpc => ({ jsonrpc: '2.0', id: 7, method, params });

suite('IA: protocolo MCP', () => {
  test('negociarVersion acepta las soportadas y cae a la por defecto', () => {
    assert.equal(negociarVersion('2025-06-18'), '2025-06-18');
    assert.equal(negociarVersion('2024-11-05'), VERSION_POR_DEFECTO);
    assert.equal(negociarVersion(undefined), VERSION_POR_DEFECTO);
  });
  test('initialize devuelve versión, capacidades, serverInfo e instrucciones', async () => {
    const r = await despachar(peticion('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } }), deps());
    assert.deepEqual(r?.result, { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'sextante', version: '0.1.0' }, instructions: 'haz esto' });
  });
  test('notifications/initialized no responde; ping responde {}', async () => {
    assert.equal(await despachar({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps()), undefined);
    assert.deepEqual((await despachar(peticion('ping'), deps()))?.result, {});
  });
  test('tools/list lista nombre, descripción y esquema', async () => {
    const r = await despachar(peticion('tools/list'), deps());
    assert.deepEqual(r?.result, { tools: [{ name: 'eco', description: 'devuelve', inputSchema: eco.inputSchema }, { name: 'rota', description: 'devuelve', inputSchema: eco.inputSchema }] });
  });
  test('tools/call ejecuta, envuelve en content y registra la llamada', async () => {
    const llamadas: RegistroLlamada[] = [];
    const r = await despachar(peticion('tools/call', { name: 'eco', arguments: { t: 'hola' } }), deps(llamadas));
    assert.deepEqual(r?.result, { content: [{ type: 'text', text: 'eco:hola' }], isError: false });
    assert.deepEqual(llamadas, [{ hora: 1000, herramienta: 'eco', resumen: 't=hola', resultado: 'ok' }]);
  });
  test('argumentos inválidos → isError con el motivo, no error JSON-RPC', async () => {
    const r = await despachar(peticion('tools/call', { name: 'eco', arguments: {} }), deps());
    assert.equal(r?.error, undefined);
    const res = r?.result as { isError: boolean; content: { text: string }[] };
    assert.ok(res.isError && res.content[0].text.includes('t'));
  });
  test('herramienta desconocida → -32602; método desconocido → -32601', async () => {
    assert.equal((await despachar(peticion('tools/call', { name: 'nada', arguments: {} }), deps()))?.error?.code, CODIGOS.paramsInvalidos);
    assert.equal((await despachar(peticion('x/y'), deps()))?.error?.code, CODIGOS.metodoDesconocido);
  });
  test('una excepción de la herramienta → isError con el nombre del error y registro error', async () => {
    const llamadas: RegistroLlamada[] = [];
    const r = await despachar(peticion('tools/call', { name: 'rota', arguments: { t: 'a' } }), deps(llamadas));
    const res = r?.result as { isError: boolean; content: { text: string }[] };
    assert.ok(res.isError && res.content[0].text.includes('TypeError'));
    assert.equal(llamadas[0].resultado, 'error');
  });
  test('el registro lleva la uri de los argumentos en ok, en error y en excepción', async () => {
    const esquemaUri: HerramientaMcp['inputSchema'] = { type: 'object', properties: { uri: { type: 'string', description: 'uri' } }, required: ['uri'], additionalProperties: false };
    const lee: HerramientaMcp = { nombre: 'lee', descripcion: 'lee', inputSchema: esquemaUri, ejecutar: async (a) => ({ texto: String(a.uri), esError: a.uri === 'abap:/mal' }) };
    const explota: HerramientaMcp = { ...lee, nombre: 'explota', ejecutar: async () => { throw new RangeError('x'); } };
    const llamadas: RegistroLlamada[] = [];
    const d: DependenciasDespacho = { ...deps(llamadas), catalogo: [lee, explota] };
    await despachar(peticion('tools/call', { name: 'lee', arguments: { uri: 'abap:/bien' } }), d);
    await despachar(peticion('tools/call', { name: 'lee', arguments: { uri: 'abap:/mal' } }), d);
    await despachar(peticion('tools/call', { name: 'explota', arguments: { uri: 'abap:/roto' } }), d);
    assert.deepEqual(llamadas.map((l) => [l.resultado, l.uri]), [['ok', 'abap:/bien'], ['error', 'abap:/mal'], ['error', 'abap:/roto']]);
  });
  test('un registrar que lanza no cambia el resultado de la herramienta', async () => {
    const d: DependenciasDespacho = { ...deps(), registrar: () => { throw new Error('vista rota'); } };
    const ok = await despachar(peticion('tools/call', { name: 'eco', arguments: { t: 'hola' } }), d);
    assert.deepEqual(ok?.result, { content: [{ type: 'text', text: 'eco:hola' }], isError: false });
    const rotaR = await despachar(peticion('tools/call', { name: 'rota', arguments: { t: 'a' } }), d);
    assert.deepEqual(rotaR?.result, { content: [{ type: 'text', text: 'Error interno de la herramienta: TypeError' }], isError: true });
    const invalida = await despachar(peticion('tools/call', { name: 'eco', arguments: {} }), d);
    assert.equal((invalida?.result as { isError: boolean }).isError, true);
  });
  test('las instrucciones incluyen los pasos 9 y 10 y la regla 0 ya no cita crear objetos', () => {
    assert.ok(
      INSTRUCCIONES_AGENTE.includes(
        '5. Activa solo cuando el usuario lo pida expresamente. Si el objeto tiene includes o hay varios objetos inactivos, activa con todo: true (lista «Activate All» de la extensión oficial), no archivo por archivo.\n',
      ),
    );
    assert.ok(INSTRUCCIONES_AGENTE.includes('9. Antes de afirmar'));
    assert.ok(
      INSTRUCCIONES_AGENTE.includes(
        '10. Si necesitas un objeto que no existe, pídelo con crear_objeto. Un objeto principal (programa, clase, grupo de funciones) va por el asistente de la extensión oficial: el usuario elige ahí tipo, paquete y orden. Un include de un programa que ya existe se crea directo indicando programaPrincipal: hereda el paquete y la orden del programa y el usuario solo confirma. Nunca supongas un paquete ni una orden. Un objeto que ya existe se queda en su paquete. Si no puedes crear, para y díselo. Nunca guardes código en archivos locales ni inventes nombres, paquetes o rutas sin preguntar.',
      ),
    );
    assert.ok(!INSTRUCCIONES_AGENTE.includes('crear objetos'));
    assert.ok(!INSTRUCCIONES_AGENTE.includes('(ATC, transportes)'));
  });

  test('las instrucciones 0 y 11 mandan el ATC por ejecutar_atc', () => {
    assert.ok(
      INSTRUCCIONES_AGENTE.includes(
        '0. Para cualquier tarea sobre código ABAP usa primero las herramientas de sextante. Si además tienes registrado el servidor adt de SAP (herramientas abap_*), úsalo solo para lo que sextante no cubre (transportes) y nunca para leer, editar, verificar, activar ni pasar el ATC de un objeto que puedas tratar con sextante.',
      ),
    );
    assert.ok(
      INSTRUCCIONES_AGENTE.endsWith(
        '11. Al terminar el código de una tarea, y con verificar_sintaxis sin errores, pasa el ATC con ejecutar_atc sobre el objeto. Corrige con proponer_cambio todos los errores y advertencias que salgan y vuelve a pasar el ATC; repite hasta que no quede ninguno. No des la tarea por terminada sin un ATC limpio. Si un hallazgo no se puede corregir sin cambiar lo que pidió el usuario, o sigue saliendo después de corregirlo, para y explícaselo al usuario en vez de insistir.',
      ),
    );
  });

  test('las instrucciones del agente incluyen los pasos 7 y 8 del diario', () => {
    assert.ok(INSTRUCCIONES_AGENTE.includes('7. Si contexto_actual trae diario'));
    assert.ok(INSTRUCCIONES_AGENTE.includes('8. Al terminar una tarea'));
  });
  test('resumenDeArgs recorta a 120 caracteres', () => {
    assert.equal(resumenDeArgs({ a: 1, b: 'x' }), 'a=1, b=x');
    assert.equal(resumenDeArgs({ t: 'y'.repeat(200) }).length, 120);
  });
});
