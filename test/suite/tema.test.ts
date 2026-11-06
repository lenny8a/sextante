import * as assert from 'assert';
import * as vscode from 'vscode';
import type { ApiDePrueba } from '../../src/extension';

const COMANDO = 'abapNavigator.tema.coloresPropios';
const MARCA_AVISO = 'abapNavigator.tema.avisoColores';
const TEMA_PROPIO = 'Sextante Oscuro';
const ESPERA_AVISO_MS = 800;
const TIMEOUT_DOS_CAMBIOS_MS = 10000;

function valorGlobalDeAbap(): boolean | undefined {
  return vscode.workspace
    .getConfiguration('editor', { languageId: 'abap' })
    .inspect<boolean>('semanticHighlighting.enabled')?.globalLanguageValue;
}

suite('Tema: colores propios', function () {
  this.timeout(TIMEOUT_DOS_CAMBIOS_MS);
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('lenny.sextante');
    assert.ok(ext, 'extensión no encontrada');
    await ext.activate();
  });

  test('el comando está registrado y contribuido', async () => {
    const comandos = await vscode.commands.getCommands(true);
    assert.ok(comandos.includes(COMANDO));
    const extension = vscode.extensions.all.find((e) => e.packageJSON?.name === 'sextante');
    const contribuidos = (extension?.packageJSON?.contributes?.commands ?? []) as { command: string }[];
    assert.ok(contribuidos.some((c) => c.command === COMANDO));
  });

  test('alterna el override global [abap] de semanticHighlighting', async () => {
    const original = valorGlobalDeAbap();
    const configuracion = vscode.workspace.getConfiguration('editor', { languageId: 'abap' });
    try {
      await configuracion.update('semanticHighlighting.enabled', undefined, vscode.ConfigurationTarget.Global, true);
      await vscode.commands.executeCommand(COMANDO);
      assert.strictEqual(valorGlobalDeAbap(), false);
      await vscode.commands.executeCommand(COMANDO);
      assert.strictEqual(valorGlobalDeAbap(), undefined);
    } finally {
      await configuracion.update('semanticHighlighting.enabled', original, vscode.ConfigurationTarget.Global, true);
    }
  });
});

suite('Tema: aviso para activar los colores propios', () => {
  let estado: vscode.Memento;
  const ventana = vscode.window as unknown as Record<string, unknown>;
  const mostrarOriginal = ventana.showInformationMessage;
  let avisos: string[] = [];

  function esperar(ms: number): Promise<void> {
    return new Promise((resolver) => setTimeout(resolver, ms));
  }

  async function fijarTema(tema: string | undefined): Promise<void> {
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', tema, vscode.ConfigurationTarget.Global);
  }

  function avisosDeColores(): string[] {
    return avisos.filter((m) => m.includes('colorea mejor el ABAP'));
  }

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<ApiDePrueba | undefined>('lenny.sextante');
    assert.ok(ext, 'extensión no encontrada');
    const api = await ext.activate();
    assert.ok(api, 'la extensión no expone el contexto en modo de pruebas');
    estado = api.contextoDePrueba.globalState;
  });

  setup(() => {
    avisos = [];
    ventana.showInformationMessage = async (mensaje: string) => {
      avisos.push(mensaje);
      return undefined;
    };
  });

  teardown(() => {
    ventana.showInformationMessage = mostrarOriginal;
  });

  suiteTeardown(async () => {
    await estado.update(MARCA_AVISO, undefined);
  });

  async function conTemaPropio(prueba: () => Promise<void>): Promise<void> {
    const temaOriginal = vscode.workspace.getConfiguration('workbench').inspect<string>('colorTheme')?.globalValue;
    const overrideOriginal = valorGlobalDeAbap();
    const configuracion = vscode.workspace.getConfiguration('editor', { languageId: 'abap' });
    try {
      await configuracion.update('semanticHighlighting.enabled', undefined, vscode.ConfigurationTarget.Global, true);
      await prueba();
    } finally {
      await fijarTema(temaOriginal);
      await configuracion.update(
        'semanticHighlighting.enabled',
        overrideOriginal,
        vscode.ConfigurationTarget.Global,
        true,
      );
    }
  }

  test('con «No volver a preguntar» guardado no avisa al elegir el tema', async () => {
    await estado.update(MARCA_AVISO, true);
    await conTemaPropio(async () => {
      await fijarTema(TEMA_PROPIO);
      await esperar(ESPERA_AVISO_MS);
      assert.strictEqual(avisosDeColores().length, 0);
    });
  });

  test('sin la marca avisa una sola vez por sesión y cerrar el aviso no guarda nada', async function () {
    this.timeout(TIMEOUT_DOS_CAMBIOS_MS);
    await estado.update(MARCA_AVISO, undefined);
    await conTemaPropio(async () => {
      await fijarTema(TEMA_PROPIO);
      await esperar(ESPERA_AVISO_MS);
      assert.strictEqual(avisosDeColores().length, 1);
      assert.strictEqual(estado.get<boolean>(MARCA_AVISO), undefined);

      await fijarTema('Default Dark Modern');
      await fijarTema(TEMA_PROPIO);
      await esperar(ESPERA_AVISO_MS);
      assert.strictEqual(avisosDeColores().length, 1);
    });
  });
});
