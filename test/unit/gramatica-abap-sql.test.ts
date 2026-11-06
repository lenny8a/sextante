import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Regla {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  patterns?: Regla[];
  captures?: Record<string, { name: string }>;
}

interface Gramatica {
  name: string;
  scopeName: string;
  patterns: Regla[];
}

const raiz = path.resolve(__dirname, '../../..');
const gramatica = JSON.parse(
  fs.readFileSync(path.join(raiz, 'syntaxes', 'abap-sql.tmLanguage.json'), 'utf8'),
) as Gramatica;

function reglas(): Regla[] {
  return gramatica.patterns.flatMap((r) => [r, ...(r.patterns ?? [])]);
}

function expresion(match: string): RegExp {
  return new RegExp(match.replace(/^\(\?i\)/, ''), 'gi');
}

function coincidencias(scope: string, texto: string): string[] {
  const salida: string[] = [];
  for (const regla of reglas().filter((r) => r.match !== undefined)) {
    for (const m of texto.matchAll(expresion(regla.match as string))) {
      if (regla.name === scope) {
        salida.push(m[0]);
      }
      for (const [grupo, captura] of Object.entries(regla.captures ?? {})) {
        const valor = m[Number(grupo)];
        if (captura.name === scope && valor !== undefined) {
          salida.push(valor);
        }
      }
    }
  }
  return salida;
}

suite('gramatica abap-sql', () => {
  test('declara su scope y package.json la contribuye para abap-sql', () => {
    assert.strictEqual(gramatica.scopeName, 'source.abap-sql');
    assert.strictEqual(gramatica.name, 'ABAP SQL');
    const paquete = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')) as {
      contributes: { grammars: { language: string; scopeName: string; path: string }[] };
    };
    assert.deepStrictEqual(
      paquete.contributes.grammars.find((g) => g.language === 'abap-sql'),
      { language: 'abap-sql', scopeName: 'source.abap-sql', path: './syntaxes/abap-sql.tmLanguage.json' },
    );
  });

  test('colorea palabras clave, cadenas y tabla de un SELECT', () => {
    const sql = "SELECT * FROM zmm_tienda WHERE werks = '1000'";
    const claves = coincidencias('keyword.other.abap-sql', sql).map((c) => c.toUpperCase());
    assert.deepStrictEqual([...new Set(claves)], ['FROM', 'SELECT', 'WHERE']);
    assert.deepStrictEqual(coincidencias('string.quoted.single.abap-sql', sql), ["'1000'"]);
    assert.deepStrictEqual(coincidencias('entity.name.type.table.abap-sql', sql), ['zmm_tienda']);
  });

  test('no confunde minúsculas ni partes de palabras', () => {
    assert.deepStrictEqual(coincidencias('keyword.other.abap-sql', 'select selection').map((c) => c.toLowerCase()), [
      'select',
    ]);
  });

  test('colorea números, comentarios y variables host', () => {
    assert.deepStrictEqual(coincidencias('constant.numeric.abap-sql', 'UP TO 10 ROWS'), ['10']);
    assert.deepStrictEqual(coincidencias('comment.line.double-quote.abap-sql', '" comentario'), ['" comentario']);
    assert.deepStrictEqual(coincidencias('comment.line.star.abap-sql', '* comentario'), ['* comentario']);
    assert.deepStrictEqual(coincidencias('comment.line.double-dash.abap-sql', '-- comentario'), ['-- comentario']);
    assert.deepStrictEqual(coincidencias('variable.other.host.abap-sql', 'WHERE matnr = @wa-matnr'), ['@wa-matnr']);
  });

  test('funciones, tipos de CAST y separador de campo', () => {
    assert.deepStrictEqual(coincidencias('support.function.abap-sql', 'SELECT COUNT( * ) FROM t'), ['COUNT']);
    assert.deepStrictEqual(coincidencias('storage.type.abap-sql', 'CAST( a AS CHAR )'), ['CHAR']);
    assert.deepStrictEqual(coincidencias('keyword.operator.abap-sql', 't~campo'), ['~']);
  });
});
