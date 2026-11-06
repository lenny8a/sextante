import assert from 'node:assert/strict';
import {
  argumentosBaja,
  argumentosConsulta,
  argumentosRegistro,
  comandoParaCopiar,
  consultarRegistro,
  interpretarConsulta,
  lanzar,
  registrarEnClaude,
  textoConfiguracion,
  urlServidor,
  type EjecutorCli,
} from '../../src/ia/registro-claude';

function ejecutorFijo(codigo: number, salida: string): EjecutorCli {
  return { ejecutar: async () => ({ codigo, salida }) };
}

function ejecutorQueFalla(code: string): EjecutorCli {
  return {
    ejecutar: async () => {
      throw Object.assign(new Error('fallo'), { code });
    },
  };
}

function contar(texto: string, sub: string): number {
  return texto.split(sub).length - 1;
}

suite('Registro en Claude Code', () => {
  test('urlServidor y argumentos exactos', () => {
    assert.equal(urlServidor(2237), 'http://127.0.0.1:2237/mcp');
    assert.deepEqual(argumentosRegistro(2237, 'tok'), [
      'mcp', 'add', '--transport', 'http', '--scope', 'user', 'sextante',
      'http://127.0.0.1:2237/mcp', '--header', 'Authorization: Bearer tok',
    ]);
    assert.deepEqual(argumentosConsulta(), ['mcp', 'get', 'sextante']);
    assert.deepEqual(argumentosBaja(), ['mcp', 'remove', '--scope', 'user', 'sextante']);
  });

  test('interpretarConsulta', () => {
    assert.deepEqual(interpretarConsulta('sextante:\n  URL: http://127.0.0.1:2237/mcp\n', 0), { estado: 'registrado', puerto: 2237 });
    assert.deepEqual(interpretarConsulta('URL: http://localhost:3000/mcp', 0), { estado: 'registrado', puerto: 3000 });
    assert.deepEqual(interpretarConsulta('No MCP server found with name: sextante', 1), { estado: 'noRegistrado' });
    assert.deepEqual(interpretarConsulta('Not Found', 0), { estado: 'noRegistrado' });
    assert.deepEqual(interpretarConsulta('algo raro', 1), { estado: 'noRegistrado' });
    assert.deepEqual(interpretarConsulta('algo raro', 0), { estado: 'desconocido' });
  });

  test('registrarEnClaude', async () => {
    assert.deepEqual(await registrarEnClaude(2237, 'tok', ejecutorFijo(0, 'Added')), { estado: 'registrado', puerto: 2237 });
    assert.deepEqual(await registrarEnClaude(2237, 'tok', ejecutorFijo(1, 'error')), { estado: 'desconocido' });
    assert.deepEqual(await registrarEnClaude(2237, 'tok', ejecutorQueFalla('ENOENT')), { estado: 'sinCli' });
  });

  test('registrarEnClaude da de baja antes de dar de alta e ignora el fallo de la baja', async () => {
    const llamadas: string[][] = [];
    const cli: EjecutorCli = {
      ejecutar: async (_programa, args) => {
        llamadas.push(args);
        return args[1] === 'remove' ? { codigo: 1, salida: 'No MCP server found with name: sextante' } : { codigo: 0, salida: 'Added' };
      },
    };
    assert.deepEqual(await registrarEnClaude(2237, 'tok', cli), { estado: 'registrado', puerto: 2237 });
    assert.deepEqual(llamadas, [argumentosBaja(), argumentosRegistro(2237, 'tok')]);
  });

  test('registrarEnClaude pasa los argumentos al ejecutor', async () => {
    const llamadas: Array<{ programa: string; args: string[] }> = [];
    const cli: EjecutorCli = {
      ejecutar: async (programa, args) => {
        llamadas.push({ programa, args });
        return { codigo: 0, salida: '' };
      },
    };
    await registrarEnClaude(2237, 'tok', cli);
    assert.deepEqual(llamadas, [
      { programa: 'claude', args: argumentosBaja() },
      { programa: 'claude', args: argumentosRegistro(2237, 'tok') },
    ]);
  });

  test('consultarRegistro', async () => {
    assert.deepEqual(await consultarRegistro(ejecutorFijo(0, 'http://127.0.0.1:2237/mcp')), { estado: 'registrado', puerto: 2237 });
    assert.deepEqual(await consultarRegistro(ejecutorFijo(1, 'No MCP server found')), { estado: 'noRegistrado' });
    assert.deepEqual(await consultarRegistro(ejecutorQueFalla('ENOENT')), { estado: 'sinCli' });
  });

  test('EINVAL equivale a sinCli', async () => {
    assert.deepEqual(await registrarEnClaude(2237, 'tok', ejecutorQueFalla('EINVAL')), { estado: 'sinCli' });
    assert.deepEqual(await consultarRegistro(ejecutorQueFalla('EINVAL')), { estado: 'sinCli' });
  });

  test('otro rechazo da desconocido y no filtra el token', async () => {
    const cli: EjecutorCli = {
      ejecutar: async () => {
        throw Object.assign(new Error('Command failed: claude mcp add --header Authorization: Bearer SECRETO'), { code: 'ETIMEDOUT' });
      },
    };
    const r = await registrarEnClaude(2237, 'SECRETO', cli);
    assert.deepEqual(r, { estado: 'desconocido' });
    assert.ok(!JSON.stringify(r).includes('SECRETO'));
    assert.deepEqual(await consultarRegistro(cli), { estado: 'desconocido' });
  });

  test('lanzar rechaza con mensaje fijo y código, sin argumentos', async () => {
    await assert.rejects(lanzar('programa-inexistente-sextante', ['--header', 'Bearer SECRETO']), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(e.message, 'La CLI de Claude Code no respondió');
      assert.ok(!e.message.includes('SECRETO'));
      assert.equal((e as { code?: unknown }).code, 'ENOENT');
      return true;
    });
  });

  test('textoConfiguracion: el token aparece una vez por bloque', () => {
    const texto = textoConfiguracion(2237, 'SECRETO');
    assert.equal(contar(texto, 'SECRETO'), 2);
    assert.ok(texto.includes('[mcp_servers.sextante]'));
    assert.ok(texto.includes('url = "http://127.0.0.1:2237/mcp"'));
    assert.ok(texto.includes('bearer_token_env_var = "SEXTANTE_MCP_TOKEN"'));
    assert.ok(texto.includes('SEXTANTE_MCP_TOKEN=SECRETO'));
    assert.ok(texto.includes('"Authorization": "Bearer SECRETO"'));
    assert.ok(texto.includes('"type": "http"'));
  });

  test('comandoParaCopiar', () => {
    assert.equal(
      comandoParaCopiar(2237, 'tok'),
      'claude mcp add --transport http --scope user sextante http://127.0.0.1:2237/mcp --header "Authorization: Bearer tok"',
    );
  });
});
