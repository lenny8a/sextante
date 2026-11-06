import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ResultadoTabla } from '../../src/adt/tablas-legibles';
import { documentoDump, type EstadoDumpCompleto, TEXTO_CARGANDO, textoDocumento } from '../../src/monitor/dump-texto';
import { analizarFeedDumps, type Dump, fechaHoraLocal } from '../../src/monitor/dumps-modelo';
import { type DumpCompleto, dumpCompletoDe, reensamblarFilas, registrosDe } from '../../src/monitor/snap-modelo';

const DIRECTORIO = path.resolve(__dirname, '../../../test/fixtures/adt/real');

function dumpDelFeed(): Dump {
  return analizarFeedDumps(fs.readFileSync(path.join(DIRECTORIO, 'dumps.xml'), 'utf8'))[0];
}

function completoDe(nombre: string): DumpCompleto {
  const { respuestas } = JSON.parse(fs.readFileSync(path.join(DIRECTORIO, nombre), 'utf8')) as { respuestas: ResultadoTabla[] };
  return dumpCompletoDe(registrosDe(reensamblarFilas(respuestas)).registros);
}

function dumpConPila(filas: { nr: string; evento: string; programa: string; include: string; linea: number }[]): Dump {
  const celdas = filas
    .map(
      (f) =>
        `<tr><td><code><a href="adt://DEV/sap/bc/adt/programs/programs/${f.programa.toLowerCase()}/source/main#start=${f.linea}">${f.nr}</a></code></td>` +
        `<td><code>${f.evento}</code></td><td><code>${f.programa}</code></td><td><code>${f.include}</code></td><td><code>${f.linea}</code></td></tr>`,
    )
    .join('');
  const resumenHtml = `<h4 id="STACK">Active Calls/Events</h4><table><tr><th>No.</th><th>Event</th><th>Program</th><th>Include</th><th>Line</th></tr>${celdas}</table>`;
  return { ...dumpDelFeed(), resumenHtml };
}

const ok = (completo: DumpCompleto): EstadoDumpCompleto => ({ clase: 'ok', completo });

suite('monitor dump-texto', () => {
  test('cargando: secciones del feed, pila con enlace y una sola línea de espera', () => {
    const dump = dumpDelFeed();
    const { texto, enlaces } = documentoDump(dump, 'DEST', { clase: 'cargando' });
    assert.ok(texto.startsWith(`ASSERTION_FAILED · Z_EJEMPLO_1 · ${fechaHoraLocal(dump.publicado)} · ${dump.usuario} · DEST\n`));
    for (const titulo of ['QUÉ FALLÓ', 'DÓNDE FALLÓ', 'LLAMADAS ACTIVAS / EVENTOS']) {
      assert.ok(texto.includes(`\n${titulo}\n`), titulo);
    }
    assert.match(texto, /^ +\d+ > ASSERT 1 = 2\.$/m);
    assert.equal(texto.split(TEXTO_CARGANDO).length, 2);
    assert.ok(!texto.includes('VARIABLES SELECCIONADAS'));
    assert.ok(texto.endsWith('\n'));
    const fila = texto.split('\n').findIndex((l) => /Z_EJEMPLO_1 +Z_EJEMPLO_1 +8 +START-OF-SELECTION/.test(l));
    assert.ok(fila > 0);
    assert.equal(enlaces.length, 1);
    assert.equal(enlaces[0].linea, fila);
    assert.equal(enlaces[0].uriAdt, '/sap/bc/adt/programs/programs/z_ejemplo_1/source/main');
    assert.equal(enlaces[0].lineaDestino, 8);
  });

  test('error: explica el motivo y no deja la espera', () => {
    const texto = textoDocumento(dumpDelFeed(), 'DEST', { clase: 'error', motivo: 'sin autorización para leer SNAP en este sistema' });
    assert.ok(texto.includes('Variables y campos de sistema no disponibles: sin autorización para leer SNAP en este sistema'));
    assert.ok(!texto.includes(TEXTO_CARGANDO));
    assert.ok(texto.split('\n')[0].includes('USUARIO_1'));
  });

  test('textoCorto con salto de línea no desplaza los enlaces', () => {
    const base = dumpDelFeed();
    const sinSalto = documentoDump(base, 'DEST', { clase: 'cargando' }).enlaces[0].linea;
    const dump = { ...base, textoCorto: 'primera\n  segunda' };
    const { texto, enlaces } = documentoDump(dump, 'DEST', { clase: 'cargando' });
    assert.ok(texto.includes('primera segunda'));
    assert.equal(enlaces[0].linea, sinSalto);
    assert.match(texto.split('\n')[enlaces[0].linea], /Z_EJEMPLO_1 +Z_EJEMPLO_1 +8 +START-OF-SELECTION/);
  });

  test('ok: todas las secciones en orden y la pila enlazada', () => {
    const dump = dumpConPila([{ nr: '1', evento: 'START-OF-SELECTION', programa: 'ZTEST', include: 'ZTEST', linea: 13 }]);
    const { texto, enlaces } = documentoDump(dump, 'DEST', ok(completoDe('snap-itab.json')));
    assert.ok(
      texto.startsWith(`ASSERTION_FAILED · CX_SY_ITAB_LINE_NOT_FOUND · ZTEST línea 13 · ${fechaHoraLocal(dump.publicado)} · ${dump.usuario} · DEST\n`),
    );
    const orden = [
      'QUÉ FALLÓ',
      'DÓNDE FALLÓ',
      'LLAMADAS ACTIVAS / EVENTOS',
      'VARIABLES SELECCIONADAS',
      'CAMPOS DE SISTEMA',
      'PARÁMETROS DEL ERROR',
      'USUARIO Y TRANSACCIÓN',
      'ENTORNO',
    ].map((t) => texto.indexOf(`\n${t}\n`));
    assert.ok(orden.every((i, n) => i >= 0 && (n === 0 || i > orden[n - 1])), orden.join());
    for (const trozo of [
      '1  EVENT',
      'De la sentencia que falló',
      'LT_MARA        Table IT_13[3x3526]',
      'fila 1: 100MATERIAL_EJEMPLO_1',
      "SY-LDBPG       = 'SAPDB__S'",
      'SY-SUBRC = 0',
      'SY-TABIX = 1',
      'SY-MSGID = ',
      'P2 = INDEX · P3 = 5',
      'Usuario USUARIO_1 · mandante 100 · idioma S · terminal TERMINAL · transacción SE38',
      'Programa de pantalla SAPMSSY0 · dynpro 1000',
      'Release 752 · Linux x86_64 · servidor HOST_1 · BD HDB · kernel 754 parche 33',
      'Opcodes alrededor del error: 20 · programas cargados: 65 · pila del kernel: 18 líneas',
    ]) {
      assert.ok(texto.includes(trozo), trozo);
    }
    const lineaCampos = texto.split('\n').find((l) => l.includes('SY-SUBRC = 0'));
    assert.ok(lineaCampos?.includes('SY-INDEX = 0') && lineaCampos.includes('SY-TABIX = 1'));
    assert.equal(enlaces.length, 1);
    assert.equal(enlaces[0].uriAdt, '/sap/bc/adt/programs/programs/ztest/source/main');
    assert.equal(enlaces[0].lineaDestino, 13);
    const filaPila = texto.split('\n')[enlaces[0].linea];
    assert.equal(enlaces[0].inicio, 0);
    assert.equal(enlaces[0].fin, filaPila.length);
    assert.ok(/ZTEST +ZTEST +13 +START-OF-SELECTION/.test(filaPila));
  });

  test('ok sin pareja en el feed: la fila se imprime sin enlace', () => {
    const dump = dumpConPila([{ nr: '1', evento: 'START-OF-SELECTION', programa: 'ZTEST', include: 'ZTEST', linea: 8 }]);
    const { texto, enlaces } = documentoDump(dump, 'DEST', ok(completoDe('snap-itab.json')));
    assert.equal(enlaces.length, 0);
    assert.match(texto, /1  EVENT +ZTEST +ZTEST +13 +START-OF-SELECTION/);
  });

  test('ok con rfc: el feed de una fila casa con el primer nivel de la pila', () => {
    const dump = dumpConPila([{ nr: '2', evento: 'REMOTE_FUNCTION_CALL', programa: 'SAPMSSY1', include: 'SAPMSSY1', linea: 594 }]);
    const { texto, enlaces } = documentoDump(dump, 'DEST', ok(completoDe('snap-rfc.json')));
    assert.ok(texto.includes('Llamada RFC entrante: función RS_ST22_GET_FT · destino DEST · desde 10.0.0.2 (TERMINAL, SAPJCo31)'));
    assert.ok(texto.includes('transacción —'));
    assert.equal(enlaces.length, 1);
    assert.equal(enlaces[0].lineaDestino, 594);
  });

  test('ok incompleto: avisa que SAP no terminó de grabarlo', () => {
    const completo = { ...completoDe('snap-itab.json'), incompleto: true };
    assert.ok(textoDocumento(dumpDelFeed(), 'DEST', ok(completo)).includes('Dump incompleto (SAP no terminó de grabarlo)'));
  });

  test('campos de sistema largos quedan separados por al menos dos espacios', () => {
    const base = completoDe('snap-itab.json');
    const completo: DumpCompleto = {
      ...base,
      camposSistema: [
        { nombre: 'SY-CPROG', valor: 'ZPROGRAMA_MUY_LARGO_DE_PRUEBA' },
        { nombre: 'SY-DBNAM', valor: 'X' },
        { nombre: 'SY-REPID', valor: 'Y' },
      ],
    };
    const texto = textoDocumento(dumpDelFeed(), 'DEST', ok(completo));
    assert.ok(texto.includes('SY-CPROG = ZPROGRAMA_MUY_LARGO_DE_PRUEBA  SY-DBNAM = X'));
  });

  test('la cabecera de la pila se alinea con las filas', () => {
    const dump = dumpConPila([{ nr: '1', evento: 'START-OF-SELECTION', programa: 'ZTEST', include: 'ZTEST', linea: 13 }]);
    const lineas = textoDocumento(dump, 'DEST', ok(completoDe('snap-itab.json'))).split('\n');
    const cabecera = lineas.find((l) => l.includes('Tipo'));
    const fila = lineas.find((l) => l.includes('EVENT') && l.includes('START-OF-SELECTION'));
    assert.ok(cabecera && fila);
    assert.equal(cabecera.indexOf('Tipo'), fila.indexOf('EVENT'));
    assert.equal(cabecera.indexOf('Programa'), fila.indexOf('ZTEST'));
    assert.equal(cabecera.indexOf('Nombre'), fila.indexOf('START-OF-SELECTION'));
    assert.equal(cabecera.indexOf('Nr') + 2, fila.indexOf('1') + 1);
  });

  test('las filas de tabla se recortan a 120 caracteres con puntos suspensivos', () => {
    const completo: DumpCompleto = {
      ...completoDe('snap-itab.json'),
      variables: [{ titulo: 'Grupo', variables: [{ nombre: 'T', tabla: { cabecera: 'Table IT_1[1x1]', filas: ['X'.repeat(300)] } }] }],
    };
    const fila = textoDocumento(dumpDelFeed(), 'DEST', ok(completo)).split('\n').find((l) => l.includes('fila 1:'));
    assert.ok(fila);
    assert.ok(fila.endsWith('…'));
    assert.equal(fila.trim().slice('fila 1: '.length).length, 120);
  });
});
