import * as assert from 'node:assert/strict';
import {
  COMANDO_ABRIR_FIRMA,
  COMANDO_INSERTAR_LLAMADA,
  etiquetaOpcional,
  etiquetaTipo,
  markdownClase,
  markdownFuncion,
  markdownMetodo,
} from '../../src/firmas/hover-modelo';
import type { ClaseResumen, FirmaFuncion, FirmaMetodo, MetodoResumen, Parametro } from '../../src/firmas/modelo';

function parametro(parcial: Partial<Parametro> = {}): Parametro {
  return { nombre: 'P', clase: 'importing', posicion: 1, tipo: 'CHAR1', formaTipo: 'type', porValor: true, opcional: false, ...parcial };
}

function argumentos(markdown: string, comando: string): unknown {
  const m = markdown.match(new RegExp(`\\(command:${comando}\\?([^)]*)\\)`));
  assert.ok(m, `falta el enlace ${comando}`);
  return JSON.parse(decodeURIComponent(m[1]));
}

const FUNCION: FirmaFuncion = {
  tipo: 'funcion',
  nombre: 'DDIF_FIELDINFO_GET',
  grupo: 'SDIFRUNTIME',
  rfc: true,
  descripcion: 'DD: Interface for Reading Text on Tables or Types',
  parametros: [
    parametro({ nombre: 'TABNAME', tipo: 'DDOBJNAME', texto: 'Name of the Table' }),
    parametro({ nombre: 'LANGU', tipo: 'SY-LANGU', formaTipo: 'like', opcional: true, porDefecto: 'SY-LANGU' }),
    parametro({ nombre: 'DFIES_TAB', clase: 'tables', tipo: 'DFIES', opcional: true }),
  ],
  excepciones: [{ nombre: 'NOT_FOUND' }, { nombre: 'INTERNAL_ERROR' }],
  uriAdt: '/sap/bc/adt/functions/groups/sdifruntime/fmodules/ddif_fieldinfo_get',
};

function metodo(parcial: Partial<FirmaMetodo> = {}): FirmaMetodo {
  return {
    tipo: 'metodo',
    clase: 'CL_SALV_TABLE',
    nombre: 'FACTORY',
    descripcion: 'Create ALV table',
    estatico: true,
    visibilidad: 'publico',
    abstracto: false,
    excepcionesDeClase: true,
    parametros: [parametro({ nombre: 'R_SALV_TABLE', clase: 'exporting', tipo: 'CL_SALV_TABLE', formaTipo: 'refTo' })],
    excepciones: [{ nombre: 'CX_SALV_MSG' }],
    uriAdt: '/sap/bc/adt/oo/classes/cl_salv_table',
    ...parcial,
  };
}

suite('firmas hover-modelo', () => {
  suite('markdownFuncion', () => {
    const md = markdownFuncion(FUNCION, 'DEST', 7);

    test('cabecera, fila de tabla y opcionales', () => {
      assert.ok(md.includes('**DDIF_FIELDINFO_GET**'));
      assert.ok(md.includes('grupo SDIFRUNTIME'));
      assert.ok(md.includes(' · RFC · '));
      assert.ok(md.includes('| tabname | DDOBJNAME |  | Name of the Table |'));
      assert.ok(md.includes('| langu | LIKE SY-LANGU | opcional, por defecto SY-LANGU |  |'));
      assert.ok(md.includes('| | | | |\n|---|---|---|---|'));
    });

    test('bloques en orden y excepciones', () => {
      assert.ok(md.indexOf('IMPORTING') < md.indexOf('TABLES'));
      assert.ok(!md.includes('EXPORTING'));
      assert.ok(/EXCEPTIONS\n\nnot_found · internal_error/.test(md));
    });

    test('enlaces con argumentos', () => {
      assert.deepEqual(argumentos(md, COMANDO_INSERTAR_LLAMADA), {
        destino: 'DEST',
        firma: { tipo: 'funcion', nombre: 'DDIF_FIELDINFO_GET' },
        receptor: '',
        fila: 7,
      });
      assert.deepEqual(argumentos(md, COMANDO_ABRIR_FIRMA), {
        destino: 'DEST',
        uriAdt: '/sap/bc/adt/functions/groups/sdifruntime/fmodules/ddif_fieldinfo_get',
        nombre: 'DDIF_FIELDINFO_GET',
        tipoAdt: 'FUGR/FF',
      });
    });

    test('sin excepciones no hay EXCEPTIONS ni RFC si no lo es', () => {
      const sin = markdownFuncion({ ...FUNCION, excepciones: [], rfc: false }, 'DEST', 0);
      assert.ok(!sin.includes('EXCEPTIONS'));
      assert.ok(!sin.includes('RFC'));
    });

    test('muestra todos los parámetros sin corte', () => {
      const muchos = Array.from({ length: 30 }, (_, i) => parametro({ nombre: `P${i}` }));
      const grande = markdownFuncion({ ...FUNCION, parametros: muchos }, 'DEST', 0);
      assert.ok(grande.includes('| p29 |'));
    });

    test('escapa la descripción', () => {
      const e = markdownFuncion({ ...FUNCION, descripcion: 'a*b|c' }, 'DEST', 0);
      assert.ok(e.includes('a\\*b\\|c'));
    });
  });

  suite('markdownMetodo', () => {
    test('estático con RAISING', () => {
      const md = markdownMetodo(metodo(), 'DEST', 'cl_salv_table', 3, { objeto: 'CL_SALV_TABLE', metodo: 'FACTORY' });
      assert.ok(md.includes('**CL_SALV_TABLE=>FACTORY**'));
      assert.ok(md.includes('Método estático público'));
      assert.ok(/RAISING\n\ncx_salv_msg/.test(md));
      assert.ok(md.includes('| r_salv_table | REF TO CL_SALV_TABLE |  |  |'));
      assert.deepEqual(argumentos(md, COMANDO_INSERTAR_LLAMADA), {
        destino: 'DEST',
        firma: { tipo: 'metodo', objeto: 'CL_SALV_TABLE', metodo: 'FACTORY' },
        receptor: 'cl_salv_table',
        fila: 3,
      });
      assert.deepEqual(argumentos(md, COMANDO_ABRIR_FIRMA), {
        destino: 'DEST',
        uriAdt: '/sap/bc/adt/oo/classes/cl_salv_table',
        nombre: 'CL_SALV_TABLE',
        tipoAdt: 'CLAS/OC',
      });
    });

    test('un paréntesis en el receptor va codificado y no cierra el enlace', () => {
      const md = markdownMetodo(metodo({ estatico: false }), 'DEST', 'lt_x[ 1 ]-obj(1)', 0, { objeto: 'CL_SALV_TABLE', metodo: 'FACTORY' });
      const enlace = /\[\$\(symbol-method\) Insertar llamada\]\(([^)]*)\)/.exec(md)?.[1] ?? '';
      assert.ok(enlace.includes('%28') && enlace.includes('%29'), enlace);
      assert.equal((argumentos(md, COMANDO_INSERTAR_LLAMADA) as { receptor: string }).receptor, 'lt_x[ 1 ]-obj(1)');
    });

    test('de instancia heredado y excepciones clásicas', () => {
      const md = markdownMetodo(
        metodo({ estatico: false, heredadoDe: 'CL_X', excepcionesDeClase: false, excepciones: [{ nombre: 'ERROR' }] }),
        'DEST',
        'lo_alv',
        0,
        { objeto: 'ZCL_HIJA_EJEMPLO', metodo: 'FACTORY' },
      );
      assert.ok(md.includes('**CL_SALV_TABLE->FACTORY**'));
      assert.ok(md.includes('heredado de CL_X'));
      assert.deepEqual((argumentos(md, COMANDO_INSERTAR_LLAMADA) as { firma: unknown }).firma, {
        tipo: 'metodo', objeto: 'ZCL_HIJA_EJEMPLO', metodo: 'FACTORY',
      });
      assert.ok(/EXCEPTIONS\n\nerror/.test(md));
    });

    test('de interfaz', () => {
      const md = markdownMetodo(metodo({ deInterfaz: 'ZIF_Y' }), 'DEST', '', 0, { objeto: 'CL_SALV_TABLE', metodo: 'ZIF_Y~FACTORY' });
      assert.ok(md.includes('de la interfaz ZIF_Y'));
    });

    test('el enlace lleva la llamada tal como está en el código: interfaz con ~ y viaSuper', () => {
      const deInterfaz = markdownMetodo(metodo({ deInterfaz: 'ZIF_A' }), 'DEST', 'lo_x', 0, { objeto: 'ZCL_X', metodo: 'ZIF_A~RUN' });
      assert.deepEqual((argumentos(deInterfaz, COMANDO_INSERTAR_LLAMADA) as { firma: unknown }).firma, {
        tipo: 'metodo', objeto: 'ZCL_X', metodo: 'ZIF_A~RUN',
      });
      const viaSuper = markdownMetodo(metodo(), 'DEST', 'super', 0, { objeto: 'ZCL_H', metodo: 'CONSTRUCTOR', viaSuper: true });
      assert.deepEqual((argumentos(viaSuper, COMANDO_INSERTAR_LLAMADA) as { firma: unknown }).firma, {
        tipo: 'metodo', objeto: 'ZCL_H', metodo: 'CONSTRUCTOR', viaSuper: true,
      });
    });

    test('RETURNING es su propio grupo, al final', () => {
      const md = markdownMetodo(
        metodo({ parametros: [parametro({ nombre: 'R', clase: 'returning' }), parametro({ nombre: 'A' })] }),
        'DEST',
        '',
        0,
        { objeto: 'CL_SALV_TABLE', metodo: 'FACTORY' },
      );
      assert.ok(md.indexOf('IMPORTING') < md.indexOf('RETURNING'));
    });
  });

  suite('etiquetas', () => {
    test('etiquetaTipo', () => {
      assert.equal(etiquetaTipo(parametro({ formaTipo: 'refTo', tipo: 'CL_GUI_CONTAINER' })), 'REF TO CL_GUI_CONTAINER');
      assert.equal(etiquetaTipo(parametro({ formaTipo: 'ninguna', tipo: '' })), 'genérico');
      assert.equal(etiquetaTipo(parametro({ formaTipo: 'like', tipo: 'DFIES' })), 'LIKE DFIES');
      assert.equal(etiquetaTipo(parametro({ tipo: 'STRING' })), 'STRING');
    });

    test('etiquetaOpcional', () => {
      assert.equal(etiquetaOpcional(parametro()), '');
      assert.equal(etiquetaOpcional(parametro({ opcional: true })), 'opcional');
      assert.equal(etiquetaOpcional(parametro({ opcional: true, porDefecto: 'SY-LANGU' })), 'opcional, por defecto SY-LANGU');
    });
  });

  suite('markdownClase', () => {
    const metodos: MetodoResumen[] = Array.from({ length: 10 }, (_, i) => ({ nombre: `M${i}`, descripcion: '', estatico: false }));
    const clase: ClaseResumen = {
      nombre: 'CL_SALV_TABLE',
      esInterfaz: false,
      descripcion: 'Basis Class Simple ALV Tables',
      paquete: 'SALV_OM_OBJECTS',
      superclase: 'CL_SALV_MODEL_LIST',
      interfaces: ['IF_A', 'IF_B'],
      final: false,
      abstracto: false,
      metodos,
      heredados: [{ nombre: 'GET_LAYOUT', descripcion: '', estatico: false, origen: 'CL_SALV_MODEL_LIST' }],
      uriAdt: '/sap/bc/adt/oo/classes/cl_salv_table',
    };
    const md = markdownClase(clase, 'DEST');

    test('cabecera', () => {
      assert.ok(
        md.includes(
          '**CL_SALV_TABLE** · Clase · Basis Class Simple ALV Tables · paquete SALV_OM_OBJECTS · hereda de CL_SALV_MODEL_LIST · implementa IF_A, IF_B',
        ),
      );
    });

    test('corta a 8 métodos', () => {
      assert.ok(md.includes('M7'));
      assert.ok(!md.includes('M8'));
      assert.ok(md.includes('… y 2 más'));
      assert.ok(md.includes('Heredados y de interfaces: GET_LAYOUT (CL_SALV_MODEL_LIST)'));
    });

    test('solo el enlace Abrir', () => {
      assert.equal((md.match(/\(command:/g) ?? []).length, 1);
      assert.ok(md.includes(COMANDO_ABRIR_FIRMA));
    });
  });
});
