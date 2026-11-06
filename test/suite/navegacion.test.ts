import * as assert from 'assert';
import * as vscode from 'vscode';
import { registrarNavegacionPerform, type DependenciasNavegacionPerform } from '../../src/navegacion/perform-navegacion';

/** Sin la extensión oficial no hay lenguaje `abap`: el proveedor se registra para plaintext, como en firmas.test.ts. */
const LENGUAJE_PRUEBA = 'plaintext';
const SELECTOR_PRUEBA: vscode.DocumentFilter = { language: LENGUAJE_PRUEBA, scheme: 'untitled' };
const CONTENIDO = ['REPORT zprog_ejemplo.', 'START-OF-SELECTION.', '  PERFORM calcular USING 1.', '  PERFORM no_existe.', 'FORM calcular USING p.', 'ENDFORM.'].join('\n');

async function definiciones(doc: vscode.TextDocument, posicion: vscode.Position): Promise<vscode.Location[]> {
  const resultado = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
    'vscode.executeDefinitionProvider',
    doc.uri,
    posicion,
  );
  return (resultado ?? []).map((d) =>
    d instanceof vscode.Location ? d : new vscode.Location(d.targetUri, d.targetSelectionRange ?? d.targetRange),
  );
}

suite('navegación: ir al FORM de un PERFORM', () => {
  const contexto = { subscriptions: [] as vscode.Disposable[] };
  const avisos: string[] = [];
  let modoBloque = false;
  const deps: DependenciasNavegacionPerform = {
    modoBloque: () => modoBloque,
    rutaPrincipalDe: () => undefined,
    leerTexto: async () => undefined,
    avisar: (mensaje) => avisos.push(mensaje),
  };

  suiteSetup(() => {
    registrarNavegacionPerform(contexto, deps, SELECTOR_PRUEBA);
  });

  suiteTeardown(() => {
    for (const d of contexto.subscriptions) {
      d.dispose();
    }
  });

  setup(() => {
    avisos.length = 0;
    modoBloque = false;
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('Ir a definición sobre el PERFORM lleva a la línea del FORM en el mismo documento', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: CONTENIDO });
    const destinos = await definiciones(doc, new vscode.Position(2, 12));
    assert.equal(destinos.length, 1, JSON.stringify(destinos));
    assert.equal(destinos[0].uri.toString(), doc.uri.toString());
    assert.deepEqual([destinos[0].range.start.line, destinos[0].range.start.character], [4, 5]);
    assert.deepEqual(avisos, []);
  });

  test('con el modo bloque activo un documento que no es abap: sigue saltando a la línea', async () => {
    modoBloque = true;
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: CONTENIDO });
    const destinos = await definiciones(doc, new vscode.Position(2, 12));
    assert.equal(destinos.length, 1);
    assert.equal(destinos[0].uri.scheme, 'untitled');
    assert.equal(destinos[0].range.start.line, 4);
  });

  test('un FORM que no está avisa en vez de saltar', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: CONTENIDO });
    const destinos = await definiciones(doc, new vscode.Position(3, 12));
    assert.equal(destinos.length, 0);
    assert.deepEqual(avisos, ['FORM NO_EXISTE no está en este objeto ni en sus includes']);
  });

  test('fuera de un PERFORM no hay destino ni aviso', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: CONTENIDO });
    const destinos = await definiciones(doc, new vscode.Position(4, 6));
    assert.equal(destinos.length, 0);
    assert.deepEqual(avisos, []);
  });
});
