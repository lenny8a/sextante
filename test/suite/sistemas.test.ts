import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { leerConfig, rolDe, urlDe } from '../../src/config/navegador-config';
import { SistemaActivo } from '../../src/config/sistema-activo';
import { estadoConexion } from '../../src/bridge/logon-oficial';
import { ProveedorSistemas } from '../../src/tree/sistemas-proveedor';

const FIXTURE = path.resolve(__dirname, '../../../test/fixtures/destinations.anonimizado.json');

function crearMemento(): vscode.Memento {
  const datos = new Map<string, unknown>();
  return {
    keys: () => [...datos.keys()],
    get: <T>(clave: string, porDefecto?: T) => (datos.has(clave) ? (datos.get(clave) as T) : porDefecto),
    update: async (clave: string, valor: unknown) => {
      if (valor === undefined) {
        datos.delete(clave);
      } else {
        datos.set(clave, valor);
      }
    },
  } as vscode.Memento;
}

interface Entorno {
  carpeta: string;
  rutaDestinos: string;
  rutaConfig: string;
  sistemaActivo: SistemaActivo;
  proveedor: ProveedorSistemas;
}

function crearEntorno(): Entorno {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-navigator-sistemas-'));
  const rutaDestinos = path.join(carpeta, 'destinations.json');
  const rutaConfig = path.join(carpeta, 'abap-navigator.json');
  fs.copyFileSync(FIXTURE, rutaDestinos);
  const sistemaActivo = new SistemaActivo(crearMemento());
  const proveedor = new ProveedorSistemas({
    rutaDestinos,
    rutaConfig,
    sistemaActivo,
    estadoDe: async () => 'desconectado',
  });
  return { carpeta, rutaDestinos, rutaConfig, sistemaActivo, proveedor };
}

suite('Vista Sistemas', () => {
  let entorno: Entorno;

  setup(() => {
    entorno = crearEntorno();
  });

  teardown(() => {
    entorno.proveedor.dispose();
    fs.rmSync(entorno.carpeta, { recursive: true, force: true });
  });

  test('los siete comandos de sistemas están registrados', async () => {
    const comandos = await vscode.commands.getCommands(true);
    for (const nombre of ['refrescar', 'conectar', 'marcarActivo', 'cambiarRol', 'copiarId', 'nuevo', 'editarDestinos']) {
      assert.ok(comandos.includes(`abapNavigator.sistemas.${nombre}`), nombre);
    }
  });

  test('lista los destinos de la fixture con estado del stub', async () => {
    await entorno.proveedor.actualizarEstados();
    const nodos = await entorno.proveedor.getChildren();
    assert.deepStrictEqual(
      nodos.map((n) => [n.id, n.estado]),
      [
        ['DEV-X', 'desconectado'],
        ['QAS-X', 'desconectado'],
      ],
    );
  });

  test('destinations.json roto produce un nodo de error', async () => {
    fs.writeFileSync(entorno.rutaDestinos, '{');
    const nodos = await entorno.proveedor.getChildren();
    assert.strictEqual(nodos.length, 1);
    assert.strictEqual(nodos[0].etiqueta, 'Error leyendo destinations.json');
    assert.strictEqual(entorno.proveedor.getTreeItem(nodos[0]).contextValue, 'errorDestinos');
  });

  test('destinations.json ausente devuelve lista vacía sin nodo de error', async () => {
    fs.rmSync(entorno.rutaDestinos);
    assert.deepStrictEqual(await entorno.proveedor.getChildren(), []);
  });

  test('config corrupta se trata como vacía y no se sobrescribe', async () => {
    fs.writeFileSync(entorno.rutaConfig, '{');
    const nodos = await entorno.proveedor.getChildren();
    assert.strictEqual(nodos.length, 2);
    assert.strictEqual(fs.readFileSync(entorno.rutaConfig, 'utf8'), '{');
  });

  test('un error de lectura de la config conserva la última válida y no dispara el evento', async () => {
    fs.writeFileSync(entorno.rutaConfig, JSON.stringify({ version: 1, destinos: { 'QAS-X': { rol: 'QAS' } } }));
    await entorno.proveedor.getChildren();
    assert.strictEqual(rolDe(entorno.proveedor.config, 'QAS-X'), 'QAS');
    let avisos = 0;
    const suscripcion = entorno.proveedor.onDidChangeConfig(() => avisos++);
    fs.writeFileSync(entorno.rutaConfig, '{');
    await entorno.proveedor.getChildren();
    suscripcion.dispose();
    assert.strictEqual(rolDe(entorno.proveedor.config, 'QAS-X'), 'QAS');
    assert.strictEqual(avisos, 0);
  });

  test('fijarRol persiste y marca protegido', async () => {
    await entorno.proveedor.fijarRol('QAS-X', 'QAS');
    const nodos = await entorno.proveedor.getChildren();
    assert.strictEqual(nodos.find((n) => n.id === 'QAS-X')?.protegido, true);
    assert.strictEqual(leerConfig(entorno.rutaConfig).destinos['QAS-X']?.rol, 'QAS');
  });

  test('sistema activo va primero y su contextValue es sistemaActivo', async () => {
    await entorno.sistemaActivo.establecer('QAS-X');
    const nodos = await entorno.proveedor.getChildren();
    assert.strictEqual(nodos[0].id, 'QAS-X');
    assert.strictEqual(entorno.proveedor.getTreeItem(nodos[0]).contextValue, 'sistemaActivo');
  });

  test('el rol de la config existente está disponible sin llamar a getChildren', () => {
    fs.writeFileSync(entorno.rutaConfig, JSON.stringify({ version: 1, destinos: { 'QAS-X': { rol: 'QAS' } } }));
    const nuevo = new ProveedorSistemas({
      rutaDestinos: entorno.rutaDestinos,
      rutaConfig: entorno.rutaConfig,
      sistemaActivo: entorno.sistemaActivo,
      estadoDe: async () => 'desconectado',
    });
    try {
      assert.strictEqual(rolDe(nuevo.config, 'QAS-X'), 'QAS');
    } finally {
      nuevo.dispose();
    }
  });

  test('fijarUrl persiste la url sin perder el rol y quitarUrl la borra', async () => {
    await entorno.proveedor.fijarRol('DEV-X', 'DEV');
    await entorno.proveedor.fijarUrl('DEV-X', 'https://host.local:44300');
    assert.strictEqual(urlDe(entorno.proveedor.config, 'DEV-X'), 'https://host.local:44300');
    assert.strictEqual(leerConfig(entorno.rutaConfig).destinos['DEV-X']?.url, 'https://host.local:44300');
    await entorno.proveedor.quitarUrl('DEV-X');
    assert.strictEqual(urlDe(entorno.proveedor.config, 'DEV-X'), undefined);
    assert.deepStrictEqual(leerConfig(entorno.rutaConfig).destinos['DEV-X'], { rol: 'DEV' });
  });

  test('al cambiar la vía de un destino la vista se refresca y su descripción la muestra', async () => {
    const vias = new Map<string, 'rfc' | 'http' | 'oficial'>();
    const oyentes: Array<(id: string) => void> = [];
    entorno.proveedor.seguirVias({
      viaDe: (id) => vias.get(id),
      alCambiarVia: (cb) => {
        oyentes.push(cb);
      },
    });
    assert.strictEqual(oyentes.length, 1);
    const antes = await entorno.proveedor.getChildren();
    assert.ok(antes.every((n) => !n.descripcion.includes(' · RFC')));
    let refrescos = 0;
    const suscripcion = entorno.proveedor.onDidChangeTreeData(() => refrescos++);
    vias.set('DEV-X', 'rfc');
    vias.set('QAS-X', 'http');
    oyentes[0]('DEV-X');
    suscripcion.dispose();
    assert.strictEqual(refrescos, 1);
    const despues = await entorno.proveedor.getChildren();
    assert.ok(despues.find((n) => n.id === 'DEV-X')?.descripcion.endsWith(' · RFC'));
    assert.ok(despues.find((n) => n.id === 'QAS-X')?.descripcion.endsWith(' · REST'));
  });

  test('una clave busqueda antigua se descarta al leer y desaparece del archivo al primer cambio', async () => {
    fs.writeFileSync(entorno.rutaConfig, JSON.stringify({ version: 1, destinos: { 'DEV-X': { rol: 'DEV', busqueda: 'oficial' } } }));
    await entorno.proveedor.getChildren();
    assert.deepStrictEqual(entorno.proveedor.config.destinos['DEV-X'], { rol: 'DEV' });
    assert.ok(fs.readFileSync(entorno.rutaConfig, 'utf8').includes('busqueda'));
    await entorno.proveedor.fijarRol('QAS-X', 'QAS');
    assert.ok(!fs.readFileSync(entorno.rutaConfig, 'utf8').includes('busqueda'));
    assert.deepStrictEqual(leerConfig(entorno.rutaConfig).destinos['DEV-X'], { rol: 'DEV' });
  });

  test('fijarRol dispara onDidChangeConfig', async () => {
    let avisos = 0;
    const suscripcion = entorno.proveedor.onDidChangeConfig(() => avisos++);
    await entorno.proveedor.fijarRol('QAS-X', 'QAS');
    await entorno.proveedor.fijarRol('QAS-X', 'QAS');
    suscripcion.dispose();
    assert.strictEqual(avisos, 1);
  });

  test('conectando se refleja en contextValue y sobrevive a actualizarEstados', async () => {
    entorno.proveedor.marcarConectando('DEV-X');
    assert.strictEqual(entorno.proveedor.estaConectando('DEV-X'), true);
    await entorno.proveedor.actualizarEstados();
    const nodo = (await entorno.proveedor.getChildren()).find((n) => n.id === 'DEV-X');
    assert.ok(nodo);
    assert.strictEqual(nodo.estado, 'conectando');
    assert.ok(entorno.proveedor.getTreeItem(nodo).contextValue?.endsWith('.conectando'));
    entorno.proveedor.terminarConexion('DEV-X');
    assert.strictEqual(entorno.proveedor.estaConectando('DEV-X'), false);
    await entorno.proveedor.actualizarEstados();
    const despues = (await entorno.proveedor.getChildren()).find((n) => n.id === 'DEV-X');
    assert.strictEqual(despues?.estado, 'desconectado');
  });

  test('el icono de estado usa id y color del tema', () => {
    const base = { id: 'DEV-X', etiqueta: 'DEV-X', descripcion: '', tooltip: '', protegido: false, activo: false };
    const conectado = entorno.proveedor.getTreeItem({ ...base, estado: 'conectado' }).iconPath;
    const desconectado = entorno.proveedor.getTreeItem({ ...base, estado: 'desconectado' }).iconPath;
    assert.ok(conectado instanceof vscode.ThemeIcon);
    assert.strictEqual(conectado.id, 'plug');
    assert.ok(conectado.color instanceof vscode.ThemeColor);
    assert.ok(desconectado instanceof vscode.ThemeIcon);
    assert.strictEqual(desconectado.id, 'debug-disconnect');
    assert.ok(desconectado.color instanceof vscode.ThemeColor);
  });

  test('refrescar sin la oficial no lanza', async () => {
    await vscode.commands.executeCommand('abapNavigator.sistemas.refrescar');
    const real = new ProveedorSistemas({
      rutaDestinos: entorno.rutaDestinos,
      rutaConfig: entorno.rutaConfig,
      sistemaActivo: entorno.sistemaActivo,
      estadoDe: (id) => estadoConexion(id, 500),
    });
    try {
      await real.actualizarEstados();
      const estados = (await real.getChildren()).map((n) => n.estado);
      assert.deepStrictEqual(estados, ['desconocido', 'desconocido']);
    } finally {
      real.dispose();
    }
  });
});
