import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  analizarRespuestaBusqueda,
  descodificarEntidades,
  descodificarSegmento,
  descripcionDe,
  esPaquete,
  esTransaccion,
  etiquetaDe,
  FILTROS_TIPO,
  interpretarConsulta,
  parametrosBusqueda,
  ResultadoBusqueda,
} from '../../src/adt/busqueda-modelo';

function leerFixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function filtro(id: string) {
  const f = FILTROS_TIPO.find((x) => x.id === id);
  assert.ok(f, `filtro ${id} no existe`);
  return f;
}

function resultado(parcial: Partial<ResultadoBusqueda>): ResultadoBusqueda {
  return { nombre: 'X', tipo: 'CLAS/OC', descripcion: '', paquete: '', uriAdt: '', ...parcial };
}

suite('busqueda-modelo: analizarRespuestaBusqueda', () => {
  test('lee todos los resultados de una búsqueda real sin filtro (busq-xml.xml)', () => {
    const resultados = analizarRespuestaBusqueda(leerFixture('busq-xml.xml'));
    assert.equal(resultados.length, 10);
    assert.deepEqual(resultados[0], {
      nombre: 'Z',
      tipo: 'PROG/P',
      descripcion: 'Programa',
      paquete: '$TMP',
      uriAdt: '/sap/bc/adt/programs/programs/z',
    });
  });

  test('con filtro de tipo la respuesta real no trae paquete ni descripción (busq-clas.xml)', () => {
    const resultados = analizarRespuestaBusqueda(leerFixture('busq-clas.xml'));
    assert.equal(resultados.length, 10);
    assert.ok(resultados.every((r) => r.tipo === 'CLAS/OC' && r.paquete === '' && r.descripcion === ''));
    assert.deepEqual(resultados[0], {
      nombre: 'Z_EJEMPLO_9',
      tipo: 'CLAS/OC',
      descripcion: '',
      paquete: '',
      uriAdt: '/sap/bc/adt/oo/classes/z_ejemplo_9',
    });
  });

  test('conserva el nombre con espacio de nombres y la uri codificada (busq-namespace.xml)', () => {
    const [primero] = analizarRespuestaBusqueda(leerFixture('busq-namespace.xml'));
    assert.equal(primero.nombre, '/ACCGO/ABD');
    assert.equal(primero.paquete, '/ACCGO/CAKSTL');
    assert.ok(primero.uriAdt.includes('%2faccgo%2fabd'), primero.uriAdt);
    assert.equal(descodificarSegmento('%2faccgo%2fabd'), '/accgo/abd');
  });

  test('$TMP llega como %24tmp en la uri (busq-tmp.xml)', () => {
    const [paquete] = analizarRespuestaBusqueda(leerFixture('busq-tmp.xml'));
    assert.equal(paquete.nombre, '$TMP');
    assert.equal(paquete.uriAdt, '/sap/bc/adt/packages/%24tmp');
    assert.equal(descodificarSegmento('%24tmp'), '$tmp');
  });

  test('noDescription=true deja la descripción vacía y conserva el paquete (busq-sin-desc.xml)', () => {
    const resultados = analizarRespuestaBusqueda(leerFixture('busq-sin-desc.xml'));
    assert.equal(resultados.length, 3);
    assert.ok(resultados.every((r) => r.descripcion === '' && r.paquete !== ''));
  });

  test('un tipo inexistente devuelve una lista vacía (busq-tipo-malo.xml)', () => {
    assert.deepEqual(analizarRespuestaBusqueda(leerFixture('busq-tipo-malo.xml')), []);
  });

  test('admite elementos con cierre explícito', () => {
    const xml = '<adtcore:objectReference adtcore:name="A" adtcore:type="INTF/OI"></adtcore:objectReference>';
    assert.deepEqual(analizarRespuestaBusqueda(xml).map((r) => r.nombre), ['A']);
  });

  test('devuelve vacío con una respuesta que no es XML de ADT', () => {
    assert.deepEqual(analizarRespuestaBusqueda('<html>error</html>'), []);
  });

  test('descodifica entidades con nombre y numéricas', () => {
    const xml =
      '<adtcore:objectReference adtcore:name="A" adtcore:description="&lt;a&gt; &quot;b&quot; &apos;c&apos; &#65;&#x42;"/>';
    assert.equal(analizarRespuestaBusqueda(xml)[0].descripcion, '<a> "b" \'c\' AB');
  });

  test('no confunde objectReferences con objectReference', () => {
    assert.deepEqual(analizarRespuestaBusqueda('<adtcore:objectReferences xmlns:adtcore="x"/>'), []);
  });

  test('una entidad numérica fuera de rango se deja tal cual sin perder la lista', () => {
    const xml = [
      '<adtcore:objectReference adtcore:name="A" adtcore:description="x &#99999999; &#x110000; y"/>',
      '<adtcore:objectReference adtcore:name="B"/>',
    ].join('');
    const r = analizarRespuestaBusqueda(xml);
    assert.deepEqual(r.map((x) => x.nombre), ['A', 'B']);
    assert.equal(r[0].descripcion, 'x &#99999999; &#x110000; y');
    assert.equal(descodificarEntidades('&#99999999;&amp;'), '&#99999999;&');
  });
});

suite('busqueda-modelo: FILTROS_TIPO', () => {
  test('cada tipo de los filtros existe en el catálogo real de tipos (tipos.xml)', () => {
    const tipos = leerFixture('tipos.xml');
    for (const f of FILTROS_TIPO) {
      assert.ok(tipos.includes(`type:${f.tipoAdt};`), f.tipoAdt);
    }
  });
});

suite('busqueda-modelo: interpretarConsulta', () => {
  test('prefijo con espacio fija el filtro', () => {
    assert.deepEqual(interpretarConsulta('prog zrep'), { patron: 'ZREP*', filtro: filtro('programa') });
  });

  test('prefijo con dos puntos conserva el asterisco', () => {
    assert.deepEqual(interpretarConsulta('clas:zcl_x*'), { patron: 'ZCL_X*', filtro: filtro('clase') });
  });

  test('sin prefijo ni filtro solo añade el patrón', () => {
    assert.deepEqual(interpretarConsulta('zcl'), { patron: 'ZCL*', filtro: undefined });
  });

  test('el filtro activo manda si no hay prefijo', () => {
    assert.deepEqual(interpretarConsulta('zcl', filtro('interfaz')), {
      patron: 'ZCL*',
      filtro: filtro('interfaz'),
    });
  });

  test('el prefijo gana al filtro activo', () => {
    assert.equal(interpretarConsulta('tabl zt', filtro('clase')).filtro, filtro('tabla'));
  });

  test('un prefijo desconocido se trata como texto', () => {
    assert.deepEqual(interpretarConsulta('foo bar'), { patron: 'FOO BAR*', filtro: undefined });
  });
});

suite('busqueda-modelo: parametrosBusqueda', () => {
  test('sin filtro solo envía operación, query y máximo', () => {
    assert.deepEqual(parametrosBusqueda({ patron: 'ZCL*' }, 50), {
      operation: 'quickSearch',
      query: 'ZCL*',
      maxResults: '50',
    });
  });

  test('con filtro añade objectType', () => {
    const p = parametrosBusqueda({ patron: 'ZCL*', filtro: filtro('clase') }, 20);
    assert.equal(p.objectType, 'CLAS/OC');
    assert.equal(p.maxResults, '20');
  });
});

suite('busqueda-modelo: presentación', () => {
  test('etiquetaDe devuelve el nombre', () => {
    assert.equal(etiquetaDe(resultado({ nombre: 'ZCL_A' })), 'ZCL_A');
  });

  test('sin paquete ni descripción no hay separador vacío (busq-clas.xml)', () => {
    const [r] = analizarRespuestaBusqueda(leerFixture('busq-clas.xml'));
    assert.equal(etiquetaDe(r), 'Z_EJEMPLO_9');
    assert.equal(descripcionDe(r), 'Clase');
  });

  test('descripcionDe compone tipo, paquete y texto', () => {
    assert.equal(
      descripcionDe(resultado({ tipo: 'CLAS/OC', paquete: 'ZPAQ1', descripcion: 'texto' })),
      'Clase · ZPAQ1 · texto',
    );
  });

  test('descripcionDe no lanza con un % mal formado en la uri de una función', () => {
    const r = { nombre: 'Z_FM', tipo: 'FUGR/FF', descripcion: '', paquete: 'ZPAQ1', uriAdt: '/sap/bc/adt/functions/groups/z%E0%A4%A/fmodules/z_fm' };
    assert.equal(descripcionDe(r), 'Módulo de función · Z%E0%A4%A');
    assert.equal(descodificarSegmento('z%E0%A4%A'), 'z%E0%A4%A');
    assert.equal(descodificarSegmento('%2FZNS%2FGRUPO'), '/ZNS/GRUPO');
  });

  test('descripcionDe de una función usa el grupo de la uri real (busq-fugr.xml)', () => {
    const [r] = analizarRespuestaBusqueda(leerFixture('busq-fugr.xml'));
    assert.equal(r.uriAdt, '/sap/bc/adt/functions/groups/z_ejemplo_33/fmodules/z_ejemplo_28');
    assert.equal(descripcionDe(r), 'Módulo de función · Z_EJEMPLO_33');
  });

  test('descripcionDe omite partes vacías y tolera tipos desconocidos', () => {
    assert.equal(descripcionDe(resultado({ tipo: 'XXXX/YY', paquete: '' })), 'XXXX/YY');
  });

  test('esTransaccion y esPaquete', () => {
    assert.equal(esTransaccion(resultado({ tipo: 'TRAN/T' })), true);
    assert.equal(esTransaccion(resultado({ tipo: 'CLAS/OC' })), false);
    assert.equal(esPaquete(resultado({ tipo: 'DEVC/K' })), true);
    assert.equal(esPaquete(resultado({ tipo: 'TRAN/T' })), false);
  });
});
