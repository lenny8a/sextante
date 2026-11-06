import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { destinoDeDumps } from '../../src/commands/herramientas';
import type { ApiDePrueba } from '../../src/extension';
import type { ResultadoAbrir } from '../../src/adt/abrir-resultado';
import type { ResultadoBusqueda } from '../../src/adt/busqueda-modelo';
import type { MostrarRuta } from '../../src/commands/buscar';
import { documentoDump } from '../../src/monitor/dump-texto';
import { analizarFeedDumps, resultadoDePosicion } from '../../src/monitor/dumps-modelo';
import { abrirPosicion, uriDeDump } from '../../src/monitor/dump-documento';
import { COMANDOS_MONITOR, debeRefrescarPorVia } from '../../src/monitor/cableado';

suite('monitor comandos (integración)', () => {
  let api: ApiDePrueba;

  suiteSetup(async () => {
    api = (await vscode.extensions.getExtension<ApiDePrueba>('lenny.sextante')?.activate()) as ApiDePrueba;
  });

  test('registra los 13 comandos del monitor', async () => {
    const registrados = await vscode.commands.getCommands(true);
    const ids = Object.values(COMANDOS_MONITOR);
    assert.equal(ids.length, 13);
    for (const id of ids) {
      assert.ok(registrados.includes(id), id);
    }
  });

  test('el documento del dump se sirve desde el proveedor de la API', async () => {
    const xml = fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', 'dumps.xml'), 'utf8');
    const dump = analizarFeedDumps(xml)[0];
    const uri = api.monitor.documentos.registrar('DEST_API', dump);
    assert.equal(uri.toString(), uriDeDump('DEST_API', dump).toString());
    const doc = await vscode.workspace.openTextDocument(uriDeDump('DEST_API', dump));
    assert.equal(doc.getText(), documentoDump(dump, 'DEST_API', { clase: 'cargando' }).texto);
  });

  test('abrirPosicion abre el include en la línea', async () => {
    const uriAdt = '/sap/bc/adt/programs/includes/z_ejemplo_inc/source/main';
    const doc = await vscode.workspace.openTextDocument({ content: Array.from({ length: 10 }, (_, i) => `linea ${i + 1}`).join('\n') });
    const llamadas: { r: ResultadoBusqueda; destino: string; mostrar?: MostrarRuta }[] = [];
    const avisos: string[] = [];
    await abrirPosicion('DEST', uriAdt, 5, {
      abrirResultado: async (r, destino, mostrar): Promise<ResultadoAbrir> => {
        llamadas.push({ r, destino, mostrar });
        await mostrar?.('/ruta/ficticia');
        return 'abierto';
      },
      avisar: (m) => avisos.push(m),
      aUri: () => doc.uri,
    });
    assert.deepEqual(llamadas[0].r, resultadoDePosicion({ uriAdt, linea: 5 }, 'Z_EJEMPLO_INC'));
    assert.equal(llamadas[0].destino, 'DEST');
    assert.equal(vscode.window.activeTextEditor?.selection.active.line, 4);
    assert.deepEqual(avisos, []);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('abrirPosicion con una dirección no reconocida avisa y no abre nada', async () => {
    const avisos: string[] = [];
    let abiertos = 0;
    await abrirPosicion('DEST', '/sap/bc/adt/otra/cosa', 3, {
      abrirResultado: async (): Promise<ResultadoAbrir> => {
        abiertos += 1;
        return 'abierto';
      },
      avisar: (m) => avisos.push(m),
    });
    assert.equal(abiertos, 0);
    assert.deepEqual(avisos, ['Posición no reconocida']);
  });

  test('el botón Dumps y feeds elige el monitor solo con vía RFC', () => {
    assert.equal(destinoDeDumps(true), 'monitor');
    assert.equal(destinoDeDumps(false), 'oficial');
  });

  test('debeRefrescarPorVia: solo el destino activo y solo si aporta', () => {
    assert.equal(debeRefrescarPorVia('A', 'A', 'rfc', undefined, false), false);
    assert.equal(debeRefrescarPorVia('A', 'A', 'rfc', undefined, true), true);
    assert.equal(debeRefrescarPorVia('A', 'A', undefined, 'rfc', false), true);
    assert.equal(debeRefrescarPorVia('A', 'A', 'rfc', 'rfc', false), false);
    assert.equal(debeRefrescarPorVia('A', 'A', 'http', 'rfc', false), true);
    assert.equal(debeRefrescarPorVia('B', 'A', 'rfc', 'http', true), false);
    assert.equal(debeRefrescarPorVia('A', undefined, 'rfc', undefined, true), false);
  });
});
