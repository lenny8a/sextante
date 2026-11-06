import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compararVersiones, versionDelNombre } from '../../src/adt/puente-piezas';
import { localizarExtensionOficial } from '../../src/bridge/adt-oficial-doc';

type MensajeJson = Record<string, unknown>;

interface PiezasPrueba { java: string; jarJco?: string; fragmento?: string }

const CLASES_PUENTE = path.resolve(__dirname, '../../puente-rfc');

function mayorPorPrefijo(carpeta: string, prefijo: string, sufijo: string): string | undefined {
  const candidatos = fs.readdirSync(carpeta)
    .filter((nombre) => nombre.startsWith(prefijo) && nombre.endsWith(sufijo))
    .sort((a, b) => compararVersiones(versionDelNombre(b), versionDelNombre(a)));
  return candidatos.length ? path.join(carpeta, candidatos[0]) : undefined;
}

function javaDelPath(): string | undefined {
  const resultado = spawnSync('java', ['-version'], { stdio: 'ignore' });
  return resultado.status === 0 ? 'java' : undefined;
}

function localizarPiezasPrueba(): PiezasPrueba | undefined {
  const raiz = localizarExtensionOficial();
  const plugins = raiz ? path.join(raiz, 'adt-ls', 'win32', 'win32', 'x86_64', 'plugins') : undefined;
  if (!plugins || !fs.existsSync(plugins)) {
    const java = javaDelPath();
    return java ? { java } : undefined;
  }
  const jre = mayorPorPrefijo(plugins, 'com.sap.adt.jvm.sapmachineminimal.win32.x86_64_', '');
  const javaOficial = jre ? path.join(jre, 'jre', 'bin', 'java.exe') : undefined;
  const java = javaOficial && fs.existsSync(javaOficial) ? javaOficial : javaDelPath();
  if (!java) {
    return undefined;
  }
  return {
    java,
    jarJco: mayorPorPrefijo(plugins, 'com.sap.conn.jco_', '.jar'),
    fragmento: mayorPorPrefijo(plugins, 'com.sap.conn.jco.win32.x86_64_', '.jar'),
  };
}

class ProcesoPuente {
  private readonly pendientes: string[] = [];
  private readonly esperas: Array<{ resolver: (linea: string) => void; rechazar: (error: Error) => void }> = [];
  private resto = '';
  readonly lineas: string[] = [];
  readonly salida: Promise<number | null>;

  constructor(readonly hijo: ChildProcessWithoutNullStreams) {
    hijo.stdout.setEncoding('utf8');
    hijo.stdout.on('data', (trozo: string) => this.recibir(trozo));
    hijo.stderr.resume();
    this.salida = new Promise((resolver) => hijo.on('exit', (codigo) => {
      for (const espera of this.esperas.splice(0)) {
        espera.rechazar(new Error(`el puente terminó con código ${codigo} sin responder`));
      }
      resolver(codigo);
    }));
  }

  enviar(linea: string): void {
    this.hijo.stdin.write(`${linea}\n`, 'utf8');
  }

  siguiente(): Promise<MensajeJson> {
    const linea = this.pendientes.shift();
    const promesa = linea !== undefined
      ? Promise.resolve(linea)
      : new Promise<string>((resolver, rechazar) => this.esperas.push({ resolver, rechazar }));
    return promesa.then((texto) => JSON.parse(texto) as MensajeJson);
  }

  vivo(): boolean {
    return this.hijo.exitCode === null && this.hijo.signalCode === null;
  }

  private recibir(trozo: string): void {
    this.resto += trozo;
    let corte = this.resto.indexOf('\n');
    while (corte >= 0) {
      const linea = this.resto.slice(0, corte).replace(/\r$/, '');
      this.resto = this.resto.slice(corte + 1);
      this.lineas.push(linea);
      const espera = this.esperas.shift();
      if (espera) {
        espera.resolver(linea);
      } else {
        this.pendientes.push(linea);
      }
      corte = this.resto.indexOf('\n');
    }
  }
}

suite('Puente Java (proceso real)', () => {
  let piezas: PiezasPrueba | undefined;
  let temporal: string | undefined;
  let proceso: ProcesoPuente | undefined;

  suiteSetup(function (this: Mocha.Context) {
    piezas = localizarPiezasPrueba();
    if (!piezas || !fs.existsSync(path.join(CLASES_PUENTE, 'PuenteRfc.class'))) {
      this.skip();
    }
  });

  setup(() => {
    temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'puente-java-'));
  });

  teardown(async () => {
    if (proceso && proceso.vivo()) {
      proceso.hijo.kill();
      await proceso.salida;
    }
    proceso = undefined;
    if (temporal) {
      fs.rmSync(temporal, { recursive: true, force: true });
      temporal = undefined;
    }
  });

  function lanzar(carpetaLib: string): ProcesoPuente {
    assert.ok(piezas);
    const classpath = [CLASES_PUENTE, ...(piezas.jarJco ? [piezas.jarJco] : [])].join(path.delimiter);
    const hijo = spawn(piezas.java, [`-Djava.library.path=${carpetaLib}`, '-cp', classpath, 'PuenteRfc'], { stdio: 'pipe' });
    proceso = new ProcesoPuente(hijo);
    return proceso;
  }

  test('preparar extrae la DLL del fragmento y salir termina con código 0', async function (this: Mocha.Context) {
    this.timeout(30_000);
    assert.ok(piezas && temporal);
    if (!piezas.fragmento) {
      this.skip();
    }
    const carpetaLib = path.join(temporal, 'lib');
    const puente = lanzar(carpetaLib);

    puente.enviar(JSON.stringify({ id: 1, tipo: 'preparar', fragmentoJar: piezas.fragmento, carpetaLib }));
    const preparado = await puente.siguiente();
    assert.equal(preparado.id, 1);
    assert.equal(preparado.ok, true);
    assert.match(String(preparado.versionJco), /^\d+\.\d+\.\d+/);
    assert.ok(fs.existsSync(path.join(carpetaLib, 'sapjco3.dll')), 'falta sapjco3.dll en la carpeta lib');

    puente.enviar(JSON.stringify({ id: 2, tipo: 'salir' }));
    assert.deepEqual(await puente.siguiente(), { id: 2, ok: true });
    assert.equal(await puente.salida, 0);
    for (const linea of puente.lineas) {
      assert.doesNotThrow(() => JSON.parse(linea), 'stdout solo lleva líneas JSON');
    }
  });

  test('una línea que no es JSON responde error de protocolo sin id y el proceso sigue vivo', async function (this: Mocha.Context) {
    this.timeout(30_000);
    assert.ok(temporal);
    const puente = lanzar(path.join(temporal, 'lib'));

    puente.enviar('esto no es json');
    const error = await puente.siguiente();
    assert.equal('id' in error, false);
    const detalle = error.error as MensajeJson;
    assert.equal(detalle.clase, 'protocolo');
    assert.equal(typeof detalle.mensaje, 'string');
    assert.ok(puente.vivo());

    puente.enviar(JSON.stringify({ id: 7, tipo: 'desconocido' }));
    const desconocido = await puente.siguiente();
    assert.equal(desconocido.id, 7);
    assert.equal((desconocido.error as MensajeJson).clase, 'protocolo');

    puente.enviar(JSON.stringify({ id: 8, tipo: 'salir' }));
    assert.deepEqual(await puente.siguiente(), { id: 8, ok: true });
    assert.equal(await puente.salida, 0);
  });

  test('dos peticiones seguidas se atienden a la vez y cada respuesta lleva su id', async function (this: Mocha.Context) {
    this.timeout(30_000);
    assert.ok(piezas && temporal);
    if (!piezas.fragmento || !piezas.jarJco) {
      this.skip();
    }
    const carpetaLib = path.join(temporal, 'lib');
    const puente = lanzar(carpetaLib);
    puente.enviar(JSON.stringify({ id: 1, tipo: 'preparar', fragmentoJar: piezas.fragmento, carpetaLib }));
    assert.equal((await puente.siguiente()).ok, true);

    const peticion = { tipo: 'peticion', destino: 'NO_EXISTE', metodo: 'GET', uri: '/sap/bc/adt/discovery', cabeceras: {}, cuerpo: '' };
    puente.enviar(JSON.stringify({ id: 2, ...peticion }));
    puente.enviar(JSON.stringify({ id: 3, ...peticion }));
    const respuestas = [await puente.siguiente(), await puente.siguiente()];

    assert.deepEqual(respuestas.map((r) => r.id).sort(), [2, 3]);
    for (const respuesta of respuestas) {
      assert.equal((respuesta.error as MensajeJson).clase, 'protocolo');
    }
    assert.ok(puente.vivo());

    puente.enviar(JSON.stringify({ id: 4, tipo: 'salir' }));
    assert.deepEqual(await puente.siguiente(), { id: 4, ok: true });
    assert.equal(await puente.salida, 0);
  });

  test('tabla: sin logon responde error de protocolo y una tabla con nombre inválido también', async function (this: Mocha.Context) {
    this.timeout(30_000);
    assert.ok(piezas && temporal);
    if (!piezas.fragmento || !piezas.jarJco) {
      this.skip();
    }
    const carpetaLib = path.join(temporal, 'lib');
    const puente = lanzar(carpetaLib);
    puente.enviar(JSON.stringify({ id: 1, tipo: 'preparar', fragmentoJar: piezas.fragmento, carpetaLib }));
    assert.equal((await puente.siguiente()).ok, true);

    puente.enviar(JSON.stringify({ id: 7, tipo: 'tabla', destino: 'DEST', tabla: 'SNAP', campos: ['SEQNO', 'FLIST'], condiciones: ["DATUM EQ '20261103'"], filasMax: 0 }));
    const sinLogon = await puente.siguiente();
    assert.equal(sinLogon.id, 7);
    assert.equal((sinLogon.error as MensajeJson).clase, 'protocolo');
    puente.enviar(JSON.stringify({ id: 8, tipo: 'tabla', destino: 'DEST', tabla: 'snap; drop', campos: ['SEQNO'], condiciones: [], filasMax: 0 }));
    const invalida = await puente.siguiente();
    assert.equal(invalida.id, 8);
    assert.equal((invalida.error as MensajeJson).clase, 'protocolo');
    puente.enviar(JSON.stringify({ id: 10, tipo: 'tabla', destino: 'DEST', tabla: 'MARA', campos: ['MATNR'], condiciones: [], filasMax: 0 }));
    const noLegible = await puente.siguiente();
    assert.equal(noLegible.id, 10);
    assert.equal((noLegible.error as MensajeJson).clase, 'protocolo');
    assert.equal(puente.vivo(), true);

    puente.enviar(JSON.stringify({ id: 9, tipo: 'salir' }));
    assert.deepEqual(await puente.siguiente(), { id: 9, ok: true });
    assert.equal(await puente.salida, 0);
  });

  test('el fin de stdin termina el proceso con código 0', async function (this: Mocha.Context) {
    this.timeout(30_000);
    assert.ok(temporal);
    const puente = lanzar(path.join(temporal, 'lib'));
    puente.hijo.stdin.end();
    assert.equal(await puente.salida, 0);
  });
});
