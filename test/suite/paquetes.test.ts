import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { EstadoDestino } from '../../src/bridge/logon-oficial';
import { ErrorRepotree, type EntradaRepotree } from '../../src/bridge/repotree-oficial';
import { SistemaActivo } from '../../src/config/sistema-activo';
import { CADUCIDAD_VACIO_MS, ProveedorPaquetes } from '../../src/tree/paquete-proveedor';

interface CarpetaRepotree {
  ruta: string;
  entradas: { nombre: string; tipo: 'carpeta' | 'archivo' }[];
}

const CARPETAS = (
  JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/repotree/carpetas.json'), 'utf8'),
  ) as CarpetaRepotree[]
).map((c) => ({ path: vscode.Uri.parse(c.ruta).path, entradas: c.entradas }));

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
  sistemaActivo: SistemaActivo;
  proveedor: ProveedorPaquetes;
  vistos: string[];
}

function crearEntorno(estado: EstadoDestino = 'conectado', falla = false): Entorno {
  const vistos: string[] = [];
  const sistemaActivo = new SistemaActivo(crearMemento());
  const proveedor = new ProveedorPaquetes({
    sistemaActivo,
    estadoDe: async () => estado,
    listarCarpeta: async (uri): Promise<EntradaRepotree[]> => {
      vistos.push(uri.path);
      if (falla) {
        throw new ErrorRepotree('sin carpeta');
      }
      const carpeta = CARPETAS.find((c) => c.path === uri.path);
      return (carpeta?.entradas ?? []).map((e) => ({ nombre: e.nombre, esCarpeta: e.tipo === 'carpeta' }));
    },
  });
  return { sistemaActivo, proveedor, vistos };
}

suite('Vista Paquetes', () => {
  let entornos: Entorno[];

  const nuevoEntorno = (estado?: EstadoDestino, falla?: boolean): Entorno => {
    const entorno = crearEntorno(estado, falla);
    entornos.push(entorno);
    return entorno;
  };

  setup(() => {
    entornos = [];
  });

  teardown(() => {
    for (const { proveedor, sistemaActivo } of entornos) {
      proveedor.dispose();
      sistemaActivo.dispose();
    }
  });

  test('sin sistema activo devuelve vacío; con activo lista bibliotecas y paquetes', async () => {
    const { proveedor, sistemaActivo } = nuevoEntorno();
    assert.deepStrictEqual(await proveedor.getChildren(), []);
    await sistemaActivo.establecer('DEST');
    const raiz = await proveedor.getChildren();
    assert.deepStrictEqual(raiz.map((n) => n.etiqueta), ['Local Objects ($TMP)', 'System Library']);
    const paquetes = await proveedor.getChildren(raiz[1]);
    assert.ok(paquetes.length >= 10);
    assert.strictEqual(proveedor.getParent(paquetes[0]), raiz[1]);
    assert.strictEqual(proveedor.getParent(raiz[1]), undefined);
    assert.deepStrictEqual(await proveedor.paquetes(), paquetes);
  });

  test('el stub recibe el path sin codificar aunque el nombre lleve paréntesis', async () => {
    const { proveedor, sistemaActivo, vistos } = nuevoEntorno();
    await sistemaActivo.establecer('DEST');
    const raiz = await proveedor.getChildren();
    const locales = await proveedor.getChildren(raiz[0]);
    assert.ok(vistos.includes('/repotree-v1/DEST/Local Objects ($TMP)'));
    assert.deepStrictEqual(locales.map((n) => [n.etiqueta, n.clase]), [['ABAP', 'paquete']]);
  });

  test('no conectado devuelve vacío sin lanzar', async () => {
    const desconectado = nuevoEntorno('desconectado');
    await desconectado.sistemaActivo.establecer('DEST');
    assert.deepStrictEqual(await desconectado.proveedor.getChildren(), []);
    assert.deepStrictEqual(desconectado.vistos, []);

    const fallando = nuevoEntorno('conectado', true);
    await fallando.sistemaActivo.establecer('DEST');
    assert.deepStrictEqual(await fallando.proveedor.getChildren(), []);
    assert.deepStrictEqual(await fallando.proveedor.paquetes(), []);
  });

  test('un listado vacío caduca a los 30 s: antes sale de caché y después se vuelve a pedir', async () => {
    const vistos: string[] = [];
    const sistemaActivo = new SistemaActivo(crearMemento());
    const rutaSistema = '/repotree-v1/DEST/System Library';
    let reloj = 1_000_000;
    const proveedor = new ProveedorPaquetes({
      sistemaActivo,
      estadoDe: async () => 'conectado',
      ahora: () => reloj,
      listarCarpeta: async (uri): Promise<EntradaRepotree[]> => {
        vistos.push(uri.path);
        const primeraVez = vistos.filter((p) => p === uri.path).length === 1;
        if (uri.path === rutaSistema && primeraVez) {
          return [];
        }
        const carpeta = CARPETAS.find((c) => c.path === uri.path);
        return (carpeta?.entradas ?? []).map((e) => ({ nombre: e.nombre, esCarpeta: e.tipo === 'carpeta' }));
      },
    });
    entornos.push({ sistemaActivo, proveedor, vistos });
    await sistemaActivo.establecer('DEST');
    const raiz = await proveedor.getChildren();
    const sistema = raiz.find((n) => n.etiqueta === 'System Library');
    assert.ok(sistema);
    const pedidos = (): number => vistos.filter((p) => p === rutaSistema).length;
    assert.strictEqual(CADUCIDAD_VACIO_MS, 30_000);
    assert.deepStrictEqual(await proveedor.getChildren(sistema), []);
    reloj += CADUCIDAD_VACIO_MS - 1;
    assert.deepStrictEqual(await proveedor.getChildren(sistema), [], 'dentro del plazo sale de caché');
    assert.strictEqual(pedidos(), 1);
    reloj += 1;
    const paquetes = await proveedor.getChildren(sistema);
    assert.ok(paquetes.length >= 10);
    assert.strictEqual(pedidos(), 2);
    reloj += 10 * CADUCIDAD_VACIO_MS;
    await proveedor.getChildren(sistema);
    assert.strictEqual(pedidos(), 2, 'con entradas no caduca');
  });

  test('refrescar vacía también los listados vacíos en caché', async () => {
    const { proveedor, sistemaActivo, vistos } = nuevoEntorno();
    await sistemaActivo.establecer('DEST');
    const raiz = await proveedor.getChildren();
    const locales = raiz.find((n) => n.etiqueta === 'Local Objects ($TMP)');
    assert.ok(locales);
    const [abap] = await proveedor.getChildren(locales);
    const rutaVacia = abap.ruta;
    await proveedor.getChildren(abap);
    await proveedor.getChildren(abap);
    assert.strictEqual(vistos.filter((p) => p === rutaVacia).length, 1);
    proveedor.refrescar();
    await proveedor.getChildren(abap);
    assert.strictEqual(vistos.filter((p) => p === rutaVacia).length, 2);
  });

  test('los cuatro comandos de paquetes están registrados', async () => {
    const comandos = await vscode.commands.getCommands(true);
    for (const nombre of ['refrescar', 'abrir', 'ir', 'conectar']) {
      assert.ok(comandos.includes(`abapNavigator.paquetes.${nombre}`), nombre);
    }
  });

  test('paquetes.ir con un nombre como argumento no abre el QuickPick', async () => {
    const ventana = vscode.window as unknown as Record<string, unknown>;
    const originales = {
      showQuickPick: ventana.showQuickPick,
      showWarningMessage: ventana.showWarningMessage,
      showInformationMessage: ventana.showInformationMessage,
    };
    let quickPicks = 0;
    const mensajes: string[] = [];
    ventana.showQuickPick = async () => {
      quickPicks++;
      return undefined;
    };
    ventana.showWarningMessage = async (m: string) => {
      mensajes.push(m);
    };
    ventana.showInformationMessage = async (m: string) => {
      mensajes.push(m);
    };
    try {
      await vscode.commands.executeCommand('abapNavigator.paquetes.ir', 'ZPAQ_NO_EXISTE');
    } finally {
      Object.assign(ventana, originales);
    }
    assert.strictEqual(quickPicks, 0);
    assert.strictEqual(mensajes.length, 1);
  });
});
