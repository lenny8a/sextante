import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analizarDataPreview } from '../../src/adt/transaccion';
import {
  analizarOrdenes,
  consultaObjetosDeOrden,
  consultaOrdenesDeObjeto,
  consultaTareas,
  consultaTextos,
  esModificable,
  esNumeroOrden,
  formatearFechaSap,
  objetosDeOrden,
  objetosDeOrdenDe,
  ordenesDeObjetoDe,
  textoOrdenDe,
  TIPOS_E071_POR_TIPO,
} from '../../src/adt/transportes-modelo';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function filas(nombre: string): Record<string, string>[] {
  return analizarDataPreview(fixture(nombre));
}

function claveObjeto(x: { pgmid: string; tipo: string; nombre: string }): string {
  return `${x.pgmid}|${x.tipo}|${x.nombre}`;
}

suite('transportes-modelo: lista de órdenes', () => {
  const ordenes = analizarOrdenes(fixture('ordenes-lista.xml'));

  test('devuelve las órdenes en el orden del XML', () => {
    assert.equal(ordenes.length, 3);
    assert.deepEqual(
      ordenes.map((o) => o.estado),
      ['modificable', 'modificable', 'liberada'],
    );
  });

  test('orden modificable con tareas y objetos directos', () => {
    const o = ordenes[0];
    assert.equal(o.estado, 'modificable');
    assert.equal(o.estadoCrudo, 'D');
    assert.equal(o.categoria, 'workbench');
    assert.equal(o.tareas.length, 2);
    assert.equal(o.objetos.length, 2);
    assert.equal(o.destino, undefined);
    assert.equal(esModificable(o), true);
  });

  test('objetos directos y de tareas', () => {
    const o = ordenes[0];
    const delasTareas = o.tareas.reduce((n, t) => n + t.objetos.length, 0);
    assert.ok(o.tareas.every((t) => t.objetos.length > 0));
    assert.equal(objetosDeOrden(o).length, o.objetos.length + delasTareas);
    assert.equal(new Set(objetosDeOrden(o).map(claveObjeto)).size, objetosDeOrden(o).length);
  });

  test('un objeto repetido entre la orden y sus tareas no se duplica', () => {
    const liberada = ordenes[2];
    const total = liberada.objetos.length + liberada.tareas.reduce((n, t) => n + t.objetos.length, 0);
    const claves = objetosDeOrden(liberada).map(claveObjeto);
    assert.ok(claves.length < total);
    assert.equal(new Set(claves).size, claves.length);
    assert.equal(claves.length, liberada.objetos.length);
  });

  test('orden liberada', () => {
    assert.equal(ordenes[2].estado, 'liberada');
    assert.equal(ordenes[2].estadoCrudo, 'R');
    assert.equal(esModificable(ordenes[2]), false);
  });

  test('números y propietarios de orden y tarea', () => {
    assert.match(ordenes[0].numero, /^DEVK9\d{5}$/);
    assert.equal(ordenes[0].propietario, 'USUARIO_1');
    assert.match(ordenes[0].tareas[0].numero, /^DEVK9\d{5}$/);
    assert.equal(ordenes[0].tareas[0].propietario, 'USUARIO_1');
    assert.equal(ordenes[0].tareas[0].estado, 'modificable');
  });

  test('atributos de un objeto de la orden', () => {
    const include = objetosDeOrden(ordenes[0]).find((x) => x.tipo === 'REPS');
    assert.ok(include);
    assert.equal(include.pgmid, 'LIMU');
    assert.equal(include.tipoWb, 'PROG/I');
    assert.equal(include.info, 'Source report');
  });

  test('objeto sin tm:wbtype ni tm:obj_desc deja esos campos sin definir', () => {
    const vista = objetosDeOrden(ordenes[0]).find((x) => x.tipo === 'VDAT');
    assert.ok(vista);
    assert.equal(vista.tipoWb, undefined);
    assert.equal(vista.descripcion, undefined);
  });

  test('entidades en textos', () => {
    const textos = ordenes.flatMap((o) => objetosDeOrden(o)).map((x) => x.descripcion ?? '');
    assert.ok(textos.includes('Descripción de ejemplo 2 & más'));
    assert.ok(textos.every((t) => !t.includes('&amp;')));
  });

  test('el bloque customizing vacío no aporta órdenes', () => {
    assert.ok(ordenes.every((o) => o.categoria === 'workbench'));
  });
});

suite('transportes-modelo: casos de estructura', () => {
  test('con tm:target la orden lleva el destino', () => {
    const ordenes = analizarOrdenes(fixture('ordenes-targets.xml'));
    assert.equal(ordenes.length, 1);
    assert.equal(ordenes[0].destino, 'QAS');
  });

  test('sin órdenes devuelve una lista vacía', () => {
    assert.deepEqual(analizarOrdenes(fixture('ordenes-vacia.xml')), []);
    assert.deepEqual(analizarOrdenes(''), []);
  });

  test('categoría customizing, estado desconocido y textos con comillas y entidades', () => {
    const xml =
      '<tm:root><tm:customizing tm:category="Customizing"><tm:modifiable tm:status="Modificable">' +
      '<tm:request tm:number="DEVK900099" tm:owner="USUARIO_1" tm:desc="a &gt; b &quot;c&quot;" tm:status="L">' +
      '<tm:abap_object tm:pgmid="R3TR" tm:type="TABU" tm:name="T001" tm:obj_desc="x &amp; y"/>' +
      '</tm:request></tm:modifiable></tm:customizing></tm:root>';
    const [orden] = analizarOrdenes(xml);
    assert.equal(orden.categoria, 'customizing');
    assert.equal(orden.estado, 'otro');
    assert.equal(orden.estadoCrudo, 'L');
    assert.equal(orden.descripcion, 'a > b "c"');
    assert.equal(orden.objetos[0].descripcion, 'x & y');
    assert.equal(esModificable(orden), false);
  });
});

suite('transportes-modelo: consultas SQL', () => {
  test('esNumeroOrden', () => {
    assert.equal(esNumeroOrden('DEVK900001'), true);
    assert.equal(esNumeroOrden('DEVK9 1'), false);
    assert.equal(esNumeroOrden("DEVK9'1"), false);
    assert.equal(esNumeroOrden(''), false);
    assert.equal(esNumeroOrden('A'.repeat(21)), false);
  });

  test('consultaOrdenesDeObjeto', () => {
    assert.equal(
      consultaOrdenesDeObjeto('Z_EJEMPLO_1', TIPOS_E071_POR_TIPO.clase),
      'SELECT E071~TRKORR, E071~PGMID, E071~OBJECT, E071~OBJ_NAME, E071~LOCKFLAG, E070~TRFUNCTION, E070~TRSTATUS, E070~TARSYSTEM, E070~AS4USER, E070~AS4DATE, E070~AS4TIME, E070~STRKORR ' +
        'FROM E071 INNER JOIN E070 ON E070~TRKORR = E071~TRKORR ' +
        "WHERE ( E071~OBJ_NAME = 'Z_EJEMPLO_1' OR E071~OBJ_NAME LIKE 'Z_EJEMPLO_1 %' ) " +
        "AND E071~OBJECT IN ('CLAS','METH','CPUB','CPRO','CPRI','CLSD','CINC')",
    );
  });

  test('consultaOrdenesDeObjeto pasa el nombre a mayúsculas y rechaza lo no válido', () => {
    assert.match(consultaOrdenesDeObjeto('z_ejemplo_1', ['INTF']), /OBJ_NAME = 'Z_EJEMPLO_1'/);
    assert.throws(() => consultaOrdenesDeObjeto("Z'; DROP", ['CLAS']), /nombre no válido/);
    assert.throws(() => consultaOrdenesDeObjeto('Z_EJEMPLO_1', []), /nombre no válido/);
    assert.throws(() => consultaOrdenesDeObjeto('Z_EJEMPLO_1', ["CLAS')"]), /tipo no válido/);
  });

  test('tipos E071 por tipo de objeto', () => {
    assert.deepEqual(TIPOS_E071_POR_TIPO.cds, ['DDLS']);
    assert.deepEqual(TIPOS_E071_POR_TIPO.include, ['REPS']);
    assert.deepEqual(TIPOS_E071_POR_TIPO.desconocido, []);
    assert.deepEqual(TIPOS_E071_POR_TIPO.estructura, ['TABL', 'TABD']);
  });

  test('consultaTareas, consultaTextos y consultaObjetosDeOrden', () => {
    assert.equal(
      consultaTareas('DEVK900001'),
      "SELECT TRKORR, TRFUNCTION, TRSTATUS, AS4USER, AS4DATE, AS4TIME, STRKORR FROM E070 WHERE STRKORR = 'DEVK900001'",
    );
    assert.equal(
      consultaTextos(['DEVK900001'], ['S', 'E']),
      "SELECT TRKORR, LANGU, AS4TEXT FROM E07T WHERE TRKORR IN ('DEVK900001') AND LANGU IN ('S','E')",
    );
    assert.equal(
      consultaObjetosDeOrden(['DEVK900001', 'DEVK900002']),
      "SELECT TRKORR, AS4POS, PGMID, OBJECT, OBJ_NAME, OBJFUNC, LOCKFLAG FROM E071 WHERE TRKORR IN ('DEVK900001','DEVK900002') ORDER BY TRKORR, AS4POS",
    );
  });

  test('números de orden no válidos lanzan', () => {
    const mensaje = /número de orden no válido/;
    assert.throws(() => consultaTextos(['x y'], ['E']), mensaje);
    assert.throws(() => consultaTareas("X' OR '1'='1"), mensaje);
    assert.throws(() => consultaObjetosDeOrden(['DEVK900001', 'devk']), mensaje);
    assert.throws(() => consultaTextos([], ['E']), mensaje);
  });
});

suite('transportes-modelo: filas de Data Preview', () => {
  test('formatearFechaSap', () => {
    assert.deepEqual(formatearFechaSap('20261030', '112745'), { fecha: '2026-10-30', hora: '11:27' });
    assert.deepEqual(formatearFechaSap('00000000', '000000'), { fecha: '', hora: '' });
    assert.deepEqual(formatearFechaSap('', ''), { fecha: '', hora: '' });
  });

  test('órdenes de un objeto: la fila de tarea apunta a su orden', () => {
    const join = filas('e071-e070-objeto.xml');
    const resultado = ordenesDeObjetoDe(join, filas('e07t-orden.xml'), ['E']);
    assert.equal(resultado.length, 1);
    const o = resultado[0];
    assert.equal(o.numero, join[0].STRKORR);
    assert.equal(o.tarea, join[0].TRKORR);
    assert.equal(o.estado, 'modificable');
    assert.equal(o.fecha, '2026-06-05');
    assert.equal(o.hora, '16:27');
    assert.equal(o.propietario, 'USUARIO_1');
    assert.deepEqual(o.partes, ['CLAS']);
    assert.equal(o.descripcion, undefined);
  });

  test('la descripción sale de E07T cuando el número coincide, con respaldo de idioma', () => {
    const base = filas('e071-e070-objeto.xml');
    const numero = base[0].STRKORR;
    const textos = [
      { TRKORR: numero, LANGU: 'E', AS4TEXT: 'En inglés' },
      { TRKORR: numero, LANGU: 'S', AS4TEXT: 'En español' },
    ];
    assert.equal(ordenesDeObjetoDe(base, textos, ['S', 'E'])[0].descripcion, 'En español');
    assert.equal(ordenesDeObjetoDe(base, textos, ['F', 'E'])[0].descripcion, 'En inglés');
    assert.equal(textoOrdenDe(numero, textos, ['F']), undefined);
    assert.equal(textoOrdenDe('DEVK999999', textos, ['E']), undefined);
  });

  test('con filas vacías no hay órdenes', () => {
    assert.deepEqual(ordenesDeObjetoDe([], [], ['E']), []);
  });

  test('agrupa por orden, usa la fecha de la orden y ordena la más reciente primero', () => {
    const lista = [
      { TRKORR: 'DEVK900021', PGMID: 'LIMU', OBJECT: 'METH', OBJ_NAME: 'Z_EJEMPLO_1                    GET_INFO', TRFUNCTION: 'S', TRSTATUS: 'D', TARSYSTEM: '', AS4USER: 'USUARIO_2', AS4DATE: '20260101', AS4TIME: '090000', STRKORR: 'DEVK900020' },
      { TRKORR: 'DEVK900020', PGMID: 'R3TR', OBJECT: 'CLAS', OBJ_NAME: 'Z_EJEMPLO_1', TRFUNCTION: 'K', TRSTATUS: 'R', TARSYSTEM: 'QAS', AS4USER: 'USUARIO_1', AS4DATE: '20260102', AS4TIME: '101500', STRKORR: '' },
      { TRKORR: 'DEVK900030', PGMID: 'R3TR', OBJECT: 'CLAS', OBJ_NAME: 'Z_EJEMPLO_1', TRFUNCTION: 'K', TRSTATUS: 'D', TARSYSTEM: '', AS4USER: 'USUARIO_1', AS4DATE: '20260301', AS4TIME: '080000', STRKORR: '' },
    ];
    const resultado = ordenesDeObjetoDe(lista, [], ['E']);
    assert.deepEqual(
      resultado.map((o) => o.numero),
      ['DEVK900030', 'DEVK900020'],
    );
    const antigua = resultado[1];
    assert.equal(antigua.estado, 'liberada');
    assert.equal(antigua.destino, 'QAS');
    assert.equal(antigua.propietario, 'USUARIO_1');
    assert.equal(antigua.fecha, '2026-01-02');
    assert.equal(antigua.hora, '10:15');
    assert.equal(antigua.tarea, 'DEVK900021');
    assert.deepEqual(antigua.partes, ['METH GET_INFO', 'CLAS']);
  });

  test('objetos de una orden: includes', () => {
    const objetos = objetosDeOrdenDe(filas('e071-orden.xml'));
    assert.equal(objetos.length, 2);
    for (const o of objetos) {
      assert.equal(o.pgmid, 'LIMU');
      assert.equal(o.tipo, 'REPS');
      assert.equal(o.tipoWb, 'PROG/I');
      assert.match(o.nombre, /^Z_EJEMPLO_\d+$/);
    }
  });

  test('objetos de una orden: métodos', () => {
    const objetos = objetosDeOrdenDe(filas('e071-meth.xml'));
    assert.equal(objetos.length, 5);
    for (const o of objetos) {
      assert.equal(o.tipo, 'METH');
      assert.equal(o.tipoWb, 'CLAS/OC');
      assert.match(o.nombre, /^Z_EJEMPLO_\d+$/);
      assert.ok(o.info?.startsWith('método '));
    }
  });

  test('objetos de una orden: tipos sin traducción a tipo de Workbench', () => {
    const [o] = objetosDeOrdenDe([{ PGMID: 'R3TR', OBJECT: 'ENHO', OBJ_NAME: 'Z_EJEMPLO_1' }]);
    assert.deepEqual(o, { pgmid: 'R3TR', tipo: 'ENHO', nombre: 'Z_EJEMPLO_1' });
  });
});
