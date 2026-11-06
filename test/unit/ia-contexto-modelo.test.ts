import assert from 'node:assert/strict';
import {
  MAX_TEXTO_SELECCION,
  TIEMPO_RELEASE_MS,
  bloqueBajoCursor,
  conTope,
  contextoActualDe,
  type EntradaContexto,
  type FotoEditor,
} from '../../src/ia/contexto-modelo';
import { ESQUEMA_BLOQUE } from '../../src/bloques/bloque-modelo';
import type { Rango, SimboloDocumento } from '../../src/tree/objeto-modelo';

const RUTA_PROG = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap';
const RUTA_INCLUDE = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Includes/ZINC_EJEMPLO/zinc_ejemplo.prog.abap';

function simbolo(nombre: string, nombreKind: string, rango: Rango, hijos: SimboloDocumento[] = []): SimboloDocumento {
  return { nombre, kind: 0, nombreKind, rango, hijos };
}

function foto(path: string, extra: Partial<FotoEditor> = {}): FotoEditor {
  return { uri: { scheme: 'abap', path }, linea: 4, columna: 2, esActivo: true, ...extra };
}

function entrada(extra: Partial<EntradaContexto> = {}): EntradaContexto {
  return {
    editor: foto(RUTA_PROG),
    origenEditor: 'activo',
    simbolos: [],
    editoresAbiertos: [],
    sistemaActivo: 'OTRO',
    rolDe: (id) => (id === 'DEST' ? 'DEV' : id === 'QASX' ? 'QAS' : undefined),
    viaDe: (id) => (id === 'DEST' ? 'rfc' : undefined),
    releaseDe: () => undefined,
    modoBloque: false,
    propuestasPendientes: [],
    ...extra,
  };
}

suite('contexto actual del editor para el agente', () => {
  test('con editor abap: activo devuelve sistema (rol, vía), objeto, archivo y cursor 1-based', () => {
    const c = contextoActualDe(entrada());
    assert.deepEqual(c.sistema, { id: 'DEST', rol: 'DEV', via: 'rfc', origen: 'editor' });
    assert.deepEqual(c.objeto, {
      tipo: 'programa',
      nombre: 'ZPROG_EJEMPLO',
      paquete: 'ZPAQ1',
      uriRaiz: '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Programs/ZPROG_EJEMPLO',
    });
    assert.deepEqual(c.archivo, { uri: `abap:${RUTA_PROG}`, nombre: 'zprog_ejemplo.prog.abap', esInclude: false });
    assert.deepEqual(c.cursor, { linea: 5, columna: 3 });
    assert.equal(c.origenEditor, 'activo');
    assert.equal(c.soloLectura, false);
    assert.deepEqual(c.propuestasPendientes, []);
  });

  test('un include se reconoce por su carpeta', () => {
    const c = contextoActualDe(entrada({ editor: foto(RUTA_INCLUDE) }));
    assert.equal(c.objeto?.tipo, 'include');
    assert.equal(c.archivo?.esInclude, true);
    assert.equal(c.archivo?.include, 'ZINC_EJEMPLO');
  });

  test('bloqueBajoCursor: FORM, método de la implementación y evento; fuera → undefined', () => {
    const simbolos = [
      simbolo('ZCL_LOCAL', 'Class', [0, 0, 5, 0], [simbolo('DEFINIDO', 'Method', [1, 0, 2, 0])]),
      simbolo('ZCL_LOCAL', 'Class', [10, 0, 20, 0], [simbolo('CALCULAR', 'Method', [11, 0, 15, 0])]),
      simbolo('START-OF-SELECTION', 'Object', [30, 0, 35, 0]),
      simbolo('MOSTRAR', 'Function', [40, 0, 45, 0]),
      simbolo('lv_dato', 'Variable', [50, 0, 50, 10]),
    ];
    assert.deepEqual(bloqueBajoCursor(simbolos, 41), { tipo: 'form', nombre: 'MOSTRAR' });
    assert.deepEqual(bloqueBajoCursor(simbolos, 12), { tipo: 'method', nombre: 'CALCULAR' });
    assert.deepEqual(bloqueBajoCursor(simbolos, 32), { tipo: 'event', nombre: 'START-OF-SELECTION' });
    assert.equal(bloqueBajoCursor(simbolos, 8), undefined);
    assert.equal(bloqueBajoCursor(simbolos, 50), undefined);
  });

  test('el bloque bajo el cursor entra en el contexto', () => {
    const simbolos = [simbolo('MOSTRAR', 'Function', [40, 0, 45, 0])];
    const c = contextoActualDe(entrada({ simbolos, editor: foto(RUTA_PROG, { linea: 41 }) }));
    assert.deepEqual(c.bloque, { tipo: 'form', nombre: 'MOSTRAR' });
  });

  test('la selección se recorta a 4000 caracteres y lo marca', () => {
    const largo = 'x'.repeat(MAX_TEXTO_SELECCION + 10);
    const c = contextoActualDe(entrada({ editor: foto(RUTA_PROG, { seleccion: { desdeLinea: 2, hastaLinea: 6, texto: largo } }) }));
    assert.equal(c.seleccion?.texto.length, MAX_TEXTO_SELECCION);
    assert.equal(c.seleccion?.recortada, true);
    assert.equal(c.seleccion?.desdeLinea, 3);
    assert.equal(c.seleccion?.hastaLinea, 7);
    const corta = contextoActualDe(entrada({ editor: foto(RUTA_PROG, { seleccion: { desdeLinea: 0, hastaLinea: 0, texto: 'ab' } }) }));
    assert.deepEqual(corta.seleccion, { desdeLinea: 1, hastaLinea: 1, texto: 'ab', recortada: false });
  });

  test('un editor de bloque informa el origen como archivo y el bloque aparte', () => {
    const editor: FotoEditor = {
      uri: { scheme: ESQUEMA_BLOQUE, path: `${RUTA_PROG}/CALCULAR.form.abap` },
      linea: 0,
      columna: 0,
      esActivo: true,
    };
    const c = contextoActualDe(entrada({ editor, modoBloque: true }));
    assert.equal(c.archivo?.uri, `abap:${RUTA_PROG}`);
    assert.deepEqual(c.archivo?.bloque, { tipo: 'form', nombre: 'CALCULAR' });
    assert.deepEqual(c.bloque, { tipo: 'form', nombre: 'CALCULAR' });
    assert.equal(c.modoBloque, true);
    assert.equal(c.objeto?.nombre, 'ZPROG_EJEMPLO');
  });

  test('sin editor: sistema del sistemaActivo con origen sistemaActivo; soloLectura según rol QAS', () => {
    const c = contextoActualDe(entrada({ editor: undefined, origenEditor: 'ninguno', sistemaActivo: 'QASX' }));
    assert.deepEqual(c.sistema, { id: 'QASX', rol: 'QAS', via: undefined, origen: 'sistemaActivo' });
    assert.equal(c.soloLectura, true);
    assert.equal(c.objeto, undefined);
    assert.equal(c.archivo, undefined);
    assert.equal(c.cursor, undefined);
    assert.equal(c.origenEditor, 'ninguno');
    const sin = contextoActualDe(entrada({ editor: undefined, origenEditor: 'ninguno', sistemaActivo: undefined }));
    assert.equal(sin.sistema, undefined);
    assert.equal(sin.soloLectura, false);
  });

  test('origenEditor ultimoEditor se propaga y el editor no se marca activo', () => {
    const c = contextoActualDe(entrada({ editor: foto(RUTA_PROG, { esActivo: false }), origenEditor: 'ultimoEditor' }));
    assert.equal(c.origenEditor, 'ultimoEditor');
    assert.equal(c.sistema?.id, 'DEST');
    assert.equal(c.editoresAbiertos.some((e) => e.esActivo), false);
  });

  test('editoresAbiertos lista uri, objeto y sistema de cada pestaña abap:', () => {
    const c = contextoActualDe(
      entrada({
        editoresAbiertos: [
          foto(RUTA_PROG),
          foto(RUTA_INCLUDE, { esActivo: false }),
          { uri: { scheme: ESQUEMA_BLOQUE, path: `${RUTA_PROG}/CALCULAR.form.abap` }, linea: 0, columna: 0, esActivo: false },
        ],
      }),
    );
    assert.deepEqual(c.editoresAbiertos, [
      { uri: `abap:${RUTA_PROG}`, objeto: 'ZPROG_EJEMPLO', sistema: 'DEST', esActivo: true },
      { uri: `abap:${RUTA_INCLUDE}`, objeto: 'ZINC_EJEMPLO', sistema: 'DEST', esActivo: false },
      { uri: `abap:${RUTA_PROG}`, objeto: 'ZPROG_EJEMPLO', sistema: 'DEST', esActivo: false },
    ]);
  });

  test('propuestasPendientes se devuelve tal cual (id, resumen, uri)', () => {
    const c = contextoActualDe(entrada({ propuestasPendientes: [{ id: 'ab12', resumen: 'r', uri: 'abap:/x' }] }));
    assert.deepEqual(c.propuestasPendientes, [{ id: 'ab12', resumen: 'r', uri: 'abap:/x' }]);
  });

  test('sistema.release: presente cuando releaseDe lo da y ausente si no', () => {
    const con = contextoActualDe(entrada({ releaseDe: (id) => (id === 'DEST' ? '754' : undefined) }));
    assert.equal(con.sistema?.release, '754');
    const sin = contextoActualDe(entrada());
    assert.equal(sin.sistema !== undefined && 'release' in sin.sistema, false);
  });

  test('diario: se copia cuando tiene entradas, y no hay clave si falta o está vacío', () => {
    const diario = { entradas: 2, ultima: '2026-11-04 10:45', archivo: 'C:/x/DEST/PROG-ZPROG_EJEMPLO.md' };
    assert.deepEqual(contextoActualDe(entrada({ diario })).diario, diario);
    assert.equal('diario' in contextoActualDe(entrada({ diario: { entradas: 0, archivo: diario.archivo } })), false);
    assert.equal('diario' in contextoActualDe(entrada()), false);
    assert.equal('diario' in contextoActualDe(entrada({ diario, editor: undefined, origenEditor: 'ninguno' })), false);
  });
});

suite('IA: tope de espera del contexto', () => {
  const nunca = <T>(): Promise<T> => new Promise<T>(() => undefined);

  test('el release tiene un tope de 3 s', () => {
    assert.equal(TIEMPO_RELEASE_MS, 3000);
  });

  test('conTope devuelve el valor si llega antes que el tope', async () => {
    assert.equal(await conTope(Promise.resolve('754'), TIEMPO_RELEASE_MS, () => nunca<void>()), '754');
  });

  test('conTope devuelve undefined si vence el tope y espera los ms pedidos', async () => {
    const pedidos: number[] = [];
    const r = await conTope(nunca<string>(), TIEMPO_RELEASE_MS, async (ms) => {
      pedidos.push(ms);
    });
    assert.equal(r, undefined);
    assert.deepEqual(pedidos, [3000]);
  });
});
