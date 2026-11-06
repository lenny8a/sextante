import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import { INITIAL, parseRawGrammar, Registry, type IGrammar, type StateStack } from 'vscode-textmate';

interface Token {
  texto: string;
  scopes: string[];
}

interface Linea {
  texto: string;
  tokens: { inicio: number; fin: number; scopes: string[] }[];
}

const raiz = path.resolve(__dirname, '../../..');
const RUTA_GRAMATICA = path.join(raiz, 'syntaxes', 'abap.tmLanguage.json');
const RUTA_FIXTURE = path.join(raiz, 'test', 'fixtures', 'abap', 'zcl_ejemplo.clas.abap');

let gramatica: IGrammar;
let fixture: Linea[];

async function cargarGramatica(): Promise<IGrammar> {
  const wasm = fs.readFileSync(path.join(raiz, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registro = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patrones: string[]) => createOnigScanner(patrones),
      createOnigString: (texto: string) => createOnigString(texto),
    }),
    loadGrammar: async (scopeName: string) =>
      scopeName === 'source.abap' ? parseRawGrammar(fs.readFileSync(RUTA_GRAMATICA, 'utf8'), RUTA_GRAMATICA) : null,
  });
  const cargada = await registro.loadGrammar('source.abap');
  if (cargada === null) {
    throw new Error('no se cargó la gramática source.abap');
  }
  return cargada;
}

function tokenizar(texto: string): Linea[] {
  let estado: StateStack = INITIAL;
  return texto.split(/\r?\n/).map((linea) => {
    const resultado = gramatica.tokenizeLine(linea, estado);
    estado = resultado.ruleStack;
    return {
      texto: linea,
      tokens: resultado.tokens.map((t) => ({ inicio: t.startIndex, fin: t.endIndex, scopes: t.scopes })),
    };
  });
}

/** Token que contiene la n-ésima aparición de `palabra` a partir de `fragmento` en la primera línea que lo contiene. */
function tokenEn(lineas: Linea[], fragmento: string, palabra: string, ocurrencia = 0): Token {
  const linea = lineas.find((l) => l.texto.includes(fragmento));
  assert.ok(linea, `no hay línea con «${fragmento}»`);
  let indice = linea.texto.indexOf(fragmento) - 1;
  for (let i = 0; i <= ocurrencia; i++) {
    indice = linea.texto.indexOf(palabra, indice + 1);
    assert.ok(indice >= 0, `no está «${palabra}» en «${linea.texto}»`);
  }
  const token = linea.tokens.find((t) => t.inicio <= indice && indice < t.fin);
  assert.ok(token, `sin token en ${indice} de «${linea.texto}»`);
  return { texto: linea.texto.slice(token.inicio, token.fin), scopes: token.scopes };
}

function scope(fragmento: string, palabra: string, ocurrencia = 0): string {
  return tokenEn(fixture, fragmento, palabra, ocurrencia).scopes.at(-1) ?? '';
}

function scopeSuelto(texto: string, palabra: string, ocurrencia = 0): string {
  return tokenEn(tokenizar(texto), texto.split('\n')[0], palabra, ocurrencia).scopes.at(-1) ?? '';
}

suite('gramatica abap', () => {
  suiteSetup(async () => {
    gramatica = await cargarGramatica();
    fixture = tokenizar(fs.readFileSync(RUTA_FIXTURE, 'utf8'));
  });

  test('declara su scope y package.json la contribuye para abap', () => {
    const json = JSON.parse(fs.readFileSync(RUTA_GRAMATICA, 'utf8')) as { scopeName: string };
    assert.equal(json.scopeName, 'source.abap');
    const paquete = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')) as {
      contributes: { grammars: { language: string; scopeName: string; path: string }[] };
    };
    assert.deepEqual(
      paquete.contributes.grammars.find((g) => g.language === 'abap'),
      { language: 'abap', scopeName: 'source.abap', path: './syntaxes/abap.tmLanguage.json' },
    );
  });

  test('control de flujo y bloques', () => {
    assert.equal(scope('if it_filas is initial', 'if'), 'keyword.control.abap');
    assert.equal(scope('elseif lines', 'elseif'), 'keyword.control.abap');
    assert.equal(scope('    endloop.', 'endloop'), 'keyword.control.abap');
    assert.equal(scope('loop at it_filas assigning', 'loop'), 'keyword.control.abap');
    assert.equal(scope('when others', 'others'), 'keyword.control.abap');
    assert.equal(scope('    try.', 'try'), 'keyword.control.abap');
    assert.equal(scope('raise exception type', 'raise'), 'keyword.control.abap');
    assert.equal(scope('      return.', 'return'), 'keyword.control.abap');
    assert.equal(scope('  method procesar.', 'method'), 'keyword.control.block.abap');
    assert.equal(scope('  endmethod.', 'endmethod'), 'keyword.control.block.abap');
    assert.equal(scope('  public section.', 'section'), 'keyword.control.block.abap');
    assert.equal(scope('class zcl_ejemplo definition', 'class'), 'keyword.control.block.abap');
    assert.equal(scope('class zcl_ejemplo definition', 'definition'), 'keyword.control.block.abap');
  });

  test('declaraciones, modificadores y tipos', () => {
    assert.equal(scope('data lt_x type', 'data'), 'keyword.declaration.abap');
    assert.equal(scope('data lt_x type', 'type'), 'storage.modifier.abap');
    assert.equal(scope('data lt_x type', 'standard'), 'storage.modifier.abap');
    assert.equal(scope('data lt_x type', 'ztab_ejemplo'), 'entity.name.type.abap');
    assert.equal(scope('matnr type matnr,', 'matnr', 1), 'entity.name.type.abap');
    assert.equal(scope('matnr type matnr,', 'matnr', 0), 'variable.other.abap');
    assert.equal(scope('field-symbols <fs>', 'field-symbols'), 'keyword.declaration.abap');
    assert.equal(scope('class-data gv_contador', 'class-data'), 'keyword.declaration.abap');
    assert.equal(scope('data(lv_campo)', 'data'), 'keyword.declaration.abap');
    assert.equal(scope('assigning field-symbol(<m>)', 'field-symbol'), 'keyword.declaration.abap');
    assert.equal(scope('with non-unique key', 'non-unique'), 'storage.modifier.abap');
    assert.equal(scope('types tr_matnr type range of matnr', 'range'), 'storage.modifier.abap');
    assert.equal(scope('types tr_matnr type range of matnr', 'matnr', 1), 'entity.name.type.abap');
    assert.equal(scope('value(rv_ok)', 'value'), 'storage.modifier.abap');
    assert.equal(scope('iv_bukrs type bukrs optional', 'optional'), 'storage.modifier.abap');
    assert.equal(scope('mo_ayudante type ref to', 'zcl_ayudante_ejemplo'), 'entity.name.type.abap');
    assert.equal(scope('class zcl_ejemplo definition', 'zcl_ejemplo'), 'entity.name.type.abap');
    assert.equal(scope('catch zcx_ejemplo into', 'zcx_ejemplo'), 'entity.name.type.abap');
    assert.equal(scope('raise exception type', 'zcx_ejemplo'), 'entity.name.type.abap');
  });

  test('llamadas, builtins y constructores', () => {
    assert.equal(scope("add_log( iv_type = 'E' iv_message = |Error", 'add_log'), 'entity.name.function.abap');
    assert.equal(scope('elseif lines', 'lines'), 'support.function.builtin.abap');
    assert.equal(scope('strlen( lv_cadena )', 'strlen'), 'support.function.builtin.abap');
    assert.equal(scope('zcl_amdp_ejemplo=>metodo', 'zcl_amdp_ejemplo'), 'entity.name.type.abap');
    assert.equal(scope('zcl_amdp_ejemplo=>metodo', 'metodo'), 'entity.name.function.abap');
    assert.equal(scope('zcl_amdp_ejemplo=>metodo', '=>'), 'keyword.operator.abap');
    assert.equal(scope('mo_ayudante->ejecutar', 'ejecutar'), 'entity.name.function.abap');
    assert.equal(scope('super->constructor', 'super'), 'variable.language.abap');
    assert.equal(scope('super->constructor', 'constructor'), 'entity.name.function.abap');
    assert.equal(scope('  method procesar.', 'procesar'), 'entity.name.function.abap');
    assert.equal(scope('methods add_log', 'add_log'), 'entity.name.function.abap');
    assert.equal(scope('mo_ayudante->mv_estado', 'mv_estado'), 'variable.other.abap');
    assert.equal(scope('= new #( )', 'new'), 'keyword.operator.constructor.abap');
    assert.equal(scope('= new #( )', '#'), 'keyword.operator.constructor.abap');
    assert.equal(scope('= value tt_filas(', 'value'), 'keyword.operator.constructor.abap');
    assert.equal(scope('= value tt_filas(', 'tt_filas'), 'entity.name.type.abap');
    assert.equal(scope('= cond string(', 'cond'), 'keyword.operator.constructor.abap');
    assert.equal(scope('= conv i(', 'conv'), 'keyword.operator.constructor.abap');
    assert.equal(scope('= corresponding tt_filas(', 'corresponding'), 'keyword.operator.constructor.abap');
  });

  test('parámetros en la firma de los métodos', () => {
    const firma = 'methods constructor importing iv_pais type land1.';
    assert.equal(scopeSuelto(firma, 'iv_pais'), 'variable.parameter.abap');
    assert.equal(scopeSuelto(firma, 'land1'), 'entity.name.type.abap');
    assert.equal(scopeSuelto(firma, 'importing'), 'storage.modifier.abap');
    const retorno = 'methods get_log returning value(rt_log) type bapiret2_t.';
    assert.equal(scopeSuelto(retorno, 'rt_log'), 'variable.parameter.abap');
    assert.equal(scopeSuelto(retorno, 'value'), 'storage.modifier.abap');
    assert.equal(scopeSuelto(retorno, 'bapiret2_t'), 'entity.name.type.abap');
    assert.equal(scopeSuelto('class-methods crear exporting !eo_obj type ref to zcl_x.', 'eo_obj'), 'variable.parameter.abap');
    assert.equal(scope('iv_bukrs type bukrs optional', 'iv_bukrs'), 'variable.parameter.abap');
    assert.equal(scope('iv_bukrs type bukrs optional', 'bukrs', 1), 'entity.name.type.abap');
    assert.equal(scope("iv_texto type string default 'texto'", 'iv_texto'), 'variable.parameter.abap');
    assert.equal(scope('value(rv_ok)', 'rv_ok'), 'variable.parameter.abap');
    assert.equal(scope('it_filas         type tt_filas', 'it_filas'), 'variable.parameter.abap');
    assert.equal(scope('it_filas         type tt_filas', 'tt_filas'), 'entity.name.type.abap');
    assert.equal(scope('methods constructor', 'constructor'), 'entity.name.function.abap');
  });

  test('parámetros con nombre en las llamadas', () => {
    const llamada = "add_log( iv_type = 'E' iv_message = |x| ).";
    assert.equal(scopeSuelto(llamada, 'add_log'), 'entity.name.function.abap');
    assert.equal(scopeSuelto(llamada, 'iv_type'), 'variable.parameter.abap');
    assert.equal(scopeSuelto(llamada, 'iv_message'), 'variable.parameter.abap');
    assert.equal(scopeSuelto(llamada, "'E'"), 'string.quoted.single.abap');
    const estatica = 'zcl_x=>get( exporting it_matnr = lt_m importing et_master = lt_master ).';
    assert.equal(scopeSuelto(estatica, 'it_matnr'), 'variable.parameter.abap');
    assert.equal(scopeSuelto(estatica, 'et_master'), 'variable.parameter.abap');
    assert.equal(scopeSuelto(estatica, 'exporting'), 'keyword.other.abap');
    assert.equal(scopeSuelto(estatica, 'importing'), 'keyword.other.abap');
    assert.equal(scopeSuelto(estatica, 'lt_master'), 'variable.other.abap');
    assert.equal(scopeSuelto(estatica, 'get'), 'entity.name.function.abap');
    assert.equal(scopeSuelto('a( b = c( d = 1 ) ).', 'b'), 'variable.parameter.abap');
    assert.equal(scopeSuelto('a( b = c( d = 1 ) ).', 'c'), 'entity.name.function.abap');
    assert.equal(scopeSuelto('a( b = c( d = 1 ) ).', 'd'), 'variable.parameter.abap');
    assert.equal(scopeSuelto('lo->m( iv = 1 ).', 'iv'), 'variable.parameter.abap');
    assert.equal(scopeSuelto('super->constructor( iv_x = 1 ).', 'iv_x'), 'variable.parameter.abap');
    assert.equal(scope('zcl_amdp_ejemplo=>metodo( iv_valor', 'iv_valor'), 'variable.parameter.abap');
    assert.equal(scope('zcl_amdp_ejemplo=>metodo( iv_valor', 'lv_total'), 'variable.other.abap');
    assert.equal(scope("add_log( iv_type = 'E' iv_message = |Error", 'iv_message'), 'variable.parameter.abap');
    const anidada = "add_log( iv_type = 'W' iv_message = mo_ayudante->formatear(";
    assert.equal(scope(anidada, 'iv_type'), 'variable.parameter.abap');
    assert.equal(scope(anidada, 'formatear'), 'entity.name.function.abap');
    assert.equal(scope(anidada, 'iv_texto'), 'variable.parameter.abap');
    assert.equal(scope(anidada, 'lv_texto'), 'variable.other.abap');
  });

  test('los componentes y las asignaciones no son parámetros', () => {
    assert.equal(scopeSuelto('lt = value #( matnr = lv ).', 'matnr'), 'variable.other.abap');
    assert.equal(scopeSuelto('lv_x = 1.', 'lv_x'), 'variable.other.abap');
    assert.equal(scopeSuelto('a( it = value #( ( matnr = lv ) ) ).', 'matnr'), 'variable.other.abap');
    assert.equal(scopeSuelto('a( it = value #( ( matnr = lv ) ) ).', 'it'), 'variable.parameter.abap');
    assert.equal(scopeSuelto('a( is = ls-campo ).', 'campo'), 'variable.other.abap');
    assert.equal(scope("( matnr = 'A' )", 'matnr'), 'variable.other.abap');
    assert.equal(scope('when lv_total > 0', 'lv_total'), 'variable.other.abap');
  });

  test('una llamada sin cerrar no se come las sentencias siguientes', () => {
    const lineas = tokenizar('a( b = 1.\nif lv_x = 1.');
    const si = lineas[1].tokens[0];
    assert.equal(si.scopes.at(-1), 'keyword.control.abap');
    assert.equal(scopeSuelto('a( b = 1 ). lv_y = 2.', 'lv_y'), 'variable.other.abap');
  });

  test('llamadas multilínea con comentarios', () => {
    const lineas = tokenizar("lo->m(\n* comentario\n  exporting\n    iv_a = 1 \" fin\n).\nlv_b = 2.");
    assert.equal(lineas[1].tokens[0].scopes.at(-1), 'comment.line.full.abap');
    assert.equal(tokenEn(lineas, 'iv_a', 'iv_a').scopes.at(-1), 'variable.parameter.abap');
    assert.equal(tokenEn(lineas, 'exporting', 'exporting').scopes.at(-1), 'keyword.other.abap');
    assert.equal(tokenEn(lineas, 'iv_a', '" fin').scopes.at(-1), 'comment.line.partial.abap');
    assert.equal(tokenEn(lineas, 'lv_b', 'lv_b').scopes.at(-1), 'variable.other.abap');
  });

  test('SQL abierto', () => {
    assert.equal(scope('select matnr, werks', 'select'), 'keyword.other.sql.abap');
    assert.equal(scope('from ztab_ejemplo', 'from'), 'keyword.other.sql.abap');
    assert.equal(scope('where matnr = @it_filas', 'where'), 'keyword.other.sql.abap');
    assert.equal(scope('and werks = @it_filas', 'and'), 'keyword.other.sql.abap');
    assert.equal(scope('for all entries in', 'entries'), 'keyword.other.sql.abap');
    assert.equal(scope('into table @lt_x', 'lt_x'), 'variable.other.host.abap');
    assert.equal(scope('into table @lt_x', '@'), 'punctuation.definition.variable.host.abap');
    assert.equal(scope('erdat = @sy-datum', 'sy-datum'), 'variable.other.host.abap');
    assert.equal(scope('select single', 'single'), 'keyword.other.sql.abap');
    assert.equal(scope('select single', 'data'), 'keyword.declaration.abap');
    assert.equal(scope('inner join', 'join'), 'keyword.other.sql.abap');
    assert.equal(scope('left outer join', 'outer'), 'keyword.other.sql.abap');
    assert.equal(scope('select distinct', 'distinct'), 'keyword.other.sql.abap');
    assert.equal(scope('select distinct', 'rows'), 'keyword.other.sql.abap');
    assert.equal(scope('    endselect.', 'endselect'), 'keyword.other.sql.abap');
    assert.equal(scope('from ztab_ejemplo as a', 'ztab_ejemplo'), 'entity.name.type.abap');
  });

  test('otras sentencias y operadores', () => {
    assert.equal(scope('append ls_uno to lt_x', 'append'), 'keyword.other.abap');
    assert.equal(scope('append ls_uno to lt_x', 'to'), 'keyword.other.abap');
    assert.equal(scope('sort lt_x by matnr', 'sort'), 'keyword.other.abap');
    assert.equal(scope('delete adjacent duplicates', 'duplicates'), 'keyword.other.abap');
    assert.equal(scope('read table lt_x', 'read'), 'keyword.other.abap');
    assert.equal(scope('binary search', 'binary'), 'keyword.other.abap');
    assert.equal(scope('if it_filas is initial', 'is'), 'keyword.operator.word.abap');
    assert.equal(scope('if it_filas is initial', 'initial'), 'keyword.operator.word.abap');
    assert.equal(scope('> 10 and gv_contador', 'and'), 'keyword.operator.word.abap');
    assert.equal(scope('if sy-subrc <> 0', '<>'), 'keyword.operator.abap');
    assert.equal(scope('lv_total = lv_total - 1', '-'), 'keyword.operator.abap');
  });

  test('field-symbols, sistema, constantes y componentes', () => {
    const fs1 = tokenEn(fixture, '<m>-menge = <m>-menge', '<m>');
    assert.equal(fs1.texto, '<m>');
    assert.equal(fs1.scopes.at(-1), 'variable.other.field-symbol.abap');
    assert.equal(scope('<m>-menge = <m>-menge', 'menge'), 'variable.other.abap');
    assert.equal(scope('if sy-subrc', 'sy'), 'variable.language.abap');
    assert.equal(scope('if sy-subrc', 'subrc'), 'variable.other.abap');
    assert.equal(scope('me->mo_ayudante', 'me'), 'variable.language.abap');
    assert.equal(scope('rv_ok = abap_true', 'abap_true'), 'constant.language.abap');
    assert.equal(scope('lv_texto = space', 'space'), 'constant.language.abap');
    const guion = tokenEn(fixture, '= ls_wi-bukrs.', '-');
    assert.ok(!guion.scopes.some((s) => s.startsWith('keyword.operator')), guion.scopes.join(' '));
    assert.equal(scope('= ls_wi-bukrs.', 'bukrs'), 'variable.other.abap');
    assert.equal(scope('sy-datum+4(2)', '4'), 'constant.numeric.abap');
  });

  test('cadenas, plantillas, comentarios, pragmas y números', () => {
    assert.equal(scope("add_log( iv_type = 'E'", "'E'"), 'string.quoted.single.abap');
    const comilla = tokenEn(fixture, "'cadena''con comilla'", "'cadena");
    assert.equal(comilla.texto, "'cadena''con comilla'");
    assert.equal(scope('`positivo`', '`positivo`'), 'string.quoted.backtick.abap');
    assert.equal(scope('|Filas: {', 'Filas'), 'string.interpolated.abap');
    const builtin = tokenEn(fixture, '|Filas: {', 'lines');
    assert.equal(builtin.scopes.at(-1), 'support.function.builtin.abap');
    assert.ok(builtin.scopes.includes('meta.embedded.expression.abap'));
    assert.equal(scope('|Filas: {', 'lt_x'), 'variable.other.abap');
    assert.equal(scope('|Filas: {', '\\|'), 'constant.character.escape.abap');
    assert.equal(scope('|Filas: {', 'escapado'), 'string.interpolated.abap');
    assert.equal(scope('|Error en { ls_wi-bukrs }|', 'bukrs'), 'variable.other.abap');
    assert.equal(scope('" comentario al final', '" comentario'), 'comment.line.partial.abap');
    assert.equal(scope('* Clase de ejemplo', '* Clase'), 'comment.line.full.abap');
    assert.equal(scope('##NO_TEXT', '##NO_TEXT'), 'comment.line.pragma.abap');
    assert.equal(scope('lv_total type i value 1000', '1000'), 'constant.numeric.abap');
    assert.equal(scope("with key matnr = '01'", "'01'"), 'string.quoted.single.abap');
  });

  test('las palabras clave no distinguen mayúsculas', () => {
    assert.equal(scopeSuelto('IF LV_X IS INITIAL.', 'IF'), 'keyword.control.abap');
    assert.equal(scopeSuelto('IF LV_X IS INITIAL.', 'IS'), 'keyword.operator.word.abap');
    assert.equal(scopeSuelto('DATA LV_X TYPE MATNR.', 'DATA'), 'keyword.declaration.abap');
    assert.equal(scopeSuelto('DATA LV_X TYPE MATNR.', 'MATNR'), 'entity.name.type.abap');
    assert.equal(scopeSuelto('SELECT SINGLE * FROM ZTAB INTO @LS WHERE A = @B.', 'WHERE'), 'keyword.other.sql.abap');
    assert.equal(scopeSuelto('Append ls To lt.', 'Append'), 'keyword.other.abap');
    assert.equal(scopeSuelto('RV = ABAP_TRUE.', 'ABAP_TRUE'), 'constant.language.abap');
  });

  test('los comentarios nunca empiezan dentro de cadenas', () => {
    assert.equal(scopeSuelto(`lv = 'a " b'.`, '"'), 'string.quoted.single.abap');
    assert.equal(scopeSuelto('lv = |a " { lv } b|.', '"'), 'string.interpolated.abap');
    assert.equal(scopeSuelto('lv = `a " b`.', '"'), 'string.quoted.backtick.abap');
    assert.equal(scopeSuelto(`lv = 'a * b'. " fin`, '" fin'), 'comment.line.partial.abap');
    assert.equal(scopeSuelto('  lv = 2 * 3.', '*'), 'keyword.operator.abap');
  });

  test('los nombres que contienen palabras clave son identificadores', () => {
    assert.equal(scopeSuelto('lv_if = ls_x-data.', 'lv_if'), 'variable.other.abap');
    assert.equal(scopeSuelto('lv_if = ls_x-data.', 'data'), 'variable.other.abap');
    assert.equal(scopeSuelto('lv_if = ls_x-type.', 'type'), 'variable.other.abap');
    assert.equal(scopeSuelto('selection = 1.', 'selection'), 'variable.other.abap');
  });

  test('los comparadores de dos letras no tiñen nombres como lt', () => {
    assert.equal(scopeSuelto('IF a LT b.', 'LT'), 'keyword.operator.word.abap');
    assert.equal(scopeSuelto("IF lv_a CA 'XYZ'.", 'CA'), 'keyword.operator.word.abap');
    assert.equal(scopeSuelto('LOOP AT lt INTO ls.', 'lt'), 'variable.other.abap');
    assert.equal(scopeSuelto('READ TABLE lt ASSIGNING <x> INDEX 1.', 'lt'), 'variable.other.abap');
    assert.equal(scopeSuelto('lt = x.', 'lt'), 'variable.other.abap');
    assert.equal(scopeSuelto('DATA lt TYPE i.', 'lt'), 'variable.other.abap');
    assert.equal(scopeSuelto('IF lo IS INSTANCE OF zcl_x.', 'zcl_x'), 'entity.name.type.abap');
  });
});
