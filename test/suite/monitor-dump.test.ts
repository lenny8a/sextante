import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ResultadoAbrir } from '../../src/adt/abrir-resultado';
import type { ResultadoBusqueda } from '../../src/adt/busqueda-modelo';
import type { MostrarRuta } from '../../src/commands/buscar';
import {
  abrirDumpEnEditor,
  abrirPosicion,
  type DependenciasAbrirDump,
  ESQUEMA_DUMP,
  ProveedorDocumentoDump,
  uriDeDump,
} from '../../src/monitor/dump-documento';
import type { ResultadoTabla } from '../../src/adt/tablas-legibles';
import { documentoDump, TEXTO_CARGANDO } from '../../src/monitor/dump-texto';
import { analizarFeedDumps, type Dump, resultadoDePosicion } from '../../src/monitor/dumps-modelo';
import type { ResultadoDumpCompleto } from '../../src/monitor/servicio';
import { dumpCompletoDe, reensamblarFilas, registrosDe } from '../../src/monitor/snap-modelo';

interface Llamada {
  r: ResultadoBusqueda;
  destino: string;
  mostrar?: MostrarRuta;
}

function dumpFixture(): Dump {
  const xml = fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', 'dumps.xml'), 'utf8');
  return analizarFeedDumps(xml)[0];
}

function completoFixture(): ResultadoDumpCompleto {
  const ruta = path.resolve(__dirname, '../../../test/fixtures/adt/real', 'snap-itab.json');
  const { respuestas } = JSON.parse(fs.readFileSync(ruta, 'utf8')) as { respuestas: ResultadoTabla[] };
  return { clase: 'ok', completo: dumpCompletoDe(registrosDe(reensamblarFilas(respuestas)).registros) };
}

let contador = 0;

const esperar = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));

function dumpEnInclude(): Dump {
  return { ...dumpFixture(), posicion: { uriAdt: '/sap/bc/adt/programs/includes/z_ejemplo_inc/source/main', linea: 8 } };
}

suite('monitor dump (integración)', () => {
  let proveedor: ProveedorDocumentoDump;
  let registro: vscode.Disposable;
  let llamadas: Llamada[];
  let avisos: string[];
  let resultadoFalso: ResultadoAbrir;
  let resultados: ResultadoAbrir[];
  let deps: DependenciasAbrirDump;

  setup(async () => {
    proveedor = new ProveedorDocumentoDump();
    registro = vscode.Disposable.from(
      vscode.workspace.registerTextDocumentContentProvider(ESQUEMA_DUMP, proveedor),
      vscode.languages.registerDocumentLinkProvider({ scheme: ESQUEMA_DUMP }, proveedor),
    );
    llamadas = [];
    avisos = [];
    resultadoFalso = 'abierto';
    resultados = [];
    const doc = await vscode.workspace.openTextDocument({ content: Array.from({ length: 10 }, (_, i) => `linea ${i + 1}`).join('\n') });
    const untitled = doc.uri;
    deps = {
      documentos: proveedor,
      avisar: (m) => avisos.push(m),
      aUri: () => untitled,
      abrirResultado: async (r, destino, mostrar) => {
        llamadas.push({ r, destino, mostrar });
        const resultado = resultados.shift() ?? resultadoFalso;
        if (mostrar && resultado === 'abierto') {
          await mostrar('/ruta/ficticia');
        }
        return resultado;
      },
    };
  });

  teardown(async () => {
    registro.dispose();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('abre el objeto en la línea del dump y el documento al lado', async () => {
    const d = dumpFixture();
    const r = await abrirDumpEnEditor('DEST', d, deps);
    assert.equal(r, 'abierto');
    assert.deepEqual(llamadas[0].r, resultadoDePosicion(d.posicion!, d.programa));
    assert.equal(
      vscode.window.visibleTextEditors.some((e) => e.document.uri.scheme === ESQUEMA_DUMP),
      true,
    );
    const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === 'untitled');
    assert.equal(editor?.selection.active.line, 7);
    const doc = vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === ESQUEMA_DUMP)?.document;
    assert.ok(doc?.getText().startsWith('ASSERTION_FAILED · Z_EJEMPLO_1'));
  });

  test('dump sin posición abre el programa sin línea y avisa', async () => {
    const d = { ...dumpFixture(), posicion: undefined };
    const r = await abrirDumpEnEditor('DEST', d, deps);
    assert.equal(r, 'sinPosicion');
    assert.deepEqual(llamadas.at(-1)?.r, { nombre: 'Z_EJEMPLO_1', tipo: 'PROG/P', descripcion: '', paquete: '', uriAdt: '' });
    assert.equal(llamadas.at(-1)?.mostrar, undefined);
    assert.ok(avisos.at(-1)?.includes('sin posición'));
  });

  test('si nada se abre devuelve noAbierto tras dos intentos y el documento del dump se abre igual', async () => {
    resultadoFalso = 'noLocalizado';
    const r = await abrirDumpEnEditor('DEST', dumpEnInclude(), deps);
    assert.equal(r, 'noAbierto');
    assert.equal(llamadas.length, 2);
    assert.equal(
      vscode.window.visibleTextEditors.some((e) => e.document.uri.scheme === ESQUEMA_DUMP),
      true,
    );
  });

  test('include no localizado: reintenta con el programa, avisa y devuelve sinPosicion', async () => {
    resultados = ['noLocalizado', 'abierto'];
    const d = dumpEnInclude();
    const r = await abrirDumpEnEditor('DEST', d, deps);
    assert.equal(r, 'sinPosicion');
    assert.equal(llamadas.length, 2);
    assert.equal(llamadas[1].r.nombre, d.programa);
    assert.equal(llamadas[1].mostrar, undefined);
    assert.ok(avisos.some((a) => a.includes('No se localizó')));
    assert.equal(
      vscode.window.visibleTextEditors.some((e) => e.document.uri.scheme === ESQUEMA_DUMP),
      true,
    );
  });

  suite('con SNAP', () => {
    let destino = '';
    setup(() => {
      contador += 1;
      destino = `DEST${contador}`;
    });
    const textoDelDocumento = (): string | undefined =>
      vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriDeDump(destino, dumpFixture()).toString())?.getText();
    const cambioDelDocumento = (): Promise<void> =>
      new Promise((resolver) => {
        const suscripcion = vscode.workspace.onDidChangeTextDocument((e) => {
          if (e.document.uri.scheme === ESQUEMA_DUMP) {
            suscripcion.dispose();
            resolver();
          }
        });
      });

    test('el documento se abre cargando y se completa cuando llega SNAP', async () => {
      deps.dumpCompleto = async () => {
        await esperar(50);
        return completoFixture();
      };
      const cambioProveedor = new Promise<void>((resolver) => {
        const suscripcion = proveedor.onDidChange(() => {
          suscripcion.dispose();
          resolver();
        });
      });
      const cambio = cambioDelDocumento();
      await abrirDumpEnEditor(destino, dumpFixture(), deps);
      assert.ok(textoDelDocumento()?.includes(TEXTO_CARGANDO));
      await cambioProveedor;
      await cambio;
      const texto = textoDelDocumento() ?? '';
      assert.ok(texto.includes('VARIABLES SELECCIONADAS'));
      assert.ok(!texto.includes(TEXTO_CARGANDO));
    });

    test('si SNAP falla, el documento muestra el motivo y conserva el feed', async () => {
      const motivo = 'sin autorización para leer SNAP en este sistema';
      deps.dumpCompleto = async () => ({ clase: 'error', motivo });
      const cambio = cambioDelDocumento();
      await abrirDumpEnEditor(destino, dumpFixture(), deps);
      await cambio;
      const texto = textoDelDocumento() ?? '';
      assert.ok(texto.includes(motivo));
      assert.ok(texto.includes('QUÉ FALLÓ'));
      assert.ok(texto.includes('DÓNDE FALLÓ'));
      assert.ok(!texto.includes(TEXTO_CARGANDO));
    });

    test('un dump ya completo no se vuelve a leer', async () => {
      let lecturas = 0;
      deps.dumpCompleto = async () => {
        lecturas += 1;
        return completoFixture();
      };
      const d = dumpFixture();
      await abrirDumpEnEditor(destino, d, deps);
      await esperar(50);
      await abrirDumpEnEditor(destino, d, deps);
      await esperar(50);
      assert.equal(lecturas, 1);
    });

    test('cerrar el documento antes de que llegue SNAP no rompe', async () => {
      deps.dumpCompleto = async () => {
        await esperar(50);
        return completoFixture();
      };
      const d = dumpFixture();
      await abrirDumpEnEditor(destino, d, deps);
      await esperar(10);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await esperar(100);
      assert.equal(proveedor.estadoDe(uriDeDump(destino, d))?.clase, 'ok');
    });

    test('las filas de la pila son enlaces al comando abrirPosicion', async () => {
      const d = dumpFixture();
      const uri = proveedor.registrar(destino, d);
      await vscode.workspace.openTextDocument(uri);
      const enlaces = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', uri);
      const deComando = enlaces.filter((e) => e.target?.toString().startsWith('command:abapNavigator.monitor.abrirPosicion?'));
      assert.equal(deComando.length, 1);
      const args = JSON.parse(decodeURIComponent(deComando[0].target?.query ?? '')) as unknown[];
      const esperado = documentoDump(d, destino, { clase: 'cargando' }).enlaces[0];
      assert.deepEqual(args, [destino, esperado.uriAdt, esperado.lineaDestino]);
    });

    test('la uri ADT con %2f sobrevive a la descodificación del enlace', async () => {
      const uriAdt = '/sap/bc/adt/programs/programs/%2fns%2fzprog/source/main';
      const base = dumpFixture();
      const resumenHtml =
        '<h4 id="STACK">Active Calls/Events</h4><table><tr><th>No.</th><th>Event</th><th>Program</th><th>Include</th><th>Line</th></tr>' +
        `<tr><td><code><a href="adt://DEV${uriAdt}#start=8">1</a></code></td><td><code>START-OF-SELECTION</code></td><td><code>/NS/ZPROG</code></td><td><code>/NS/ZPROG</code></td><td><code>8</code></td></tr></table>`;
      const d = { ...base, id: `${base.id}-ns`, resumenHtml };
      const uri = proveedor.registrar(destino, d);
      await vscode.workspace.openTextDocument(uri);
      const enlaces = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', uri);
      const deComando = enlaces.filter((e) => e.target?.scheme === 'command');
      assert.equal(deComando.length, 1);
      const args = JSON.parse(decodeURIComponent(deComando[0].target?.query ?? '')) as unknown[];
      assert.equal(args[1], uriAdt);
    });

    test('un error de SNAP se reintenta al reabrir y un dump completo no', async () => {
      let lecturas = 0;
      deps.dumpCompleto = async () => {
        lecturas += 1;
        return lecturas === 1 ? { clase: 'error', motivo: 'tiempo agotado' } : completoFixture();
      };
      const d = dumpFixture();
      await abrirDumpEnEditor(destino, d, deps);
      await esperar(50);
      assert.equal(proveedor.estadoDe(uriDeDump(destino, d))?.clase, 'error');
      await abrirDumpEnEditor(destino, d, deps);
      await esperar(50);
      assert.equal(lecturas, 2);
      assert.ok(textoDelDocumento()?.includes('VARIABLES SELECCIONADAS'));
    });

    test('dos aperturas seguidas no lanzan dos lecturas', async () => {
      let lecturas = 0;
      deps.dumpCompleto = async () => {
        lecturas += 1;
        await esperar(50);
        return completoFixture();
      };
      const d = dumpFixture();
      await Promise.all([abrirDumpEnEditor(destino, d, deps), abrirDumpEnEditor(destino, d, deps)]);
      await esperar(120);
      assert.equal(lecturas, 1);
    });

    test('abrirPosicion rechaza argumentos mal formados', async () => {
      await abrirPosicion(destino, '/sap/bc/adt/programs/programs/zp/source/main', 0, deps);
      await abrirPosicion(destino, '/sap/bc/adt/programs/programs/zp/source/main', 1.5, deps);
      await abrirPosicion(destino, 5, 3, deps);
      assert.deepEqual(avisos, ['Posición no reconocida', 'Posición no reconocida', 'Posición no reconocida']);
      assert.equal(llamadas.length, 0);
    });
  });
});

suite('monitor dump-documento', () => {
  test('uriDeDump usa el esquema propio y el destino en la ruta', () => {
    const uri = uriDeDump('DEST', dumpFixture());
    assert.equal(uri.scheme, ESQUEMA_DUMP);
    assert.ok(uri.path.startsWith('/DEST/Dump ASSERTION_FAILED'));
    assert.ok(uri.query.includes(encodeURIComponent(dumpFixture().id)));
  });

  test('el proveedor devuelve el texto tras registrar y vacío antes', () => {
    const d = dumpFixture();
    const proveedor = new ProveedorDocumentoDump();
    assert.equal(proveedor.provideTextDocumentContent(uriDeDump('DEST', d)), '');
    const uri = proveedor.registrar('DEST', d);
    assert.equal(proveedor.provideTextDocumentContent(uri), documentoDump(d, 'DEST', { clase: 'cargando' }).texto);
    assert.deepEqual(proveedor.estadoDe(uri), { clase: 'cargando' });
  });
});
