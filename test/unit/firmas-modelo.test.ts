import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { analizarDataPreview } from '../../src/adt/transaccion';
import {
  claseResumenDe,
  consultaCabeceraMetodo,
  consultaComponentes,
  consultaGrupoFuncion,
  consultaMetodosPublicos,
  consultaParametrosFuncion,
  consultaParametrosMetodo,
  consultaRelaciones,
  consultaSubcomponentes,
  consultaTextoClase,
  consultaTextosComponentes,
  consultaTextosFuncion,
  consultaTextosMetodo,
  consultaTituloFuncion,
  firmaFuncionDe,
  firmaMetodoDe,
  metodosResumenDe,
  separarMetodo,
  uriClase,
  uriFuncion,
} from '../../src/firmas/modelo';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function filas(nombre: string): Record<string, string>[] {
  return analizarDataPreview(fixture(nombre));
}

const IDIOMAS = ['E'];

function filasFuncion() {
  return {
    parametros: filas('firma-fupararef.xml'),
    textos: filas('firma-funct.xml'),
    titulo: filas('firma-tftit.xml'),
    grupo: filas('firma-tfdir.xml'),
  };
}

function filasFactory() {
  return {
    cabecera: filas('firma-seocompodf.xml'),
    parametros: filas('firma-seosubcodf.xml'),
    subcomponentes: filas('firma-seosubco.xml'),
    textos: filas('firma-seosubcotx.xml'),
    textosComponentes: filas('firma-seocompotx.xml'),
  };
}

suite('firmas-modelo', () => {
  suite('consultas', () => {
    test('parámetros de un módulo de funciones, en mayúsculas', () => {
      assert.equal(
        consultaParametrosFuncion('ddif_fieldinfo_get'),
        'SELECT PARAMETER, PARAMTYPE, STRUCTURE, DEFAULTVAL, REFERENCE, PPOSITION, OPTIONAL, TYPE, CLASS, REF_CLASS, LINE_OF, TABLE_OF ' +
          "FROM FUPARAREF WHERE FUNCNAME = 'DDIF_FIELDINFO_GET' AND R3STATE = 'A'",
      );
    });

    test('rechazan nombres que no son identificadores', () => {
      assert.throws(() => consultaParametrosFuncion('DROP TABLE'), /nombre no válido/);
      assert.throws(() => consultaCabeceraMetodo('CL_X', "A'B"), /nombre no válido/);
      assert.throws(() => consultaRelaciones('ZIF~M'), /nombre no válido/);
    });

    test('rechazan idiomas inválidos o vacíos', () => {
      assert.throws(() => consultaTituloFuncion('FM', ["E'"]), /idioma no válido/);
      assert.throws(() => consultaTextoClase('CL_X', []), /idioma no válido/);
    });

    test('textos, título y grupo de un módulo de funciones', () => {
      assert.equal(
        consultaTextosFuncion('fm_x', ['E', 'S']),
        "SELECT PARAMETER, KIND, SPRAS, STEXT FROM FUNCT WHERE FUNCNAME = 'FM_X' AND SPRAS IN ('E','S')",
      );
      assert.equal(consultaTituloFuncion('fm_x', ['E']), "SELECT SPRAS, STEXT FROM TFTIT WHERE FUNCNAME = 'FM_X' AND SPRAS IN ('E')");
      assert.equal(consultaGrupoFuncion('fm_x'), "SELECT FUNCNAME, PNAME, FMODE FROM TFDIR WHERE FUNCNAME = 'FM_X'");
    });

    test('cabecera, parámetros, subcomponentes y textos de un método', () => {
      assert.equal(
        consultaCabeceraMetodo('cl_x', 'm'),
        "SELECT CMPNAME, EXPOSURE, MTDDECLTYP, MTDABSTRCT, MTDFINAL, MTDNEWEXC, REDEFIN FROM SEOCOMPODF WHERE CLSNAME = 'CL_X' AND CMPNAME = 'M' AND VERSION = '1'",
      );
      assert.equal(
        consultaParametrosMetodo('cl_x', 'm'),
        "SELECT SCONAME, EDITORDER, PARDECLTYP, PARPASSTYP, TYPTYPE, TYPE, TABLEOF, PARVALUE, PAROPTIONL, PARPREFERD FROM SEOSUBCODF WHERE CLSNAME = 'CL_X' AND CMPNAME = 'M' AND VERSION = '1'",
      );
      assert.equal(consultaSubcomponentes('cl_x', 'm'), "SELECT SCONAME, SCOTYPE FROM SEOSUBCO WHERE CLSNAME = 'CL_X' AND CMPNAME = 'M'");
      assert.equal(
        consultaTextosMetodo('cl_x', 'm', ['E', 'S']),
        "SELECT SCONAME, LANGU, DESCRIPT FROM SEOSUBCOTX WHERE CLSNAME = 'CL_X' AND CMPNAME = 'M' AND LANGU IN ('E','S')",
      );
    });

    test('componentes, métodos públicos, texto y relaciones de una clase', () => {
      assert.equal(
        consultaTextosComponentes('cl_x', ['E']),
        "SELECT CMPNAME, LANGU, DESCRIPT FROM SEOCOMPOTX WHERE CLSNAME = 'CL_X' AND LANGU IN ('E')",
      );
      assert.equal(consultaComponentes('cl_x'), "SELECT CMPNAME, CMPTYPE FROM SEOCOMPO WHERE CLSNAME = 'CL_X'");
      assert.equal(
        consultaMetodosPublicos('cl_x'),
        "SELECT CMPNAME, MTDDECLTYP, EDITORDER FROM SEOCOMPODF WHERE CLSNAME = 'CL_X' AND VERSION = '1' AND EXPOSURE = '2'",
      );
      assert.equal(consultaTextoClase('cl_x', ['E']), "SELECT LANGU, DESCRIPT FROM SEOCLASSTX WHERE CLSNAME = 'CL_X' AND LANGU IN ('E')");
      assert.equal(consultaRelaciones('cl_x'), "SELECT REFCLSNAME, RELTYPE FROM SEOMETAREL WHERE CLSNAME = 'CL_X' AND VERSION = '1'");
    });
  });

  suite('firmaFuncionDe', () => {
    test('DDIF_FIELDINFO_GET: parámetros, excepciones y datos del grupo', () => {
      const firma = firmaFuncionDe('ddif_fieldinfo_get', filasFuncion(), IDIOMAS);
      assert.ok(firma);
      assert.equal(firma.parametros.length, 14);
      assert.deepEqual(firma.excepciones.map((e) => e.nombre), ['NOT_FOUND', 'INTERNAL_ERROR']);
      assert.equal(firma.excepciones[0].texto, 'Nothing found');
      assert.equal(firma.grupo, 'SDIFRUNTIME');
      assert.equal(firma.rfc, true);
      assert.equal(firma.descripcion, 'DD: Interface for Reading Text on Tables or Types');
      assert.equal(firma.uriAdt, '/sap/bc/adt/functions/groups/sdifruntime/fmodules/ddif_fieldinfo_get');
    });

    test('TABNAME es importing por valor del tipo DDOBJNAME y con texto', () => {
      const tabname = firmaFuncionDe('DDIF_FIELDINFO_GET', filasFuncion(), IDIOMAS)?.parametros.find((p) => p.nombre === 'TABNAME');
      assert.ok(tabname);
      assert.equal(tabname.clase, 'importing');
      assert.equal(tabname.formaTipo, 'type');
      assert.equal(tabname.tipo, 'DDOBJNAME');
      assert.equal(tabname.porValor, true);
      assert.equal(tabname.opcional, false);
      assert.ok(tabname.texto?.startsWith('Name of the Table'));
    });

    test('valores por defecto literales y opcionalidad derivada', () => {
      const parametros = firmaFuncionDe('DDIF_FIELDINFO_GET', filasFuncion(), IDIOMAS)?.parametros ?? [];
      const langu = parametros.find((p) => p.nombre === 'LANGU');
      const fieldname = parametros.find((p) => p.nombre === 'FIELDNAME');
      assert.equal(langu?.porDefecto, 'SY-LANGU');
      assert.equal(langu?.opcional, true);
      assert.equal(fieldname?.porDefecto, "' '");
    });

    test('las tablas van siempre por referencia y al final, ordenadas por posición', () => {
      const parametros = firmaFuncionDe('DDIF_FIELDINFO_GET', filasFuncion(), IDIOMAS)?.parametros ?? [];
      const dfies = parametros.find((p) => p.nombre === 'DFIES_TAB');
      assert.equal(dfies?.clase, 'tables');
      assert.equal(dfies?.porValor, false);
      assert.equal(dfies?.opcional, true);
      const orden = ['importing', 'exporting', 'changing', 'tables'];
      const indices = parametros.map((p) => orden.indexOf(p.clase));
      assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
      const importing = parametros.filter((p) => p.clase === 'importing').map((p) => p.posicion);
      assert.deepEqual(importing, [...importing].sort((a, b) => a - b));
    });

    test('sin fila en TFDIR no hay firma', () => {
      assert.equal(firmaFuncionDe('DDIF_FIELDINFO_GET', { ...filasFuncion(), grupo: [] }, IDIOMAS), undefined);
    });

    test('el texto sale del primer idioma de la lista que tenga fila', () => {
      const textos = [
        { PARAMETER: 'TABNAME', KIND: 'P', SPRAS: 'E', STEXT: 'en inglés' },
        { PARAMETER: 'TABNAME', KIND: 'P', SPRAS: 'S', STEXT: 'en español' },
        { PARAMETER: 'LANGU', KIND: 'P', SPRAS: 'E', STEXT: 'solo inglés' },
      ];
      const parametros = firmaFuncionDe('DDIF_FIELDINFO_GET', { ...filasFuncion(), textos }, ['S', 'E'])?.parametros ?? [];
      assert.equal(parametros.find((p) => p.nombre === 'TABNAME')?.texto, 'en español');
      assert.equal(parametros.find((p) => p.nombre === 'LANGU')?.texto, 'solo inglés');
      assert.equal(parametros.find((p) => p.nombre === 'UCLEN')?.texto, undefined);
    });
  });

  suite('firmaMetodoDe', () => {
    test('CL_SALV_TABLE=>FACTORY: estático, público, con excepciones de clase y 5 parámetros ordenados', () => {
      const firma = firmaMetodoDe('CL_SALV_TABLE', 'FACTORY', filasFactory(), IDIOMAS);
      assert.ok(firma);
      assert.equal(firma.estatico, true);
      assert.equal(firma.visibilidad, 'publico');
      assert.equal(firma.excepcionesDeClase, true);
      assert.equal(firma.abstracto, false);
      assert.deepEqual(firma.parametros.map((p) => p.nombre), ['LIST_DISPLAY', 'R_CONTAINER', 'CONTAINER_NAME', 'R_SALV_TABLE', 'T_TABLE']);
      assert.equal(firma.uriAdt, '/sap/bc/adt/oo/classes/cl_salv_table');
    });

    test('opcionalidad, valor por defecto, forma de tipo y clase de cada parámetro', () => {
      const parametros = firmaMetodoDe('CL_SALV_TABLE', 'FACTORY', filasFactory(), IDIOMAS)?.parametros ?? [];
      const listDisplay = parametros.find((p) => p.nombre === 'LIST_DISPLAY');
      assert.equal(listDisplay?.opcional, true);
      assert.equal(listDisplay?.porDefecto, 'IF_SALV_C_BOOL_SAP=>FALSE');
      assert.equal(listDisplay?.porValor, true);
      assert.equal(listDisplay?.tipo, 'SAP_BOOL');
      assert.equal(listDisplay?.formaTipo, 'type');
      assert.equal(listDisplay?.texto, 'ALV Displayed in List Mode');
      assert.equal(parametros.find((p) => p.nombre === 'R_CONTAINER')?.formaTipo, 'refTo');
      assert.equal(parametros.find((p) => p.nombre === 'R_SALV_TABLE')?.clase, 'exporting');
      assert.equal(parametros.find((p) => p.nombre === 'T_TABLE')?.clase, 'changing');
    });

    test('la excepción de clase se identifica por SCOTYPE y no es un parámetro', () => {
      const firma = firmaMetodoDe('CL_SALV_TABLE', 'FACTORY', filasFactory(), IDIOMAS);
      assert.deepEqual(firma?.excepciones, [{ nombre: 'CX_SALV_MSG', texto: 'ALV: General Error Class with Message' }]);
      assert.equal(firma?.parametros.some((p) => p.nombre === 'CX_SALV_MSG'), false);
    });

    test('método clásico: returning y excepción TYPE_NOT_FOUND sin excepciones de clase', () => {
      const firma = firmaMetodoDe(
        'CL_ABAP_TYPEDESCR',
        'DESCRIBE_BY_NAME',
        {
          cabecera: [{ CMPNAME: 'DESCRIBE_BY_NAME', EXPOSURE: '2', MTDDECLTYP: '1', MTDABSTRCT: '', MTDFINAL: '', MTDNEWEXC: '', REDEFIN: '' }],
          parametros: filas('firma-seosubcodf-clasica.xml'),
          subcomponentes: filas('firma-seosubco-clasica.xml'),
          textos: [],
          textosComponentes: [],
        },
        IDIOMAS,
      );
      assert.ok(firma);
      assert.equal(firma.excepcionesDeClase, false);
      assert.equal(firma.parametros.find((p) => p.nombre === 'P_DESCR_REF')?.clase, 'returning');
      assert.deepEqual(firma.excepciones.map((e) => e.nombre), ['TYPE_NOT_FOUND']);
      assert.equal(firma.parametros.some((p) => p.nombre === 'TYPE_NOT_FOUND'), false);
    });

    test('método de interfaz: OUT es refTo IF_OO_ADT_INTRNL_CLASSRUN', () => {
      const firma = firmaMetodoDe(
        'IF_OO_ADT_CLASSRUN',
        'MAIN',
        {
          cabecera: [{ CMPNAME: 'MAIN', EXPOSURE: '2', MTDDECLTYP: '0' }],
          parametros: filas('firma-intf-seosubcodf.xml'),
          subcomponentes: [],
          textos: [],
          textosComponentes: [],
        },
        IDIOMAS,
      );
      const salida = firma?.parametros.find((p) => p.nombre === 'OUT');
      assert.equal(salida?.formaTipo, 'refTo');
      assert.equal(salida?.tipo, 'IF_OO_ADT_INTRNL_CLASSRUN');
      assert.equal(salida?.clase, 'importing');
    });

    test('sin cabecera no hay firma', () => {
      assert.equal(firmaMetodoDe('CL_SALV_TABLE', 'FACTORY', { ...filasFactory(), cabecera: [] }, IDIOMAS), undefined);
    });

    test('la descripción del método sale de SEOCOMPOTX', () => {
      const firma = firmaMetodoDe('CL_SALV_TABLE', 'FACTORY', filasFactory(), IDIOMAS);
      const esperada = filas('firma-seocompotx.xml').find((f) => f.CMPNAME === 'FACTORY' && f.LANGU === 'E')?.DESCRIPT;
      assert.ok(esperada);
      assert.equal(firma?.descripcion, esperada);
    });
  });

  suite('claseResumenDe', () => {
    function resumen() {
      return claseResumenDe(
        'CL_SALV_TABLE',
        fixture('clase-metadatos.xml'),
        fixture('clase-objectstructure.xml'),
        { texto: filas('firma-seoclasstx.xml'), relaciones: filas('firma-seometarel.xml') },
        IDIOMAS,
      );
    }

    test('CL_SALV_TABLE: descripción, paquete, superclase y marcas', () => {
      const r = resumen();
      assert.ok(r);
      assert.equal(r.descripcion, 'Basis Class for Simple Tables');
      assert.equal(r.paquete, 'SALV_OM_OBJECTS');
      assert.equal(r.superclase, 'CL_SALV_MODEL_LIST');
      assert.equal(r.final, true);
      assert.equal(r.abstracto, false);
      assert.equal(r.esInterfaz, false);
      assert.deepEqual(r.interfaces, []);
      assert.deepEqual(r.heredados, []);
      assert.equal(r.uriAdt, '/sap/bc/adt/oo/classes/cl_salv_table');
    });

    test('6 métodos públicos del objectstructure; FACTORY es estático', () => {
      const r = resumen();
      assert.equal(r?.metodos.length, 6);
      assert.equal(r?.metodos.find((m) => m.nombre === 'FACTORY')?.estatico, true);
      assert.equal(r?.metodos.find((m) => m.nombre === 'REFRESH')?.estatico, false);
    });

    test('RELTYPE 1 son interfaces', () => {
      const r = claseResumenDe(
        'CL_X',
        undefined,
        fixture('clase-objectstructure.xml'),
        { texto: [], relaciones: [{ REFCLSNAME: 'IF_UNO', RELTYPE: '1' }, { REFCLSNAME: 'CL_PADRE', RELTYPE: '2' }] },
        IDIOMAS,
      );
      assert.deepEqual(r?.interfaces, ['IF_UNO']);
      assert.equal(r?.superclase, 'CL_PADRE');
      assert.equal(r?.paquete, undefined);
    });

    test('un objectstructure sin raíz de clase o interfaz no da resumen', () => {
      assert.equal(claseResumenDe('X', undefined, '<otra/>', { texto: [], relaciones: [] }, IDIOMAS), undefined);
      assert.equal(
        claseResumenDe('X', undefined, '<abapsource:objectStructureElement adtcore:type="PROG/P" adtcore:name="X"/>', { texto: [], relaciones: [] }, IDIOMAS),
        undefined,
      );
    });
  });

  suite('metodosResumenDe', () => {
    test('solo métodos de SEOCOMPO, en el orden del editor y con origen', () => {
      const metodos = [
        { CMPNAME: 'B_METODO', MTDDECLTYP: '0', EDITORDER: '2 ' },
        { CMPNAME: 'EVENTO', MTDDECLTYP: '0', EDITORDER: '1 ' },
        { CMPNAME: 'A_ESTATICO', MTDDECLTYP: '1', EDITORDER: '3 ' },
      ];
      const componentes = [
        { CMPNAME: 'B_METODO', CMPTYPE: '1' },
        { CMPNAME: 'EVENTO', CMPTYPE: '2' },
        { CMPNAME: 'A_ESTATICO', CMPTYPE: '1' },
      ];
      const textos = [{ CMPNAME: 'B_METODO', LANGU: 'E', DESCRIPT: 'Hace B' }];
      const r = metodosResumenDe({ metodos, componentes, textos }, IDIOMAS, 'CL_PADRE');
      assert.deepEqual(r, [
        { nombre: 'B_METODO', descripcion: 'Hace B', estatico: false, origen: 'CL_PADRE' },
        { nombre: 'A_ESTATICO', descripcion: '', estatico: true, origen: 'CL_PADRE' },
      ]);
    });

    test('con las fixtures de CL_SALV_TABLE los componentes de tipo 1 son métodos', () => {
      const componentes = filas('firma-seocompo.xml');
      const metodos = componentes.filter((f) => f.CMPTYPE === '1').map((f) => ({ CMPNAME: f.CMPNAME, MTDDECLTYP: '0', EDITORDER: '1' }));
      const r = metodosResumenDe({ metodos, componentes, textos: filas('firma-seocompotx.xml') }, IDIOMAS, 'CL_SALV_TABLE');
      assert.equal(r.length, metodos.length);
      assert.ok(r.some((m) => m.nombre === 'FACTORY'));
    });
  });

  suite('uris y nombres', () => {
    test('separarMetodo separa la interfaz del método', () => {
      assert.deepEqual(separarMetodo('zif_x~m'), { interfaz: 'ZIF_X', metodo: 'M' });
      assert.deepEqual(separarMetodo('factory'), { metodo: 'FACTORY' });
    });

    test('uriClase y uriFuncion en minúsculas con la barra codificada', () => {
      assert.equal(uriClase('/BOBF/CL_X', false), '/sap/bc/adt/oo/classes/%2fbobf%2fcl_x');
      assert.equal(uriClase('IF_X', true), '/sap/bc/adt/oo/interfaces/if_x');
      assert.equal(uriFuncion('/ABC/GRP', '/ABC/FM'), '/sap/bc/adt/functions/groups/%2fabc%2fgrp/fmodules/%2fabc%2ffm');
    });
  });
});
