import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface ReglaColor {
  scope: string | string[];
  settings: { foreground?: string; fontStyle?: string };
}

interface Tema {
  name: string;
  type: string;
  semanticHighlighting: boolean;
  colors: Record<string, string>;
  semanticTokenColors?: unknown;
  tokenColors: ReglaColor[];
}

interface Paquete {
  contributes: {
    themes: { label: string; uiTheme: string; path: string }[];
    grammars: { language: string; scopeName: string; path: string }[];
  };
}

const raiz = path.resolve(__dirname, '../../..');
const paquete = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')) as Paquete;
const RUTA_TEMA = './themes/sextante-oscuro-color-theme.json';
const tema = JSON.parse(fs.readFileSync(path.join(raiz, RUTA_TEMA), 'utf8')) as Tema;

/** Scope que produce la gramática propia de ABAP → color (y estilo) que le da el tema. */
const COLORES_ABAP: Record<string, { foreground: string; fontStyle?: string }> = {
  'keyword.control.abap': { foreground: '#C678DD' },
  'keyword.control.block.abap': { foreground: '#C678DD' },
  'keyword.declaration.abap': { foreground: '#C678DD' },
  'storage.modifier.abap': { foreground: '#56B6C2' },
  'entity.name.type.abap': { foreground: '#E5C07B' },
  'entity.name.function.abap': { foreground: '#61AFEF' },
  'support.function.builtin.abap': { foreground: '#61AFEF' },
  'keyword.operator.constructor.abap': { foreground: '#56B6C2' },
  'keyword.other.sql.abap': { foreground: '#C678DD' },
  'keyword.other.abap': { foreground: '#C678DD' },
  'keyword.operator.word.abap': { foreground: '#56B6C2' },
  'keyword.operator.abap': { foreground: '#56B6C2' },
  'punctuation.definition.variable.host.abap': { foreground: '#56B6C2' },
  'variable.other.field-symbol.abap': { foreground: '#E06C75', fontStyle: 'italic' },
  'variable.parameter.abap': { foreground: '#E06C75' },
  'variable.language.abap': { foreground: '#D19A66' },
  'constant.language.abap': { foreground: '#D19A66' },
  'variable.other.host.abap': { foreground: '#ABB2BF' },
  'string.quoted.single.abap': { foreground: '#98C379' },
  'string.quoted.backtick.abap': { foreground: '#98C379' },
  'string.interpolated.abap': { foreground: '#98C379' },
  'punctuation.definition.string.begin.abap': { foreground: '#ABB2BF' },
  'punctuation.definition.string.end.abap': { foreground: '#ABB2BF' },
  'comment.line.full.abap': { foreground: '#5C6370', fontStyle: 'italic' },
  'comment.line.partial.abap': { foreground: '#5C6370', fontStyle: 'italic' },
  'comment.line.pragma.abap': { foreground: '#5C6370' },
  'constant.numeric.abap': { foreground: '#D19A66' },
};

const COLOR = /^#[0-9A-F]{6}([0-9A-F]{2})?$/i;

function reglaDe(scope: string): ReglaColor | undefined {
  return tema.tokenColors.find((r) => (Array.isArray(r.scope) ? r.scope : [r.scope]).includes(scope));
}

suite('Tema Sextante Oscuro', () => {
  test('package.json contribuye el tema oscuro y la gramática abap', () => {
    const contribuido = paquete.contributes.themes.find((t) => t.path === RUTA_TEMA);
    assert.ok(contribuido);
    assert.equal(contribuido.label, 'Sextante Oscuro');
    assert.equal(contribuido.uiTheme, 'vs-dark');
    assert.equal(tema.name, contribuido.label);
    assert.deepEqual(
      paquete.contributes.grammars.find((g) => g.language === 'abap'),
      { language: 'abap', scopeName: 'source.abap', path: './syntaxes/abap.tmLanguage.json' },
    );
  });

  test('desactiva el resaltado semántico para que mande la gramática propia', () => {
    assert.equal(tema.type, 'dark');
    assert.equal(tema.semanticHighlighting, false);
    assert.equal(tema.semanticTokenColors, undefined);
  });

  test('colorea cada scope de la gramática abap', () => {
    for (const [scope, esperado] of Object.entries(COLORES_ABAP)) {
      const regla = reglaDe(scope);
      assert.ok(regla, `falta una regla para ${scope}`);
      assert.equal(regla.settings.foreground, esperado.foreground, scope);
      if (esperado.fontStyle !== undefined) {
        assert.equal(regla.settings.fontStyle, esperado.fontStyle, scope);
      }
    }
  });

  test('los parámetros anulan la cursiva genérica para distinguirlos de los field-symbols', () => {
    assert.equal(reglaDe('variable.parameter')?.settings.fontStyle, 'italic');
    assert.equal(reglaDe('variable.parameter.abap')?.settings.fontStyle, '');
  });

  test('el contenido de las plantillas recupera el color normal', () => {
    assert.equal(reglaDe('meta.embedded.expression.abap')?.settings.foreground, '#ABB2BF');
  });

  test('todos los colores son hexadecimales válidos', () => {
    for (const [clave, valor] of Object.entries(tema.colors)) {
      assert.match(valor, COLOR, clave);
    }
    for (const regla of tema.tokenColors) {
      if (regla.settings.foreground !== undefined) {
        assert.match(regla.settings.foreground, COLOR, String(regla.scope));
      }
    }
  });

  test('el fondo, el texto y los comentarios no cambian', () => {
    assert.equal(tema.colors['editor.background'], '#282C34');
    assert.equal(tema.colors['editor.foreground'], '#ABB2BF');
    const comentarios = reglaDe('comment');
    assert.equal(comentarios?.settings.foreground, '#5C6370');
    assert.equal(comentarios?.settings.fontStyle, 'italic');
  });
});
