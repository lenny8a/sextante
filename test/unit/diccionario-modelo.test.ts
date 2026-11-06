import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { analizarDataPreview } from '../../src/adt/transaccion';
import {
  RUTAS_DDIC,
  analizarDominio,
  analizarElementoDatos,
  analizarMetadatosDdic,
  camposDe,
  claveIdiomaSap,
  consultaCampos,
  decimalesPorCampo,
  consultaCamposSinTexto,
  consultaMensaje,
  consultaTextoTabla,
  consultaTextosElemento,
  consultaValoresDominio,
  mensajeDe,
  nombreValido,
  valoresDe,
} from '../../src/diccionario/modelo';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function filas(nombre: string): Record<string, string>[] {
  return analizarDataPreview(fixture(nombre));
}

suite('diccionario-modelo', () => {
  suite('claveIdiomaSap', () => {
    test('convierte el código ISO 639-1 de destinations.json a la clave SAP de un carácter', () => {
      assert.equal(claveIdiomaSap('ES'), 'S');
      assert.equal(claveIdiomaSap('es'), 'S');
      assert.equal(claveIdiomaSap('EN'), 'E');
      assert.equal(claveIdiomaSap('DE'), 'D');
      assert.equal(claveIdiomaSap('ZH'), '1');
      assert.equal(claveIdiomaSap('ZF'), 'M');
    });

    test('acepta una clave SAP ya válida, también en minúsculas', () => {
      assert.equal(claveIdiomaSap('E'), 'E');
      assert.equal(claveIdiomaSap('s'), 'S');
      assert.equal(claveIdiomaSap('1'), '1');
    });

    test('toma las dos primeras letras de es_ES y es-ES', () => {
      assert.equal(claveIdiomaSap('es_ES'), 'S');
      assert.equal(claveIdiomaSap('es-ES'), 'S');
      assert.equal(claveIdiomaSap('pt_BR'), 'P');
    });

    test('lo desconocido, vacío o con caracteres raros da undefined', () => {
      assert.equal(claveIdiomaSap('xx'), undefined);
      assert.equal(claveIdiomaSap(''), undefined);
      assert.equal(claveIdiomaSap(undefined), undefined);
      assert.equal(claveIdiomaSap("E' OR 'X"), undefined);
      assert.equal(claveIdiomaSap('ESP'), undefined);
      assert.equal(claveIdiomaSap('-'), undefined);
    });
  });


  suite('nombres y consultas', () => {
    test('nombreValido acepta nombres DDIC, namespaces y minúsculas', () => {
      assert.ok(nombreValido('MARA'));
      assert.ok(nombreValido('mara'));
      assert.ok(nombreValido('/BOBF/OBM_NODE'));
      assert.ok(nombreValido('Z_EJEMPLO_1'));
    });

    test('nombreValido rechaza vacíos, comillas, espacios y nombres de más de 30', () => {
      assert.equal(nombreValido(''), false);
      assert.equal(nombreValido("MARA'; DROP"), false);
      assert.equal(nombreValido('MA RA'), false);
      assert.equal(nombreValido('A'.repeat(31)), false);
    });

    test('consultaCampos lee DD03VT en los idiomas pedidos de una vez, en orden de posición', () => {
      assert.equal(
        consultaCampos('mara', ['S', 'E']),
        "SELECT POSITION, FIELDNAME, KEYFLAG, ROLLNAME, DATATYPE, LENG, DDLANGUAGE, DDTEXT FROM DD03VT WHERE TABNAME = 'MARA' AND DDLANGUAGE IN ('S','E') ORDER BY POSITION",
      );
    });

    test('consultaCampos lanza con un nombre que intenta inyectar SQL', () => {
      assert.throws(() => consultaCampos("MARA'; DROP", ['E']), /nombre no válido/);
    });

    test('consultaCampos lanza con un idioma que no es una clave de un carácter o sin idiomas', () => {
      assert.throws(() => consultaCampos('MARA', ["E' OR 'X"]), /idioma no válido/);
      assert.throws(() => consultaCampos('MARA', ['e']), /idioma no válido/);
      assert.throws(() => consultaCampos('MARA', ['']), /idioma no válido/);
      assert.throws(() => consultaCampos('MARA', []), /idioma no válido/);
    });

    test('las claves de idioma numéricas de SAP se aceptan; dos caracteres o minúsculas no', () => {
      assert.ok(consultaCampos('MARA', ['1']).endsWith("DDLANGUAGE IN ('1') ORDER BY POSITION"));
      assert.ok(consultaTextoTabla('MARA', ['1', 'E']).includes("DDLANGUAGE IN ('1','E')"));
      assert.throws(() => consultaCampos('MARA', ['es']), /idioma no válido/);
      assert.throws(() => consultaCampos('MARA', ['E1']), /idioma no válido/);
    });

    test('consultaCamposSinTexto lee DD03L activa con los campos para marcar includes', () => {
      assert.equal(
        consultaCamposSinTexto('MARA'),
        "SELECT POSITION, FIELDNAME, KEYFLAG, ROLLNAME, DOMNAME, DATATYPE, LENG, DECIMALS, CHECKTABLE, COMPTYPE, PRECFIELD FROM DD03L WHERE TABNAME = 'MARA' AND AS4LOCAL = 'A' ORDER BY POSITION",
      );
      assert.throws(() => consultaCamposSinTexto('MA RA'), /nombre no válido/);
    });

    test('consultaTextoTabla lee DD02T en varios idiomas (consulta de dd02t-mara.xml)', () => {
      assert.equal(
        consultaTextoTabla('MARA', ['E', 'S']),
        "SELECT TABNAME, DDLANGUAGE, DDTEXT FROM DD02T WHERE TABNAME = 'MARA' AND DDLANGUAGE IN ('E','S')",
      );
      assert.throws(() => consultaTextoTabla('MARA', []), /idioma no válido/);
    });

    test('consultaTextosElemento lee DD04T (consulta de dd04t-matnr.xml)', () => {
      assert.equal(
        consultaTextosElemento('matnr', ['E', 'S']),
        "SELECT ROLLNAME, DDLANGUAGE, DDTEXT, SCRTEXT_S, SCRTEXT_M, SCRTEXT_L FROM DD04T WHERE ROLLNAME = 'MATNR' AND DDLANGUAGE IN ('E','S')",
      );
      assert.throws(() => consultaTextosElemento('MATNR', ['ES']), /idioma no válido/);
    });

    test('consultaValoresDominio lee DD07V en los idiomas pedidos de una vez (dd07v-mtart.xml + DDLANGUAGE en lista)', () => {
      assert.equal(
        consultaValoresDominio('MTART', ['S', 'E']),
        "SELECT DOMVALUE_L, DOMVALUE_H, DDLANGUAGE, DDTEXT FROM DD07V WHERE DOMNAME = 'MTART' AND DDLANGUAGE IN ('S','E')",
      );
      assert.throws(() => consultaValoresDominio('MT ART', ['E']), /nombre no válido/);
      assert.throws(() => consultaValoresDominio('MTART', []), /idioma no válido/);
    });

    test('consultaMensaje filtra T100 por clase, número e idiomas', () => {
      const sql = consultaMensaje('ZMSG', '001', ['S', 'E']);
      assert.ok(sql.includes("SPRSL IN ('S','E')"), sql);
      assert.equal(
        sql,
        "SELECT SPRSL, ARBGB, MSGNR, TEXT FROM T100 WHERE ARBGB = 'ZMSG' AND MSGNR = '001' AND SPRSL IN ('S','E')",
      );
      assert.throws(() => consultaMensaje('ZMSG', "1' OR '1", ['E']), /número de mensaje no válido/);
      assert.throws(() => consultaMensaje("Z'", '001', ['E']), /nombre no válido/);
    });
  });

  suite('campos (Data Preview de DD03VT / DD03L)', () => {
    test('dd03vt-mara.xml da al menos 20 campos con la clave marcada', () => {
      const campos = camposDe(filas('dd03vt-mara.xml'));
      assert.ok(campos.length >= 20, `${campos.length}`);
      assert.equal(campos.find((c) => c.nombre === 'MANDT')?.clave, true);
      assert.equal(campos.find((c) => c.nombre === 'MATNR')?.clave, true);
      assert.equal(campos.find((c) => c.nombre === 'ERSDA')?.clave, false);
    });

    test('MTART: tipo CHAR, longitud 4, texto y elemento de datos', () => {
      const mtart = camposDe(filas('dd03vt-mara.xml')).find((c) => c.nombre === 'MTART');
      assert.ok(mtart);
      assert.equal(mtart.tipo, 'CHAR');
      assert.equal(mtart.longitud, 4);
      assert.equal(mtart.decimales, 0);
      assert.equal(mtart.posicion, 11);
      assert.equal(mtart.elementoDatos, 'MTART');
      assert.ok(mtart.texto.length > 0);
      assert.equal(mtart.include, undefined);
    });

    test('con idiomas queda una fila por campo: la del primer idioma disponible, en el orden de aparición', () => {
      const filasVt = [
        { POSITION: '0001', FIELDNAME: 'MANDT', DDLANGUAGE: 'E', DDTEXT: 'Client' },
        { POSITION: '0001', FIELDNAME: 'MANDT', DDLANGUAGE: 'S', DDTEXT: 'Mandante' },
        { POSITION: '0002', FIELDNAME: 'MATNR', DDLANGUAGE: 'E', DDTEXT: 'Material Number' },
        { POSITION: '0003', FIELDNAME: 'ERSDA', DDLANGUAGE: 'D', DDTEXT: 'Angelegt am' },
      ];
      assert.deepEqual(camposDe(filasVt, ['S', 'E']).map((c) => [c.nombre, c.texto]), [
        ['MANDT', 'Mandante'],
        ['MATNR', 'Material Number'],
      ]);
      assert.deepEqual(camposDe(filasVt, ['E']).map((c) => c.texto), ['Client', 'Material Number']);
    });

    test('los pseudocampos .INCLUDE y .APPEND no son campos', () => {
      const filasVt: Record<string, string>[] = [
        { POSITION: '0001', FIELDNAME: 'MANDT', DDLANGUAGE: 'E', DDTEXT: 'Client', KEYFLAG: 'X' },
        { POSITION: '0002', FIELDNAME: '.INCLUDE', DDLANGUAGE: 'E', DDTEXT: '' },
        { POSITION: '0003', FIELDNAME: 'ERSDA', DDLANGUAGE: 'E', DDTEXT: 'Created On' },
        { POSITION: '0004', FIELDNAME: '.APPEND', DDLANGUAGE: 'E', DDTEXT: '' },
        { POSITION: '0005', FIELDNAME: 'ZZCAMPO', DDLANGUAGE: 'E', DDTEXT: 'Campo de ejemplo' },
      ];
      assert.deepEqual(camposDe(filasVt, ['E']).map((c) => c.nombre), ['MANDT', 'ERSDA', 'ZZCAMPO']);
      assert.deepEqual(camposDe(filasVt).map((c) => c.nombre), ['MANDT', 'ERSDA', 'ZZCAMPO']);
    });

    test('DD03VT no trae DECIMALS: los decimales de camposDe quedan en 0', () => {
      assert.ok(camposDe(filas('dd03vt-mara.xml')).every((c) => c.decimales === 0));
    });

    test('decimalesPorCampo: los decimales de DD03L por nombre de campo, sin pseudocampos', () => {
      const decimales = decimalesPorCampo(filas('dd03l-mara.xml'));
      assert.equal(decimales.get('BRGEW'), 3);
      assert.equal(decimales.get('MTART'), 0);
      assert.equal(decimalesPorCampo([{ FIELDNAME: '.INCLUDE', DECIMALS: '0' }, { FIELDNAME: 'ntgew', DECIMALS: '000003' }]).size, 1);
      assert.equal(decimalesPorCampo([{ FIELDNAME: 'ntgew', DECIMALS: '000003' }]).get('NTGEW'), 3);
    });

    test('dd03l-mara.xml: decimales a número y texto vacío sin DDTEXT', () => {
      const brgew = camposDe(filas('dd03l-mara.xml')).find((c) => c.nombre === 'BRGEW');
      assert.ok(brgew);
      assert.equal(brgew.decimales, 3);
      assert.equal(brgew.longitud, 13);
      assert.equal(brgew.texto, '');
    });
  });

  suite('metadatos de ADT', () => {
    test('tabla-mara.xml es una tabla del paquete MG', () => {
      assert.deepEqual(analizarMetadatosDdic(fixture('tabla-mara.xml')), {
        nombre: 'MARA',
        tipo: 'tabla',
        tipoAdt: 'TABL/DT',
        descripcion: 'General Material Data',
        paquete: 'MG',
        uriAdt: '/sap/bc/adt/ddic/tables/mara',
      });
    });

    test('estructura-bapiret2.xml es una estructura', () => {
      const objeto = analizarMetadatosDdic(fixture('estructura-bapiret2.xml'));
      assert.equal(objeto?.tipo, 'estructura');
      assert.equal(objeto?.tipoAdt, 'TABL/DS');
      assert.equal(objeto?.uriAdt, '/sap/bc/adt/ddic/structures/bapiret2');
    });

    test('dtel-matnr.xml y doma-mtart.xml dan elemento de datos y dominio', () => {
      const elemento = analizarMetadatosDdic(fixture('dtel-matnr.xml'));
      assert.equal(elemento?.tipo, 'elementoDatos');
      assert.equal(elemento?.uriAdt, '/sap/bc/adt/ddic/dataelements/matnr');
      const dominio = analizarMetadatosDdic(fixture('doma-mtart.xml'));
      assert.equal(dominio?.tipo, 'dominio');
      assert.equal(dominio?.paquete, 'BMG');
      assert.equal(dominio?.uriAdt, '/sap/bc/adt/ddic/domains/mtart');
    });

    test('un namespace se codifica con %2f como en la búsqueda', () => {
      const xml = '<blue:blueSource adtcore:name="/BOBF/OBM_NODE" adtcore:type="TABL/DT" adtcore:description="x"/>';
      const objeto = analizarMetadatosDdic(xml);
      assert.equal(objeto?.uriAdt, '/sap/bc/adt/ddic/tables/%2fbobf%2fobm_node');
      assert.equal(objeto?.paquete, undefined);
    });

    test('un tipo que no es del diccionario o un XML vacío no dan objeto', () => {
      assert.equal(analizarMetadatosDdic('<x adtcore:name="ZPROG" adtcore:type="PROG/P"/>'), undefined);
      assert.equal(analizarMetadatosDdic(''), undefined);
      assert.equal(analizarMetadatosDdic(fixture('dd02t-mara.xml')), undefined);
    });

    test('RUTAS_DDIC', () => {
      assert.deepEqual(RUTAS_DDIC, {
        tabla: '/sap/bc/adt/ddic/tables',
        estructura: '/sap/bc/adt/ddic/structures',
        elementoDatos: '/sap/bc/adt/ddic/dataelements',
        dominio: '/sap/bc/adt/ddic/domains',
      });
    });
  });

  suite('elemento de datos', () => {
    test('dtel-matnr.xml: dominio, tipo, longitud, etiquetas y ayuda de búsqueda', () => {
      assert.deepEqual(analizarElementoDatos(fixture('dtel-matnr.xml')), {
        nombre: 'MATNR',
        descripcion: 'Materialnummer',
        dominio: 'MATNR',
        tipo: 'CHAR',
        longitud: 40,
        decimales: 0,
        etiquetas: { corta: 'Material', media: 'Material', larga: 'Material', cabecera: 'Material' },
        ayudaBusqueda: 'S_MAT1',
      });
    });

    test('un XML que no es de elemento de datos no da resultado', () => {
      assert.equal(analizarElementoDatos(fixture('tabla-mara.xml')), undefined);
    });
  });

  suite('dominio', () => {
    test('doma-mtart.xml: tipo, longitud, tabla de valores T134 y sin valores fijos', () => {
      assert.deepEqual(analizarDominio(fixture('doma-mtart.xml')), {
        nombre: 'MTART',
        descripcion: 'Materialart',
        tipo: 'CHAR',
        longitud: 4,
        tablaValores: 'T134',
        valores: [],
      });
    });

    // NO VERIFICADO: forma de doma:fixValue supuesta; ninguna respuesta real trae valores fijos todavía.
    test('valores fijos dentro de doma:fixValues si vienen', () => {
      const xml =
        '<doma:domain adtcore:name="ZDOM" adtcore:type="DOMA/DD" adtcore:description="d"><doma:content>' +
        '<doma:typeInformation><doma:datatype>CHAR</doma:datatype><doma:length>000001</doma:length></doma:typeInformation>' +
        '<doma:valueInformation><doma:fixValues><doma:fixValue><doma:position>0001</doma:position><doma:low>A</doma:low>' +
        '<doma:high/><doma:text>Alta &amp; activa</doma:text></doma:fixValue></doma:fixValues></doma:valueInformation>' +
        '</doma:content></doma:domain>';
      const dominio = analizarDominio(xml);
      assert.deepEqual(dominio?.valores, [{ valor: 'A', texto: 'Alta & activa' }]);
      assert.equal(dominio?.tablaValores, undefined);
    });

    test('un elemento vacío con atributos no se come el resto del XML', () => {
      const xml =
        '<doma:domain adtcore:name="ZDOM" adtcore:type="DOMA/DD" adtcore:description="d">' +
        '<doma:fixValues x="1"/><doma:typeInformation><doma:datatype>NUMC</doma:datatype></doma:typeInformation>' +
        '<doma:fixValue><doma:low>B</doma:low></doma:fixValue></doma:domain>';
      const dominio = analizarDominio(xml);
      assert.deepEqual(dominio?.valores, []);
      assert.equal(dominio?.tipo, 'NUMC');
    });

    test('un XML que no es de dominio no da resultado', () => {
      assert.equal(analizarDominio(fixture('dtel-matnr.xml')), undefined);
    });
  });

  suite('mensajes (T100)', () => {
    test('t100-00-001.xml da el mensaje en E', () => {
      assert.deepEqual(mensajeDe(filas('t100-00-001.xml'), ['E']), {
        clase: '00',
        numero: '001',
        texto: '&1&2&3&4&5&6&7&8',
        idioma: 'E',
      });
    });

    test('usa el primer idioma disponible en el orden dado', () => {
      assert.equal(mensajeDe(filas('t100-00-001.xml'), ['F', 'S', 'E'])?.idioma, 'S');
      assert.equal(mensajeDe(filas('t100-00-001.xml'), ['F']), undefined);
      assert.equal(mensajeDe([], ['E']), undefined);
    });
  });

  suite('valores de dominio y textos (Data Preview)', () => {
    test('dd07v-mtart.xml no tiene filas: MTART usa la tabla de valores T134', () => {
      assert.deepEqual(filas('dd07v-mtart.xml'), []);
      assert.deepEqual(valoresDe(filas('dd07v-mtart.xml'), ['E']), []);
    });

    test('valoresDe: un valor por DOMVALUE_L con el texto del primer idioma disponible', () => {
      const filasDd07v = [
        { DOMVALUE_L: 'A', DDLANGUAGE: 'E', DDTEXT: 'Active' },
        { DOMVALUE_L: 'A', DDLANGUAGE: 'S', DDTEXT: 'Activo' },
        { DOMVALUE_L: 'B', DDLANGUAGE: 'E', DDTEXT: 'Blocked' },
        { DOMVALUE_L: 'C', DDLANGUAGE: 'D', DDTEXT: 'Gesperrt' },
      ];
      assert.deepEqual(valoresDe(filasDd07v, ['S', 'E']), [
        { valor: 'A', texto: 'Activo' },
        { valor: 'B', texto: 'Blocked' },
      ]);
    });

    test('valoresDe: DOMVALUE_H no vacío es un intervalo (valorAlto); vacío, un valor suelto', () => {
      const filasDd07v: Record<string, string>[] = [
        { DOMVALUE_L: 'A', DOMVALUE_H: 'Z', DDLANGUAGE: 'E', DDTEXT: 'Letras' },
        { DOMVALUE_L: '1', DOMVALUE_H: '', DDLANGUAGE: 'E', DDTEXT: 'Uno' },
        { DOMVALUE_L: '2', DDLANGUAGE: 'E', DDTEXT: 'Dos' },
      ];
      assert.deepEqual(valoresDe(filasDd07v, ['E']), [
        { valor: 'A', texto: 'Letras', valorAlto: 'Z' },
        { valor: '1', texto: 'Uno' },
        { valor: '2', texto: 'Dos' },
      ]);
    });

    test('dd02t-mara.xml y dd04t-matnr.xml traen E y S', () => {
      assert.deepEqual(
        filas('dd02t-mara.xml').map((f) => f.DDLANGUAGE),
        ['E', 'S'],
      );
      assert.equal(filas('dd04t-matnr.xml').find((f) => f.DDLANGUAGE === 'S')?.DDTEXT, 'Número de material');
    });

    test('dp-mara-datos.xml trae materiales anonimizados', () => {
      assert.deepEqual(
        filas('dp-mara-datos.xml').map((f) => f.MATNR),
        ['MAT00001', 'MAT00002', 'MAT00003', 'MAT00004', 'MAT00005'],
      );
    });
  });
});
