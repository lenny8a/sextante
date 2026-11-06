import * as assert from 'node:assert/strict';
import {
  COMANDO_ABRIR_PANEL,
  COMANDO_CONECTAR,
  COMANDO_GENERAR_CASE,
  MAX_CAMPOS_HOVER,
  markdownCampo,
  markdownConectar,
  markdownElemento,
  markdownMensaje,
  markdownObjeto,
} from '../../src/diccionario/hover-modelo';
import type { CampoDiccionario, Dominio, ElementoDatos, ObjetoDiccionario } from '../../src/diccionario/modelo';
import type { Resuelto } from '../../src/diccionario/servicio';

const MARA: ObjetoDiccionario = {
  nombre: 'MARA',
  tipo: 'tabla',
  tipoAdt: 'TABL/DT',
  descripcion: 'General Material Data',
  paquete: 'MG',
  uriAdt: '/sap/bc/adt/ddic/tables/mara',
};

function campo(parcial: Partial<CampoDiccionario> = {}): CampoDiccionario {
  return {
    posicion: 1,
    nombre: 'CAMPO',
    clave: false,
    elementoDatos: 'ELEMENTO',
    tipo: 'CHAR',
    longitud: 10,
    decimales: 0,
    texto: 'Texto',
    ...parcial,
  };
}

function camposNumerados(n: number): CampoDiccionario[] {
  return Array.from({ length: n }, (_, i) => campo({ posicion: i + 1, nombre: `CAMPO${i + 1}`, clave: i < 2 }));
}

/** Filas de datos de la tabla Markdown (sin cabecera ni separador). */
function filasTabla(markdown: string): string[] {
  const filas = markdown.split('\n').filter((l) => l.startsWith('|'));
  return filas.slice(2);
}

const MATNR: ElementoDatos = {
  nombre: 'MATNR',
  descripcion: 'Material Number',
  dominio: 'MATNR',
  tipo: 'CHAR',
  longitud: 40,
  decimales: 0,
  etiquetas: { corta: 'Material', media: 'Material', larga: 'Material Number', cabecera: 'Material' },
  ayudaBusqueda: 'S_MAT1',
};

const MTART: Dominio = {
  nombre: 'MTART',
  descripcion: 'Material Type',
  tipo: 'CHAR',
  longitud: 4,
  tablaValores: 'T134',
  valores: Array.from({ length: 12 }, (_, i) => ({ valor: `V${i + 1}`, texto: `Valor ${i + 1}` })),
};

const SIN_VALORES: Dominio = { ...MTART, valores: [] };

/** El argumento JSON del primer enlace a `comando` del Markdown; `undefined` si no hay enlace. */
function argumentoDe(markdown: string, comando: string): unknown {
  const inicio = markdown.indexOf(`command:${comando}?`);
  if (inicio < 0) {
    return undefined;
  }
  const codificado = markdown.slice(inicio + comando.length + 'command:?'.length, markdown.indexOf(')', inicio));
  return JSON.parse(decodeURIComponent(codificado));
}

suite('diccionario-hover-modelo', () => {
  test('constantes de los comandos y del máximo de campos', () => {
    assert.equal(MAX_CAMPOS_HOVER, 15);
    assert.equal(COMANDO_ABRIR_PANEL, 'abapNavigator.diccionario.abrir');
    assert.equal(COMANDO_CONECTAR, 'abapNavigator.diccionario.conectar');
    assert.equal(COMANDO_GENERAR_CASE, 'abapNavigator.diccionario.generarCase');
  });

  suite('markdownObjeto', () => {
    test('cabecera con nombre, tipo, descripción y paquete', () => {
      const md = markdownObjeto({ objeto: MARA, campos: [] }, 'DEST');
      assert.equal(md.split('\n')[0], '**MARA** · Tabla transparente · General Material Data · paquete MG');
    });

    test('sin paquete ni descripción la cabecera los omite', () => {
      const md = markdownObjeto({ objeto: { ...MARA, paquete: undefined, descripcion: '' } }, 'DEST');
      assert.equal(md.split('\n')[0], '**MARA** · Tabla transparente');
    });

    test('etiqueta del tipo para estructura, elemento de datos y dominio', () => {
      const cabecera = (tipo: ObjetoDiccionario['tipo']): string =>
        markdownObjeto({ objeto: { ...MARA, tipo, paquete: undefined, descripcion: '' } }, 'DEST').split('\n')[0];
      assert.equal(cabecera('estructura'), '**MARA** · Estructura');
      assert.equal(cabecera('elementoDatos'), '**MARA** · Elemento de datos');
      assert.equal(cabecera('dominio'), '**MARA** · Dominio');
    });

    test('con 262 campos la tabla tiene 15 filas y el pie dice 247 campos más con el enlace al panel', () => {
      const resuelto: Resuelto = { objeto: MARA, campos: camposNumerados(262) };
      const md = markdownObjeto(resuelto, 'DEST');
      assert.equal(filasTabla(md).length, MAX_CAMPOS_HOVER);
      assert.ok(md.includes('… y 247 campos más en el panel Diccionario'), md);
      const argumento = encodeURIComponent(JSON.stringify({ destino: 'DEST', nombre: 'MARA' }));
      assert.ok(md.includes(`command:abapNavigator.diccionario.abrir?${argumento}`), md);
    });

    test('cabecera de la tabla y 🔑 solo en los campos clave', () => {
      const md = markdownObjeto({ objeto: MARA, campos: camposNumerados(4) }, 'DEST');
      const lineas = md.split('\n').filter((l) => l.startsWith('|'));
      assert.equal(lineas[0], '| 🔑 | Campo | Elem. datos | Tipo | Texto |');
      const filas = filasTabla(md);
      assert.equal(filas.length, 4);
      assert.deepEqual(filas.map((f) => f.includes('🔑')), [true, true, false, false]);
      assert.equal(filas[0], '| 🔑 | CAMPO1 | ELEMENTO | CHAR 10 | Texto |');
      assert.equal(filas[2], '|  | CAMPO3 | ELEMENTO | CHAR 10 | Texto |');
      assert.ok(!md.includes('campos más'), md);
    });

    test('tipo con decimales solo cuando son > 0', () => {
      const md = markdownObjeto({ objeto: MARA, campos: [campo({ tipo: 'DEC', longitud: 13, decimales: 3 }), campo({ tipo: 'CHAR', longitud: 40 })] }, 'DEST');
      const filas = filasTabla(md);
      assert.ok(filas[0].includes('| DEC 13,3 |'), filas[0]);
      assert.ok(filas[1].includes('| CHAR 40 |'), filas[1]);
    });

    test('escapa | y saltos de línea en los textos', () => {
      const md = markdownObjeto({ objeto: { ...MARA, descripcion: 'a|b\nc' }, campos: [campo({ texto: 'x|y\r\nz' })] }, 'DEST');
      assert.ok(md.split('\n')[0].includes('a\\|b c'), md);
      assert.equal(filasTabla(md)[0], '|  | CAMPO | ELEMENTO | CHAR 10 | x\\|y z |');
    });

    test('un elemento de datos resuelto sin campos no lleva tabla', () => {
      const md = markdownObjeto({ objeto: { ...MARA, tipo: 'elementoDatos' } }, 'DEST');
      assert.equal(filasTabla(md).length, 0);
    });
  });

  suite('markdownCampo', () => {
    test('cabecera tabla-campo, elemento, tipo y texto', () => {
      const c = campo({ nombre: 'MTART', elementoDatos: 'MTART', tipo: 'CHAR', longitud: 4, texto: 'Material Type' });
      const md = markdownCampo('MARA', c);
      assert.equal(md.split('\n')[0], '**MARA-MTART** · MTART · CHAR 4 · Material Type');
    });

    test('con dominio muestra su nombre, tabla de valores y hasta 10 valores fijos', () => {
      const c = campo({ nombre: 'MTART', elementoDatos: 'MTART', tipo: 'CHAR', longitud: 4, texto: 'Material Type' });
      const md = markdownCampo('MARA', c, undefined, MTART);
      assert.ok(md.includes('Dominio **MTART** · Material Type'), md);
      assert.ok(md.includes('T134'), md);
      assert.ok(md.includes('`V10`'), md);
      assert.ok(!md.includes('`V11`'), md);
      assert.ok(md.includes('… y 2 valores más'), md);
    });

    test('dominio con valores: enlace Generar CASE con destino, dominio y la expresión bajo el cursor', () => {
      const c = campo({ nombre: 'MTART', elementoDatos: 'MTART', tipo: 'CHAR', longitud: 4, texto: 'Material Type' });
      const md = markdownCampo('MARA', c, undefined, MTART, 'DEST', 'ls_mara-mtart');
      assert.ok(md.includes('[$(list-unordered) Generar CASE](command:abapNavigator.diccionario.generarCase?'), md);
      assert.deepEqual(argumentoDe(md, COMANDO_GENERAR_CASE), { destino: 'DEST', dominio: 'MTART', variable: 'ls_mara-mtart' });
    });

    test('sin expresión del cursor, el enlace usa la tabulación lv_<campo>', () => {
      const c = campo({ nombre: 'MTART', elementoDatos: 'MTART' });
      const md = markdownCampo('MARA', c, undefined, MTART, 'DEST');
      assert.deepEqual(argumentoDe(md, COMANDO_GENERAR_CASE), { destino: 'DEST', dominio: 'MTART', variable: '${1:lv_mtart}' });
    });

    test('sin valores fijos o sin destino no hay enlace Generar CASE', () => {
      const c = campo({ nombre: 'MTART', elementoDatos: 'MTART' });
      assert.ok(!markdownCampo('MARA', c, undefined, SIN_VALORES, 'DEST', 'ls_mara-mtart').includes('Generar CASE'));
      assert.ok(!markdownCampo('MARA', c, undefined, MTART).includes('Generar CASE'));
    });

    test('con elemento de datos muestra su descripción', () => {
      const c = campo({ nombre: 'MATNR', elementoDatos: 'MATNR', tipo: 'CHAR', longitud: 40, texto: 'Material' });
      const md = markdownCampo('MARA', c, MATNR);
      assert.ok(md.includes('Material Number'), md);
    });
  });

  suite('markdownElemento', () => {
    test('cabecera, tipo, dominio y etiquetas', () => {
      const md = markdownElemento(MATNR);
      assert.equal(md.split('\n')[0], '**MATNR** · Elemento de datos · Material Number');
      assert.ok(md.includes('CHAR 40'), md);
      assert.ok(md.includes('dominio MATNR'), md);
      assert.ok(md.includes('Material Number'), md);
      assert.ok(md.includes('S_MAT1'), md);
    });

    test('dominio con valores: enlace Generar CASE con la expresión bajo el cursor o lv_<elemento>', () => {
      const conVariable = markdownElemento(MATNR, MTART, 'DEST', 'lv_tipo');
      assert.deepEqual(argumentoDe(conVariable, COMANDO_GENERAR_CASE), { destino: 'DEST', dominio: 'MTART', variable: 'lv_tipo' });
      const sinVariable = markdownElemento(MATNR, MTART, 'DEST');
      assert.deepEqual(argumentoDe(sinVariable, COMANDO_GENERAR_CASE), { destino: 'DEST', dominio: 'MTART', variable: '${1:lv_matnr}' });
    });

    test('sin valores fijos no hay enlace Generar CASE', () => {
      assert.ok(!markdownElemento(MATNR, SIN_VALORES, 'DEST', 'lv_tipo').includes('Generar CASE'));
      assert.ok(!markdownElemento(MATNR).includes('Generar CASE'));
    });
  });

  suite('markdownMensaje', () => {
    test('con tipo lo pone en la cabecera y conserva &1', () => {
      const md = markdownMensaje({ clase: 'ZMSG', numero: '001', texto: 'El material &1 no existe', idioma: 'S' }, 'E');
      assert.equal(md, '**ZMSG 001 (E)** · El material &1 no existe');
    });

    test('sin tipo no lo pone', () => {
      const md = markdownMensaje({ clase: 'ZMSG', numero: '001', texto: '&1 &2', idioma: 'S' });
      assert.equal(md, '**ZMSG 001** · &1 &2');
    });
  });

  suite('markdownConectar', () => {
    test('texto y enlace al comando de conectar con el destino', () => {
      const md = markdownConectar('DEST');
      assert.ok(md.includes('Conéctate al sistema para ver el diccionario'), md);
      const argumento = encodeURIComponent(JSON.stringify({ destino: 'DEST' }));
      assert.ok(md.includes(`command:abapNavigator.diccionario.conectar?${argumento}`), md);
    });
  });
});
