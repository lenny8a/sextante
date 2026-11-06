import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConexionAdt } from '../../src/adt/conexion-adt';
import { analizarDataPreview } from '../../src/adt/transaccion';
import type { PeticionAdt, RespuestaAdt, TransporteAdt } from '../../src/adt/transporte';
import { SELECTOR_DICCIONARIO, registrarHoverDiccionario, type DependenciasHover } from '../../src/diccionario/hover';
import type { ResultadoBusqueda } from '../../src/adt/busqueda-modelo';
import type { NodoDiccionario } from '../../src/diccionario/panel-modelo';
import {
  PanelDiccionario,
  RETARDO_CARGANDO_MS,
  RETARDO_CURSOR_MS,
  abrirDdl,
  abrirUso,
  conectarPanel,
  generarCaseDesde,
  type DependenciasPanel,
} from '../../src/diccionario/panel-proveedor';
import { RUTA_USOS } from '../../src/diccionario/donde-se-usa';
import { insertarEnCursor } from '../../src/diccionario/insertar';
import { COMANDO_SOLO_LECTURA_SESION } from '../../src/proteccion/comandos-solo-lectura';
import { ServicioDiccionario } from '../../src/diccionario/servicio';
import { ServicioFirmas } from '../../src/firmas/servicio';
import type { ApiDePrueba } from '../../src/extension';

const CONTENIDO = ['REPORT zejemplo.', 'SELECT SINGLE * FROM mara INTO @DATA(ls_mara).', ''].join('\n');
const FILA_SELECT = 1;
const SEPARADOR = '\n---\n';
/**
 * Sin la extensión oficial no existe el lenguaje `abap`: un documento abierto con `language: 'abap'` queda en
 * plaintext. El proveedor se registra aquí para plaintext; `destinoDe` limita el hover a los documentos de cada caso.
 */
const LENGUAJE_PRUEBA = 'plaintext';
const SELECTOR_PRUEBA: vscode.DocumentFilter = { language: LENGUAJE_PRUEBA, scheme: 'untitled' };
const COLUMNA_MARA = CONTENIDO.split('\n')[FILA_SELECT].indexOf('mara') + 1;

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function escaparXml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Data Preview sintético en el formato de las respuestas reales (como en test/unit/diccionario-servicio.test.ts). */
function dataPreview(filas: Record<string, string>[]): string {
  const columnas = Object.keys(filas[0] ?? {});
  const bloques = columnas.map((c) =>
    `<dataPreview:columns><dataPreview:metadata dataPreview:name="${c}"/><dataPreview:dataSet>` +
    filas.map((f) => `<dataPreview:data>${escaparXml(f[c] ?? '')}</dataPreview:data>`).join('') +
    '</dataPreview:dataSet></dataPreview:columns>');
  return `<?xml version="1.0" encoding="utf-8"?><dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">${bloques.join('')}</dataPreview:tableData>`;
}

/** dd03vt-mara.xml se grabó sin la columna DDLANGUAGE: se añade 'E' a cada fila. */
function dd03vtMara(): string {
  return dataPreview(analizarDataPreview(fixture('dd03vt-mara.xml')).map((f) => ({ ...f, DDLANGUAGE: 'E' })));
}

/** Segunda tabla para el panel: los metadatos de MARA con otro nombre. */
const OTRA_TABLA = 'ZTABLA_EJEMPLO';

function responder(p: PeticionAdt): RespuestaAdt {
  if (p.metodo === 'GET') {
    if (p.ruta === '/sap/bc/adt/ddic/tables/mara') {
      return { estado: 200, cuerpo: fixture('tabla-mara.xml') };
    }
    if (p.ruta === '/sap/bc/adt/ddic/structures/bapiret2') {
      return { estado: 200, cuerpo: fixture('estructura-bapiret2.xml') };
    }
    if (p.ruta === `/sap/bc/adt/ddic/tables/${OTRA_TABLA.toLowerCase()}`) {
      return { estado: 200, cuerpo: fixture('tabla-mara.xml').replace('adtcore:name="MARA"', `adtcore:name="${OTRA_TABLA}"`) };
    }
    return { estado: 404, cuerpo: '' };
  }
  const sql = p.cuerpo ?? '';
  if (sql.endsWith(' FROM MARA')) {
    return { estado: 200, cuerpo: fixture('dp-mara-datos.xml') };
  }
  if (sql.endsWith(` FROM ${OTRA_TABLA}`)) {
    return { estado: 400, cuerpo: fixture('dp-sql-malo.xml') };
  }
  if (sql.includes('FROM DD03VT')) {
    return { estado: 200, cuerpo: dd03vtMara() };
  }
  if (sql.includes('FROM DD03L')) {
    return { estado: 200, cuerpo: fixture('dd03l-mara.xml') };
  }
  return { estado: 200, cuerpo: fixture('dp-sin-filas.xml') };
}

function servicioConFixtures(): ServicioDiccionario {
  const transporte: TransporteAdt = { peticion: async (p) => responder(p) };
  const conexion = new ConexionAdt(transporte);
  return new ServicioDiccionario({ conexion: async () => conexion, idiomaDe: () => 'E' });
}

function textoDe(hovers: vscode.Hover[]): string[] {
  return hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value)));
}

async function hoversEn(uri: vscode.Uri, posicion: vscode.Position): Promise<string[]> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, posicion);
  return textoDe(hovers ?? []);
}

suite('Hover del diccionario', () => {
  const contexto = { subscriptions: [] as vscode.Disposable[] };
  const conConexion = new Set<string>();
  const sinConexion = new Set<string>();
  const abriendoSesion = new Set<string>();

  /** Sin conexión para las firmas: estos documentos no tienen llamadas. */
  function registrar(uris: Set<string>, deps: Omit<DependenciasHover, 'destinoDe' | 'firmas'>): void {
    const firmas = new ServicioFirmas({ conexion: async () => undefined, idiomaDe: () => 'E' });
    registrarHoverDiccionario(contexto, { ...deps, firmas, destinoDe: (uri) => (uris.has(uri.toString()) ? 'DEST' : undefined) }, SELECTOR_PRUEBA);
  }

  async function documento(uris: Set<string>): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: CONTENIDO });
    uris.add(doc.uri.toString());
    return doc;
  }

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('lenny.sextante');
    assert.ok(ext, 'extensión no encontrada');
    await ext.activate();
    registrar(conConexion, { servicio: servicioConFixtures(), credencialGuardada: async () => true });
    registrar(sinConexion, {
      servicio: new ServicioDiccionario({ conexion: async () => undefined, idiomaDe: () => 'E' }),
      credencialGuardada: async () => false,
    });
    registrar(abriendoSesion, {
      servicio: new ServicioDiccionario({ conexion: async () => undefined, idiomaDe: () => 'E' }),
      credencialGuardada: async () => true,
    });
  });

  suiteTeardown(() => {
    for (const d of contexto.subscriptions) {
      d.dispose();
    }
  });

  test('sobre la tabla del FROM devuelve el hover con la cabecera de MARA', async () => {
    const doc = await documento(conConexion);
    assert.strictEqual(doc.languageId, LENGUAJE_PRUEBA);
    const textos = await hoversEn(doc.uri, new vscode.Position(FILA_SELECT, COLUMNA_MARA));
    const nuestro = textos.find((t) => t.includes('**MARA**'));
    assert.ok(nuestro, textos.join(SEPARADOR));
    assert.ok(nuestro.includes('Tabla transparente'), nuestro);
    assert.ok(nuestro.includes('| 🔑 | Campo | Elem. datos | Tipo | Texto |'), nuestro);
    assert.ok(nuestro.includes('command:abapNavigator.diccionario.abrir?'), nuestro);
  });

  test('sobre SELECT no hay hover del diccionario', async () => {
    const doc = await documento(conConexion);
    const textos = await hoversEn(doc.uri, new vscode.Position(FILA_SELECT, 2));
    assert.ok(textos.every((t) => !t.includes('**MARA**')), textos.join(SEPARADOR));
  });

  test('en producción el hover se registra para el lenguaje abap de la oficial', () => {
    assert.deepStrictEqual(SELECTOR_DICCIONARIO, { language: 'abap' });
  });

  test('un documento sin destino no tiene hover del diccionario', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: CONTENIDO });
    const textos = await hoversEn(doc.uri, new vscode.Position(FILA_SELECT, COLUMNA_MARA));
    assert.ok(textos.every((t) => !t.includes('**MARA**') && !t.includes('Conéctate')), textos.join(SEPARADOR));
  });

  test('sin conexión y sin credencial guardada devuelve el enlace para conectarse', async () => {
    const doc = await documento(sinConexion);
    const textos = await hoversEn(doc.uri, new vscode.Position(FILA_SELECT, COLUMNA_MARA));
    const nuestro = textos.find((t) => t.includes('Conéctate al sistema para ver el diccionario'));
    assert.ok(nuestro, textos.join(SEPARADOR));
    assert.ok(nuestro.includes('command:abapNavigator.diccionario.conectar?'), nuestro);
  });

  test('el hover real de la activación no responde en un documento abap sin destino', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'abap', content: CONTENIDO });
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', doc.uri, new vscode.Position(FILA_SELECT, COLUMNA_MARA),
    );
    const textos = textoDe(hovers ?? []);
    assert.ok(textos.every((t) => !t.includes('**') && !t.includes('Conéctate')), textos.join(SEPARADOR));
  });

  test('en la activación real, destinoDe solo da destinos rfc sin SSO ni SNC y con el puente disponible', async () => {
    const api = (await vscode.extensions.getExtension<ApiDePrueba>('lenny.sextante')?.activate()) as ApiDePrueba;
    const ruta = (id: string): vscode.Uri =>
      vscode.Uri.from({ scheme: 'abap', path: `/repotree-v1/${id}/System Library/ZPAQ1/Programas/Programas/ZR_EJEMPLO/zr_ejemplo.prog.abap` });
    const esperado = api.puente.disponible().ok ? 'DEV-X' : undefined;
    assert.strictEqual(api.diccionario.destinoDe(ruta('DEV-X')), esperado);
    assert.strictEqual(api.diccionario.destinoDe(ruta('QAS-X')), undefined, 'QAS-X tiene SSO');
    assert.strictEqual(api.diccionario.destinoDe(ruta('NOEXISTE-X')), undefined);
    assert.strictEqual(api.diccionario.destinoDe(vscode.Uri.parse('untitled:Untitled-1')), undefined);
  });

  test('sin conexión pero con credencial guardada (sesión abriéndose) no devuelve hover esta vez', async () => {
    const doc = await documento(abriendoSesion);
    const textos = await hoversEn(doc.uri, new vscode.Position(FILA_SELECT, COLUMNA_MARA));
    assert.ok(textos.every((t) => !t.includes('**MARA**') && !t.includes('Conéctate')), textos.join(SEPARADOR));
  });
});

const COMANDOS_PANEL = [
  'abrir', 'fijar', 'soltar', 'refrescar', 'copiarNombre', 'abrirDdl', 'conectar', 'verDatos', 'masDatos', 'ocultarDatos',
  'dondeSeUsa', 'ocultarUsos', 'anadirPrefijoPropio', 'abrirUso', 'generarTypes', 'generarSelect', 'generarData', 'generarTablaInterna',
].map((c) => `abapNavigator.diccionario.${c}`);
const CONTENIDO_PANEL = [
  'REPORT zejemplo.',
  'SELECT SINGLE * FROM mara INTO @DATA(ls_mara).',
  `SELECT SINGLE * FROM ${OTRA_TABLA.toLowerCase()} INTO @DATA(ls_otra).`,
  '',
].join('\n');
const FILA_OTRA = 2;
const ESPERA_MAXIMA_MS = 1_000;

interface VistaJson { id: string; name: string }
interface PaqueteJson {
  contributes: {
    views: Record<string, VistaJson[]>;
    commands: { command: string; icon?: string }[];
    menus: Record<string, { command: string; when?: string; group?: string }[]>;
  };
}

function leerPaquete(): PaqueteJson {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as PaqueteJson;
}

async function esperar(ms: number): Promise<void> {
  await new Promise((resolver) => setTimeout(resolver, ms));
}

type NodoCampo = Extract<NodoDiccionario, { clase: 'campo' }>;

const GENERADORES = ['generarTypes', 'generarSelect', 'generarData', 'generarTablaInterna'];
const ESQUEMA_SOLO_LECTURA = 'abapnavigatorpruebaro';
const CONTENIDO_SOLO_LECTURA = 'REPORT zejemplo.';

/** Sistema de archivos de un solo archivo y de solo lectura: el editor que abre no admite cambios. */
function sistemaSoloLectura(): vscode.FileSystemProvider {
  const contenido = new TextEncoder().encode(CONTENIDO_SOLO_LECTURA);
  const cambios = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  const noPermitido = (): never => {
    throw vscode.FileSystemError.NoPermissions();
  };
  return {
    onDidChangeFile: cambios.event,
    watch: () => new vscode.Disposable(() => undefined),
    stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: contenido.length }),
    readDirectory: () => [],
    createDirectory: noPermitido,
    readFile: () => contenido,
    writeFile: noPermitido,
    delete: noPermitido,
    rename: noPermitido,
  };
}

suite('Panel Diccionario', () => {
  const conDestino = new Set<string>();
  const conectados: string[] = [];
  const abiertos: ResultadoBusqueda[] = [];
  let panel: PanelDiccionario;
  let deps: DependenciasPanel;
  let soloLectura: vscode.Disposable;

  function cabecera(): string | undefined {
    const primero = panel.getChildren()[0];
    return primero?.clase === 'cabecera' ? primero.objeto.nombre : undefined;
  }

  async function esperarCabecera(nombre: string): Promise<boolean> {
    const limite = Date.now() + ESPERA_MAXIMA_MS;
    while (Date.now() < limite) {
      if (cabecera() === nombre) {
        return true;
      }
      await esperar(25);
    }
    return cabecera() === nombre;
  }

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('lenny.sextante');
    assert.ok(ext, 'extensión no encontrada');
    await ext.activate();
    // La activación ya registró la vista y los comandos con el panel real: este se maneja directamente.
    deps = {
      servicio: servicioConFixtures(),
      destinoDe: (uri) => (conDestino.has(uri.toString()) ? 'DEST' : undefined),
      credencialGuardada: async () => true,
      conectar: async (destino) => {
        conectados.push(destino);
      },
      abrir: async (r) => {
        abiertos.push(r);
      },
      registrar: () => undefined,
    };
    panel = new PanelDiccionario(deps);
    soloLectura = vscode.workspace.registerFileSystemProvider(ESQUEMA_SOLO_LECTURA, sistemaSoloLectura(), { isReadonly: true });
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    panel.dispose();
    soloLectura.dispose();
  });

  test('la vista abapNavigator.diccionario existe tras Objeto y la activación registra los comandos del panel', async () => {
    const paquete = leerPaquete();
    const vistas = paquete.contributes.views.abapNavigator.map((v) => v.id);
    const indice = vistas.indexOf('abapNavigator.diccionario');
    assert.ok(indice >= 0, vistas.join(', '));
    assert.ok(vistas.indexOf('abapNavigator.objeto') >= 0 && vistas.indexOf('abapNavigator.objeto') < indice, vistas.join(', '));
    const declarados = paquete.contributes.commands.map((c) => c.command);
    const registrados = await vscode.commands.getCommands(true);
    for (const id of COMANDOS_PANEL) {
      assert.ok(declarados.includes(id), `no declarado: ${id}`);
      assert.ok(registrados.includes(id), `no registrado: ${id}`);
    }
  });

  test('package.json: pin/pinned según el contexto fijado y copiar/abrir en los nodos', () => {
    const menus = leerPaquete().contributes.menus;
    const titulo = menus['view/title'].filter((m) => m.when?.startsWith('view == abapNavigator.diccionario'));
    const fijar = titulo.find((m) => m.command === 'abapNavigator.diccionario.fijar');
    const soltar = titulo.find((m) => m.command === 'abapNavigator.diccionario.soltar');
    assert.ok(fijar?.when?.includes('!abapNavigator.diccionario.fijado'), JSON.stringify(fijar));
    assert.ok(soltar?.when?.includes('&& abapNavigator.diccionario.fijado'), JSON.stringify(soltar));
    assert.ok(titulo.some((m) => m.command === 'abapNavigator.diccionario.refrescar'));
    const item = menus['view/item/context'].filter((m) => m.when?.startsWith('view == abapNavigator.diccionario'));
    assert.ok(item.some((m) => m.command === 'abapNavigator.diccionario.copiarNombre' && m.when?.includes('campo')));
    assert.ok(item.some((m) => m.command === 'abapNavigator.diccionario.abrirDdl' && m.when?.includes('cabecera')));
  });

  test('package.json: verDatos en la cabecera (inline y menú) y masDatos/ocultarDatos inline en el grupo Datos', () => {
    const paquete = leerPaquete();
    const verDatos = paquete.contributes.commands.find((c) => c.command === 'abapNavigator.diccionario.verDatos');
    assert.strictEqual(verDatos?.icon, '$(table)');
    const item = paquete.contributes.menus['view/item/context'].filter((m) => m.when?.startsWith('view == abapNavigator.diccionario'));
    const de = (comando: string): { command: string; when?: string; group?: string }[] =>
      item.filter((m) => m.command === `abapNavigator.diccionario.${comando}`);
    assert.ok(de('verDatos').some((m) => m.group?.startsWith('inline') && m.when?.includes('cabecera')), JSON.stringify(de('verDatos')));
    assert.ok(de('verDatos').some((m) => !m.group?.startsWith('inline') && m.when?.includes('cabecera')), JSON.stringify(de('verDatos')));
    for (const comando of ['masDatos', 'ocultarDatos']) {
      assert.ok(de(comando).some((m) => m.group?.startsWith('inline') && m.when?.includes('viewItem == grupoDatos')), comando);
    }
  });

  test('package.json: Ver datos, más filas, ocultar datos y Generar SELECT solo con una tabla (esTabla)', () => {
    const menus = leerPaquete().contributes.menus;
    const item = menus['view/item/context'].filter((m) => m.when?.startsWith('view == abapNavigator.diccionario'));
    for (const comando of ['verDatos', 'masDatos', 'ocultarDatos', 'generarSelect']) {
      const entradas = item.filter((m) => m.command === `abapNavigator.diccionario.${comando}`);
      assert.ok(entradas.length > 0, comando);
      for (const entrada of entradas) {
        assert.ok(entrada.when?.includes('&& abapNavigator.diccionario.esTabla'), JSON.stringify(entrada));
      }
    }
    const paleta = menus.commandPalette.find((m) => m.command === 'abapNavigator.diccionario.verDatos');
    assert.strictEqual(paleta?.when, 'abapNavigator.diccionario.esTabla');
    const conDatosViejo = JSON.stringify(menus).includes('abapNavigator.diccionario.conDatos');
    assert.strictEqual(conDatosViejo, false);
  });

  test('package.json: dondeSeUsa inline en la cabecera y ocultarUsos inline en el grupo Dónde se usa', () => {
    const paquete = leerPaquete();
    const dondeSeUsa = paquete.contributes.commands.find((c) => c.command === 'abapNavigator.diccionario.dondeSeUsa');
    assert.strictEqual(dondeSeUsa?.icon, '$(references)');
    const item = paquete.contributes.menus['view/item/context'].filter((m) => m.when?.startsWith('view == abapNavigator.diccionario'));
    const de = (comando: string): { command: string; when?: string; group?: string }[] =>
      item.filter((m) => m.command === `abapNavigator.diccionario.${comando}`);
    assert.ok(de('dondeSeUsa').some((m) => m.group?.startsWith('inline') && m.when?.includes('viewItem == cabecera')), JSON.stringify(de('dondeSeUsa')));
    assert.ok(de('ocultarUsos').some((m) => m.group?.startsWith('inline') && m.when?.includes('viewItem == grupoUsos')), JSON.stringify(de('ocultarUsos')));
    const paleta = paquete.contributes.menus.commandPalette;
    for (const comando of ['ocultarUsos', 'anadirPrefijoPropio', 'abrirUso']) {
      assert.ok(paleta.some((m) => m.command === `abapNavigator.diccionario.${comando}` && m.when === 'false'), comando);
    }
  });

  test('package.json: los cuatro generadores en el menú de cabecera, grupo, include y campo, ocultos en la paleta', () => {
    const paquete = leerPaquete();
    const item = paquete.contributes.menus['view/item/context'].filter((m) => m.when?.startsWith('view == abapNavigator.diccionario'));
    const paleta = paquete.contributes.menus.commandPalette;
    for (const comando of GENERADORES) {
      const id = `abapNavigator.diccionario.${comando}`;
      const entradas = item.filter((m) => m.command === id);
      assert.strictEqual(entradas.length, 1, comando);
      assert.ok(entradas[0].group?.startsWith('3_generar@'), JSON.stringify(entradas[0]));
      assert.ok(entradas[0].when?.includes('viewItem =~ /^(cabecera|grupoCampos|include|campo|campoConValores)$/'), JSON.stringify(entradas[0]));
      const contexto = comando === 'generarSelect' ? 'abapNavigator.diccionario.esTabla' : 'abapNavigator.diccionario.conCampos';
      assert.ok(entradas[0].when?.includes(contexto), JSON.stringify(entradas[0]));
      assert.ok(paleta.some((m) => m.command === id && m.when === 'false'), comando);
    }
  });

  test('insertarEnCursor tras «    DATA x.» indenta las líneas siguientes con 4 espacios', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: '    DATA x.' });
    const editor = await vscode.window.showTextDocument(doc);
    const fin = doc.lineAt(0).range.end;
    editor.selection = new vscode.Selection(fin, fin);
    assert.strictEqual(await insertarEnCursor('uno\ndos\ntres'), true);
    assert.deepStrictEqual(doc.getText().split(/\r?\n/), ['    DATA x.uno', '    dos', '    tres']);
  });

  test('insertarEnCursor en un editor de solo lectura devuelve false sin lanzar', async () => {
    const uri = vscode.Uri.parse(`${ESQUEMA_SOLO_LECTURA}:/ejemplo.txt`);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    assert.strictEqual(await insertarEnCursor('DATA y.'), false);
    assert.strictEqual(doc.getText(), CONTENIDO_SOLO_LECTURA);
  });

  test('insertarEnCursor en un editor de solo lectura de la sesión (protección QAS/PRD) devuelve false', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: 'REPORT zejemplo.' });
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand(COMANDO_SOLO_LECTURA_SESION);
    assert.strictEqual(await insertarEnCursor('DATA y.'), false);
    assert.strictEqual(doc.getText(), 'REPORT zejemplo.');
  });

  test('generarTypes con dos campos seleccionados genera exactamente esos dos, en el orden del catálogo', async () => {
    await panel.mostrar('DEST', 'MARA');
    const [, grupo] = panel.getChildren();
    const campos = panel.getChildren(grupo).filter((n): n is NodoCampo => n.clase === 'campo');
    const mtart = campos.find((n) => n.campo.nombre === 'MTART');
    const matnr = campos.find((n) => n.campo.nombre === 'MATNR');
    assert.ok(mtart && matnr);
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: '' });
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('abapNavigator.diccionario.generarTypes', mtart, [mtart, matnr]);
    const finDeLinea = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    assert.strictEqual(
      doc.getText().split(finDeLinea).join('\n'),
      'TYPES: BEGIN OF ty_mara,\n         matnr TYPE mara-matnr,\n         mtart TYPE mara-mtart,\n       END OF ty_mara.',
    );
  });

  test('verDatos sobre MARA añade el grupo Datos con las filas y ocultarDatos lo quita', async () => {
    await panel.mostrar('DEST', 'MARA');
    await panel.verDatos();
    const raiz = panel.getChildren();
    assert.deepStrictEqual(raiz.map((n) => n.clase), ['cabecera', 'grupoCampos', 'grupoDatos']);
    const grupo = panel.getTreeItem(raiz[2]);
    assert.strictEqual(grupo.label, 'Datos (5 de 43)');
    assert.strictEqual(grupo.contextValue, 'grupoDatos');
    const filas = panel.getChildren(raiz[2]);
    assert.strictEqual(filas.length, 5);
    const celdas = panel.getChildren(filas[0]);
    assert.deepStrictEqual(celdas.map((c) => panel.getTreeItem(c).label), ['MATNR', 'MTART', 'MATKL', 'MEINS']);
    panel.ocultarDatos();
    assert.deepStrictEqual(panel.getChildren().map((n) => n.clase), ['cabecera', 'grupoCampos']);
  });

  test('verDatos sobre una estructura no pide filas: sin grupo Datos y los generadores siguen con su catálogo', async () => {
    await panel.mostrar('DEST', 'BAPIRET2');
    assert.strictEqual(cabecera(), 'BAPIRET2');
    assert.strictEqual(panel.esTabla(), false);
    await panel.verDatos();
    assert.deepStrictEqual(panel.getChildren().map((n) => n.clase), ['cabecera', 'grupoCampos']);
    assert.ok(panel.objetoConCampos() !== undefined);
    await panel.mostrar('DEST', 'MARA');
    assert.strictEqual(panel.esTabla(), true);
  });

  test('cambiar de objeto quita los datos', async () => {
    await panel.mostrar('DEST', 'MARA');
    await panel.verDatos();
    await panel.mostrar('DEST', OTRA_TABLA);
    assert.deepStrictEqual(panel.getChildren().map((n) => n.clase), ['cabecera', 'grupoCampos']);
    await panel.mostrar('DEST', 'MARA');
    assert.deepStrictEqual(panel.getChildren().map((n) => n.clase), ['cabecera', 'grupoCampos']);
  });

  test('refrescar conserva el grupo Datos y vuelve a pedir las filas', async () => {
    await panel.mostrar('DEST', 'MARA');
    await panel.verDatos();
    await panel.refrescar();
    const raiz = panel.getChildren();
    assert.deepStrictEqual(raiz.map((n) => n.clase), ['cabecera', 'grupoCampos', 'grupoDatos']);
    assert.strictEqual(panel.getTreeItem(raiz[2]).label, 'Datos (5 de 43)');
    panel.ocultarDatos();
  });

  test('un error del servidor se ve en el grupo con el mensaje legible', async () => {
    await panel.mostrar('DEST', OTRA_TABLA);
    await panel.verDatos();
    const raiz = panel.getChildren();
    const grupo = raiz.find((n) => n.clase === 'grupoDatos');
    assert.ok(grupo);
    assert.strictEqual(panel.getTreeItem(grupo).label, 'Datos (error: ErrorAdt)');
    const [hijo] = panel.getChildren(grupo);
    assert.match(String(panel.getTreeItem(hijo).label), /^Nombre de columna desconocido/);
    panel.ocultarDatos();
  });

  test("mostrar('DEST', 'MARA') produce la cabecera MARA y el grupo de campos", async () => {
    await panel.mostrar('DEST', 'MARA');
    const raiz = panel.getChildren();
    assert.deepStrictEqual(raiz.map((n) => n.clase), ['cabecera', 'grupoCampos']);
    const item = panel.getTreeItem(raiz[0]);
    assert.strictEqual(item.label, 'MARA');
    assert.ok(String(item.description).startsWith('Tabla transparente'), String(item.description));
  });

  test('copiarNombre copia MARA en la cabecera y MARA-MTART en un campo', async () => {
    await panel.mostrar('DEST', 'MARA');
    const [nodoCabecera, grupo] = panel.getChildren();
    await vscode.commands.executeCommand('abapNavigator.diccionario.copiarNombre', nodoCabecera);
    assert.strictEqual(await vscode.env.clipboard.readText(), 'MARA');
    const mtart = panel.getChildren(grupo).find((n): n is NodoCampo => n.clase === 'campo' && n.campo.nombre === 'MTART');
    assert.ok(mtart);
    await vscode.commands.executeCommand('abapNavigator.diccionario.copiarNombre', mtart);
    assert.strictEqual(await vscode.env.clipboard.readText(), 'MARA-MTART');
  });

  test('abrirDdl entrega a abrir el ResultadoBusqueda del objeto', async () => {
    await panel.mostrar('DEST', 'MARA');
    abiertos.length = 0;
    await abrirDdl(panel, deps);
    assert.strictEqual(abiertos.length, 1);
    assert.strictEqual(abiertos[0].nombre, 'MARA');
    assert.strictEqual(abiertos[0].tipo, 'TABL/DT');
    assert.strictEqual(abiertos[0].uriAdt, '/sap/bc/adt/ddic/tables/mara');
  });

  test('sin conexión el panel registra «sin datos (conectar)» una sola vez mientras no cambie el estado', async () => {
    const registros: string[] = [];
    const sinConexion = new ServicioDiccionario({ conexion: async () => undefined, idiomaDe: () => 'E' });
    const propio = new PanelDiccionario({ ...deps, servicio: sinConexion, credencialGuardada: async () => false, registrar: (m) => registros.push(m) });
    try {
      await propio.mostrar('DEST', 'MARA');
      await propio.mostrar('DEST', 'MARA');
      await propio.mostrar('DEST', 'BAPIRET2');
      assert.deepStrictEqual(registros.filter((m) => m.startsWith('Diccionario: panel → sin datos')), ['Diccionario: panel → sin datos (conectar)']);
    } finally {
      propio.dispose();
    }
  });

  test('conectar delega en la dependencia con el destino del argumento', async () => {
    conectados.length = 0;
    await conectarPanel(panel, deps, { destino: 'DEST' });
    assert.deepStrictEqual(conectados, ['DEST']);
  });

  test('un editor sin destino no cambia el panel', async () => {
    await panel.mostrar('DEST', 'MARA');
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: CONTENIDO_PANEL });
    const editor = await vscode.window.showTextDocument(doc);
    const columna = CONTENIDO_PANEL.split('\n')[FILA_OTRA].indexOf(OTRA_TABLA.toLowerCase()) + 1;
    editor.selection = new vscode.Selection(FILA_OTRA, columna, FILA_OTRA, columna);
    await esperar(RETARDO_CURSOR_MS * 3);
    assert.strictEqual(cabecera(), 'MARA');
  });

  test('fijado no sigue al cursor; al soltar cambia en ≤ 1 s', async () => {
    await panel.mostrar('DEST', 'MARA');
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: CONTENIDO_PANEL });
    conDestino.add(doc.uri.toString());
    const editor = await vscode.window.showTextDocument(doc);
    const columna = CONTENIDO_PANEL.split('\n')[FILA_OTRA].indexOf(OTRA_TABLA.toLowerCase()) + 1;
    panel.fijar(true);
    editor.selection = new vscode.Selection(FILA_OTRA, columna, FILA_OTRA, columna);
    await esperar(RETARDO_CURSOR_MS * 3);
    assert.strictEqual(cabecera(), 'MARA');
    panel.fijar(false);
    editor.selection = new vscode.Selection(FILA_OTRA, columna + 1, FILA_OTRA, columna + 1);
    assert.ok(await esperarCabecera(OTRA_TABLA), `cabecera: ${cabecera() ?? '(ninguna)'}`);
  });
});

const TABLA_LENTA = 'ZLENTA_EJEMPLO';
const TABLA_INEXISTENTE = 'ZNOEXISTE_EJEMPLO';

interface Compuerta { abrir(): void; esperar: Promise<void> }

function compuerta(): Compuerta {
  let abrir = (): void => undefined;
  const esperar = new Promise<void>((resolver) => {
    abrir = resolver;
  });
  return { abrir, esperar };
}

/** MARA al momento; TABLA_LENTA espera a la compuerta; el resto, 404. */
function servicioConLenta(lenta: Compuerta): ServicioDiccionario {
  const transporte: TransporteAdt = {
    peticion: async (p) => {
      if (p.metodo === 'GET' && p.ruta === `/sap/bc/adt/ddic/tables/${TABLA_LENTA.toLowerCase()}`) {
        await lenta.esperar;
        return { estado: 200, cuerpo: fixture('tabla-mara.xml').replace('adtcore:name="MARA"', `adtcore:name="${TABLA_LENTA}"`) };
      }
      return responder(p);
    },
  };
  const conexion = new ConexionAdt(transporte);
  return new ServicioDiccionario({ conexion: async () => conexion, idiomaDe: () => 'E' });
}

suite('Panel Diccionario: cargas que se cruzan', () => {
  const conDestino = new Set<string>();
  let lenta: Compuerta;
  let panel: PanelDiccionario;

  function primero(): NodoDiccionario | undefined {
    return panel.getChildren()[0];
  }

  function cabecera(): string | undefined {
    const nodo = primero();
    return nodo?.clase === 'cabecera' ? nodo.objeto.nombre : undefined;
  }

  setup(() => {
    lenta = compuerta();
    panel = new PanelDiccionario({
      servicio: servicioConLenta(lenta),
      destinoDe: (uri) => (conDestino.has(uri.toString()) ? 'DEST' : undefined),
      credencialGuardada: async () => true,
      registrar: () => undefined,
    });
  });

  teardown(async () => {
    lenta.abrir();
    panel.dispose();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('una carga lenta reemplazada por otra que falla vuelve a lo mostrado, nunca a «Cargando…»', async () => {
    await panel.mostrar('DEST', 'MARA');
    const cargaLenta = panel.mostrar('DEST', TABLA_LENTA);
    await esperar(RETARDO_CARGANDO_MS * 2);
    assert.strictEqual(primero()?.clase, 'vacio', 'la carga lenta muestra «Cargando…»');
    await panel.mostrar('DEST', TABLA_INEXISTENTE);
    assert.strictEqual(cabecera(), 'MARA');
    lenta.abrir();
    await cargaLenta;
    assert.strictEqual(cabecera(), 'MARA');
    await panel.mostrar('DEST', TABLA_LENTA);
    assert.strictEqual(cabecera(), TABLA_LENTA, 'la tabla lenta se puede volver a pedir');
  });

  test('una carga del cursor en vuelo al fijar no cambia la cabecera', async () => {
    await panel.mostrar('DEST', 'MARA');
    const contenido = `SELECT SINGLE * FROM ${TABLA_LENTA.toLowerCase()} INTO @DATA(ls_lenta).`;
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: contenido });
    conDestino.add(doc.uri.toString());
    const editor = await vscode.window.showTextDocument(doc);
    const columna = contenido.indexOf(TABLA_LENTA.toLowerCase()) + 1;
    editor.selection = new vscode.Selection(0, columna, 0, columna);
    await esperar(RETARDO_CURSOR_MS + RETARDO_CARGANDO_MS * 2);
    panel.fijar(true);
    lenta.abrir();
    await esperar(RETARDO_CARGANDO_MS * 2);
    assert.strictEqual(cabecera(), 'MARA');
    await panel.mostrar('DEST', TABLA_LENTA);
    assert.strictEqual(cabecera(), TABLA_LENTA, 'mostrar explícito sí actúa con el panel fijado');
  });
});

const OBJETO_PROPIO = 'Z_EJEMPLO_1';
const AVISO_ESTANDAR = 'Objeto estándar: puede tardar hasta un minuto';

interface ServicioUsos { servicio: ServicioDiccionario; peticionesUsos: PeticionAdt[]; compuertaUsos?: Compuerta }

/** MARA y Z_EJEMPLO_1 (metadatos de MARA renombrados); «dónde se usa» responde whereused-mara.xml, tras la compuerta si la hay. */
function servicioConUsos(compuertaUsos?: Compuerta): ServicioUsos {
  const peticionesUsos: PeticionAdt[] = [];
  const transporte: TransporteAdt = {
    peticion: async (p) => {
      if (p.metodo === 'POST' && p.ruta === RUTA_USOS) {
        peticionesUsos.push(p);
        await compuertaUsos?.esperar;
        return { estado: 200, cuerpo: fixture('whereused-mara.xml') };
      }
      if (p.metodo === 'GET' && p.ruta === `/sap/bc/adt/ddic/tables/${OBJETO_PROPIO.toLowerCase()}`) {
        return { estado: 200, cuerpo: fixture('tabla-mara.xml').replace('adtcore:name="MARA"', `adtcore:name="${OBJETO_PROPIO}"`) };
      }
      return responder(p);
    },
  };
  const conexion = new ConexionAdt(transporte);
  return { servicio: new ServicioDiccionario({ conexion: async () => conexion, idiomaDe: () => 'E' }), peticionesUsos, compuertaUsos };
}

suite('Panel Diccionario: dónde se usa', () => {
  let entorno: ServicioUsos;
  let panel: PanelDiccionario;
  let deps: DependenciasPanel;
  let avisos: string[];
  let respuestaAviso: boolean;
  let prefijos: string[];
  let abiertos: ResultadoBusqueda[];

  function crearPanel(compuertaUsos?: Compuerta): void {
    entorno = servicioConUsos(compuertaUsos);
    avisos = [];
    respuestaAviso = false;
    prefijos = ['Z', 'Y'];
    abiertos = [];
    deps = {
      servicio: entorno.servicio,
      destinoDe: () => undefined,
      credencialGuardada: async () => true,
      registrar: () => undefined,
      abrir: async (r) => {
        abiertos.push(r);
      },
      confirmar: async (mensaje) => {
        avisos.push(mensaje);
        return respuestaAviso;
      },
      prefijosDe: () => [...prefijos],
      anadirPrefijo: async (_destino, prefijo) => {
        prefijos.push(prefijo);
      },
    };
    panel = new PanelDiccionario(deps);
  }

  function grupoUsos(): NodoDiccionario | undefined {
    return panel.getChildren().find((n) => n.clase === 'grupoUsos');
  }

  function etiquetaGrupo(): string | undefined {
    const grupo = grupoUsos();
    return grupo === undefined ? undefined : String(panel.getTreeItem(grupo).label);
  }

  teardown(() => {
    entorno.compuertaUsos?.abrir();
    panel.dispose();
  });

  test('sobre un objeto propio no avisa y añade el grupo con los usos propios', async () => {
    crearPanel();
    await panel.mostrar('DEST', OBJETO_PROPIO);
    await panel.dondeSeUsa();
    assert.deepStrictEqual(avisos, []);
    assert.strictEqual(entorno.peticionesUsos.length, 1);
    assert.deepStrictEqual(entorno.peticionesUsos[0].parametros, { uri: `/sap/bc/adt/ddic/tables/${OBJETO_PROPIO.toLowerCase()}` });
    assert.strictEqual(etiquetaGrupo(), 'Dónde se usa (6 propios de 6.848)');
    assert.deepStrictEqual(panel.getChildren().map((n) => n.clase), ['cabecera', 'grupoCampos', 'grupoUsos']);
  });

  test('sobre MARA avisa y, al cancelar, no pide nada ni añade el grupo', async () => {
    crearPanel();
    await panel.mostrar('DEST', 'MARA');
    await panel.dondeSeUsa();
    assert.deepStrictEqual(avisos, [AVISO_ESTANDAR]);
    assert.strictEqual(entorno.peticionesUsos.length, 0);
    assert.strictEqual(grupoUsos(), undefined);
  });

  test('sobre MARA, al continuar, pide y añade el grupo', async () => {
    crearPanel();
    respuestaAviso = true;
    await panel.mostrar('DEST', 'MARA');
    await panel.dondeSeUsa();
    assert.deepStrictEqual(avisos, [AVISO_ESTANDAR]);
    assert.strictEqual(entorno.peticionesUsos.length, 1);
    assert.strictEqual(etiquetaGrupo(), 'Dónde se usa (6 propios de 6.848)');
  });

  test('añadir /ACCGO/ a propios vuelve a filtrar sin una petición nueva', async () => {
    crearPanel();
    await panel.mostrar('DEST', OBJETO_PROPIO);
    await panel.dondeSeUsa();
    const grupo = grupoUsos();
    assert.ok(grupo);
    const anadir = panel.getChildren(grupo).find((n) => n.clase === 'anadirPrefijo');
    assert.ok(anadir);
    const item = panel.getTreeItem(anadir);
    assert.strictEqual(item.label, 'Añadir /ACCGO/ a propios…');
    assert.strictEqual(item.command?.command, 'abapNavigator.diccionario.anadirPrefijoPropio');
    await panel.anadirPrefijoPropio('/ACCGO/');
    assert.deepStrictEqual(prefijos, ['Z', 'Y', '/ACCGO/']);
    assert.strictEqual(entorno.peticionesUsos.length, 1);
    assert.strictEqual(etiquetaGrupo(), 'Dónde se usa (8 propios de 6.848)');
    const nuevoGrupo = grupoUsos();
    assert.ok(nuevoGrupo);
    assert.ok(panel.getChildren(nuevoGrupo).every((n) => n.clase !== 'anadirPrefijo'));
  });

  test('añadir un prefijo con la caché del servicio ya vacía tampoco pide: filtra la lista que guarda el panel', async () => {
    crearPanel();
    await panel.mostrar('DEST', OBJETO_PROPIO);
    await panel.dondeSeUsa();
    entorno.servicio.vaciar();
    await panel.anadirPrefijoPropio('/ACCGO/');
    assert.strictEqual(entorno.peticionesUsos.length, 1);
    assert.deepStrictEqual(avisos, []);
    assert.strictEqual(etiquetaGrupo(), 'Dónde se usa (8 propios de 6.848)');
  });

  test('clic en un uso: el comando lleva el nodo y abrirUso entrega el ResultadoBusqueda', async () => {
    crearPanel();
    await panel.mostrar('DEST', OBJETO_PROPIO);
    await panel.dondeSeUsa();
    const grupo = grupoUsos();
    assert.ok(grupo);
    const tabla = panel.getChildren(grupo).find((n) => n.clase === 'tipoUso' && n.tipoAdt === 'TABL/DT');
    assert.ok(tabla);
    const [paquete] = panel.getChildren(tabla);
    const [nodoUso] = panel.getChildren(paquete);
    const item = panel.getTreeItem(nodoUso);
    assert.strictEqual(item.command?.command, 'abapNavigator.diccionario.abrirUso');
    await abrirUso(deps, item.command?.arguments?.[0]);
    assert.deepStrictEqual(abiertos, [{
      nombre: 'Z_EJEMPLO_4',
      tipo: 'TABL/DT',
      uriAdt: '/sap/bc/adt/ddic/tables/z_ejemplo_4',
      paquete: 'ZPAQ2',
      descripcion: 'Descripción de ejemplo 4',
    }]);
  });

  test('ocultarUsos quita el grupo y cambiar de objeto también', async () => {
    crearPanel();
    await panel.mostrar('DEST', OBJETO_PROPIO);
    await panel.dondeSeUsa();
    panel.ocultarUsos();
    assert.strictEqual(grupoUsos(), undefined);
    await panel.dondeSeUsa();
    assert.ok(grupoUsos());
    await panel.mostrar('DEST', 'MARA');
    assert.strictEqual(grupoUsos(), undefined);
    await panel.mostrar('DEST', OBJETO_PROPIO);
    assert.strictEqual(grupoUsos(), undefined, 'el grupo no vuelve al regresar al objeto');
  });

  test('mientras busca se ve «buscando…» y la respuesta que llega tras cambiar de objeto se descarta', async () => {
    const lenta = compuerta();
    crearPanel(lenta);
    await panel.mostrar('DEST', OBJETO_PROPIO);
    const busqueda = panel.dondeSeUsa();
    await esperar(25);
    assert.strictEqual(etiquetaGrupo(), 'Dónde se usa (buscando…)');
    await panel.mostrar('DEST', 'MARA');
    lenta.abrir();
    await busqueda;
    assert.strictEqual(grupoUsos(), undefined);
    await panel.mostrar('DEST', OBJETO_PROPIO);
    assert.strictEqual(grupoUsos(), undefined);
  });
});

/** Valores sintéticos para un dominio con valores fijos (los fixtures reales solo traen MTART, con tabla de valores). */
const VALORES_EJEMPLO = ['A', 'B', 'C'].map((v) => ({ DOMVALUE_L: v, DOMVALUE_H: '', DDLANGUAGE: 'E', DDTEXT: `Valor ${v}` }));

/** Como `responder`, con el elemento MATNR (dtel-matnr.xml) y su dominio MATNR con tres valores fijos. */
function responderConValores(p: PeticionAdt): RespuestaAdt {
  if (p.metodo === 'GET' && p.ruta === '/sap/bc/adt/ddic/dataelements/matnr') {
    return { estado: 200, cuerpo: fixture('dtel-matnr.xml') };
  }
  if (p.metodo === 'GET' && p.ruta === '/sap/bc/adt/ddic/domains/matnr') {
    return { estado: 200, cuerpo: fixture('doma-mtart.xml').replace('adtcore:name="MTART"', 'adtcore:name="MATNR"') };
  }
  if (p.metodo !== 'GET' && (p.cuerpo ?? '').includes('FROM DD07V')) {
    return { estado: 200, cuerpo: dataPreview(VALORES_EJEMPLO) };
  }
  return responder(p);
}

suite('Panel Diccionario: Generar CASE', () => {
  const registros: string[] = [];
  const preguntas: string[] = [];
  let panel: PanelDiccionario;
  let deps: DependenciasPanel;

  setup(() => {
    registros.length = 0;
    preguntas.length = 0;
    const conexion = new ConexionAdt({ peticion: async (p) => responderConValores(p) });
    deps = {
      servicio: new ServicioDiccionario({ conexion: async () => conexion, idiomaDe: () => 'E' }),
      destinoDe: () => undefined,
      credencialGuardada: async () => true,
      registrar: (m) => registros.push(m),
      preguntar: async (mensaje) => {
        preguntas.push(mensaje);
        return undefined;
      },
    };
    panel = new PanelDiccionario(deps);
  });

  teardown(async () => {
    panel.dispose();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  async function campoDeMara(nombre: string): Promise<NodoCampo> {
    await panel.mostrar('DEST', 'MARA');
    const [, grupo] = panel.getChildren();
    const nodo = panel.getChildren(grupo).find((n): n is NodoCampo => n.clase === 'campo' && n.campo.nombre === nombre);
    assert.ok(nodo, nombre);
    return nodo;
  }

  async function editorVacio(): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: '' });
    await vscode.window.showTextDocument(doc);
    return doc;
  }

  function textoDe(doc: vscode.TextDocument): string {
    return doc.getText().split(doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n').join('\n');
  }

  test('seleccionar un campo carga su dominio, refresca solo ese nodo y lo marca campoConValores sin cambiar la cabecera', async () => {
    const matnr = await campoDeMara('MATNR');
    assert.strictEqual(panel.getTreeItem(matnr).contextValue, 'campo');
    const refrescados: unknown[] = [];
    const suscripcion = panel.onDidChangeTreeData((n) => refrescados.push(n));
    await panel.seleccionar([matnr]);
    suscripcion.dispose();
    assert.strictEqual(panel.getTreeItem(matnr).contextValue, 'campoConValores');
    assert.deepStrictEqual(refrescados, [matnr]);
    const primero = panel.getChildren()[0];
    assert.strictEqual(primero?.clase === 'cabecera' ? primero.objeto.nombre : undefined, 'MARA');
    assert.ok(registros.includes('Diccionario: campo → con valores fijos'), registros.join('\n'));
    const mtart = await campoDeMara('MTART');
    await panel.seleccionar([mtart]);
    assert.strictEqual(panel.getTreeItem(mtart).contextValue, 'campo');
  });

  test('generarCase sobre un campo aún sin cargar carga su dominio al momento e inserta el CASE', async () => {
    const matnr = await campoDeMara('MATNR');
    const doc = await editorVacio();
    await generarCaseDesde(panel, deps, matnr);
    assert.strictEqual(textoDe(doc), [
      'CASE lv_matnr.',
      `  WHEN 'A'.  " Valor A`,
      `  WHEN 'B'.  " Valor B`,
      `  WHEN 'C'.  " Valor C`,
      '  WHEN OTHERS.',
      'ENDCASE.',
    ].join('\n'));
  });

  test('generarCase sobre un campo sin elemento ni dominio no inserta nada', async () => {
    const mtart = await campoDeMara('MTART');
    const doc = await editorVacio();
    await generarCaseDesde(panel, deps, mtart);
    assert.strictEqual(doc.getText(), '');
  });

  test('un dominio de más de 50 valores pregunta y, sin «Generar», no inserta', async () => {
    const valores = Array.from({ length: 51 }, (_, i) => ({ valor: `V${i}`, texto: '' }));
    const doc = await editorVacio();
    await generarCaseDesde(panel, deps, { clase: 'dominio', dominio: { nombre: 'ZDOM_EJEMPLO', descripcion: '', tipo: 'CHAR', longitud: 4, valores } });
    assert.deepStrictEqual(preguntas, ['El dominio ZDOM_EJEMPLO tiene 51 valores. ¿Generar el CASE igual?']);
    assert.strictEqual(doc.getText(), '');
  });
});
