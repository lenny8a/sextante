import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  analizarFeedDumps,
  esDeHoy,
  fechaHoraLocal,
  horaArchivo,
  horaLocal,
  marcaUtc,
  marcoDe,
  marcosDe,
  medianocheLocal,
  posicionDe,
  resultadoDePosicion,
  rutaDumps,
  textoDeResumen,
  usuarioValido,
} from '../../src/monitor/dumps-modelo';

function leerFixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

suite('monitor dumps-modelo', () => {
  test('analiza la entrada real (dumps.xml)', () => {
    const [d] = analizarFeedDumps(leerFixture('dumps.xml'));
    assert.equal(analizarFeedDumps(leerFixture('dumps.xml')).length, 1);
    assert.equal(d.usuario, 'USUARIO_1');
    assert.equal(d.errorEjecucion, 'ASSERTION_FAILED');
    assert.equal(d.programa, 'Z_EJEMPLO_1');
    assert.equal(d.textoCorto, 'The ASSERT condition was violated.');
    assert.equal(d.publicado, '2026-10-31T03:45:08Z');
    assert.ok(d.id.startsWith('/sap/bc/adt/vit/runtime/dumps/20261030214508'));
    assert.deepEqual(d.posicion, { uriAdt: '/sap/bc/adt/programs/programs/z_ejemplo_1/source/main', linea: 8 });
    assert.deepEqual(d.marco, { evento: 'START-OF-SELECTION', programa: 'Z_EJEMPLO_1', include: 'Z_EJEMPLO_1', linea: 8 });
    assert.ok(d.resumenHtml.startsWith('<p style='));
  });

  test('feed vacío (dumps-vacio.xml) → sin dumps', () => {
    assert.deepEqual(analizarFeedDumps(leerFixture('dumps-vacio.xml')), []);
  });

  test('resumen sin enlace #start → sin posición ni marco', () => {
    assert.equal(posicionDe('<h4>Header</h4><table></table>'), undefined);
    assert.equal(marcoDe('<h4>Header</h4>'), undefined);
  });

  test('rutaDumps con usuario válido, from y top', () => {
    const desde = new Date(Date.UTC(2026, 9, 30, 6, 0, 0));
    assert.equal(
      rutaDumps({ usuario: 'USUARIO_1', desde, top: 50 }),
      '/sap/bc/adt/runtime/dumps?$query=and%20(%20equals%20(%20user%20,%20USUARIO_1%20)%20)&from=20261030060000&$top=50',
    );
  });

  test('usuario inválido → sin $query', () => {
    const desde = new Date(Date.UTC(2026, 9, 30, 6, 0, 0));
    assert.equal(usuarioValido('usuario_1'), false);
    assert.equal(usuarioValido("X' )"), false);
    assert.equal(usuarioValido(undefined), false);
    assert.equal(rutaDumps({ desde, top: 100 }), '/sap/bc/adt/runtime/dumps?from=20261030060000&$top=100');
  });

  test('marcaUtc y medianocheLocal', () => {
    assert.equal(marcaUtc(new Date(Date.UTC(2026, 9, 31, 3, 45, 8))), '20261031034508');
    const ahora = new Date(2026, 9, 30, 21, 45, 8);
    const m = medianocheLocal(ahora);
    assert.deepEqual(
      [m.getFullYear(), m.getMonth(), m.getDate(), m.getHours(), m.getMinutes(), m.getSeconds()],
      [2026, 9, 30, 0, 0, 0],
    );
  });

  test('esDeHoy compara la fecha local', () => {
    const [d] = analizarFeedDumps(leerFixture('dumps.xml'));
    const instante = new Date(d.publicado);
    assert.equal(esDeHoy(d, instante), true);
    assert.equal(esDeHoy(d, new Date(instante.getTime() + 24 * 3600 * 1000)), false);
  });

  test('horaLocal y fechaHoraLocal', () => {
    const local = new Date(2026, 9, 30, 21, 45, 8).toISOString();
    assert.equal(horaLocal(local), '21:45');
    assert.equal(fechaHoraLocal(local), '30/10/2026 21:45:08');
  });

  test('horaArchivo da HH-MM-SS local sin dos puntos', () => {
    assert.equal(horaArchivo(new Date(2026, 9, 30, 9, 5, 7).toISOString()), '09-05-07');
  });

  test('texto del resumen: sin etiquetas, con secciones, extracto y pila', () => {
    const [d] = analizarFeedDumps(leerFixture('dumps.xml'));
    const texto = textoDeResumen(d.resumenHtml);
    assert.ok(
      !/<[a-z]/i.test(texto) && !texto.includes('&nbsp;') && !texto.includes('Show in SAP GUI') && !texto.includes('Contents'),
    );
    assert.ok(
      texto.includes('HEADER INFORMATION\nShort Text: The ASSERT condition was violated.\nRuntime Error: ASSERTION_FAILED\nProgram: Z_EJEMPLO_1'),
    );
    assert.ok(
      texto.includes('WHAT HAPPENED?\nThe current application program has detected a situation with the\nASSERT statement that should not occur.'),
    );
    assert.ok(texto.includes('SOURCE CODE EXTRACT\n'));
    assert.ok(texto.includes('   6   REPORT z_ejemplo_1.\n   7\n   8 > ASSERT 1 = 2.\n   9\n'));
    assert.ok(
      texto.includes('ACTIVE CALLS/EVENTS\nNo. | Event | Program | Include | Line\n1 | START-OF-SELECTION | Z_EJEMPLO_1 | Z_EJEMPLO_1 | 8'),
    );
    assert.ok(texto.includes('*&---------------------------------------------------------------------*'));
  });

  test('marcosDe: fila del feed con número y uri ADT', () => {
    const [d] = analizarFeedDumps(leerFixture('dumps.xml'));
    const marcos = marcosDe(d.resumenHtml);
    assert.equal(marcos.length, 1);
    assert.equal(marcos[0].nr, '1');
    assert.equal(marcos[0].uriAdt, '/sap/bc/adt/programs/programs/z_ejemplo_1/source/main');
    assert.equal(marcos[0].linea, 8);
    assert.equal(marcos[0].programa, 'Z_EJEMPLO_1');
  });

  test('marcosDe: varias filas y la que no trae enlace queda sin uriAdt', () => {
    const fila = (nr: string, href: string): string =>
      `<tr><td><code>${href ? `<a href="${href}">${nr}</a>` : nr}</code></td><td>FORM</td><td>ZP</td><td>ZI</td><td>1${nr}</td></tr>`;
    const html =
      '<h4 id="STACK">Active</h4><table><tr><th>No.</th><th>E</th><th>P</th><th>I</th><th>L</th></tr>' +
      fila('1', 'adt://DEV/sap/bc/adt/programs/programs/zp/source/main#start=11') +
      fila('2', '') +
      '</table>';
    const marcos = marcosDe(html);
    assert.equal(marcos.length, 2);
    assert.equal(marcos[1].nr, '2');
    assert.equal(marcos[1].uriAdt, undefined);
    assert.deepEqual(marcoDe(html), { evento: 'FORM', programa: 'ZP', include: 'ZI', linea: 11 });
  });

  test('resultadoDePosicion por prefijo de la uri', () => {
    const r = (uri: string) => resultadoDePosicion({ uriAdt: uri, linea: 1 }, 'Z_EJEMPLO_1');
    assert.deepEqual(r('/sap/bc/adt/programs/programs/z_ejemplo_1/source/main'), {
      nombre: 'Z_EJEMPLO_1',
      tipo: 'PROG/P',
      descripcion: '',
      paquete: '',
      uriAdt: '/sap/bc/adt/programs/programs/z_ejemplo_1',
    });
    assert.equal(r('/sap/bc/adt/programs/includes/z_ejemplo_1_f01/source/main')?.tipo, 'PROG/I');
    assert.equal(r('/sap/bc/adt/oo/classes/zcl_ejemplo/source/main')?.tipo, 'CLAS/OC');
    const fm = r('/sap/bc/adt/functions/groups/zgrupo/fmodules/z_fm/source/main');
    assert.equal(fm?.tipo, 'FUGR/FF');
    assert.equal(fm?.uriAdt, '/sap/bc/adt/functions/groups/zgrupo/fmodules/z_fm');
    assert.equal(r('/sap/bc/adt/vit/wb/object_type/x'), undefined);
  });
});
