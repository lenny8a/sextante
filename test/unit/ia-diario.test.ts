import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AlmacenDiario, type NivelRegistro } from '../../src/ia/diario';
import { cabeceraDiario, formatearFecha, identidadDeUri, rutaRelativaDiario, type IdentidadDiario } from '../../src/ia/diario-modelo';
import { MSG_SIN_APLICAR, MSG_SIN_GUARDAR, type Propuesta } from '../../src/ia/propuestas-modelo';

const BASE = 'abap:/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library';
const URI = `${BASE}/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap`;
const URI_F01 = `${BASE}/Includes/ZPROG_EJEMPLO_F01/zprog_ejemplo_f01.prog.abap`;
const ID: IdentidadDiario = { destino: 'DEST', codigo: 'PROG', nombre: 'ZPROG_EJEMPLO' };
const AHORA = new Date(2026, 10, 4, 10, 32).getTime();

function propuesta(datos: Partial<Propuesta>): Propuesta {
  return {
    id: 'p1',
    uri: URI,
    resumen: 'Añade validación',
    entrada: { cambios: [] },
    textoBase: '',
    textoPropuesto: '',
    creada: AHORA,
    estado: 'aplicada',
    ...datos,
  };
}

suite('ia-diario', () => {
  let dir: string;
  let lineas: string[];
  let niveles: Map<string, NivelRegistro>;
  let almacen: AlmacenDiario;

  const registrar = (linea: string, nivel: NivelRegistro): void => {
    lineas.push(linea);
    niveles.set(linea, nivel);
  };

  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sextante-diario-'));
    lineas = [];
    niveles = new Map();
    almacen = new AlmacenDiario({ carpetaBase: dir, ahora: () => AHORA, registrar });
  });

  teardown(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('anotar crea carpeta, cabecera y entrada; la segunda entrada va al final sin repetir cabecera', async () => {
    const primera = await almacen.anotar(ID, { tipo: 'nota', texto: 'uno' });
    assert.equal(primera.ruta, path.join(dir, rutaRelativaDiario(ID)));
    assert.equal(primera.entradas, 1);
    const segunda = await almacen.anotar(ID, { tipo: 'nota', texto: 'dos' });
    assert.equal(segunda.entradas, 2);
    const contenido = fs.readFileSync(primera.ruta, 'utf8');
    const fecha = formatearFecha(AHORA);
    assert.ok(contenido.startsWith(cabeceraDiario(ID)));
    assert.equal(contenido.split('# Diario de').length, 2);
    assert.ok(contenido.indexOf(`## ${fecha} · nota\nuno`) < contenido.indexOf(`## ${fecha} · nota\ndos`));
  });

  test('leer devuelve undefined sin archivo y resumen devuelve { entradas: 0 }; con archivo vacío también 0 y la siguiente entrada no repone la cabecera', async () => {
    assert.equal(await almacen.leer(ID), undefined);
    assert.deepEqual(await almacen.resumen(ID), { entradas: 0 });
    const ruta = almacen.rutaDe(ID);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, '');
    assert.deepEqual(await almacen.resumen(ID), { entradas: 0 });
    await almacen.anotar(ID, { tipo: 'nota', texto: 'x' });
    assert.ok(!fs.readFileSync(ruta, 'utf8').includes('# Diario de'));
  });

  test('dos anotar concurrentes sobre el mismo diario conservan las dos entradas', async () => {
    await Promise.all([
      almacen.anotar(ID, { tipo: 'nota', texto: 'a' }),
      almacen.anotar(ID, { tipo: 'nota', texto: 'b' }),
    ]);
    assert.equal((await almacen.resumen(ID)).entradas, 2);
  });

  test('registrarDecision anota aplicada con Por qué, aplicada sin guardar con Aviso y rechazada con Motivo del usuario', async () => {
    await almacen.registrarDecision(propuesta({ porque: 'evita dump' }));
    await almacen.registrarDecision(propuesta({ resumen: 'Segundo', motivo: MSG_SIN_GUARDAR }));
    await almacen.registrarDecision(propuesta({ resumen: 'Tercero', estado: 'rechazada', motivo: 'no lo quiero' }));
    const contenido = (await almacen.leer(ID)) ?? '';
    assert.ok(contenido.includes('· aplicado · Añade validación\nArchivo: principal\nPor qué: evita dump'));
    assert.ok(contenido.includes('· aplicado · Segundo\nArchivo: principal\nAviso:'));
    assert.ok(contenido.includes('· rechazado · Tercero\nArchivo: principal\nMotivo del usuario: no lo quiero'));
    assert.ok(lineas.includes('diario: entrada aplicado añadida (1 entradas)'));
    assert.equal(niveles.get('diario: entrada aplicado añadida (1 entradas)'), 'info');
  });

  test('registrarDecision usa resolverIdentidad: un include del programa mostrado va al diario del programa con Archivo: el include', async () => {
    const conVista = new AlmacenDiario({
      carpetaBase: dir,
      ahora: () => AHORA,
      registrar,
      resolverIdentidad: (uri) => (uri === URI_F01 ? ID : identidadDeUri(uri)),
    });
    await conVista.registrarDecision(propuesta({ uri: URI_F01, porque: 'evita dump' }));
    const contenido = (await conVista.leer(ID)) ?? '';
    assert.ok(contenido.includes('· aplicado · Añade validación\nArchivo: ZPROG_EJEMPLO_F01\nPor qué: evita dump'), contenido);
    assert.equal(await conVista.leer({ destino: 'DEST', codigo: 'INCL', nombre: 'ZPROG_EJEMPLO_F01' }), undefined);
  });

  test('sin resolverIdentidad un include de programa conserva su diario INCL', async () => {
    await almacen.registrarDecision(propuesta({ uri: URI_F01 }));
    const contenido = (await almacen.leer({ destino: 'DEST', codigo: 'INCL', nombre: 'ZPROG_EJEMPLO_F01' })) ?? '';
    assert.ok(contenido.includes('· aplicado · Añade validación\nArchivo: principal'), contenido);
    assert.equal(await almacen.leer(ID), undefined);
  });

  test('registrarDecision ignora caducada, rechazada con MSG_SIN_APLICAR y uris sin objeto, y registra solo forma', async () => {
    await almacen.registrarDecision(propuesta({ estado: 'caducada' }));
    await almacen.registrarDecision(propuesta({ estado: 'rechazada', motivo: MSG_SIN_APLICAR }));
    await almacen.registrarDecision(propuesta({ uri: 'file:///x/ZPROG.abap' }));
    assert.equal(await almacen.leer(ID), undefined);
    assert.ok(lineas.length > 0);
    assert.ok(lineas.every((l) => !l.includes('ZPROG')));
  });

  test('registrarDecision no lanza si la carpeta base es un archivo (fallo de escritura) y lo registra', async () => {
    const archivo = path.join(dir, 'base');
    fs.writeFileSync(archivo, 'x');
    const roto = new AlmacenDiario({ carpetaBase: archivo, ahora: () => AHORA, registrar });
    await roto.registrarDecision(propuesta({}));
    const fallo = lineas.find((l) => l.startsWith('diario: no se pudo escribir la entrada'));
    assert.ok(fallo);
    assert.equal(niveles.get(fallo), 'warn');
  });

  test('onDidChange avisa tras anotar y notificarCambioExterno avisa solo con rutas de diario', async () => {
    const avisos: IdentidadDiario[] = [];
    const sub = almacen.onDidChange((id) => avisos.push(id));
    await almacen.anotar(ID, { tipo: 'nota', texto: 'x' });
    assert.deepEqual(avisos, [ID]);
    almacen.notificarCambioExterno(path.join(dir, 'DEST', 'PROG-ZPROG_EJEMPLO.md').replace(/\\/g, '/'));
    assert.equal(avisos.length, 2);
    almacen.notificarCambioExterno(path.join(dir, 'DEST', 'otro.txt'));
    almacen.notificarCambioExterno(path.join(os.tmpdir(), 'fuera', 'PROG-X.md'));
    assert.equal(avisos.length, 2);
    sub.dispose();
    almacen.notificarCambioExterno(almacen.rutaDe(ID));
    assert.equal(avisos.length, 2);
  });

  test('rutaDe rechaza un destino que saldría de la carpeta base', () => {
    for (const destino of ['..\\..\\x', '..']) {
      assert.throws(
        () => almacen.rutaDe({ destino, codigo: 'PROG', nombre: 'Z' }),
        { message: 'ruta del diario fuera de la carpeta base' },
        destino,
      );
    }
  });

  test('registrarDecision con un destino que escapa no escribe fuera y registra solo forma', async () => {
    const uri = 'abap:/repotree-v1/..\\..\\x/System Library/ZPAQ1/Source Code Library/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap';
    await almacen.registrarDecision(propuesta({ uri }));
    assert.ok(lineas.every((l) => l.startsWith('diario:')));
    assert.equal(fs.existsSync(path.join(path.dirname(dir), 'x')), false);
    assert.equal(fs.readdirSync(dir).length, 0);
  });

  test('crearSiFalta crea con cabecera y no toca un archivo existente', async () => {
    const ruta = await almacen.crearSiFalta(ID);
    assert.equal(fs.readFileSync(ruta, 'utf8'), cabeceraDiario(ID));
    fs.writeFileSync(ruta, 'editado');
    await almacen.crearSiFalta(ID);
    assert.equal(fs.readFileSync(ruta, 'utf8'), 'editado');
  });
});
