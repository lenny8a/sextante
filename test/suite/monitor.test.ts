import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { RolSistema } from '../../src/config/navegador-config';
import { SistemaActivo } from '../../src/config/sistema-activo';
import { analizarFeedDumps, TOP_DUMPS, type Dump } from '../../src/monitor/dumps-modelo';
import { analizarInactivos, type ObjetoInactivo } from '../../src/monitor/inactivos-modelo';
import { TEXTO_SIN_SISTEMA } from '../../src/monitor/panel-modelo';
import {
  CONTEXTO_DUMPS_TODOS,
  CONTEXTO_ESCRIBIBLE,
  CONTEXTO_INACTIVOS_TODOS,
  ProveedorMonitor,
  type DependenciasMonitor,
} from '../../src/monitor/panel-proveedor';
import { ErrorSinSesion, type ResultadoDumps } from '../../src/monitor/servicio';

const FIXTURES = path.resolve(__dirname, '../../../test/fixtures/adt/real');
const DUMPS = analizarFeedDumps(fs.readFileSync(path.join(FIXTURES, 'dumps.xml'), 'utf8'));
const INACTIVOS = analizarInactivos(fs.readFileSync(path.join(FIXTURES, 'inactivos.xml'), 'utf8'));
const AHORA = new Date(DUMPS[0].publicado);
const DESTINO = 'DEST';

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

interface LlamadaDumps { destino: string; usuario?: string; top?: number }

interface Entorno {
  proveedor: ProveedorMonitor;
  sistemaActivo: SistemaActivo;
  cambioVia: vscode.EventEmitter<void>;
  llamadasDumps: LlamadaDumps[];
  llamadasInactivos: { destino: string; usuario?: string }[];
  contextos: [string, boolean][];
  cambios: { n: number };
}

interface Opciones {
  rol?: RolSistema;
  motivoSinRfc?: string;
  credencial?: boolean;
  llena?: boolean;
  falloDumps?: Error;
  falloInactivos?: Error;
  /** Se espera en cada `setContext`; permite retener un refresco a mitad de camino. */
  bloqueoContexto?: () => Promise<void>;
}

const vivos: Entorno[] = [];

async function crearEntorno(opciones: Opciones = {}, activo: string | null = DESTINO): Promise<Entorno> {
  const sistemaActivo = new SistemaActivo(crearMemento());
  if (activo !== null) {
    await sistemaActivo.establecer(activo);
  }
  const cambioVia = new vscode.EventEmitter<void>();
  const llamadasDumps: LlamadaDumps[] = [];
  const llamadasInactivos: { destino: string; usuario?: string }[] = [];
  const contextos: [string, boolean][] = [];
  const deps: DependenciasMonitor = {
    sistemaActivo,
    servicio: {
      dumps: async (destino, o): Promise<ResultadoDumps> => {
        llamadasDumps.push({ destino, usuario: o.usuario, top: o.top });
        if (opciones.falloDumps !== undefined) {
          throw opciones.falloDumps;
        }
        return { dumps: DUMPS, llena: opciones.llena ?? false, top: o.top ?? TOP_DUMPS };
      },
      inactivos: async (destino, _signal, usuario): Promise<ObjetoInactivo[]> => {
        llamadasInactivos.push({ destino, usuario });
        if (opciones.falloInactivos !== undefined) {
          throw opciones.falloInactivos;
        }
        return INACTIVOS;
      },
    },
    usuarioDe: () => 'USUARIO1',
    descripcionDe: () => 'DEV · RFC',
    motivoSinRfc: () => opciones.motivoSinRfc,
    credencialGuardada: async () => opciones.credencial ?? true,
    alCambiarVia: cambioVia.event,
    rolDe: () => opciones.rol,
    ahora: () => AHORA,
    establecerContexto: async (clave, valor) => {
      contextos.push([clave, valor]);
      await opciones.bloqueoContexto?.();
    },
  };
  const proveedor = new ProveedorMonitor(deps);
  const cambios = { n: 0 };
  proveedor.onDidChangeTreeData(() => {
    cambios.n++;
  });
  const entorno = { proveedor, sistemaActivo, cambioVia, llamadasDumps, llamadasInactivos, contextos, cambios };
  vivos.push(entorno);
  return entorno;
}

async function esperar(condicion: () => boolean): Promise<void> {
  const limite = Date.now() + 5000;
  while (!condicion()) {
    assert.ok(Date.now() < limite, 'la condición no se cumplió a tiempo');
    await new Promise((r) => setTimeout(r, 10));
  }
}

suite('Vista Monitor', () => {
  teardown(() => {
    for (const e of vivos.splice(0)) {
      e.proveedor.dispose();
      e.cambioVia.dispose();
      e.sistemaActivo.dispose();
    }
  });

  test('sin sistema activo → aviso', async () => {
    const { proveedor } = await crearEntorno({}, null);
    await proveedor.refrescar();
    assert.deepStrictEqual(proveedor.getChildren(), [{ clase: 'aviso', texto: TEXTO_SIN_SISTEMA }]);
  });

  test('destino sin vía RFC → aviso con el motivo y ninguna petición', async () => {
    const e = await crearEntorno({ motivoSinRfc: 'El destino usa SSO' });
    await e.proveedor.refrescar();
    assert.deepStrictEqual(e.proveedor.getChildren(), [{ clase: 'aviso', texto: 'El destino usa SSO' }]);
    assert.strictEqual(e.llamadasDumps.length + e.llamadasInactivos.length, 0);
  });

  test('sin contraseña guardada → nodo conectar y ninguna petición', async () => {
    const e = await crearEntorno({ credencial: false });
    await e.proveedor.refrescar();
    const raiz = e.proveedor.getChildren();
    assert.deepStrictEqual(raiz, [{ clase: 'conectar', destino: DESTINO }]);
    const item = e.proveedor.getTreeItem(raiz[0]);
    assert.strictEqual(item.command?.command, 'abapNavigator.monitor.conectar');
    assert.deepStrictEqual(item.command?.arguments, [DESTINO]);
    assert.strictEqual(e.llamadasDumps.length + e.llamadasInactivos.length, 0);
  });

  test('con sesión → tres secciones, dumps e inactivos cargados; descripción de la raíz', async () => {
    const e = await crearEntorno();
    await e.proveedor.refrescar();
    const raiz = e.proveedor.getChildren();
    assert.deepStrictEqual(
      raiz.map((n) => n.clase === 'seccion' && n.seccion),
      ['dumps', 'inactivos', 'ordenes'],
    );
    assert.strictEqual(e.proveedor.estado.descripcionDestino, 'DEV · RFC');
    assert.deepStrictEqual(e.llamadasDumps, [{ destino: DESTINO, usuario: 'USUARIO1', top: TOP_DUMPS }]);
    assert.deepStrictEqual(e.llamadasInactivos, [{ destino: DESTINO, usuario: 'USUARIO1' }]);

    const dumps = e.proveedor.getChildren(raiz[0]);
    const nodoDump = dumps.find((n) => n.clase === 'dump');
    assert.ok(nodoDump && nodoDump.clase === 'dump', 'debe haber un dump de hoy');
    const dump: Dump = nodoDump.dump;
    assert.strictEqual(dump.id, DUMPS.find((d) => d.id === dump.id)?.id);
    const item = e.proveedor.getTreeItem(nodoDump);
    assert.strictEqual(item.command?.command, 'abapNavigator.monitor.abrirDump');
    assert.deepStrictEqual(item.command?.arguments, [DESTINO, dump]);

    const itemSeccion = e.proveedor.getTreeItem(raiz[0]);
    assert.strictEqual(itemSeccion.contextValue, 'seccionDumps');
    assert.strictEqual(itemSeccion.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    const pendiente = e.proveedor.getChildren(raiz[2]);
    assert.deepStrictEqual(pendiente, [{ clase: 'pendiente' }]);
  });

  test('cambio de sistema activo y alCambiarVia refrescan', async () => {
    const e = await crearEntorno();
    await e.proveedor.refrescar();
    assert.strictEqual(e.llamadasDumps.length, 1);
    const antes = e.cambios.n;

    await e.sistemaActivo.establecer('OTRO');
    await esperar(() => e.llamadasDumps.length === 2);
    assert.strictEqual(e.llamadasDumps[1].destino, 'OTRO');
    assert.ok(e.cambios.n > antes);

    e.cambioVia.fire();
    await esperar(() => e.llamadasDumps.length === 3);
    assert.strictEqual(e.llamadasInactivos.length, 3);
  });

  test('error del servicio en dumps deja inactivos intactos', async () => {
    const e = await crearEntorno({ falloDumps: new Error('Falla de prueba') });
    await e.proveedor.refrescar();
    const [dumps, inactivos] = e.proveedor.getChildren();
    const hijosDumps = e.proveedor.getChildren(dumps);
    assert.strictEqual(hijosDumps.length, 1);
    assert.ok(hijosDumps[0].clase === 'aviso' && hijosDumps[0].texto.startsWith('Error'));
    assert.strictEqual(e.proveedor.estado.inactivos.fase, 'ok');
    assert.ok(e.proveedor.getChildren(inactivos).every((n) => n.clase !== 'aviso' || !n.texto.startsWith('Error')));
    assert.strictEqual(e.proveedor.getChildren()[0].clase, 'seccion');
  });

  test('ErrorSinSesion en una sección lleva la raíz a conectar', async () => {
    const e = await crearEntorno({ falloInactivos: new ErrorSinSesion() });
    await e.proveedor.refrescar();
    assert.deepStrictEqual(e.proveedor.getChildren(), [{ clase: 'conectar', destino: DESTINO }]);
  });

  test('alternar "todos" cambia el contexto y repite la petición sin usuario', async () => {
    const e = await crearEntorno();
    await e.proveedor.refrescar();
    await e.proveedor.alternarDumpsTodos();
    assert.deepStrictEqual(e.contextos.filter(([c]) => c === CONTEXTO_DUMPS_TODOS), [[CONTEXTO_DUMPS_TODOS, true]]);
    assert.strictEqual(e.llamadasDumps.length, 2);
    assert.strictEqual(e.llamadasDumps[1].usuario, undefined);
    assert.strictEqual(e.llamadasInactivos.length, 1);

    await e.proveedor.alternarInactivosTodos();
    assert.deepStrictEqual(e.contextos.filter(([c]) => c === CONTEXTO_INACTIVOS_TODOS), [[CONTEXTO_INACTIVOS_TODOS, true]]);
    assert.strictEqual(e.llamadasInactivos.length, 2);
    assert.strictEqual(e.llamadasInactivos[1].usuario, undefined);
    assert.strictEqual(e.llamadasDumps.length, 2);
  });

  test('masDumps pide top 100 tras una página llena', async () => {
    const e = await crearEntorno({ llena: true });
    await e.proveedor.refrescar();
    const [dumps] = e.proveedor.getChildren();
    const mas = e.proveedor.getChildren(dumps).find((n) => n.clase === 'masDumps');
    assert.ok(mas, 'página llena → nodo Más…');
    assert.strictEqual(e.proveedor.getTreeItem(mas).command?.command, 'abapNavigator.monitor.masDumps');
    await e.proveedor.masDumps();
    assert.strictEqual(e.llamadasDumps[1].top, 2 * TOP_DUMPS);
    assert.strictEqual(e.llamadasDumps[1].top, 100);
  });

  test('rol QAS → contexto escribible false; sin rol o DEV → true', async () => {
    for (const [rol, esperado] of [['QAS', false], ['PRD', false], ['DEV', true], [undefined, true]] as const) {
      const e = await crearEntorno({ rol });
      await e.proveedor.refrescar();
      assert.deepStrictEqual(
        e.contextos.filter(([c]) => c === CONTEXTO_ESCRIBIBLE),
        [[CONTEXTO_ESCRIBIBLE, esperado]],
        `rol ${rol}`,
      );
    }
  });

  test('sin destino el contexto escribible es false', async () => {
    const e = await crearEntorno({}, null);
    await e.proveedor.refrescar();
    assert.deepStrictEqual(
      e.contextos.filter(([c]) => c === CONTEXTO_ESCRIBIBLE),
      [[CONTEXTO_ESCRIBIBLE, false]],
    );
  });

  test('descripcionVista: destino y descripción; sin destino undefined', async () => {
    const e = await crearEntorno();
    await e.proveedor.refrescar();
    assert.ok(e.proveedor.descripcionVista()?.startsWith(DESTINO));
    assert.equal(e.proveedor.descripcionVista(), `${DESTINO} · DEV · RFC`);
    const sin = await crearEntorno({}, null);
    await sin.proveedor.refrescar();
    assert.equal(sin.proveedor.descripcionVista(), undefined);
  });

  test('una respuesta de un refresco anterior se descarta', async () => {
    const lentos: ((r: ResultadoDumps) => void)[] = [];
    const sistemaActivo = new SistemaActivo(crearMemento());
    await sistemaActivo.establecer(DESTINO);
    const cambioVia = new vscode.EventEmitter<void>();
    const proveedor = new ProveedorMonitor({
      sistemaActivo,
      servicio: {
        dumps: () => new Promise<ResultadoDumps>((resolver) => lentos.push(resolver)),
        inactivos: async () => INACTIVOS,
      },
      usuarioDe: () => undefined,
      descripcionDe: () => undefined,
      motivoSinRfc: () => undefined,
      credencialGuardada: async () => true,
      alCambiarVia: cambioVia.event,
      rolDe: () => undefined,
      ahora: () => AHORA,
      establecerContexto: async () => undefined,
    });
    vivos.push({
      proveedor,
      sistemaActivo,
      cambioVia,
      llamadasDumps: [],
      llamadasInactivos: [],
      contextos: [],
      cambios: { n: 0 },
    });
    const primero = proveedor.refrescar();
    await esperar(() => lentos.length === 1);
    const segundo = proveedor.refrescar();
    await esperar(() => lentos.length === 2);
    lentos[1]({ dumps: DUMPS, llena: false, top: TOP_DUMPS });
    await segundo;
    lentos[0]({ dumps: [], llena: false, top: TOP_DUMPS });
    await primero;
    assert.ok(proveedor.estado.dumps.fase === 'ok' && proveedor.estado.dumps.elementos.length === DUMPS.length);
  });

  test('un refresco superado durante setContext no carga datos del destino anterior', async () => {
    let liberar: () => void = () => undefined;
    let primera = true;
    const e = await crearEntorno({
      bloqueoContexto: () => {
        if (!primera) {
          return Promise.resolve();
        }
        primera = false;
        return new Promise<void>((resolver) => {
          liberar = resolver;
        });
      },
    });
    const primero = e.proveedor.refrescar();
    await esperar(() => e.contextos.length === 1);
    await e.sistemaActivo.establecer('OTRO');
    await esperar(() => e.llamadasDumps.length === 1);
    liberar();
    await primero;
    await new Promise((r) => setTimeout(r, 50));
    assert.deepStrictEqual(e.llamadasDumps.map((l) => l.destino), ['OTRO']);
    assert.deepStrictEqual(e.llamadasInactivos.map((l) => l.destino), ['OTRO']);
    assert.strictEqual(e.proveedor.estado.destino, 'OTRO');
    assert.strictEqual(e.proveedor.estado.dumps.fase, 'ok');
    assert.strictEqual(e.proveedor.estado.inactivos.fase, 'ok');
  });
});
