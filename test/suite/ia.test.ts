import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ApiDePrueba } from '../../src/extension';
import { COMANDOS_IA } from '../../src/ia/cableado';
import type { ContextoActual } from '../../src/ia/contexto-modelo';
import { cabeceraDiario } from '../../src/ia/diario-modelo';
import { ORDEN_DIARIO } from '../../src/ia/herramientas-diario';
import { ORDEN_ESCRITURA } from '../../src/ia/herramientas-escritura';
import { lanzarSinEsperar } from '../../src/ia/oficial-escritura';
import { RegistroActividad } from '../../src/ia/actividad-modelo';
import { CONTEXTO_PROPUESTA_PENDIENTE, ProveedorActividad } from '../../src/ia/actividad-proveedor';
import { GestorPropuestas, MSG_ARCHIVO_CAMBIO, MSG_SIN_DIFF, MSG_SIN_GUARDAR, MSG_YA_APLICADO } from '../../src/ia/propuestas';
import { ProveedorDocumentoPropuesta, idDeUriPropuesta, uriDePropuesta } from '../../src/ia/propuestas-documento';
import { RegistroPropuestas, type Propuesta } from '../../src/ia/propuestas-modelo';
import { CABECERA_SESION, PUERTO_POR_DEFECTO, RUTA_MCP, ServidorHttpMcp } from '../../src/ia/servidor-http';
import { EsquemaAbapOcupado, contenidoFalso, registrarFsAbapFalso } from './fs-abap-falso';

const TOKEN = 't';
const BIBLIOTECA = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library';
const RUTA_PROG = `${BIBLIOTECA}/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap`;
const RUTA_TOP = `${BIBLIOTECA}/Includes/ZPROG_EJEMPLO_TOP/zprog_ejemplo_top.prog.abap`;
const RUTA_F01 = `${BIBLIOTECA}/Includes/ZPROG_EJEMPLO_F01/zprog_ejemplo_f01.prog.abap`;

const ARCHIVOS: Record<string, string> = {
  [RUTA_PROG]: 'REPORT zprog_ejemplo.\nINCLUDE zprog_ejemplo_top.\nINCLUDE zprog_ejemplo_f01.\nSTART-OF-SELECTION.\n  PERFORM calcular.\n',
  [RUTA_TOP]: 'DATA gv_x TYPE i.\n',
  [RUTA_F01]: 'FORM calcular.\nENDFORM.\n',
};

const HERRAMIENTAS_LECTURA = [
  'contexto_actual',
  'abrir_objeto',
  'abrir_transaccion',
  'leer_programa',
  'leer_archivo',
  'estructura_objeto',
  'editores_abiertos',
];

interface RespuestaMcp {
  cabeceras: Headers;
  cuerpo: { result?: Record<string, unknown>; error?: { message: string } };
}

interface ResultadoLlamada {
  texto: string;
  esError: boolean;
}

function uriAbap(ruta: string): vscode.Uri {
  return vscode.Uri.from({ scheme: 'abap', path: ruta });
}

class ClienteMcp {
  private sesion: string | undefined;
  private siguienteId = 1;

  constructor(
    private readonly puerto: number,
    private readonly token: string,
  ) {}

  async pedir(method: string, params: Record<string, unknown>): Promise<RespuestaMcp> {
    const cabeceras: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
    if (this.sesion !== undefined) {
      cabeceras[CABECERA_SESION] = this.sesion;
    }
    const respuesta = await fetch(`http://127.0.0.1:${this.puerto}${RUTA_MCP}`, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify({ jsonrpc: '2.0', id: this.siguienteId++, method, params }),
    });
    assert.strictEqual(respuesta.status, 200, `${method} respondió ${respuesta.status}`);
    const cuerpo = (await respuesta.json()) as RespuestaMcp['cuerpo'];
    assert.strictEqual(cuerpo.error, undefined, `${method} devolvió error JSON-RPC`);
    return { cabeceras: respuesta.headers, cuerpo };
  }

  async iniciar(): Promise<RespuestaMcp> {
    const respuesta = await this.pedir('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'prueba-integracion', version: '0' },
    });
    this.sesion = respuesta.cabeceras.get(CABECERA_SESION) ?? undefined;
    return respuesta;
  }

  async llamar(nombre: string, args: Record<string, unknown> = {}): Promise<ResultadoLlamada> {
    const { cuerpo } = await this.pedir('tools/call', { name: nombre, arguments: args });
    const resultado = cuerpo.result as { content: { type: string; text: string }[]; isError: boolean };
    assert.strictEqual(resultado.content.length, 1);
    assert.strictEqual(resultado.content[0].type, 'text');
    return { texto: resultado.content[0].text, esError: resultado.isError };
  }
}

async function abrirPrograma(linea: number, columna: number): Promise<vscode.TextEditor> {
  const editor = await vscode.window.showTextDocument(uriAbap(RUTA_PROG));
  const posicion = new vscode.Position(linea, columna);
  editor.selection = new vscode.Selection(posicion, posicion);
  return editor;
}

async function activarExtension(): Promise<ApiDePrueba> {
  const ext = vscode.extensions.getExtension<ApiDePrueba | undefined>('lenny.sextante');
  assert.ok(ext, 'extensión no encontrada');
  const activada = await ext.activate();
  assert.ok(activada, 'la extensión no expone el cableado en modo de pruebas');
  return activada;
}

function esperarMs(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

async function sondearHasta(condicion: () => boolean, limiteMs = 5000): Promise<void> {
  const fin = Date.now() + limiteMs;
  while (!condicion()) {
    assert.ok(Date.now() < fin, 'la condición no se cumplió a tiempo');
    await esperarMs(50);
  }
}

/** Repite `accion` (p. ej. pulsar Escape en la caja de texto) hasta que la promesa termine: la caja tarda en abrirse. */
async function insistirHasta<T>(promesa: Promise<T>, accion: () => Thenable<unknown>, limiteMs = 5000): Promise<T> {
  let terminada = false;
  void promesa.then(
    () => (terminada = true),
    () => (terminada = true),
  );
  const fin = Date.now() + limiteMs;
  while (!terminada) {
    assert.ok(Date.now() < fin, 'la caja de texto no respondió a tiempo');
    await accion();
    await esperarMs(100);
  }
  return promesa;
}

function hayDiffAbierto(): boolean {
  return vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.input instanceof vscode.TabInputTextDiff));
}

function ladoDerechoDelDiff(): vscode.Uri | undefined {
  const entrada = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return entrada instanceof vscode.TabInputTextDiff ? entrada.modified : undefined;
}

/** Escribe a través del documento (edición + guardar) para que el modelo de VS Code y el FS falso no se desfasen. */
async function escribirPorDocumento(ruta: string, texto: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uriAbap(ruta));
  if (doc.getText() === texto && !doc.isDirty) {
    return;
  }
  const edicion = new vscode.WorkspaceEdit();
  edicion.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), texto);
  assert.ok(await vscode.workspace.applyEdit(edicion), 'no se pudo editar el documento abap: falso');
  assert.ok(await doc.save(), 'no se pudo guardar el documento abap: falso');
  assert.strictEqual(contenidoFalso(ruta), texto);
}

suite('IA: servidor MCP en la extensión', () => {
  let api: ApiDePrueba;
  let fsFalso: vscode.Disposable | undefined;
  let servidor: ServidorHttpMcp | undefined;
  let cliente: ClienteMcp;

  suiteSetup(async function () {
    try {
      fsFalso = registrarFsAbapFalso(ARCHIVOS, { escribible: true });
    } catch (e) {
      if (e instanceof EsquemaAbapOcupado) {
        console.warn(`IA: se salta el suite de integración del servidor MCP: ${e.message}`);
        this.skip();
      }
      throw e;
    }
    api = await activarExtension();
    // Las llamadas de este servidor también se anotan en la vista Actividad, como las del servidor del cableado.
    const registro = api.ia.registro;
    servidor = new ServidorHttpMcp({
      token: TOKEN,
      despacho: { catalogo: api.ia.catalogo, version: 'x', instrucciones: 'i', registrar: (llamada) => registro.anotar(llamada) },
    });
    cliente = new ClienteMcp(await servidor.arrancar(0), TOKEN);
  });

  setup(async () => {
    await escribirPorDocumento(RUTA_TOP, ARCHIVOS[RUTA_TOP]);
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  suiteTeardown(async () => {
    await servidor?.cerrar();
    fsFalso?.dispose();
  });

  test('initialize → tools/list devuelve las 7 de lectura, info_sistema, las 2 del diario, crear_objeto y las 6 de escritura', async () => {
    const inicio = await cliente.iniciar();
    assert.ok(inicio.cabeceras.get(CABECERA_SESION), 'falta la cabecera Mcp-Session-Id');
    const resultado = inicio.cuerpo.result as { serverInfo: { name: string; version: string }; protocolVersion: string };
    assert.strictEqual(resultado.serverInfo.name, 'sextante');
    assert.strictEqual(resultado.serverInfo.version, 'x');
    assert.strictEqual(resultado.protocolVersion, '2025-06-18');

    const lista = await cliente.pedir('tools/list', {});
    const herramientas = (lista.cuerpo.result as { tools: { name: string; description: string; inputSchema: { type: string } }[] }).tools;
    assert.deepStrictEqual(
      herramientas.map((h) => h.name),
      [...HERRAMIENTAS_LECTURA, 'info_sistema', ...ORDEN_DIARIO, 'crear_objeto', ...ORDEN_ESCRITURA],
    );
    const nombres = herramientas.map((h) => h.name);
    assert.strictEqual(nombres.indexOf('ejecutar_atc'), nombres.indexOf('verificar_sintaxis') + 1);
    for (const h of herramientas) {
      assert.ok(h.description.length > 0, `${h.name} sin descripción`);
      assert.strictEqual(h.inputSchema.type, 'object', `${h.name} sin esquema de objeto`);
    }
    const activar = herramientas.find((h) => h.name === 'activar') as
      | { inputSchema: { properties: Record<string, { type: string }>; required: string[] } }
      | undefined;
    assert.strictEqual(activar?.inputSchema.properties.todo?.type, 'boolean');
    assert.deepStrictEqual(activar.inputSchema.required, ['uri']);
  });

  test('contexto_actual con un documento abap: falso abierto devuelve sistema DEST, objeto y cursor', async () => {
    await abrirPrograma(4, 2);
    const { texto, esError } = await cliente.llamar('contexto_actual');
    assert.strictEqual(esError, false, texto);
    const contexto = JSON.parse(texto) as ContextoActual;
    assert.strictEqual(contexto.sistema?.id, 'DEST');
    assert.strictEqual(contexto.sistema?.origen, 'editor');
    assert.strictEqual(contexto.sistema?.rol, undefined);
    assert.ok(!('release' in (contexto.sistema ?? {})), 'sistema.release sin conexión propia');
    assert.strictEqual(contexto.soloLectura, false);
    assert.strictEqual(contexto.origenEditor, 'activo');
    assert.strictEqual(contexto.objeto?.nombre, 'ZPROG_EJEMPLO');
    assert.strictEqual(contexto.objeto?.tipo, 'programa');
    assert.deepStrictEqual(contexto.cursor, { linea: 5, columna: 3 });
    assert.ok(contexto.archivo?.uri.startsWith('abap:/repotree-v1/DEST/'), contexto.archivo?.uri);
    assert.strictEqual(contexto.archivo?.nombre, 'zprog_ejemplo.prog.abap');
    assert.strictEqual(contexto.archivo?.esInclude, false);
    assert.ok(
      contexto.editoresAbiertos.some((e) => e.esActivo && e.objeto === 'ZPROG_EJEMPLO'),
      'el programa no aparece como editor activo',
    );
  });

  test('leer_programa sobre el FS falso devuelve el principal y sus includes con cabeceras', async () => {
    const { texto, esError } = await cliente.llamar('leer_programa', { uri: uriAbap(RUTA_PROG).toString() });
    assert.strictEqual(esError, false, texto);
    const cabeceras = [`=== ${RUTA_PROG} (5 líneas) ===`, `=== ${RUTA_TOP} (1 líneas) ===`, `=== ${RUTA_F01} (2 líneas) ===`];
    const posiciones = cabeceras.map((c) => texto.indexOf(c));
    for (const [i, posicion] of posiciones.entries()) {
      assert.ok(posicion >= 0, `falta la cabecera ${cabeceras[i]}`);
    }
    assert.ok(posiciones[0] < posiciones[1] && posiciones[1] < posiciones[2], 'las cabeceras no siguen el orden principal, TOP, F01');
    const lineas = texto.split('\n');
    assert.ok(lineas.includes('5|   PERFORM calcular.'), 'falta la línea 5 numerada del principal');
    assert.ok(lineas.includes('1| DATA gv_x TYPE i.'), 'falta la línea numerada del TOP');
    assert.ok(lineas.includes('2| ENDFORM.'), 'falta la línea numerada del F01');
  });

  test('leer_archivo con rango fuera del archivo → isError con motivo', async () => {
    const uri = uriAbap(RUTA_TOP).toString();
    const fuera = await cliente.llamar('leer_archivo', { uri, desdeLinea: 1, hastaLinea: 99 });
    assert.strictEqual(fuera.esError, true);
    assert.match(fuera.texto, /supera el total de líneas \(1\)/);
    assert.match(fuera.texto, /entre 1 y 1/);

    const dentro = await cliente.llamar('leer_archivo', { uri, desdeLinea: 1, hastaLinea: 1 });
    assert.strictEqual(dentro.esError, false, dentro.texto);
    assert.strictEqual(dentro.texto, `=== ${RUTA_TOP} (líneas 1-1 de 1) ===\n1| DATA gv_x TYPE i.`);
  });

  test('la vista Actividad anota la llamada y el servidor del cableado escucha en 2237 o informa otraVentana', async function () {
    // Con el 2237 ocupado por otra ventana, arrancar() agota 6 reintentos de 500 ms antes de informar otraVentana.
    this.timeout(10_000);
    const puerto = vscode.workspace.getConfiguration('abapNavigator.ia').get<number>('puerto', PUERTO_POR_DEFECTO);
    const inicial = api.ia.registro.servidor;
    assert.ok(['escuchando', 'otraVentana', 'parado'].includes(inicial.estado), `estado inicial inesperado: ${inicial.estado}`);
    if (inicial.estado === 'escuchando' || inicial.estado === 'otraVentana') {
      assert.strictEqual(inicial.puerto, puerto);
    }

    await api.ia.arrancar();
    const arrancado = api.ia.registro.servidor;
    assert.ok(arrancado.estado === 'escuchando' || arrancado.estado === 'otraVentana', `tras arrancar: ${arrancado.estado}`);
    assert.strictEqual(arrancado.puerto, puerto);

    if (arrancado.estado === 'escuchando') {
      assert.strictEqual(api.ia.servidor?.puerto, puerto);
      await abrirPrograma(0, 0);
      const delCableado = new ClienteMcp(puerto, await api.ia.token());
      await delCableado.iniciar();
      const antes = api.ia.registro.llamadas.length;
      const { esError } = await delCableado.llamar('contexto_actual');
      assert.strictEqual(esError, false);
      assert.strictEqual(api.ia.registro.llamadas.length, antes + 1, 'la vista Actividad no anotó la llamada');
      assert.strictEqual(api.ia.registro.llamadas[0]?.herramienta, 'contexto_actual');
      assert.strictEqual(api.ia.registro.llamadas[0]?.resultado, 'ok');
    } else {
      console.warn(`IA: el puerto ${puerto} lo atiende otro proceso; no se comprueba la anotación en la vista Actividad`);
    }

    await api.ia.parar();
    assert.deepStrictEqual(api.ia.registro.servidor, { estado: 'parado' });
    assert.strictEqual(api.ia.servidor?.puerto, undefined);
  });

  test('verificar_sintaxis sin la extensión oficial → isError que nombra la extensión oficial', async () => {
    const { texto, esError } = await cliente.llamar('verificar_sintaxis', { uri: uriAbap(RUTA_PROG).toString() });
    assert.strictEqual(esError, true);
    assert.match(texto, /extensión oficial/);
  });

  test('ejecutar_atc sin la extensión oficial → isError que nombra la extensión oficial', async () => {
    const { texto, esError } = await cliente.llamar('ejecutar_atc', { uri: uriAbap(RUTA_PROG).toString() });
    assert.strictEqual(esError, true);
    assert.match(texto, /extensión oficial/);
  });

  test('ejecutar_unit_tests y activar sin rol en DEST → rechazado por rol, sin tocar la oficial ni abrir modal', async () => {
    for (const nombre of ['ejecutar_unit_tests', 'activar']) {
      const { texto, esError } = await cliente.llamar(nombre, { uri: uriAbap(RUTA_PROG).toString() });
      assert.strictEqual(esError, true, nombre);
      assert.match(texto, /^rechazado por rol/);
    }
    const todo = await cliente.llamar('activar', { uri: uriAbap(RUTA_PROG).toString(), todo: true });
    assert.strictEqual(todo.esError, true);
    assert.match(todo.texto, /^rechazado por rol/);
  });

  test('info_sistema en DEST sin conexión propia → fuente "no disponible" con indicación', async () => {
    const { texto, esError } = await cliente.llamar('info_sistema', { sistema: 'DEST' });
    assert.strictEqual(esError, false, texto);
    const info = JSON.parse(texto) as { sistema: string; fuente: string; indicacion?: string };
    assert.strictEqual(info.sistema, 'DEST');
    assert.strictEqual(info.fuente, 'no disponible');
    assert.ok(info.indicacion && info.indicacion.length > 0, 'falta la indicación');
  });

  test('crear_objeto en DEST sin rol → rechazado por rol', async () => {
    const { texto, esError } = await cliente.llamar('crear_objeto', {
      sistema: 'DEST', tipo: 'PROG', nombre: 'ZPRUEBA_NUEVO', descripcion: 'Prueba',
    });
    assert.strictEqual(esError, true);
    assert.match(texto, /^rechazado por rol/);
  });

  suite('con DEST en rol DEV', () => {
    let rutaConfig: string;
    let configPrevia: string | undefined;

    suiteSetup(async () => {
      rutaConfig = path.join(api.contextoDePrueba.globalStorageUri.fsPath, 'abap-navigator.json');
      configPrevia = fs.existsSync(rutaConfig) ? fs.readFileSync(rutaConfig, 'utf8') : undefined;
      await api.sistemas.fijarRol('DEST', 'DEV');
    });

    // Una prueba que falla a medias no debe dejar propuestas pendientes que contaminen a las siguientes.
    teardown(async () => {
      for (const p of api.ia.registroPropuestas.pendientes) {
        await api.ia.propuestas.rechazar(p.id, 'fin de la prueba');
      }
    });

    suiteTeardown(async () => {
      // El almacén global de la instancia de pruebas sobrevive entre ejecuciones: se deja como estaba.
      if (configPrevia === undefined) {
        fs.rmSync(rutaConfig, { force: true });
      } else {
        fs.writeFileSync(rutaConfig, configPrevia, 'utf8');
      }
      await api.sistemas.getChildren();
    });

    test('escena completa: proponer_cambio abre el diff, el comando Aplicar cambia el archivo y la herramienta devuelve aplicado', async function () {
      this.timeout(15_000);
      const llamada = cliente.llamar('proponer_cambio', {
        uri: uriAbap(RUTA_TOP).toString(),
        resumen: 'Tipar gv_x',
        cambios: [{ buscar: 'TYPE i', reemplazar: 'TYPE p LENGTH 8' }],
      });
      await sondearHasta(() => api.ia.registroPropuestas.pendientes.length === 1);
      const [pendiente] = api.ia.registroPropuestas.pendientes;
      const contexto = JSON.parse((await cliente.llamar('contexto_actual')).texto) as ContextoActual;
      assert.deepEqual(contexto.propuestasPendientes, [{ id: pendiente.id, resumen: 'Tipar gv_x', uri: uriAbap(RUTA_TOP).toString() }]);
      await sondearHasta(() => ladoDerechoDelDiff() !== undefined);
      await vscode.commands.executeCommand(COMANDOS_IA.aplicarPropuesta, ladoDerechoDelDiff());
      const { texto, esError } = await llamada;
      assert.strictEqual(esError, false, texto);
      assert.deepEqual(JSON.parse(texto), { id: pendiente.id, estado: 'aplicado' });
      assert.strictEqual(contenidoFalso(RUTA_TOP), 'DATA gv_x TYPE p LENGTH 8.\n');
      assert.strictEqual(api.ia.registro.llamadas[0]?.herramienta, 'proponer_cambio');
      assert.strictEqual(api.ia.registroPropuestas.pendientes.length, 0);
      assert.ok(!hayDiffAbierto(), 'el diff sigue abierto');
    });

    test('rechazar desde el comando con motivo → la herramienta devuelve rechazado con ese motivo', async function () {
      this.timeout(15_000);
      const llamada = cliente.llamar('proponer_cambio', {
        uri: uriAbap(RUTA_TOP).toString(),
        resumen: 'Tipar gv_x',
        cambios: [{ buscar: 'TYPE i', reemplazar: 'TYPE p LENGTH 8' }],
      });
      await sondearHasta(() => api.ia.registroPropuestas.pendientes.length === 1);
      const [pendiente] = api.ia.registroPropuestas.pendientes;
      await sondearHasta(() => ladoDerechoDelDiff() !== undefined);
      await vscode.commands.executeCommand(COMANDOS_IA.rechazarPropuesta, ladoDerechoDelDiff(), 'prefiero otro nombre');
      const { texto, esError } = await llamada;
      assert.strictEqual(esError, false, texto);
      assert.deepEqual(JSON.parse(texto), { id: pendiente.id, estado: 'rechazado', motivo: 'prefiero otro nombre' });
      assert.strictEqual(contenidoFalso(RUTA_TOP), ARCHIVOS[RUTA_TOP]);
      assert.ok(!hayDiffAbierto(), 'el diff sigue abierto');
    });

    suite('crear_objeto con el cuadro guía', () => {
      const ventana = vscode.window as { showInformationMessage: unknown };
      const original = ventana.showInformationMessage;
      const cuadros: { mensaje: string; opciones: unknown }[] = [];
      let respuesta: string | undefined;
      setup(() => {
        cuadros.length = 0;
        ventana.showInformationMessage = async (mensaje: string, opciones: unknown) => {
          cuadros.push({ mensaje, opciones });
          return respuesta;
        };
      });
      teardown(() => {
        ventana.showInformationMessage = original;
      });

      test('cancelar el cuadro guía → cancelado, sin lanzar el asistente', async () => {
        respuesta = undefined;
        const { texto, esError } = await cliente.llamar('crear_objeto', {
          sistema: 'DEST', tipo: 'PROG', nombre: 'ZPRUEBA_CANCELADO', descripcion: 'Prueba',
        });
        assert.strictEqual(esError, false, texto);
        assert.deepStrictEqual(JSON.parse(texto), { estado: 'cancelado', nombre: 'ZPRUEBA_CANCELADO' });
        assert.strictEqual(cuadros.length, 1);
        assert.strictEqual(cuadros[0].mensaje, 'El agente pide crear programa ZPRUEBA_CANCELADO «Prueba» en DEST.');
        assert.strictEqual((cuadros[0].opciones as { modal?: boolean }).modal, true);
      });

      test('aceptar sin la oficial en la instancia de pruebas → error sin esperar al asistente', async () => {
        respuesta = 'Abrir asistente';
        const inicio = Date.now();
        const { texto, esError } = await cliente.llamar('crear_objeto', {
          sistema: 'DEST', tipo: 'PROG', nombre: 'ZPRUEBA_NUEVO', descripcion: 'Prueba',
        });
        assert.strictEqual(esError, true);
        assert.strictEqual(
          texto,
          'falta la extensión oficial de SAP (ABAP Development Tools for VS Code): pide al usuario que la instale y vuelve a llamar',
        );
        assert.ok(Date.now() - inicio < 5000, 'crear_objeto esperó al asistente sin la oficial');
      });

      test('include con programaPrincipal sin conexión ADT propia → error de conexión, sin cuadro', async () => {
        respuesta = 'Crear';
        const { texto, esError } = await cliente.llamar('crear_objeto', {
          sistema: 'DEST', tipo: 'INCL', nombre: 'ZPRUEBA_TOP', descripcion: 'Prueba', programaPrincipal: 'ZPROG_EJEMPLO',
        });
        assert.strictEqual(esError, true);
        assert.strictEqual(texto, 'Sin conexión ADT propia con DEST: conéctate (o busca una vez) y vuelve a intentarlo');
        assert.strictEqual(cuadros.length, 0);
      });
    });

    test('estado_propuesta con id desconocido → isError "desconocida" sin esperar', async () => {
      const inicio = Date.now();
      const { texto, esError } = await cliente.llamar('estado_propuesta', { id: 'ffffffff' });
      assert.strictEqual(esError, true);
      assert.match(texto, /no hay ninguna propuesta con ese id/);
      assert.ok(Date.now() - inicio < 5000, 'estado_propuesta esperó con un id desconocido');
    });

    test('proponer_cambio con buscar repetido → isError sin abrir ningún diff', async () => {
      const { texto, esError } = await cliente.llamar('proponer_cambio', {
        uri: uriAbap(RUTA_TOP).toString(),
        resumen: 'Repetido',
        cambios: [{ buscar: 'A', reemplazar: 'B' }],
      });
      assert.strictEqual(esError, true);
      assert.match(texto, /aparece 2 veces/);
      assert.strictEqual(api.ia.registroPropuestas.pendientes.length, 0);
      assert.ok(!hayDiffAbierto(), 'se abrió un diff');
    });

    suite('diario por objeto', () => {
      let carpetaDiario: string;
      let rutaTop: string;
      let rutaProg: string;

      const leerDiario = (ruta: string): string => (fs.existsSync(ruta) ? fs.readFileSync(ruta, 'utf8') : '');

      async function decidirPropuestaDelTop(decidir: (derecha: vscode.Uri | undefined) => Thenable<unknown>): Promise<ResultadoLlamada> {
        const llamada = cliente.llamar('proponer_cambio', {
          uri: uriAbap(RUTA_TOP).toString(),
          resumen: 'Tipar gv_x',
          porque: 'p LENGTH 8 evita el desbordamiento',
          cambios: [{ buscar: 'TYPE i', reemplazar: 'TYPE p LENGTH 8' }],
        });
        await sondearHasta(() => api.ia.registroPropuestas.pendientes.length === 1);
        await sondearHasta(() => ladoDerechoDelDiff() !== undefined);
        await decidir(ladoDerechoDelDiff());
        return llamada;
      }

      // En Windows el vigilante de archivos de VS Code puede retener un momento la carpeta del diario recién abierto.
      const borrarCarpetaDiario = (): void => fs.rmSync(carpetaDiario, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

      /** Deja la vista Objeto mostrando exactamente ese archivo: la identidad del diario de un include depende de ella. */
      async function mostrarEnVista(ruta: string): Promise<void> {
        await api.objeto.mostrar(uriAbap(ruta));
        assert.strictEqual(api.objeto.objeto?.uri.path, ruta, 'la vista Objeto no muestra el archivo pedido');
      }

      // Sin la oficial no hay símbolos: este proveedor da los INCLUDE del programa para que el árbol cuelgue sus includes.
      let simbolosPrograma: vscode.Disposable | undefined;

      // El almacén global de la instancia de pruebas sobrevive entre ejecuciones: el diario empieza y acaba vacío.
      suiteSetup(() => {
        carpetaDiario = path.join(api.contextoDePrueba.globalStorageUri.fsPath, 'diario');
        borrarCarpetaDiario();
        rutaTop = api.ia.diario.rutaDe({ destino: 'DEST', codigo: 'INCL', nombre: 'ZPROG_EJEMPLO_TOP' });
        rutaProg = api.ia.diario.rutaDe({ destino: 'DEST', codigo: 'PROG', nombre: 'ZPROG_EJEMPLO' });
        simbolosPrograma = vscode.languages.registerDocumentSymbolProvider(
          { scheme: 'abap' },
          {
            provideDocumentSymbols: (doc) => {
              if (doc.uri.path !== RUTA_PROG) {
                return [];
              }
              return ['ZPROG_EJEMPLO_TOP', 'ZPROG_EJEMPLO_F01'].map((nombre, i) => {
                const rango = new vscode.Range(i + 1, 8, i + 1, 8 + nombre.length);
                return new vscode.DocumentSymbol(nombre, 'INCLUDE', vscode.SymbolKind.Object, rango, rango);
              });
            },
          },
        );
      });

      // El diario del programa se abrió en un editor y se reescribió después: el vigilante puede tardar en soltar la carpeta.
      suiteTeardown(async function () {
        this.timeout(20_000);
        simbolosPrograma?.dispose();
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        const fin = Date.now() + 10_000;
        for (;;) {
          try {
            borrarCarpetaDiario();
            return;
          } catch (error) {
            if (Date.now() > fin) {
              throw error;
            }
            await esperarMs(250);
          }
        }
      });

      test('aplicar una propuesta con porque escribe la entrada aplicado en el diario del include', async function () {
        this.timeout(15_000);
        assert.strictEqual(rutaTop, path.join(carpetaDiario, 'DEST', 'INCL-ZPROG_EJEMPLO_TOP.md'));
        await mostrarEnVista(RUTA_TOP);
        const { texto, esError } = await decidirPropuestaDelTop((derecha) =>
          vscode.commands.executeCommand(COMANDOS_IA.aplicarPropuesta, derecha),
        );
        assert.strictEqual(esError, false, texto);
        assert.strictEqual((JSON.parse(texto) as { estado: string }).estado, 'aplicado');
        await sondearHasta(() => leerDiario(rutaTop).includes(' · aplicado · '));
        const contenido = leerDiario(rutaTop);
        assert.ok(contenido.startsWith('# Diario de ZPROG_EJEMPLO_TOP (INCL) en DEST'), contenido);
        assert.ok(contenido.includes(' · aplicado · Tipar gv_x'), contenido);
        assert.ok(contenido.includes('Archivo: principal'), contenido);
        assert.ok(contenido.includes('Por qué: p LENGTH 8 evita el desbordamiento'), contenido);
      });

      test('rechazar con motivo añade rechazado con Motivo del usuario y contexto_actual trae diario', async function () {
        this.timeout(15_000);
        await mostrarEnVista(RUTA_TOP);
        const { texto, esError } = await decidirPropuestaDelTop((derecha) =>
          vscode.commands.executeCommand(COMANDOS_IA.rechazarPropuesta, derecha, 'prefiero otro nombre'),
        );
        assert.strictEqual(esError, false, texto);
        assert.strictEqual((JSON.parse(texto) as { estado: string }).estado, 'rechazado');
        await sondearHasta(() => leerDiario(rutaTop).includes(' · rechazado · '));
        assert.ok(leerDiario(rutaTop).includes('Motivo del usuario: prefiero otro nombre'), leerDiario(rutaTop));

        await vscode.window.showTextDocument(uriAbap(RUTA_TOP));
        const contexto = JSON.parse((await cliente.llamar('contexto_actual')).texto) as ContextoActual;
        assert.strictEqual(contexto.diario?.entradas, 2);
        assert.strictEqual(contexto.diario?.archivo, rutaTop);
      });

      test('anotar_diario escribe la nota y diario_objeto la devuelve con el total', async () => {
        await mostrarEnVista(RUTA_TOP);
        const uri = uriAbap(RUTA_TOP).toString();
        const anotada = await cliente.llamar('anotar_diario', { uri, texto: 'Revisado el TOP.' });
        assert.strictEqual(anotada.esError, false, anotada.texto);
        assert.deepStrictEqual(JSON.parse(anotada.texto), { archivo: rutaTop, entradas: 3 });

        const leida = await cliente.llamar('diario_objeto', { uri });
        assert.strictEqual(leida.esError, false, leida.texto);
        const diario = JSON.parse(leida.texto) as { entradas: number; texto: string; recortado: boolean };
        assert.strictEqual(diario.entradas, 3);
        assert.ok(diario.texto.includes('## '), diario.texto);
        assert.ok(diario.texto.includes('Revisado el TOP.'), diario.texto);
        assert.strictEqual(diario.recortado, false);
      });

      test('el comando Abrir diario crea el archivo si falta y lo abre al lado; el nodo Diario aparece en el árbol', async function () {
        this.timeout(15_000);
        assert.strictEqual(COMANDOS_IA.abrirDiario, 'abapNavigator.objeto.diario');
        assert.ok(!fs.existsSync(rutaProg), 'el programa ya tenía diario');
        await vscode.window.showTextDocument(uriAbap(RUTA_PROG));
        await sondearHasta(() => api.objeto.objeto?.nombre.toUpperCase() === 'ZPROG_EJEMPLO', 10_000);

        await vscode.commands.executeCommand(COMANDOS_IA.abrirDiario);
        const cabecera = leerDiario(rutaProg);
        assert.ok(cabecera.startsWith('# Diario de ZPROG_EJEMPLO (PROG) en DEST'), cabecera);
        assert.strictEqual(cabecera, cabeceraDiario({ destino: 'DEST', codigo: 'PROG', nombre: 'ZPROG_EJEMPLO' }));
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, vscode.Uri.file(rutaProg).fsPath);

        const anotada = await cliente.llamar('anotar_diario', { uri: uriAbap(RUTA_PROG).toString(), texto: 'Revisado el programa.' });
        assert.strictEqual(anotada.esError, false, anotada.texto);
        const tieneNodoDiario = async (): Promise<boolean> => {
          const [raiz] = await api.objeto.getChildren();
          return raiz?.hijos.some((h) => h.clase === 'diario') ?? false;
        };
        let visto = false;
        const fin = Date.now() + 5000;
        while (!(visto = await tieneNodoDiario()) && Date.now() < fin) {
          await esperarMs(50);
        }
        assert.ok(visto, 'el nodo Diario no apareció en el árbol del objeto');
      });

      test('con el programa en la vista, un include suyo anota, lee, decide y da contexto en el diario del programa', async function () {
        this.timeout(15_000);
        await mostrarEnVista(RUTA_PROG);
        assert.ok(api.objeto.pertenece(uriAbap(RUTA_F01)), 'el F01 no cuelga del programa mostrado');
        const uri = uriAbap(RUTA_F01).toString();
        const previas = (await api.ia.diario.resumen({ destino: 'DEST', codigo: 'PROG', nombre: 'ZPROG_EJEMPLO' })).entradas;

        const anotada = await cliente.llamar('anotar_diario', { uri, texto: 'Revisado el F01.' });
        assert.strictEqual(anotada.esError, false, anotada.texto);
        assert.deepStrictEqual(JSON.parse(anotada.texto), { archivo: rutaProg, entradas: previas + 1 });
        assert.ok(!fs.existsSync(path.join(carpetaDiario, 'DEST', 'INCL-ZPROG_EJEMPLO_F01.md')), 'el F01 tiene diario propio');

        const leida = JSON.parse((await cliente.llamar('diario_objeto', { uri })).texto) as { objeto: string; tipo: string; archivo: string };
        assert.deepStrictEqual([leida.objeto, leida.tipo, leida.archivo], ['ZPROG_EJEMPLO', 'PROG', rutaProg]);

        const llamada = cliente.llamar('proponer_cambio', {
          uri,
          resumen: 'Comentar el FORM',
          cambios: [{ buscar: 'FORM calcular.', reemplazar: 'FORM calcular.\n  " calcula' }],
        });
        await sondearHasta(() => api.ia.registroPropuestas.pendientes.length === 1);
        await sondearHasta(() => ladoDerechoDelDiff() !== undefined);
        await vscode.commands.executeCommand(COMANDOS_IA.rechazarPropuesta, ladoDerechoDelDiff(), 'ahora no');
        const decidida = await llamada;
        assert.strictEqual(decidida.esError, false, decidida.texto);
        await sondearHasta(() => leerDiario(rutaProg).includes(' · rechazado · Comentar el FORM'));
        const contenido = leerDiario(rutaProg);
        assert.ok(contenido.includes(' · rechazado · Comentar el FORM\nArchivo: ZPROG_EJEMPLO_F01\nMotivo del usuario: ahora no'), contenido);

        await vscode.window.showTextDocument(uriAbap(RUTA_F01));
        await sondearHasta(() => api.objeto.objeto?.uri.path === RUTA_PROG && api.objeto.pertenece(uriAbap(RUTA_F01)));
        const contexto = JSON.parse((await cliente.llamar('contexto_actual')).texto) as ContextoActual;
        assert.strictEqual(contexto.diario?.archivo, rutaProg);
        assert.strictEqual(contexto.diario?.entradas, previas + 2);
      });

      test('un include suelto (la vista no muestra su programa) conserva su diario INCL', async () => {
        await mostrarEnVista(RUTA_PROG);
        assert.ok(api.objeto.pertenece(uriAbap(RUTA_TOP)), 'con el programa en la vista el TOP iría a su diario');
        await mostrarEnVista(RUTA_TOP);
        const previas = (await api.ia.diario.resumen({ destino: 'DEST', codigo: 'INCL', nombre: 'ZPROG_EJEMPLO_TOP' })).entradas;
        const anotada = await cliente.llamar('anotar_diario', { uri: uriAbap(RUTA_TOP).toString(), texto: 'TOP suelto.' });
        assert.strictEqual(anotada.esError, false, anotada.texto);
        assert.deepStrictEqual(JSON.parse(anotada.texto), { archivo: rutaTop, entradas: previas + 1 });
        assert.ok(!leerDiario(rutaProg).includes('TOP suelto.'), 'la nota del TOP suelto acabó en el diario del programa');
      });
    });
  });
});

const CON_COMENTARIO = 'FORM calcular.\n  " hola\nENDFORM.\n';
const ID_DESCONOCIDO = 'ffffffff';

suite('IA: gestor de propuestas', () => {
  let api: ApiDePrueba;
  let fsFalso: vscode.Disposable | undefined;

  suiteSetup(async function () {
    try {
      fsFalso = registrarFsAbapFalso(ARCHIVOS, { escribible: true });
    } catch (e) {
      if (e instanceof EsquemaAbapOcupado) {
        console.warn(`IA: se salta el suite de integración del gestor de propuestas: ${e.message}`);
        this.skip();
      }
      throw e;
    }
    api = await activarExtension();
  });

  setup(async () => {
    await escribirPorDocumento(RUTA_F01, ARCHIVOS[RUTA_F01]);
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  suiteTeardown(() => {
    fsFalso?.dispose();
    // Las decisiones de este suite también se anotan en el diario del F01, que vive en el almacén global persistente.
    if (api !== undefined) {
      fs.rmSync(path.join(api.contextoDePrueba.globalStorageUri.fsPath, 'diario'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  function proponerComentario(): Promise<Propuesta> {
    return api.ia.propuestas.proponer({
      uri: uriAbap(RUTA_F01).toString(),
      resumen: 'Añadir comentario',
      entrada: { cambios: [{ buscar: 'FORM calcular.', reemplazar: 'FORM calcular.\n  " hola' }] },
      textoBase: ARCHIVOS[RUTA_F01],
      textoPropuesto: CON_COMENTARIO,
    });
  }

  async function textoDePropuesta(id: string): Promise<string> {
    return (await vscode.workspace.openTextDocument(uriDePropuesta(id, uriAbap(RUTA_F01)))).getText();
  }

  test('proponer abre un diff cuyo lado derecho es sextante-propuesta: con el texto propuesto', async () => {
    const p = await proponerComentario();
    const pestana = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(pestana?.input instanceof vscode.TabInputTextDiff, 'no se abrió un diff');
    assert.strictEqual(pestana.input.modified.scheme, 'sextante-propuesta');
    assert.strictEqual(idDeUriPropuesta(pestana.input.modified), p.id);
    assert.strictEqual(pestana.input.original.toString(), uriAbap(RUTA_F01).toString());
    assert.strictEqual(pestana.label, 'Propuesta: Añadir comentario');
    const derecha = await vscode.workspace.openTextDocument(pestana.input.modified);
    assert.strictEqual(derecha.getText(), CON_COMENTARIO);
    await api.ia.propuestas.rechazar(p.id, 'fin de la prueba');
  });

  test('aplicar cambia el texto del documento abap: falso, lo guarda en el FS y cierra el diff', async () => {
    const p = await proponerComentario();
    assert.ok(hayDiffAbierto(), 'proponer no abrió el diff');
    const decision = await api.ia.propuestas.aplicar(p.id);
    assert.deepStrictEqual(decision, { id: p.id, estado: 'aplicado' });
    assert.strictEqual(contenidoFalso(RUTA_F01), CON_COMENTARIO);
    assert.ok(!(await vscode.workspace.openTextDocument(uriAbap(RUTA_F01))).isDirty);
    assert.ok(!hayDiffAbierto(), 'el diff sigue abierto');
  });

  test('aplicar sobre un archivo que cambió y cuyo buscar ya no es único → rechazado con motivo "el archivo cambió"', async () => {
    const p = await proponerComentario();
    const duplicado = 'FORM calcular.\nENDFORM.\nFORM calcular.\nENDFORM.\n';
    await escribirPorDocumento(RUTA_F01, duplicado);
    const decision = await api.ia.propuestas.aplicar(p.id);
    assert.deepStrictEqual(decision, { id: p.id, estado: 'rechazado', motivo: MSG_ARCHIVO_CAMBIO });
    assert.strictEqual(api.ia.registroPropuestas.obtener(p.id)?.estado, 'caducada');
    assert.strictEqual(contenidoFalso(RUTA_F01), duplicado);
    assert.strictEqual((await vscode.workspace.openTextDocument(uriAbap(RUTA_F01))).isDirty, false);
    assert.ok(!hayDiffAbierto(), 'el diff sigue abierto');
  });

  test('archivo cambiado con buscar aún único: el primer Aplicar refresca el diff sin escribir; el segundo escribe', async () => {
    const p = await proponerComentario();
    const cambiado = '* cabecera\nFORM calcular.\nENDFORM.\n';
    await escribirPorDocumento(RUTA_F01, cambiado);
    await vscode.commands.executeCommand(COMANDOS_IA.aplicarPropuesta, { propuestaId: p.id });
    const recalculado = '* cabecera\nFORM calcular.\n  " hola\nENDFORM.\n';
    const enRegistro = api.ia.registroPropuestas.obtener(p.id);
    assert.strictEqual(enRegistro?.estado, 'pendiente');
    assert.strictEqual(enRegistro?.textoBase, cambiado);
    assert.strictEqual(enRegistro?.textoPropuesto, recalculado);
    const derecha = uriDePropuesta(p.id, uriAbap(RUTA_F01)).toString();
    await sondearHasta(() => vscode.workspace.textDocuments.find((d) => d.uri.toString() === derecha)?.getText() === recalculado);
    assert.strictEqual(await textoDePropuesta(p.id), recalculado);
    assert.strictEqual(contenidoFalso(RUTA_F01), cambiado, 'el primer Aplicar no debe escribir');
    assert.ok(hayDiffAbierto(), 'el diff se cerró sin que el usuario viera el recálculo');

    const segunda = await api.ia.propuestas.aplicar(p.id);
    assert.deepStrictEqual(segunda, { id: p.id, estado: 'aplicado' });
    assert.strictEqual(contenidoFalso(RUTA_F01), recalculado);
    assert.ok(!hayDiffAbierto(), 'el diff sigue abierto');
  });

  test('archivo que ya tiene el cambio propuesto (hecho a mano) → caducada con el motivo "ya contiene el cambio"', async () => {
    const p = await api.ia.propuestas.proponer({
      uri: uriAbap(RUTA_F01).toString(),
      resumen: 'Reescribir',
      entrada: { textoCompleto: CON_COMENTARIO },
      textoBase: ARCHIVOS[RUTA_F01],
      textoPropuesto: CON_COMENTARIO,
    });
    await escribirPorDocumento(RUTA_F01, CON_COMENTARIO);
    const decision = await api.ia.propuestas.aplicar(p.id);
    assert.deepStrictEqual(decision, { id: p.id, estado: 'rechazado', motivo: MSG_YA_APLICADO });
    assert.strictEqual(api.ia.registroPropuestas.obtener(p.id)?.estado, 'caducada');
    assert.ok(!hayDiffAbierto(), 'el diff sigue abierto');
  });

  test('si la oficial no guarda, el diff sigue abierto y el archivo sucio queda como editor activo', async () => {
    const registro = api.ia.registroPropuestas;
    const gestor = new GestorPropuestas(registro, new ProveedorDocumentoPropuesta(registro), {
      abrirDocumento: (u) => vscode.workspace.openTextDocument(u),
      aplicarEdicion: (e) => vscode.workspace.applyEdit(e),
      guardar: () => Promise.resolve(false),
      mostrarDiff: (i, d, t) => vscode.commands.executeCommand<void>('vscode.diff', i, d, t),
      mostrarDocumento: (doc) => vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false }),
      pedirMotivo: () => Promise.resolve(undefined),
    });
    const p = await gestor.proponer({
      uri: uriAbap(RUTA_F01).toString(),
      resumen: 'Añadir comentario',
      entrada: { cambios: [{ buscar: 'FORM calcular.', reemplazar: 'FORM calcular.\n  " hola' }] },
      textoBase: ARCHIVOS[RUTA_F01],
      textoPropuesto: CON_COMENTARIO,
    });
    assert.deepStrictEqual(await gestor.aplicar(p.id), { id: p.id, estado: 'aplicado', motivo: MSG_SIN_GUARDAR });
    const activo = vscode.window.activeTextEditor?.document;
    assert.strictEqual(activo?.uri.toString(), uriAbap(RUTA_F01).toString(), 'el archivo sin guardar no es el editor activo');
    assert.ok(activo.isDirty, 'el documento debería quedar con la edición sin guardar');
    const diffDeLaPropuesta = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .some((t) => t.input instanceof vscode.TabInputTextDiff && idDeUriPropuesta(t.input.modified) === p.id);
    assert.ok(diffDeLaPropuesta, 'el diff de la propuesta se cerró');
    gestor.dispose();
    await escribirPorDocumento(RUTA_F01, ARCHIVOS[RUTA_F01]);
  });

  test('si el diff no se abre, la propuesta no queda pendiente: caducada con motivo y el error sube', async () => {
    const registro = new RegistroPropuestas({ generarId: () => 'abcd1234' });
    const gestor = new GestorPropuestas(registro, new ProveedorDocumentoPropuesta(registro), {
      abrirDocumento: (u) => vscode.workspace.openTextDocument(u),
      aplicarEdicion: (e) => vscode.workspace.applyEdit(e),
      guardar: (doc) => doc.save(),
      mostrarDiff: () => Promise.reject(new Error('sin diff')),
      mostrarDocumento: () => Promise.resolve(),
      pedirMotivo: () => Promise.resolve(undefined),
    });
    await assert.rejects(
      gestor.proponer({
        uri: uriAbap(RUTA_F01).toString(),
        resumen: 'Añadir comentario',
        entrada: { textoCompleto: CON_COMENTARIO },
        textoBase: ARCHIVOS[RUTA_F01],
        textoPropuesto: CON_COMENTARIO,
      }),
      /sin diff/,
    );
    assert.strictEqual(registro.pendientes.length, 0);
    assert.strictEqual(registro.obtener('abcd1234')?.estado, 'caducada');
    assert.strictEqual(registro.obtener('abcd1234')?.motivo, MSG_SIN_DIFF);
    gestor.dispose();
  });

  test('la vista Actividad marca solo las propuestas pendientes con el contexto de Aplicar/Rechazar en línea', () => {
    const base = { uri: uriAbap(RUTA_F01).toString(), resumen: 'r', entrada: { textoCompleto: 'b' }, textoBase: 'a', textoPropuesto: 'b', creada: 0 };
    const proveedor = new ProveedorActividad(new RegistroActividad(), () => undefined, () => ({
      pendientes: [{ ...base, id: 'p1', estado: 'pendiente' }],
      decididas: [{ ...base, id: 'p2', estado: 'aplicada' }],
    }));
    const [, seccion] = proveedor.getChildren();
    assert.deepStrictEqual(
      seccion.hijos.map((n) => proveedor.getTreeItem(n).contextValue),
      [CONTEXTO_PROPUESTA_PENDIENTE, 'propuesta'],
    );
    proveedor.dispose();
  });

  test('rechazar con motivo deja la propuesta rechazada con ese motivo; aplicar después no vale', async () => {
    const p = await proponerComentario();
    const rechazo = await api.ia.propuestas.rechazar(p.id, 'prefiero otro nombre');
    assert.deepStrictEqual(rechazo, { id: p.id, estado: 'rechazado', motivo: 'prefiero otro nombre' });
    assert.ok(!hayDiffAbierto(), 'el diff sigue abierto');
    const despues = await api.ia.propuestas.aplicar(p.id);
    assert.deepStrictEqual(despues, rechazo);
    assert.strictEqual(contenidoFalso(RUTA_F01), ARCHIVOS[RUTA_F01]);
    assert.ok(!(await vscode.workspace.openTextDocument(uriAbap(RUTA_F01))).isDirty);
  });

  test('rechazar sin motivo lo pide: Escape la deja pendiente con el diff abierto; Aceptar vacío rechaza sin motivo', async function () {
    this.timeout(15_000);
    const p = await proponerComentario();
    const cancelado = await insistirHasta(api.ia.propuestas.rechazar(p.id), () =>
      vscode.commands.executeCommand('workbench.action.closeQuickOpen'),
    );
    assert.deepStrictEqual(cancelado, { id: p.id, estado: 'pendiente' });
    assert.ok(hayDiffAbierto(), 'Escape cerró el diff');
    const rechazado = await insistirHasta(api.ia.propuestas.rechazar(p.id), () =>
      vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem'),
    );
    assert.deepStrictEqual(rechazado, { id: p.id, estado: 'rechazado' });
    assert.ok(!hayDiffAbierto(), 'el diff sigue abierto');
  });

  test('un guardado que lanza deja la propuesta aplicada con el motivo "sin guardar" y el documento sucio', async () => {
    // Gestor aparte sin registrar proveedor (el esquema ya lo tiene el cableado): solo cambia `guardar`.
    const registro = new RegistroPropuestas();
    const gestor = new GestorPropuestas(registro, new ProveedorDocumentoPropuesta(registro), {
      abrirDocumento: (u) => vscode.workspace.openTextDocument(u),
      aplicarEdicion: (e) => vscode.workspace.applyEdit(e),
      guardar: () => Promise.reject(new Error('guardado imposible')),
      mostrarDiff: () => Promise.resolve(),
      mostrarDocumento: () => Promise.resolve(),
      pedirMotivo: () => Promise.resolve(undefined),
    });
    const p = registro.crear({
      uri: uriAbap(RUTA_F01).toString(),
      resumen: 'Añadir comentario',
      entrada: { cambios: [{ buscar: 'FORM calcular.', reemplazar: 'FORM calcular.\n  " hola' }] },
      textoBase: ARCHIVOS[RUTA_F01],
      textoPropuesto: CON_COMENTARIO,
    });
    assert.deepStrictEqual(await gestor.aplicar(p.id), { id: p.id, estado: 'aplicado', motivo: MSG_SIN_GUARDAR });
    const doc = await vscode.workspace.openTextDocument(uriAbap(RUTA_F01));
    assert.strictEqual(doc.getText(), CON_COMENTARIO);
    assert.ok(doc.isDirty, 'el documento debería quedar con la edición sin guardar');
    assert.strictEqual(contenidoFalso(RUTA_F01), ARCHIVOS[RUTA_F01]);
    gestor.dispose();
    await escribirPorDocumento(RUTA_F01, ARCHIVOS[RUTA_F01]);
  });

  test('una propuesta desconocida no cambia nada', async () => {
    assert.strictEqual((await api.ia.propuestas.aplicar(ID_DESCONOCIDO)).estado, 'desconocida');
    assert.strictEqual((await api.ia.propuestas.rechazar(ID_DESCONOCIDO, 'x')).estado, 'desconocida');
    assert.strictEqual(await api.ia.propuestas.abrirDiff(ID_DESCONOCIDO), false);
    assert.strictEqual(await textoDePropuesta(ID_DESCONOCIDO), '* Propuesta desconocida');
  });

  test('abrirPropuesta con el nodo de una pendiente vuelve a abrir su diff', async () => {
    const p = await proponerComentario();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    assert.ok(!hayDiffAbierto());
    await vscode.commands.executeCommand(COMANDOS_IA.abrirPropuesta, { propuestaId: p.id });
    assert.strictEqual(idDeUriPropuesta(ladoDerechoDelDiff() ?? vscode.Uri.parse('x:/')), p.id);
    await vscode.commands.executeCommand(COMANDOS_IA.rechazarPropuesta, { propuestaId: p.id }, '');
    assert.strictEqual(api.ia.registroPropuestas.obtener(p.id)?.estado, 'rechazada');
  });
});

suite('IA: lanzar un comando de la oficial sin esperar a su lista', () => {
  test('un comando que sigue en curso devuelve el control al vencer el margen', async () => {
    const inicio = Date.now();
    await lanzarSinEsperar(new Promise<void>(() => undefined), 30);
    assert.ok(Date.now() - inicio < 2000, 'se quedó esperando al comando');
  });

  test('un fallo dentro del margen se propaga', async () => {
    await assert.rejects(lanzarSinEsperar(Promise.reject(new Error('sin la extensión oficial')), 1000), /extensión oficial/);
  });

  test('un comando que termina enseguida no espera al margen', async () => {
    const inicio = Date.now();
    await lanzarSinEsperar(Promise.resolve(), 5000);
    assert.ok(Date.now() - inicio < 2000, 'esperó el margen completo');
  });

  test('un fallo posterior al margen no queda como rechazo sin atender', async () => {
    let fallar: (err: Error) => void = () => undefined;
    const lanzamiento = new Promise<void>((_resolver, rechazar) => {
      fallar = rechazar;
    });
    await lanzarSinEsperar(lanzamiento, 10);
    fallar(new Error('tardío'));
    await new Promise((resolver) => setTimeout(resolver, 20));
  });
});
