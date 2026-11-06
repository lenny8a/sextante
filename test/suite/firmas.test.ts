import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConexionAdt } from '../../src/adt/conexion-adt';
import type { PeticionAdt, RespuestaAdt } from '../../src/adt/transporte';
import { registrarHoverDiccionario, resolverHover, type DependenciasHover } from '../../src/diccionario/hover';
import { COMANDO_GENERAR_CASE } from '../../src/diccionario/hover-modelo';
import { insertarSnippetEnCursor } from '../../src/diccionario/insertar';
import type { Dominio } from '../../src/diccionario/modelo';
import { PanelDiccionario, generarCaseDesde, type DependenciasPanel } from '../../src/diccionario/panel-proveedor';
import { ServicioDiccionario } from '../../src/diccionario/servicio';
import { COMANDO_ABRIR_FIRMA, COMANDO_INSERTAR_LLAMADA, type PeticionInsertar } from '../../src/firmas/hover-modelo';
import { ServicioFirmas } from '../../src/firmas/servicio';
import type { ApiDePrueba } from '../../src/extension';
import { COMANDO_SOLO_LECTURA_SESION } from '../../src/proteccion/comandos-solo-lectura';

/** Sin la extensión oficial no hay lenguaje `abap`: el hover se registra para plaintext, como en diccionario.test.ts. */
const LENGUAJE_PRUEBA = 'plaintext';
const SELECTOR_PRUEBA: vscode.DocumentFilter = { language: LENGUAJE_PRUEBA, scheme: 'untitled' };
const FUNCION = 'DDIF_FIELDINFO_GET';
const LLAMADA = `CALL FUNCTION '${FUNCION}'.`;

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

const CLASE = 'CL_SALV_TABLE';
const METODO = 'FACTORY';

/** `<tabla> <objeto>` de la consulta → fixture real (como en test/unit/firmas-servicio.test.ts); el resto, sin filas. */
const SQL_FIXTURE: Readonly<Record<string, string>> = {
  [`FUPARAREF ${FUNCION}`]: 'firma-fupararef.xml',
  [`FUNCT ${FUNCION}`]: 'firma-funct.xml',
  [`TFTIT ${FUNCION}`]: 'firma-tftit.xml',
  [`TFDIR ${FUNCION}`]: 'firma-tfdir.xml',
  [`SEOCOMPODF ${CLASE}`]: 'firma-seocompodf.xml',
  [`SEOSUBCODF ${CLASE}`]: 'firma-seosubcodf.xml',
  [`SEOSUBCO ${CLASE}`]: 'firma-seosubco.xml',
  [`SEOSUBCOTX ${CLASE}`]: 'firma-seosubcotx.xml',
  [`SEOCOMPOTX ${CLASE}`]: 'firma-seocompotx.xml',
  [`SEOMETAREL ${CLASE}`]: 'firma-seometarel.xml',
};

function responder(p: PeticionAdt): RespuestaAdt {
  if (p.metodo === 'GET') {
    return { estado: 404, cuerpo: '' };
  }
  const sql = p.cuerpo ?? '';
  const tabla = /FROM (\w+)/.exec(sql)?.[1] ?? '';
  const objeto = /(?:CLSNAME|FUNCNAME) = '([^']+)'/.exec(sql)?.[1] ?? '';
  return { estado: 200, cuerpo: fixture(SQL_FIXTURE[`${tabla} ${objeto}`] ?? 'dp-sin-filas.xml') };
}

function firmasConFixtures(): ServicioFirmas {
  const conexion = new ConexionAdt({ peticion: async (p) => responder(p) });
  return new ServicioFirmas({ conexion: async () => conexion, idiomaDe: () => 'E' });
}

function textoDe(doc: vscode.TextDocument): string[] {
  return doc.getText().split(doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
}

async function textosHover(doc: vscode.TextDocument, posicion: vscode.Position): Promise<string[]> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, posicion);
  return (hovers ?? []).flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value)));
}

async function editorCon(contenido: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: contenido });
  await vscode.window.showTextDocument(doc);
  return doc;
}

/** Valores A0, B1, C2…: distintos y válidos como literal ABAP. */
function dominioCon(nombre: string, total: number): Dominio {
  const valores = Array.from({ length: total }, (_, i) => ({ valor: `${String.fromCharCode(65 + (i % 26))}${i}`, texto: '' }));
  return { nombre, descripcion: '', tipo: 'CHAR', longitud: 4, valores };
}

suite('Firmas: hover e Insertar llamada', () => {
  const contexto = { subscriptions: [] as vscode.Disposable[] };
  const conDestino = new Set<string>();
  const depsHover: DependenciasHover = {
    servicio: new ServicioDiccionario({ conexion: async () => undefined, idiomaDe: () => 'E' }),
    firmas: firmasConFixtures(),
    destinoDe: (uri) => (conDestino.has(uri.toString()) ? 'DEST' : undefined),
    credencialGuardada: async () => true,
  };
  let api: ApiDePrueba;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<ApiDePrueba | undefined>('lenny.sextante');
    assert.ok(ext, 'extensión no encontrada');
    const activada = await ext.activate();
    assert.ok(activada, 'la extensión no expone el cableado en modo de pruebas');
    api = activada;
    registrarHoverDiccionario(contexto, depsHover, SELECTOR_PRUEBA);
  });

  suiteTeardown(() => {
    for (const d of contexto.subscriptions) {
      d.dispose();
    }
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('hover sobre CALL FUNCTION muestra la firma y el enlace Insertar llamada', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: `REPORT zejemplo.\n${LLAMADA}\n` });
    conDestino.add(doc.uri.toString());
    const posicion = new vscode.Position(1, LLAMADA.indexOf(FUNCION) + 3);
    const textos = await textosHover(doc, posicion);
    const nuestro = textos.find((t) => t.includes(`**${FUNCION}**`));
    assert.ok(nuestro, textos.join('\n---\n'));
    assert.ok(nuestro.includes(`command:${COMANDO_INSERTAR_LLAMADA}?`), nuestro);
    assert.ok(nuestro.includes(`command:${COMANDO_ABRIR_FIRMA}?`), nuestro);
    assert.ok(nuestro.includes('IMPORTING'), nuestro);
  });

  test('Insertar llamada desde el hover escribe el patrón debajo de la sentencia, con su sangría', async () => {
    const servicio = api.diccionario.firmas;
    const falso = firmasConFixtures();
    const original = servicio.firmaFuncion;
    servicio.firmaFuncion = (destino, nombre) => falso.firmaFuncion(destino, nombre);
    try {
      const doc = await vscode.workspace.openTextDocument({
        language: LENGUAJE_PRUEBA,
        content: ['REPORT zejemplo.', `  ${LLAMADA}`, 'WRITE lv_x.'].join('\n'),
      });
      await vscode.window.showTextDocument(doc);
      const peticion: PeticionInsertar = { destino: 'DEST', firma: { tipo: 'funcion', nombre: FUNCION }, receptor: '', fila: 1 };
      await vscode.commands.executeCommand(COMANDO_INSERTAR_LLAMADA, peticion);
      const lineas = textoDe(doc);
      assert.deepStrictEqual(lineas.slice(0, 2), ['REPORT zejemplo.', `  ${LLAMADA}`], lineas.join('\n'));
      assert.strictEqual(lineas[2], `  CALL FUNCTION '${FUNCION}'`, lineas.join('\n'));
      const insertadas = lineas.slice(2, -1);
      assert.ok(insertadas.some((l) => l.startsWith('*')), lineas.join('\n'));
      assert.ok(insertadas.every((l) => l.startsWith('*') || l.startsWith('  ')), lineas.join('\n'));
      assert.ok(!insertadas.some((l) => /^\s+\*/.test(l)), lineas.join('\n'));
      assert.ok(lineas.some((l) => /^ {4}EXPORTING$/.test(l)), lineas.join('\n'));
      assert.strictEqual(lineas[lineas.length - 1], 'WRITE lv_x.');
    } finally {
      servicio.firmaFuncion = original;
    }
  });

  test('Insertar llamada sin firma completa no toca el documento', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: LLAMADA });
    await vscode.window.showTextDocument(doc);
    const peticion: PeticionInsertar = { destino: 'DEST_SIN_CONEXION', firma: { tipo: 'funcion', nombre: FUNCION }, receptor: '', fila: 0 };
    await vscode.commands.executeCommand(COMANDO_INSERTAR_LLAMADA, peticion);
    assert.strictEqual(doc.getText(), LLAMADA);
  });

  test('hover sobre cl_salv_table=>factory( muestra la firma del método con RAISING', async () => {
    const linea = `cl_salv_table=>factory( IMPORTING r_salv_table = lo_alv ).`;
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: `REPORT zejemplo.\n${linea}\n` });
    conDestino.add(doc.uri.toString());
    const textos = await textosHover(doc, new vscode.Position(1, linea.indexOf('factory') + 2));
    const nuestro = textos.find((t) => t.includes(`**${CLASE}=>${METODO}**`));
    assert.ok(nuestro, textos.join('\n---\n'));
    assert.ok(nuestro.includes('RAISING'), nuestro);
    assert.ok(nuestro.includes(`command:${COMANDO_INSERTAR_LLAMADA}?`), nuestro);
  });

  test('hover sobre lo_x->m( ) sin declaración no da hover propio', async () => {
    const linea = 'lo_x->m( ).';
    const doc = await vscode.workspace.openTextDocument({ language: LENGUAJE_PRUEBA, content: `REPORT zejemplo.\n${linea}\n` });
    conDestino.add(doc.uri.toString());
    const posicion = new vscode.Position(1, linea.indexOf('m('));
    const textos = await textosHover(doc, posicion);
    assert.ok(!textos.some((t) => t.includes('**') || t.includes('command:abapNavigator')), textos.join('\n---\n'));
    const resultado = await resolverHover(doc, posicion, depsHover);
    assert.notStrictEqual(resultado.clase, 'metodo', JSON.stringify({ fin: resultado.fin, clase: resultado.clase }));
  });

  test('Insertar llamada de un método escribe el TRY con el CATCH de su excepción de clase', async () => {
    const servicio = api.diccionario.firmas;
    const falso = firmasConFixtures();
    const original = servicio.firmaMetodo;
    servicio.firmaMetodo = (destino, objeto, metodo, opciones) => falso.firmaMetodo(destino, objeto, metodo, opciones);
    try {
      const doc = await editorCon(['REPORT zejemplo.', 'cl_salv_table=>factory( ).'].join('\n'));
      const peticion: PeticionInsertar = { destino: 'DEST', firma: { tipo: 'metodo', objeto: CLASE, metodo: METODO }, receptor: '', fila: 1 };
      await vscode.commands.executeCommand(COMANDO_INSERTAR_LLAMADA, peticion);
      const texto = textoDe(doc).join('\n');
      assert.ok(texto.includes('TRY.'), texto);
      assert.ok(texto.includes('CATCH cx_salv_msg'), texto);
      assert.ok(texto.startsWith('REPORT zejemplo.\ncl_salv_table=>factory( ).\n'), texto);
    } finally {
      servicio.firmaMetodo = original;
    }
  });

  test('Generar CASE desde el comando con un dominio de 3 valores inserta CASE lv_mtart. y tres WHEN', async () => {
    const servicio = api.diccionario.servicio;
    const original = servicio.dominio;
    servicio.dominio = async () => dominioCon('MTART', 3);
    try {
      const doc = await editorCon('');
      await vscode.commands.executeCommand(COMANDO_GENERAR_CASE, { destino: 'DEST', dominio: 'MTART', variable: '${1:lv_mtart}' });
      const lineas = textoDe(doc);
      assert.strictEqual(lineas[0], 'CASE lv_mtart.', lineas.join('\n'));
      assert.strictEqual(lineas.filter((l) => /^\s*WHEN '/.test(l)).length, 3, lineas.join('\n'));
      assert.ok(lineas.includes('  WHEN OTHERS.') && lineas.includes('ENDCASE.'), lineas.join('\n'));
    } finally {
      servicio.dominio = original;
    }
  });

  test('Generar CASE con un dominio de 51 valores pregunta y, sin respuesta, no inserta', async () => {
    const preguntas: string[] = [];
    const servicio = new ServicioDiccionario({ conexion: async () => undefined, idiomaDe: () => 'E' });
    servicio.dominio = async () => dominioCon('ZDOM_EJEMPLO', 51);
    const deps: DependenciasPanel = {
      servicio,
      destinoDe: () => undefined,
      credencialGuardada: async () => true,
      preguntar: async (mensaje) => {
        preguntas.push(mensaje);
        return undefined;
      },
    };
    const panel = new PanelDiccionario(deps);
    try {
      const doc = await editorCon('');
      await generarCaseDesde(panel, deps, { destino: 'DEST', dominio: 'ZDOM_EJEMPLO', variable: '${1:lv_valor}' });
      assert.deepStrictEqual(preguntas, ['El dominio ZDOM_EJEMPLO tiene 51 valores. ¿Generar el CASE igual?']);
      assert.strictEqual(doc.getText(), '');
    } finally {
      panel.dispose();
    }
  });

  test('insertarSnippetEnCursor en un documento de solo lectura de la sesión devuelve false', async () => {
    const doc = await editorCon('REPORT zejemplo.');
    await vscode.commands.executeCommand(COMANDO_SOLO_LECTURA_SESION);
    assert.strictEqual(await insertarSnippetEnCursor('CALL FUNCTION \'Z_EJEMPLO\'.', doc.lineAt(0).range.end), false);
    assert.strictEqual(doc.getText(), 'REPORT zejemplo.');
  });

  test('los comandos de firmas y Generar CASE están registrados', async () => {
    const comandos = await vscode.commands.getCommands(true);
    for (const comando of [COMANDO_INSERTAR_LLAMADA, COMANDO_ABRIR_FIRMA, 'abapNavigator.diccionario.generarCase']) {
      assert.ok(comandos.includes(comando), comando);
    }
  });

  test('package.json: Insertar llamada en la paleta, Abrir firma oculto y Generar CASE también sobre campo', () => {
    interface Menu { command: string; when?: string }
    const paquete = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
      contributes: { commands: { command: string; title: string; icon?: string }[]; menus: Record<string, Menu[]> };
    };
    const insertar = paquete.contributes.commands.find((c) => c.command === COMANDO_INSERTAR_LLAMADA);
    assert.strictEqual(insertar?.title, 'Sextante: Insertar llamada…');
    assert.strictEqual(insertar?.icon, '$(symbol-method)');
    const paleta = paquete.contributes.menus.commandPalette;
    assert.ok(!paleta.some((m) => m.command === COMANDO_INSERTAR_LLAMADA && m.when === 'false'));
    assert.ok(paleta.some((m) => m.command === COMANDO_ABRIR_FIRMA && m.when === 'false'));
    const caseEnArbol = paquete.contributes.menus['view/item/context'].find((m) => m.command === 'abapNavigator.diccionario.generarCase');
    assert.ok(caseEnArbol?.when?.includes('viewItem =~ /^(campo|campoConValores|dominioConValores)$/'), caseEnArbol?.when);
  });
});
