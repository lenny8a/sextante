import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { analizarDataPreview } from '../../src/adt/transaccion';
import { analizarUsos, filtrarUsos } from '../../src/diccionario/donde-se-usa';
import { analizarMetadatosDdic, camposDe, type CampoDiccionario, type Dominio, type ElementoDatos } from '../../src/diccionario/modelo';
import {
  admiteDatos,
  campoParaCargar,
  caseDeCampo,
  caseDeDominio,
  caseDeLectura,
  conCampoSeleccionado,
  etiquetaDe,
  hijosDe,
  iconoDe,
  idDe,
  nodosRaiz,
  nombreACopiar,
  resultadoDdl,
  resultadoUso,
  tieneCampos,
  type EstadoPanel,
  type NodoCampo,
  type NodoDiccionario,
} from '../../src/diccionario/panel-modelo';
import type { DatosTabla, Resuelto } from '../../src/diccionario/servicio';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function maraDeFixtures(): Resuelto {
  const objeto = analizarMetadatosDdic(fixture('tabla-mara.xml'));
  assert.ok(objeto);
  return { objeto, campos: camposDe(analizarDataPreview(fixture('dd03vt-mara.xml'))) };
}

function estado(parcial: Partial<EstadoPanel> = {}): EstadoPanel {
  return { destino: 'DEST', fijado: false, ...parcial };
}

function campo(parcial: Partial<CampoDiccionario> = {}): CampoDiccionario {
  return {
    posicion: 1,
    nombre: 'MATNR',
    clave: true,
    elementoDatos: 'MATNR',
    tipo: 'CHAR',
    longitud: 40,
    decimales: 0,
    texto: 'Número de material',
    ...parcial,
  };
}

const MATNR: ElementoDatos = {
  nombre: 'MATNR',
  descripcion: 'Número de material',
  dominio: 'MATNR',
  tipo: 'CHAR',
  longitud: 40,
  decimales: 0,
  etiquetas: { corta: 'Material', media: 'Material', larga: 'Número de material', cabecera: 'Material' },
};

const MTART: Dominio = {
  nombre: 'MTART',
  descripcion: 'Tipo de material',
  tipo: 'CHAR',
  longitud: 4,
  valores: [
    { valor: 'FERT', texto: 'Producto terminado' },
    { valor: 'ROH', texto: 'Materia prima' },
  ],
};

function elementoResuelto(): Resuelto {
  return {
    objeto: {
      nombre: 'MATNR',
      tipo: 'elementoDatos',
      tipoAdt: 'DTEL/DE',
      descripcion: 'Número de material',
      paquete: 'MG',
      uriAdt: '/sap/bc/adt/ddic/dataelements/matnr',
    },
  };
}

/** dp-mara-datos.xml (5 filas de 43) con MANDT delante, como lo devolvería un SELECT de todo el catálogo. */
function datosMara(): DatosTabla {
  const filas = analizarDataPreview(fixture('dp-mara-datos.xml'));
  const columnas = ['MANDT', ...Object.keys(filas[0])];
  return { columnas, filas: filas.map((f) => columnas.map((c) => (c === 'MANDT' ? '100' : f[c] ?? ''))), total: 43 };
}

type NodoGrupoDatos = Extract<NodoDiccionario, { clase: 'grupoDatos' }>;

function grupoDatosDe(e: EstadoPanel): NodoGrupoDatos {
  const grupo = nodosRaiz(e).find((n): n is NodoGrupoDatos => n.clase === 'grupoDatos');
  assert.ok(grupo, 'sin grupo Datos');
  return grupo;
}

function clases(nodos: NodoDiccionario[]): string[] {
  return nodos.map((n) => n.clase);
}

suite('diccionario-panel-modelo', () => {
  suite('raíz', () => {
    test('con MARA de las fixtures: cabecera + grupo de campos con el total', () => {
      const resuelto = maraDeFixtures();
      const raiz = nodosRaiz(estado({ resuelto }));
      assert.deepEqual(clases(raiz), ['cabecera', 'grupoCampos']);
      const [cabecera, grupo] = raiz;
      assert.equal(cabecera.clase === 'cabecera' && cabecera.objeto.nombre, 'MARA');
      assert.equal(grupo.clase === 'grupoCampos' && grupo.total, resuelto.campos?.length);
    });

    test('sin objeto ni motivo: un nodo vacío que invita a poner el cursor', () => {
      const raiz = nodosRaiz(estado());
      assert.deepEqual(clases(raiz), ['vacio']);
      assert.match(etiquetaDe(raiz[0]).label, /^Pon el cursor sobre una tabla/);
    });

    test("motivoVacio 'conectar': un nodo vacío con «Conéctate»", () => {
      const raiz = nodosRaiz(estado({ motivoVacio: 'conectar' }));
      assert.deepEqual(clases(raiz), ['vacio']);
      assert.match(etiquetaDe(raiz[0]).label, /Conéctate/);
      assert.equal(etiquetaDe(raiz[0]).contextValue, 'vacio');
    });

    test("motivoVacio 'sinVia' y 'cargando' tienen su texto", () => {
      assert.equal(etiquetaDe(nodosRaiz(estado({ motivoVacio: 'sinVia' }))[0]).label, 'Sin vía RFC en este sistema');
      assert.match(etiquetaDe(nodosRaiz(estado({ motivoVacio: 'cargando' }))[0]).label, /^Cargando/);
    });

    test('el motivo manda sobre un objeto ya resuelto', () => {
      const raiz = nodosRaiz(estado({ resuelto: maraDeFixtures(), motivoVacio: 'conectar' }));
      assert.deepEqual(clases(raiz), ['vacio']);
    });

    test('elemento de datos: cabecera + nodo elemento; elemento → dominio → valores', () => {
      const e = estado({ resuelto: elementoResuelto(), elemento: { ...MATNR, dominio: 'MTART' }, dominio: MTART });
      const raiz = nodosRaiz(e);
      assert.deepEqual(clases(raiz), ['cabecera', 'elemento']);
      const dominios = hijosDe(raiz[1], e);
      assert.deepEqual(clases(dominios), ['dominio']);
      const valores = hijosDe(dominios[0], e);
      assert.deepEqual(valores.map((v) => etiquetaDe(v).label), ['FERT', 'ROH']);
      assert.equal(etiquetaDe(valores[0]).description, 'Producto terminado');
    });

    test('elemento de datos sin detalle cargado: solo la cabecera', () => {
      assert.deepEqual(clases(nodosRaiz(estado({ resuelto: elementoResuelto() }))), ['cabecera']);
    });
  });

  suite('campos', () => {
    test('hijosDe(grupoCampos) agrupa los campos con include bajo un nodo include y deja el resto planos', () => {
      const base = maraDeFixtures();
      const campos = (base.campos ?? []).map((c, i) => (i >= 3 && i <= 5 ? { ...c, include: 'EMARA' } : c));
      const e = estado({ resuelto: { ...base, campos } });
      const [, grupo] = nodosRaiz(e);
      const hijos = hijosDe(grupo, e);
      assert.equal(hijos.length, campos.length - 3 + 1);
      assert.deepEqual(clases(hijos.slice(0, 5)), ['campo', 'campo', 'campo', 'include', 'campo']);
      const include = hijos[3];
      assert.ok(include.clase === 'include');
      assert.equal(include.nombre, 'EMARA');
      assert.deepEqual(include.campos.map((c) => c.nombre), campos.slice(3, 6).map((c) => c.nombre));
      assert.equal(etiquetaDe(include).label, '.INCLUDE EMARA · 3 campos');
      assert.equal(etiquetaDe(include).colapsable, 'cerrado');
      const deInclude = hijosDe(include, e);
      assert.deepEqual(clases(deInclude), ['campo', 'campo', 'campo']);
      assert.ok(deInclude.every((n) => n.clase === 'campo' && n.tabla === 'MARA'));
    });

    test('etiquetaDe(campo clave) empieza por 🔑 y describe elemento · tipo · texto', () => {
      const etiqueta = etiquetaDe({ clase: 'campo', tabla: 'MARA', campo: campo() });
      assert.ok(etiqueta.label.startsWith('🔑'), etiqueta.label);
      assert.equal(etiqueta.label, '🔑 MATNR');
      assert.equal(etiqueta.description, 'MATNR · CHAR 40 · Número de material');
      assert.equal(etiqueta.contextValue, 'campo');
      assert.equal(etiqueta.colapsable, 'no');
      assert.ok(etiqueta.tooltip?.includes('**MARA-MATNR**'), etiqueta.tooltip);
      assert.equal(etiqueta.tooltipMarkdown, true);
    });

    test('campo sin clave: solo el nombre; con decimales: DEC 13,3', () => {
      const etiqueta = etiquetaDe({
        clase: 'campo', tabla: 'MARA', campo: campo({ nombre: 'BRGEW', clave: false, elementoDatos: 'BRGEW', tipo: 'QUAN', longitud: 13, decimales: 3, texto: 'Peso bruto' }),
      });
      assert.equal(etiqueta.label, 'BRGEW');
      assert.equal(etiqueta.description, 'BRGEW · QUAN 13,3 · Peso bruto');
    });
  });

  suite('etiquetas', () => {
    test('cabecera: nombre y «Tipo · descripción · paquete»', () => {
      const { objeto } = maraDeFixtures();
      const etiqueta = etiquetaDe({ clase: 'cabecera', objeto, fijado: false });
      assert.equal(etiqueta.label, 'MARA');
      assert.equal(etiqueta.description, ['Tabla transparente', objeto.descripcion, objeto.paquete].filter(Boolean).join(' · '));
      assert.equal(etiqueta.contextValue, 'cabecera');
    });

    test('cabecera sin paquete ni descripción: omite las partes que faltan', () => {
      const etiqueta = etiquetaDe({
        clase: 'cabecera',
        objeto: { nombre: 'BAPIRET2', tipo: 'estructura', tipoAdt: 'TABL/DS', descripcion: '', uriAdt: '/sap/bc/adt/ddic/structures/bapiret2' },
        fijado: true,
      });
      assert.equal(etiqueta.description, 'Estructura');
    });

    test('grupoCampos: «Campos (N)» abierto', () => {
      const etiqueta = etiquetaDe({ clase: 'grupoCampos', total: 262 });
      assert.equal(etiqueta.label, 'Campos (262)');
      assert.equal(etiqueta.colapsable, 'abierto');
      assert.equal(etiqueta.contextValue, 'grupoCampos');
    });

    test('grupoCampos sin campos: «Campos (0)» no se puede desplegar', () => {
      const etiqueta = etiquetaDe({ clase: 'grupoCampos', total: 0 });
      assert.equal(etiqueta.label, 'Campos (0)');
      assert.equal(etiqueta.colapsable, 'no');
    });

    test('contextValue de elemento, dominio y valor', () => {
      assert.equal(etiquetaDe({ clase: 'elemento', elemento: MATNR }).contextValue, 'elemento');
      assert.equal(etiquetaDe({ clase: 'dominio', dominio: MTART }).contextValue, 'dominioConValores');
      assert.equal(etiquetaDe({ clase: 'dominio', dominio: { ...MTART, valores: [] } }).contextValue, 'dominio');
      assert.equal(etiquetaDe({ clase: 'valor', valor: 'FERT', texto: 'Producto terminado' }).contextValue, 'valor');
    });

    test('campo seleccionado → resuelto → contextValue: campoConValores solo con su dominio con valores', () => {
      const mtart: NodoCampo = { clase: 'campo', tabla: 'MARA', campo: campo({ nombre: 'MTART', elementoDatos: 'MTART' }) };
      const matnr: NodoCampo = { clase: 'campo', tabla: 'MARA', campo: campo() };
      const mostrando = estado({ resuelto: maraDeFixtures() });
      assert.equal(campoParaCargar([mtart]), mtart);
      assert.equal(campoParaCargar([mtart, matnr]), undefined);
      assert.equal(campoParaCargar([{ clase: 'dominio', dominio: MTART }]), undefined);
      assert.equal(etiquetaDe(mtart, mostrando).contextValue, 'campo');
      const resuelto = conCampoSeleccionado(mostrando, { tabla: 'MARA', resuelto: { campo: mtart.campo, dominio: MTART } });
      assert.equal(etiquetaDe(mtart, resuelto).contextValue, 'campoConValores');
      assert.equal(etiquetaDe(matnr, resuelto).contextValue, 'campo');
      assert.equal(etiquetaDe(mtart).contextValue, 'campo');
      const sinValores = conCampoSeleccionado(mostrando, { tabla: 'MARA', resuelto: { campo: mtart.campo, dominio: { ...MTART, valores: [] } } });
      assert.equal(etiquetaDe(mtart, sinValores).contextValue, 'campo');
    });

    test('conCampoSeleccionado no cambia el estado si ya muestra otra tabla', () => {
      const mostrando = estado({ resuelto: maraDeFixtures() });
      const deOtra = conCampoSeleccionado(mostrando, { tabla: 'ZTABLA_EJEMPLO', resuelto: { campo: campo(), dominio: MTART } });
      assert.equal(deOtra, mostrando);
    });

    test('caseDeCampo y caseDeDominio: lv_<campo>/lv_<dominio> o el aviso con el nombre del dominio o del campo', () => {
      const nodo: NodoCampo = { clase: 'campo', tabla: 'MARA', campo: campo({ nombre: 'MTART_X', elementoDatos: 'MTART' }) };
      assert.deepEqual(caseDeDominio(MTART), { dominio: MTART, variable: '${1:lv_mtart}' });
      assert.deepEqual(caseDeDominio(MTART, 'ls_mara-mtart'), { dominio: MTART, variable: 'ls_mara-mtart' });
      assert.deepEqual(caseDeDominio({ ...MTART, valores: [] }), { aviso: 'El dominio MTART no tiene valores fijos' });
      assert.deepEqual(caseDeCampo(nodo, { campo: nodo.campo, dominio: MTART }), { dominio: MTART, variable: '${1:lv_mtart_x}' });
      assert.deepEqual(caseDeCampo(nodo, { campo: nodo.campo, dominio: { ...MTART, valores: [] } }), { aviso: 'El dominio MTART no tiene valores fijos' });
      assert.deepEqual(caseDeCampo(nodo, { campo: nodo.campo }), { aviso: 'El dominio MTART_X no tiene valores fijos' });
      assert.deepEqual(caseDeCampo(nodo, undefined), { aviso: 'El dominio MTART_X no tiene valores fijos' });
    });

    test('caseDeLectura: un fallo al leer el dominio no se confunde con «sin valores fijos»', () => {
      assert.deepEqual(caseDeLectura('MTART', { error: true }), { aviso: 'No se pudo leer el dominio MTART' });
      assert.deepEqual(caseDeLectura('MTART', { dominio: undefined }), { aviso: 'El dominio MTART no tiene valores fijos' });
      assert.deepEqual(caseDeLectura('MTART', { dominio: { ...MTART, valores: [] } }), { aviso: 'El dominio MTART no tiene valores fijos' });
      assert.deepEqual(caseDeLectura('MTART', { dominio: MTART }, 'ls_mara-mtart'), { dominio: MTART, variable: 'ls_mara-mtart' });
    });

    test('iconos por clase y tipo de objeto', () => {
      const { objeto } = maraDeFixtures();
      assert.equal(iconoDe({ clase: 'cabecera', objeto, fijado: false }), 'symbol-structure');
      assert.equal(iconoDe({ clase: 'cabecera', objeto: elementoResuelto().objeto, fijado: false }), 'symbol-field');
      assert.equal(iconoDe({ clase: 'grupoCampos', total: 1 }), 'list-tree');
      assert.equal(iconoDe({ clase: 'include', nombre: 'EMARA', campos: [] }), 'symbol-namespace');
      assert.equal(iconoDe({ clase: 'campo', tabla: 'MARA', campo: campo() }), undefined);
      assert.equal(iconoDe({ clase: 'vacio', etiqueta: 'x' }), 'info');
    });
  });

  suite('datos', () => {
    test('Data Preview solo admite tablas (verificado 2026-10-31: rechaza estructuras); campos, tablas y estructuras', () => {
      assert.equal(admiteDatos('tabla'), true);
      assert.equal(admiteDatos('estructura'), false);
      assert.equal(admiteDatos('elementoDatos'), false);
      assert.equal(admiteDatos(undefined), false);
      assert.equal(tieneCampos('tabla'), true);
      assert.equal(tieneCampos('estructura'), true);
      assert.equal(tieneCampos('dominio'), false);
      assert.equal(tieneCampos(undefined), false);
    });

    test('sin datos pedidos no hay grupo Datos; con datos va después de Campos', () => {
      const resuelto = maraDeFixtures();
      assert.deepEqual(clases(nodosRaiz(estado({ resuelto }))), ['cabecera', 'grupoCampos']);
      const e = estado({ resuelto, datos: { pedidas: 50, cargando: false, datos: datosMara() } });
      assert.deepEqual(clases(nodosRaiz(e)), ['cabecera', 'grupoCampos', 'grupoDatos']);
    });

    test('el grupo Datos muestra «Datos (5 de 43)» y la fila 1 describe MANDT · MATNR', () => {
      const e = estado({ resuelto: maraDeFixtures(), datos: { pedidas: 50, cargando: false, datos: datosMara() } });
      const grupo = grupoDatosDe(e);
      assert.equal(grupo.cargadas, 5);
      const etiqueta = etiquetaDe(grupo);
      assert.equal(etiqueta.label, 'Datos (5 de 43)');
      assert.equal(etiqueta.contextValue, 'grupoDatos');
      assert.equal(etiqueta.colapsable, 'abierto');
      const filas = hijosDe(grupo, e);
      assert.equal(filas.length, 5);
      assert.deepEqual(clases(filas), ['fila', 'fila', 'fila', 'fila', 'fila']);
      const primera = etiquetaDe(filas[0]);
      assert.equal(primera.label, '1');
      assert.equal(primera.description, '100 · MAT00001');
      assert.equal(primera.contextValue, 'fila');
      assert.equal(primera.colapsable, 'cerrado');
      assert.equal(etiquetaDe(filas[4]).label, '5');
    });

    test('las celdas de una fila siguen el orden de las columnas; un valor vacío se ve «(vacío)»', () => {
      const datos: DatosTabla = { columnas: ['MANDT', 'MATNR', 'MTART'], filas: [['100', 'MAT00001', '']], total: 1 };
      const e = estado({ resuelto: maraDeFixtures(), datos: { pedidas: 50, cargando: false, datos } });
      const [fila] = hijosDe(grupoDatosDe(e), e);
      const celdas = hijosDe(fila, e);
      assert.deepEqual(celdas.map((c) => etiquetaDe(c).label), ['MANDT', 'MATNR', 'MTART']);
      assert.deepEqual(celdas.map((c) => etiquetaDe(c).description), ['100', 'MAT00001', '(vacío)']);
      assert.ok(celdas.every((c) => etiquetaDe(c).contextValue === 'celda' && etiquetaDe(c).colapsable === 'no'));
    });

    test('sin total: «Datos (N, hay más)» si llegaron todas las pedidas y «Datos (N)» si no', () => {
      const resuelto = maraDeFixtures();
      const filas = (n: number): string[][] => Array.from({ length: n }, (_, i) => ['100', `MAT${i}`]);
      const lleno = estado({ resuelto, datos: { pedidas: 50, cargando: false, datos: { columnas: ['MANDT', 'MATNR'], filas: filas(50) } } });
      assert.equal(etiquetaDe(grupoDatosDe(lleno)).label, 'Datos (50, hay más)');
      const corto = estado({ resuelto, datos: { pedidas: 50, cargando: false, datos: { columnas: ['MANDT', 'MATNR'], filas: filas(3) } } });
      assert.equal(etiquetaDe(grupoDatosDe(corto)).label, 'Datos (3)');
    });

    test('con total menor que las filas recibidas cuenta como mucho el total', () => {
      const datos: DatosTabla = { columnas: ['MANDT'], filas: [['1'], ['2'], ['3']], total: 2 };
      const grupo = grupoDatosDe(estado({ resuelto: maraDeFixtures(), datos: { pedidas: 50, cargando: false, datos } }));
      assert.equal(etiquetaDe(grupo).label, 'Datos (2 de 2)');
    });

    test('cargando: «Datos (cargando…)» y conserva las filas anteriores mientras llega la respuesta', () => {
      const resuelto = maraDeFixtures();
      const primera = estado({ resuelto, datos: { pedidas: 50, cargando: true } });
      assert.equal(etiquetaDe(grupoDatosDe(primera)).label, 'Datos (cargando…)');
      assert.equal(etiquetaDe(grupoDatosDe(primera)).colapsable, 'no');
      const mas = estado({ resuelto, datos: { pedidas: 100, cargando: true, datos: datosMara() } });
      assert.equal(etiquetaDe(grupoDatosDe(mas)).label, 'Datos (cargando…)');
      assert.equal(hijosDe(grupoDatosDe(mas), mas).length, 5);
    });

    test('error: «Datos (error: ErrorAdt)» con un hijo que muestra el mensaje', () => {
      const e = estado({
        resuelto: maraDeFixtures(),
        datos: { pedidas: 50, cargando: false, error: { nombre: 'ErrorAdt', mensaje: 'La tabla no admite vista previa' } },
      });
      const grupo = grupoDatosDe(e);
      assert.equal(etiquetaDe(grupo).label, 'Datos (error: ErrorAdt)');
      assert.equal(etiquetaDe(grupo).colapsable, 'abierto');
      const hijos = hijosDe(grupo, e);
      assert.equal(hijos.length, 1);
      assert.equal(etiquetaDe(hijos[0]).label, 'La tabla no admite vista previa');
      assert.equal(iconoDe(hijos[0]), 'error');
    });

    test('sin campos clave en el catálogo la fila se describe con las dos primeras columnas', () => {
      const resuelto: Resuelto = { ...maraDeFixtures(), campos: [campo({ nombre: 'A', clave: false }), campo({ nombre: 'B', clave: false })] };
      const datos: DatosTabla = { columnas: ['A', 'B', 'C'], filas: [['x', 'y', 'z']] };
      const e = estado({ resuelto, datos: { pedidas: 50, cargando: false, datos } });
      const [fila] = hijosDe(grupoDatosDe(e), e);
      assert.equal(etiquetaDe(fila).description, 'x · y');
    });

    test('un elemento de datos nunca lleva grupo Datos', () => {
      const e = estado({ resuelto: elementoResuelto(), elemento: MATNR, datos: { pedidas: 50, cargando: false, datos: datosMara() } });
      assert.deepEqual(clases(nodosRaiz(e)), ['cabecera', 'elemento']);
    });

    test('iconos: tabla en el grupo Datos', () => {
      const e = estado({ resuelto: maraDeFixtures(), datos: { pedidas: 50, cargando: false, datos: datosMara() } });
      assert.equal(iconoDe(grupoDatosDe(e)), 'table');
    });

    test('idDe es único con datos: filas y celdas de filas distintas', () => {
      const e = estado({ resuelto: maraDeFixtures(), datos: { pedidas: 50, cargando: false, datos: datosMara() } });
      const ids: string[] = [];
      const recorrer = (nodos: NodoDiccionario[]): void => {
        for (const n of nodos) {
          ids.push(idDe(n));
          recorrer(hijosDe(n, e));
        }
      };
      recorrer(nodosRaiz(e));
      assert.ok(ids.includes('grupoDatos'));
      assert.equal(new Set(ids).size, ids.length);
    });
  });

  suite('dónde se usa', () => {
    const resultadoMara = filtrarUsos(analizarUsos(fixture('whereused-mara.xml')), ['Z', 'Y']);

    function grupoUsosDe(e: EstadoPanel): NodoDiccionario {
      const grupo = nodosRaiz(e).find((n) => n.clase === 'grupoUsos');
      assert.ok(grupo, 'sin grupo Dónde se usa');
      return grupo;
    }

    test('sin pedir no hay grupo; pedido va al final, también en un elemento de datos', () => {
      const resuelto = maraDeFixtures();
      assert.deepEqual(clases(nodosRaiz(estado({ resuelto }))), ['cabecera', 'grupoCampos']);
      const usos = { cargando: false, resultado: resultadoMara };
      const conDatos = estado({ resuelto, datos: { pedidas: 50, cargando: false, datos: datosMara() }, usos });
      assert.deepEqual(clases(nodosRaiz(conDatos)), ['cabecera', 'grupoCampos', 'grupoDatos', 'grupoUsos']);
      const e = estado({ resuelto: elementoResuelto(), elemento: MATNR, usos });
      assert.deepEqual(clases(nodosRaiz(e)), ['cabecera', 'elemento', 'grupoUsos']);
    });

    test('etiquetas del grupo: buscando, resultado con miles y error', () => {
      const resuelto = maraDeFixtures();
      assert.equal(etiquetaDe(grupoUsosDe(estado({ resuelto, usos: { cargando: true } }))).label, 'Dónde se usa (buscando…)');
      const grupo = etiquetaDe(grupoUsosDe(estado({ resuelto, usos: { cargando: false, resultado: resultadoMara } })));
      assert.equal(grupo.label, 'Dónde se usa (6 propios de 6.848)');
      assert.equal(grupo.contextValue, 'grupoUsos');
      assert.equal(grupo.colapsable, 'abierto');
      const uno = { total: 1, propios: resultadoMara.propios.slice(0, 1), namespaces: [] };
      assert.equal(etiquetaDe(grupoUsosDe(estado({ resuelto, usos: { cargando: false, resultado: uno } }))).label, 'Dónde se usa (1 propio de 1)');
      const error = { cargando: false, error: { nombre: 'ErrorAdt', mensaje: 'Tiempo agotado' } };
      const grupoError = grupoUsosDe(estado({ resuelto, usos: error }));
      assert.equal(etiquetaDe(grupoError).label, 'Dónde se usa (error: ErrorAdt)');
      const hijos = hijosDe(grupoError, estado({ resuelto, usos: error }));
      assert.deepEqual(clases(hijos), ['errorUsos']);
      assert.equal(etiquetaDe(hijos[0]).label, 'Tiempo agotado');
    });

    test('tipo → paquete → uso, y un nodo «Añadir /X/ a propios…» por namespace al final', () => {
      const e = estado({ resuelto: maraDeFixtures(), usos: { cargando: false, resultado: resultadoMara } });
      const hijos = hijosDe(grupoUsosDe(e), e);
      assert.deepEqual(clases(hijos), ['tipoUso', 'tipoUso', 'tipoUso', 'tipoUso', 'anadirPrefijo']);
      assert.deepEqual(hijos.map((h) => [etiquetaDe(h).label, etiquetaDe(h).description]), [
        ['CDS', '3'],
        ['Módulo de función', '1'],
        ['Include', '1'],
        ['Tabla', '1'],
        ['Añadir /ACCGO/ a propios…', undefined],
      ]);
      const [paquete] = hijosDe(hijos[3], e);
      assert.equal(paquete.clase, 'paqueteUso');
      assert.deepEqual([etiquetaDe(paquete).label, etiquetaDe(paquete).description], ['ZPAQ2', '1']);
      const [nodoUso] = hijosDe(paquete, e);
      assert.equal(nodoUso.clase, 'uso');
      const etiqueta = etiquetaDe(nodoUso);
      assert.equal(etiqueta.label, 'Z_EJEMPLO_4');
      assert.equal(etiqueta.description, 'Descripción de ejemplo 4');
      assert.equal(etiqueta.contextValue, 'uso');
      assert.equal(etiqueta.colapsable, 'no');
      assert.equal(etiquetaDe(hijos[4]).contextValue, 'anadirPrefijo');
    });

    test('un tipo sin etiqueta conocida muestra el tipo ADT; un uso sin paquete, «(sin paquete)»', () => {
      const uso = { nombre: 'Z_EJEMPLO_8', tipoAdt: 'XSLT/VT', descripcion: '', uriAdt: '/sap/bc/adt/xslt/z_ejemplo_8', paquete: '', esUso: true };
      const e = estado({ resuelto: maraDeFixtures(), usos: { cargando: false, resultado: { total: 1, propios: [uso], namespaces: [] } } });
      const [tipo] = hijosDe(grupoUsosDe(e), e);
      assert.equal(etiquetaDe(tipo).label, 'XSLT/VT');
      const [paquete] = hijosDe(tipo, e);
      assert.equal(etiquetaDe(paquete).label, '(sin paquete)');
    });

    test('resultadoUso construye el ResultadoBusqueda para abrir el uso', () => {
      const uso = resultadoMara.propios.find((u) => u.nombre === 'Z_EJEMPLO_6');
      assert.ok(uso);
      assert.deepEqual(resultadoUso(uso), {
        nombre: 'Z_EJEMPLO_6',
        tipo: 'FUGR/FF',
        uriAdt: '/sap/bc/adt/functions/groups/z_ejemplo_5/fmodules/z_ejemplo_6',
        paquete: 'ZPAQ3',
        descripcion: '',
      });
    });

    test('iconos e idDe únicos en el árbol con usos', () => {
      const e = estado({ resuelto: maraDeFixtures(), usos: { cargando: false, resultado: resultadoMara } });
      assert.equal(iconoDe(grupoUsosDe(e)), 'references');
      const ids: string[] = [];
      const recorrer = (nodos: NodoDiccionario[]): void => {
        for (const n of nodos) {
          ids.push(idDe(n));
          recorrer(hijosDe(n, e));
        }
      };
      recorrer(nodosRaiz(e));
      assert.ok(ids.includes('grupoUsos'));
      assert.equal(new Set(ids).size, ids.length);
    });
  });

  suite('acciones', () => {
    test('nombreACopiar: MARA en la cabecera y MARA-MTART en un campo', () => {
      const { objeto } = maraDeFixtures();
      assert.equal(nombreACopiar({ clase: 'cabecera', objeto, fijado: false }), 'MARA');
      assert.equal(nombreACopiar({ clase: 'campo', tabla: 'MARA', campo: campo({ nombre: 'MTART' }) }), 'MARA-MTART');
      assert.equal(nombreACopiar({ clase: 'grupoCampos', total: 3 }), undefined);
    });

    test('resultadoDdl construye el ResultadoBusqueda del objeto', () => {
      const { objeto } = maraDeFixtures();
      assert.deepEqual(resultadoDdl(objeto), {
        nombre: 'MARA',
        tipo: 'TABL/DT',
        uriAdt: '/sap/bc/adt/ddic/tables/mara',
        paquete: objeto.paquete ?? '',
        descripcion: objeto.descripcion,
      });
      assert.equal(resultadoDdl({ ...objeto, paquete: undefined }).paquete, '');
    });

    test('idDe es único en todo el árbol de MARA', () => {
      const e = estado({ resuelto: maraDeFixtures() });
      const ids: string[] = [];
      const recorrer = (nodos: NodoDiccionario[]): void => {
        for (const n of nodos) {
          ids.push(idDe(n));
          recorrer(hijosDe(n, e));
        }
      };
      recorrer(nodosRaiz(e));
      assert.equal(new Set(ids).size, ids.length);
    });
  });
});
