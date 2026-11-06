import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AVISO_SIN_SIMBOLOS,
  construirArbolObjeto,
  esEvento,
  nodoDiario,
  type EntradaObjeto,
  palabraClave,
  type NodoObjeto,
  type SimboloDocumento,
} from '../../src/tree/objeto-modelo';

interface FixtureRepotree {
  informe: { simbolos: SimboloDocumento[]; hermanos: { entradas: { nombre: string }[] } };
}

function leerFixture(nombre: string, carpeta = 'repotree'): { simbolos: SimboloDocumento[]; archivos: string[] } {
  const ruta = path.resolve(__dirname, '../../../test/fixtures', carpeta, `${nombre}.json`);
  const fixture = JSON.parse(fs.readFileSync(ruta, 'utf8')) as FixtureRepotree;
  return {
    simbolos: fixture.informe.simbolos,
    archivos: fixture.informe.hermanos.entradas.map((e) => e.nombre),
  };
}

interface CarpetaS4 {
  ruta: string;
  entradas: { nombre: string; tipo: string }[];
}

function archivosDeCarpetaS4(sufijo: string): string[] {
  const ruta = path.resolve(__dirname, '../../../test/fixtures/repotree-s4/carpetas.json');
  const carpetas = JSON.parse(fs.readFileSync(ruta, 'utf8')) as CarpetaS4[];
  const carpeta = carpetas.find((c) => c.ruta.endsWith(sufijo));
  assert.ok(carpeta, sufijo);
  return carpeta.entradas.filter((e) => e.tipo === 'archivo').map((e) => e.nombre);
}

/** Simula lo que hace el proveedor: detalle = primera palabra de la línea del símbolo `Object`. */
function programaS4ConDetalle(): { simbolos: SimboloDocumento[]; archivos: string[] } {
  const ruta = path.resolve(__dirname, '../../../test/fixtures/repotree-s4/programa.json');
  const fixture = JSON.parse(fs.readFileSync(ruta, 'utf8')) as FixtureRepotree & {
    informe: { primeraPalabraPorLinea: Record<string, string> };
  };
  const palabras = fixture.informe.primeraPalabraPorLinea;
  const simbolos = fixture.informe.simbolos.map((s) => {
    const palabra = palabras[String(s.rango[0])]?.replace(/[:.,]+$/, '');
    return s.nombreKind === 'Object' && palabra !== undefined ? { ...s, detalle: palabra } : s;
  });
  return { simbolos, archivos: fixture.informe.hermanos.entradas.map((e) => e.nombre) };
}

function objetoAbap(nombre: string, linea: number, detalle?: string): SimboloDocumento {
  return {
    nombre,
    kind: 18,
    nombreKind: 'Object',
    rango: [linea, 0, linea, 30],
    rangoSeleccion: [linea, 8, linea, 30],
    hijos: [],
    ...(detalle !== undefined && { detalle }),
  };
}

function todosLosNodos(nodo: NodoObjeto): NodoObjeto[] {
  return [nodo, ...nodo.hijos.flatMap(todosLosNodos)];
}

function etiquetas(nodos: NodoObjeto[]): string[] {
  return nodos.map((n) => n.etiqueta);
}

suite('modelo del árbol del objeto', () => {
  test('clase: Definición con Tipos/Constantes, Implementación con métodos, Includes locales', () => {
    const { simbolos, archivos } = leerFixture('clase');
    const raiz = construirArbolObjeto({ tipo: 'clase', nombre: 'zcl_ejemplo', archivoAbierto: 'zcl_ejemplo.clas.abap', archivos, simbolos });
    assert.strictEqual(raiz.etiqueta, 'ZCL_EJEMPLO');
    assert.strictEqual(raiz.descripcion, 'Clase');
    assert.strictEqual(raiz.archivo, 'zcl_ejemplo.clas.abap');
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Definición', 'Implementación', 'Includes locales']);
    assert.deepStrictEqual(etiquetas(raiz.hijos[0].hijos), ['Tipos', 'Constantes']);
    assert.ok(raiz.hijos[1].hijos.every((h) => h.icono === 'symbol-method' && h.archivo === 'zcl_ejemplo.clas.abap'));
    assert.deepStrictEqual(
      raiz.hijos[2].hijos.map((h) => [h.etiqueta, h.archivo]),
      [['Definiciones locales', 'zcl_ejemplo.clas.localtypes.abap']],
    );
  });

  test('símbolo usa rangoSeleccion y un id único', () => {
    const { simbolos, archivos } = leerFixture('clase');
    const raiz = construirArbolObjeto({ tipo: 'clase', nombre: 'zcl_ejemplo', archivoAbierto: 'zcl_ejemplo.clas.abap', archivos, simbolos });
    const metodo2 = simbolos[1].hijos.find((h) => h.nombre === 'METODO_2');
    assert.ok(metodo2?.rangoSeleccion);
    const nodo = raiz.hijos[1].hijos.find((h) => h.etiqueta === 'METODO_2');
    assert.deepStrictEqual(nodo?.rango, metodo2.rangoSeleccion);
    assert.notDeepStrictEqual(nodo?.rango, metodo2.rango);
    assert.strictEqual(nodo?.nombreKind, 'Method');
    const ids = todosLosNodos(raiz).map((n) => n.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test('interfaz: Definición con Tipos', () => {
    const { simbolos, archivos } = leerFixture('interfaz');
    const raiz = construirArbolObjeto({ tipo: 'interfaz', nombre: 'zif_ejemplo', archivoAbierto: 'zif_ejemplo.intf.abap', archivos, simbolos });
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Definición']);
    const tipos = raiz.hijos[0].hijos.find((h) => h.etiqueta === 'Tipos');
    assert.ok(tipos && tipos.hijos.length >= 15);
    assert.ok(tipos.hijos.every((h) => h.icono === 'symbol-property'));
  });

  test('programa: Tablas, Datos, Eventos, Forms; eventos compuestos van a Eventos', () => {
    const { simbolos, archivos } = leerFixture('programa');
    const raiz = construirArbolObjeto({ tipo: 'programa', nombre: 'zprog_ejemplo', archivoAbierto: 'zprog_ejemplo.prog.abap', archivos, simbolos });
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Tablas', 'Datos', 'Eventos', 'Forms']);
    const [tablas, , eventos] = raiz.hijos;
    assert.strictEqual(tablas.hijos.length, 7);
    const nombresEventos = etiquetas(eventos.hijos);
    assert.ok(nombresEventos.includes('AT SELECTION-SCREEN ON VALUE-REQUEST FOR VAR_9'));
    assert.ok(nombresEventos.includes('TOP-OF-PAGE DURING LINE-SELECTION'));
    assert.ok(etiquetas(tablas.hijos).every((e) => !esEvento(e)));
  });

  test('include: solo Datos', () => {
    const { simbolos, archivos } = leerFixture('include');
    const raiz = construirArbolObjeto({ tipo: 'include', nombre: 'zinc_ejemplo', archivoAbierto: 'zinc_ejemplo.prog.abap', archivos, simbolos });
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Datos']);
  });

  test('cds: Archivos y aviso de fase 4, sin aviso de símbolos', () => {
    const { simbolos, archivos } = leerFixture('cds');
    const raiz = construirArbolObjeto({ tipo: 'cds', nombre: 'zcds_ejemplo', archivoAbierto: 'zcds_ejemplo.ddls.acds', archivos, simbolos });
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Archivos', 'Campos: pendiente (fase 4)']);
    assert.strictEqual(raiz.hijos[0].hijos.length, 2);
    assert.strictEqual(raiz.hijos[1].clase, 'aviso');
  });

  test('sin símbolos: nodo de aviso', () => {
    const raiz = construirArbolObjeto({ tipo: 'clase', nombre: 'z', archivoAbierto: 'z.clas.abap', archivos: ['z.clas.abap'], simbolos: [] });
    assert.strictEqual(raiz.hijos[0].etiqueta, AVISO_SIN_SIMBOLOS);
    assert.strictEqual(raiz.hijos[0].clase, 'aviso');
  });

  test('desconocido: símbolos directos y sección Archivos', () => {
    const simbolo: SimboloDocumento = { nombre: 'X', kind: 12, nombreKind: 'Function', rango: [1, 0, 2, 0], hijos: [] };
    const raiz = construirArbolObjeto({ tipo: 'desconocido', nombre: 'x', archivoAbierto: 'x.zzzz.abap', archivos: ['x.zzzz.abap'], simbolos: [simbolo] });
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['X', 'Archivos']);
    assert.strictEqual(raiz.hijos[0].clase, 'simbolo');
  });

  test('programa S/4: INCLUDE a Includes, TABLES a Tablas y eventos a Eventos', () => {
    const includes = [1, 2, 3, 4, 5].map((n) => objetoAbap(`ZPROG_INVENTADO_I0${n}`, n, 'INCLUDE'));
    const simbolos = [
      ...includes,
      objetoAbap('TABLA_X', 7, 'TABLES'),
      objetoAbap('START-OF-SELECTION', 9, 'START-OF-SELECTION'),
    ];
    const raiz = construirArbolObjeto({ tipo: 'programa', nombre: 'zprog_inventado', archivoAbierto: 'zprog_inventado.prog.abap', archivos: [], simbolos });
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Includes', 'Tablas', 'Eventos']);
    const [seccionIncludes, tablas, eventos] = raiz.hijos;
    assert.strictEqual(seccionIncludes.hijos.length, 5);
    for (const [indice, nodo] of seccionIncludes.hijos.entries()) {
      assert.strictEqual(nodo.clase, 'include');
      assert.strictEqual(nodo.icono, 'file-submodule');
      assert.strictEqual(nodo.nombreInclude, `ZPROG_INVENTADO_I0${indice + 1}`);
      assert.strictEqual(nodo.archivo, undefined);
      assert.deepStrictEqual(nodo.rango, [indice + 1, 8, indice + 1, 30]);
    }
    assert.deepStrictEqual(etiquetas(tablas.hijos), ['TABLA_X']);
    assert.deepStrictEqual(etiquetas(eventos.hijos), ['START-OF-SELECTION']);
  });

  test('programa S/4 (fixture): Includes, Tablas, Datos, Eventos, Forms', () => {
    const { simbolos, archivos } = programaS4ConDetalle();
    const raiz = construirArbolObjeto({ tipo: 'programa', nombre: 'zprog_ejemplo_s4', archivoAbierto: 'zprog_ejemplo_s4.prog.abap', archivos, simbolos });
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Includes', 'Tablas', 'Datos', 'Eventos', 'Forms']);
    assert.deepStrictEqual(etiquetas(raiz.hijos[0].hijos), ['ZPROG_EJEMPLO_S4_TOP', 'ZPROG_EJEMPLO_S4_F01']);
    assert.deepStrictEqual(etiquetas(raiz.hijos[1].hijos), ['TABLA_1']);
  });

  const RUTA_TOP =
    '/repotree-v1/DEST-S4/System Library/ZPAQ_S4/Source Code Library/Includes/ZPROG_EJEMPLO_S4_TOP/zprog_ejemplo_s4_top.prog.abap';
  const SIMBOLOS_TOP: SimboloDocumento[] = [
    { nombre: 'GV_UNO', kind: 12, nombreKind: 'Variable', rango: [1, 0, 1, 20], rangoSeleccion: [1, 5, 1, 11], hijos: [] },
    { nombre: 'GV_DOS', kind: 12, nombreKind: 'Variable', rango: [2, 0, 2, 20], rangoSeleccion: [2, 5, 2, 11], hijos: [] },
    { nombre: 'GV_TRES', kind: 12, nombreKind: 'Variable', rango: [3, 0, 3, 20], rangoSeleccion: [3, 5, 3, 12], hijos: [] },
    { nombre: 'FORM_TOP', kind: 11, nombreKind: 'Function', rango: [5, 0, 7, 9], rangoSeleccion: [5, 5, 5, 13], hijos: [] },
  ];

  test('programa S/4 con include abierto: el nodo include muestra su estructura con ruta e ids únicos', () => {
    const { simbolos, archivos } = programaS4ConDetalle();
    const raiz = construirArbolObjeto({
      tipo: 'programa',
      nombre: 'zprog_ejemplo_s4',
      archivoAbierto: 'zprog_ejemplo_s4.prog.abap',
      archivos,
      simbolos,
      includesAbiertos: [{ nombre: 'ZPROG_EJEMPLO_S4_TOP', ruta: RUTA_TOP, simbolos: SIMBOLOS_TOP }],
    });
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Includes', 'Tablas', 'Datos', 'Eventos', 'Forms']);
    const [top, f01] = raiz.hijos[0].hijos;
    assert.strictEqual(top.clase, 'include');
    assert.deepStrictEqual(etiquetas(top.hijos), ['Datos', 'Forms']);
    assert.deepStrictEqual(etiquetas(top.hijos[0].hijos), ['GV_UNO', 'GV_DOS', 'GV_TRES']);
    const simbolosTop = todosLosNodos(top).filter((n) => n.clase === 'simbolo');
    assert.strictEqual(simbolosTop.length, 4);
    for (const nodo of simbolosTop) {
      assert.strictEqual(nodo.ruta, RUTA_TOP);
      assert.strictEqual(nodo.archivo, undefined);
      assert.ok(nodo.id.startsWith('inc:ZPROG_EJEMPLO_S4_TOP#'), nodo.id);
    }
    assert.deepStrictEqual(f01.hijos, []);
    const ids = todosLosNodos(raiz).map((n) => n.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test('programa S/4 sin includes abiertos: los nodos include no tienen hijos', () => {
    const { simbolos, archivos } = programaS4ConDetalle();
    const raiz = construirArbolObjeto({ tipo: 'programa', nombre: 'zprog_ejemplo_s4', archivoAbierto: 'zprog_ejemplo_s4.prog.abap', archivos, simbolos });
    assert.ok(raiz.hijos[0].hijos.every((n) => n.hijos.length === 0 && n.ruta === undefined));
  });

  test('tabla: Archivos y aviso de campos, sin aviso de símbolos; abre el .ddic', () => {
    const archivos = archivosDeCarpetaS4('/Database%20Tables/ZTAB_EJEMPLO');
    const raiz = construirArbolObjeto({ tipo: 'tabla', nombre: 'ztab_ejemplo', archivoAbierto: 'ztab_ejemplo.tabl.ddic', archivos, simbolos: [] });
    assert.strictEqual(raiz.descripcion, 'Tabla');
    assert.strictEqual(raiz.icono, 'database');
    assert.strictEqual(raiz.archivo, 'ztab_ejemplo.tabl.ddic');
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Archivos', 'Campos: pendiente (fase 4)']);
    assert.deepStrictEqual(
      raiz.hijos[0].hijos.map((n) => n.archivo),
      ['ztab_ejemplo.tabl.ddic'],
      'el .tabl.json no se puede abrir con vscode.open: no se lista',
    );
  });

  test('estructura: igual que una tabla con su etiqueta e icono', () => {
    const archivos = ['zestr_ejemplo.tabl.json', 'zestr_ejemplo.tabl.ddic'];
    const raiz = construirArbolObjeto({ tipo: 'estructura', nombre: 'zestr_ejemplo', archivoAbierto: 'zestr_ejemplo.tabl.ddic', archivos, simbolos: [] });
    assert.strictEqual(raiz.descripcion, 'Estructura');
    assert.strictEqual(raiz.icono, 'symbol-structure');
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Archivos', 'Campos: pendiente (fase 4)']);
    assert.deepStrictEqual(etiquetas(raiz.hijos[0].hijos), ['zestr_ejemplo.tabl.ddic']);
  });

  test('grupo de funciones: Módulos de función e Includes con el principal primero', () => {
    const { archivos } = leerFixture('grupo-funciones', 'repotree-s4');
    const raiz = construirArbolObjeto({ tipo: 'grupoFunciones', nombre: 'zfg_ejemplo', archivoAbierto: 'zfg_ejemplo.fugr.json', archivos, simbolos: [] });
    assert.strictEqual(raiz.descripcion, 'Grupo de funciones');
    assert.strictEqual(raiz.icono, 'symbol-module');
    assert.strictEqual(raiz.archivo, 'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap');
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Módulos de función', 'Includes']);
    const [modulos, includes] = raiz.hijos;
    assert.deepStrictEqual(
      modulos.hijos.map((n) => [n.etiqueta, n.clase, n.icono, n.archivo]),
      [
        ['Z_FM_EJEMPLO', 'archivo', 'symbol-function', 'zfg_ejemplo.fugr.z_fm_ejemplo.func.abap'],
        ['Z_FM_EJEMPLO_2', 'archivo', 'symbol-function', 'zfg_ejemplo.fugr.z_fm_ejemplo_2.func.abap'],
      ],
    );
    assert.deepStrictEqual(
      includes.hijos.map((n) => [n.etiqueta, n.descripcion, n.icono, n.archivo]),
      [
        ['SAPLZFG_EJEMPLO', 'principal', 'file-submodule', 'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap'],
        ['LZFG_EJEMPLOTOP', undefined, 'file-submodule', 'zfg_ejemplo.fugr.lzfg_ejemplotop.reps.abap'],
      ],
    );
  });

  test('grupo de funciones: con símbolos añade la estructura del archivo abierto', () => {
    const { archivos } = leerFixture('grupo-funciones', 'repotree-s4');
    const abierto = 'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap';
    const simbolos = [objetoAbap('LZFG_EJEMPLOTOP', 1, 'INCLUDE'), objetoAbap('LZFG_EJEMPLOUXX', 2, 'INCLUDE')];
    const raiz = construirArbolObjeto({ tipo: 'grupoFunciones', nombre: 'zfg_ejemplo', archivoAbierto: abierto, archivos, simbolos });
    assert.deepStrictEqual(etiquetas(raiz.hijos), ['Módulos de función', 'Includes', 'Estructura de SAPLZFG_EJEMPLO']);
    const [seccion] = raiz.hijos[2].hijos;
    assert.strictEqual(seccion.etiqueta, 'Includes');
    assert.deepStrictEqual(seccion.hijos.map((n) => [n.clase, n.nombreInclude]), [['include', 'LZFG_EJEMPLOTOP'], ['include', 'LZFG_EJEMPLOUXX']]);
  });

  test('clase S/4: definitions, implementations y macros como includes locales', () => {
    const archivos = archivosDeCarpetaS4('/Classes/ZCL_EJEMPLO_S4');
    const raiz = construirArbolObjeto({ tipo: 'clase', nombre: 'zcl_ejemplo_s4', archivoAbierto: 'zcl_ejemplo_s4.clas.abap', archivos, simbolos: [] });
    const locales = raiz.hijos.find((n) => n.etiqueta === 'Includes locales');
    assert.deepStrictEqual(etiquetas(locales?.hijos ?? []), ['Definiciones locales', 'Implementaciones locales', 'Macros']);
  });

  test('palabraClave quita la puntuación y pasa a mayúsculas', () => {
    assert.strictEqual(palabraClave('TABLES:'), 'TABLES');
    assert.strictEqual(palabraClave('include'), 'INCLUDE');
    assert.strictEqual(palabraClave('START-OF-SELECTION.'), 'START-OF-SELECTION');
    assert.strictEqual(palabraClave(':'), '');
  });

  test('esEvento', () => {
    assert.ok(esEvento('AT SELECTION-SCREEN OUTPUT'));
    assert.ok(esEvento('GET pernr LATE'));
    assert.ok(!esEvento('MARA'));
  });
});

suite('nodo Diario', () => {
  const base: EntradaObjeto = {
    tipo: 'programa',
    nombre: 'zprog',
    archivoAbierto: 'zprog.prog.abap',
    archivos: ['zprog.prog.abap'],
    simbolos: [
      { nombre: 'GV_UNO', kind: 12, nombreKind: 'Variable', rango: [1, 0, 1, 20], rangoSeleccion: [1, 5, 1, 11], hijos: [] },
    ],
  };

  test('el diario es el último hijo de la raíz', () => {
    const raiz = construirArbolObjeto({ ...base, diario: { entradas: 3, ultima: '2026-11-04 10:45' } });
    const ultimo = raiz.hijos[raiz.hijos.length - 1];
    assert.equal(ultimo.clase, 'diario');
    assert.equal(ultimo.etiqueta, 'Diario');
    assert.equal(ultimo.descripcion, '3 entradas · última 2026-11-04 10:45');
  });

  test('sin entradas o sin resumen no hay nodo diario', () => {
    assert.ok(!construirArbolObjeto({ ...base, diario: { entradas: 0 } }).hijos.some((h) => h.clase === 'diario'));
    assert.ok(!construirArbolObjeto(base).hijos.some((h) => h.clase === 'diario'));
  });

  test('descripción en singular y sin última', () => {
    assert.equal(nodoDiario({ entradas: 1 }).descripcion, '1 entrada');
    assert.equal(nodoDiario({ entradas: 2 }).descripcion, '2 entradas');
    assert.equal(nodoDiario({ entradas: 1, ultima: 'x' }).descripcion, '1 entrada · última x');
    assert.equal(nodoDiario({ entradas: 1 }).icono, 'note');
  });
});
