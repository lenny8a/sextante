import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ErrorConfig,
  configVacia,
  conCompararCon,
  compararConDe,
  conRol,
  conPrefijoPropio,
  conUrl,
  escribirConfig,
  esProtegido,
  firmaConexion,
  leerConfig,
  prefijosPropiosDe,
  sinUrl,
  sugerirRol,
  urlDe,
} from '../../src/config/navegador-config';

suite('configuración abap-navigator.json', () => {
  let carpeta = '';
  setup(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'navegador-config-'));
  });
  teardown(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  function escribirCrudo(contenido: string): string {
    const ruta = path.join(carpeta, 'abap-navigator.json');
    fs.writeFileSync(ruta, contenido);
    return ruta;
  }

  test('sugerirRol deduce el rol del id de sistema o del id del destino', () => {
    assert.strictEqual(sugerirRol('DEV', 'X'), 'DEV');
    assert.strictEqual(sugerirRol(undefined, 'QAS-ICC'), 'QAS');
    assert.strictEqual(sugerirRol('P01', 'PRD-X'), 'PRD');
    assert.strictEqual(sugerirRol('S4H', 'SISTEMA'), undefined);
    assert.strictEqual(sugerirRol('dev', 'x'), 'DEV');
    assert.strictEqual(sugerirRol(undefined, 'PRD-DEVOPS'), 'PRD');
    assert.strictEqual(sugerirRol('PROYECTO', 'X'), undefined);
    assert.strictEqual(sugerirRol('QAD', 'X'), undefined);
    assert.strictEqual(sugerirRol(undefined, 'DEVELOP'), undefined);
    assert.strictEqual(sugerirRol('DEV01', 'X'), 'DEV');
    assert.strictEqual(sugerirRol(undefined, 'dev_clie'), 'DEV');
  });

  test('archivo ausente devuelve config vacía', () => {
    assert.deepStrictEqual(leerConfig(path.join(carpeta, 'no.json')), { version: 1, destinos: {} });
  });

  test('ida y vuelta conserva rol y url', () => {
    const ruta = path.join(carpeta, 'sub', 'abap-navigator.json');
    escribirConfig(
      ruta,
      conRol({ version: 1, destinos: { 'DEV-X': { url: 'https://h:44300' } } }, 'DEV-X', 'DEV'),
    );
    assert.deepStrictEqual(leerConfig(ruta).destinos['DEV-X'], { url: 'https://h:44300', rol: 'DEV' });
  });

  test('JSON roto lanza ErrorConfig', () => {
    const ruta = path.join(carpeta, 'abap-navigator.json');
    fs.writeFileSync(ruta, '{');
    assert.throws(() => leerConfig(ruta), ErrorConfig);
  });

  test('rol desconocido lanza ErrorConfig con el id', () => {
    const ruta = path.join(carpeta, 'abap-navigator.json');
    fs.writeFileSync(ruta, JSON.stringify({ version: 1, destinos: { 'QAS-X': { rol: 'TEST' } } }));
    assert.throws(() => leerConfig(ruta), /QAS-X/);
  });

  test('version distinta de 1 lanza ErrorConfig', () => {
    const ruta = escribirCrudo(JSON.stringify({ version: 2, destinos: {} }));
    assert.throws(() => leerConfig(ruta), ErrorConfig);
  });

  test('destinos que no es objeto plano lanza ErrorConfig', () => {
    const ruta = escribirCrudo(JSON.stringify({ version: 1, destinos: [] }));
    assert.throws(() => leerConfig(ruta), ErrorConfig);
  });

  test('entrada que no es objeto lanza ErrorConfig con el id', () => {
    const ruta = escribirCrudo(JSON.stringify({ version: 1, destinos: { X: 5 } }));
    assert.throws(() => leerConfig(ruta), (error: unknown) => error instanceof ErrorConfig && /X/.test(error.message));
  });

  test('url que no es texto lanza ErrorConfig con el id', () => {
    const ruta = escribirCrudo(JSON.stringify({ version: 1, destinos: { X: { url: 7 } } }));
    assert.throws(() => leerConfig(ruta), (error: unknown) => error instanceof ErrorConfig && /X/.test(error.message));
  });

  test('conRol no muta el original', () => {
    const base = configVacia();
    conRol(base, 'A', 'QAS');
    assert.deepStrictEqual(base.destinos, {});
  });

  test('esProtegido marca QAS y PRD como protegidos', () => {
    assert.strictEqual(esProtegido('QAS'), true);
    assert.strictEqual(esProtegido('PRD'), true);
    assert.strictEqual(esProtegido('DEV'), false);
    assert.strictEqual(esProtegido(undefined), false);
  });

  test('conUrl conserva el rol y la url sobrevive a la escritura y lectura', () => {
    const base = conRol(configVacia(), 'DEST', 'QAS');
    const config = conUrl(base, 'DEST', 'https://host.local:44300');
    assert.strictEqual(urlDe(config, 'DEST'), 'https://host.local:44300');
    assert.strictEqual(config.destinos.DEST.rol, 'QAS');
    assert.strictEqual(urlDe(base, 'DEST'), undefined);
    const ruta = path.join(carpeta, 'abap-navigator.json');
    escribirConfig(ruta, config);
    assert.deepStrictEqual(leerConfig(ruta), config);
  });

  test('conRol conserva la url y urlDe de un destino desconocido es undefined', () => {
    const config = conRol(conUrl(configVacia(), 'DEST', 'http://h:8000'), 'DEST', 'DEV');
    assert.strictEqual(urlDe(config, 'DEST'), 'http://h:8000');
    assert.strictEqual(urlDe(config, 'OTRO'), undefined);
  });

  test('sinUrl quita la url y conserva el rol y los demás destinos', () => {
    const base = conUrl(conUrl(conRol(configVacia(), 'DEST', 'DEV'), 'DEST', 'https://h:44300'), 'OTRO', 'http://o:8000');
    const config = sinUrl(base, 'DEST');
    assert.strictEqual(urlDe(config, 'DEST'), undefined);
    assert.ok(!('url' in config.destinos.DEST));
    assert.strictEqual(config.destinos.DEST.rol, 'DEV');
    assert.strictEqual(urlDe(config, 'OTRO'), 'http://o:8000');
    assert.strictEqual(urlDe(base, 'DEST'), 'https://h:44300');
  });

  test('sinUrl de un destino sin url no cambia nada', () => {
    const base = conRol(configVacia(), 'DEST', 'QAS');
    assert.deepStrictEqual(sinUrl(base, 'DEST'), base);
    assert.deepStrictEqual(sinUrl(base, 'OTRO'), base);
  });

  test('una clave busqueda antigua se descarta al leer y se registra una sola línea sin el id', () => {
    const ruta = escribirCrudo(JSON.stringify({
      version: 1,
      destinos: { DEST: { rol: 'DEV', busqueda: 'rest' }, OTRO: { url: 'https://h:44300', busqueda: 'oficial' } },
    }));
    const registro: string[] = [];
    const config = leerConfig(ruta, (mensaje) => registro.push(mensaje));
    assert.deepStrictEqual(config.destinos.DEST, { rol: 'DEV' });
    assert.deepStrictEqual(config.destinos.OTRO, { url: 'https://h:44300' });
    assert.strictEqual(registro.length, 1);
    assert.match(registro[0], /busqueda/);
    assert.match(registro[0], /2/);
    assert.doesNotMatch(registro[0], /DEST|OTRO|h:44300/);
  });

  test('una busqueda antigua con cualquier valor se descarta sin error', () => {
    for (const busqueda of ['sap', 7, 'rfc']) {
      const ruta = escribirCrudo(JSON.stringify({ version: 1, destinos: { DEST: { rol: 'DEV', busqueda } } }));
      assert.deepStrictEqual(leerConfig(ruta).destinos.DEST, { rol: 'DEV' });
    }
  });

  test('sin claves antiguas no se registra nada', () => {
    const ruta = escribirCrudo(JSON.stringify({ version: 1, destinos: { DEST: { rol: 'DEV' } } }));
    const registro: string[] = [];
    leerConfig(ruta, (mensaje) => registro.push(mensaje));
    assert.deepStrictEqual(registro, []);
  });

  test('al reescribir tras leer, el archivo ya no lleva la clave busqueda', () => {
    const ruta = escribirCrudo(JSON.stringify({ version: 1, destinos: { DEST: { rol: 'DEV', busqueda: 'rest' } } }));
    escribirConfig(ruta, conUrl(leerConfig(ruta), 'DEST', 'https://h:44300'));
    assert.ok(!fs.readFileSync(ruta, 'utf8').includes('busqueda'));
  });

  test('prefijosPropiosDe por defecto es Z e Y', () => {
    assert.deepStrictEqual(prefijosPropiosDe(configVacia(), 'DEST'), ['Z', 'Y']);
    assert.deepStrictEqual(prefijosPropiosDe(conRol(configVacia(), 'DEST', 'DEV'), 'DEST'), ['Z', 'Y']);
  });

  test('conPrefijoPropio añade en mayúsculas sin repetir, conserva rol y url y persiste', () => {
    const base = conUrl(conRol(configVacia(), 'DEST', 'DEV'), 'DEST', 'https://h:44300');
    const una = conPrefijoPropio(base, 'DEST', '/accgo/');
    const dos = conPrefijoPropio(una, 'DEST', '/ACCGO/');
    assert.deepStrictEqual(prefijosPropiosDe(dos, 'DEST'), ['Z', 'Y', '/ACCGO/']);
    assert.deepStrictEqual(prefijosPropiosDe(base, 'DEST'), ['Z', 'Y'], 'no muta el original');
    const ruta = path.join(carpeta, 'abap-navigator.json');
    escribirConfig(ruta, dos);
    assert.deepStrictEqual(leerConfig(ruta).destinos.DEST, { rol: 'DEV', url: 'https://h:44300', prefijosPropios: ['Z', 'Y', '/ACCGO/'] });
  });

  test('conPrefijoPropio rechaza un prefijo no válido', () => {
    for (const malo of ['', '/', '/ACCGO', 'Z Y', '1Z', '/DEMASIADOLARGO/', 'Z*']) {
      assert.throws(() => conPrefijoPropio(configVacia(), 'DEST', malo), (e: unknown) => e instanceof ErrorConfig, malo);
    }
  });

  test('prefijosPropios no válidos en el archivo lanzan ErrorConfig con el id', () => {
    for (const valor of ['Z', [1], ['z'], [''], ['/X']]) {
      const ruta = escribirCrudo(JSON.stringify({ version: 1, destinos: { X: { prefijosPropios: valor } } }));
      assert.throws(() => leerConfig(ruta), (error: unknown) => error instanceof ErrorConfig && /X/.test(error.message), JSON.stringify(valor));
    }
  });

  test('prefijosPropios válidos en el archivo se leen tal cual', () => {
    const ruta = escribirCrudo(JSON.stringify({ version: 1, destinos: { DEST: { prefijosPropios: ['Z', '/ACCGO/'] } } }));
    assert.deepStrictEqual(prefijosPropiosDe(leerConfig(ruta), 'DEST'), ['Z', '/ACCGO/']);
  });

  test('firmaConexion cambia con rol o url y no con los prefijos propios', () => {
    const base = conUrl(conRol(configVacia(), 'DEST', 'DEV'), 'DEST', 'https://h:44300');
    assert.strictEqual(firmaConexion(conPrefijoPropio(base, 'DEST', '/ACCGO/')), firmaConexion(base));
    assert.notStrictEqual(firmaConexion(conRol(base, 'DEST', 'QAS')), firmaConexion(base));
    assert.notStrictEqual(firmaConexion(conUrl(base, 'DEST', 'https://otro:44300')), firmaConexion(base));
    assert.notStrictEqual(firmaConexion(conRol(base, 'OTRO', 'DEV')), firmaConexion(base));
  });
  test('compararCon: ida y vuelta, sin el propio id ni repetidos', () => {
    const config = conCompararCon(configVacia(), 'DEV-X', ['QAS-X', 'DEV-X', 'QAS-X', 'PRD-X']);
    assert.deepStrictEqual(compararConDe(config, 'DEV-X'), ['QAS-X', 'PRD-X']);
    const ruta = path.join(carpeta, 'abap-navigator.json');
    escribirConfig(ruta, config);
    assert.deepStrictEqual(compararConDe(leerConfig(ruta), 'DEV-X'), ['QAS-X', 'PRD-X']);
  });

  test('compararCon: [] y ausente se leen como undefined', () => {
    assert.strictEqual(compararConDe(configVacia(), 'DEV-X'), undefined);
    const vacio = conCompararCon(configVacia(), 'DEV-X', []);
    assert.deepStrictEqual(vacio.destinos['DEV-X'], { compararCon: [] });
    assert.strictEqual(compararConDe(vacio, 'DEV-X'), undefined);
  });

  test('leerConfig acepta compararCon y un archivo sin la clave sigue funcionando', () => {
    const con = escribirCrudo('{"version":1,"destinos":{"DEV-X":{"rol":"DEV","compararCon":["QAS-X"]}}}');
    assert.deepStrictEqual(leerConfig(con).destinos['DEV-X'], { rol: 'DEV', compararCon: ['QAS-X'] });
    const sin = escribirCrudo('{"version":1,"destinos":{"DEV-X":{"rol":"DEV"}}}');
    assert.strictEqual(compararConDe(leerConfig(sin), 'DEV-X'), undefined);
  });

  test('leerConfig rechaza compararCon que no es lista de textos', () => {
    const ruta = escribirCrudo('{"version":1,"destinos":{"DEV-X":{"compararCon":[1]}}}');
    assert.throws(() => leerConfig(ruta), ErrorConfig);
  });
});
