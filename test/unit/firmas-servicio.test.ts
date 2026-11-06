import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConexionAdt } from '../../src/adt/conexion-adt';
import { type PeticionAdt, type RespuestaAdt, type TransporteAdt } from '../../src/adt/transporte';
import { TIEMPO_HOVER_MS, type DependenciasServicio } from '../../src/diccionario/servicio';
import { PROFUNDIDAD_HERENCIA, ServicioFirmas } from '../../src/firmas/servicio';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

const SIN_FILAS = fixture('dp-sin-filas.xml');

function escaparXml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Data Preview sintético con las columnas dadas, en el formato de las respuestas reales. */
function dataPreview(filas: Record<string, string>[]): string {
  const columnas = Object.keys(filas[0] ?? {});
  const bloques = columnas.map((c) =>
    `<dataPreview:columns><dataPreview:metadata dataPreview:name="${c}"/><dataPreview:dataSet>` +
    filas.map((f) => `<dataPreview:data>${escaparXml(f[c] ?? '')}</dataPreview:data>`).join('') +
    '</dataPreview:dataSet></dataPreview:columns>');
  return `<?xml version="1.0" encoding="utf-8"?><dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">${bloques.join('')}</dataPreview:tableData>`;
}

const RUTAS_FIXTURE: Readonly<Record<string, string>> = {
  '/sap/bc/adt/oo/classes/cl_salv_table': 'clase-metadatos.xml',
  '/sap/bc/adt/oo/classes/cl_salv_table/objectstructure': 'clase-objectstructure.xml',
};

/** Clave `<tabla> <objeto>`; la cabecera de método y la lista de públicos se distinguen en SEOCOMPODF. */
const SQL_FIXTURE: Readonly<Record<string, string>> = {
  'FUPARAREF DDIF_FIELDINFO_GET': 'firma-fupararef.xml',
  'FUNCT DDIF_FIELDINFO_GET': 'firma-funct.xml',
  'TFTIT DDIF_FIELDINFO_GET': 'firma-tftit.xml',
  'TFDIR DDIF_FIELDINFO_GET': 'firma-tfdir.xml',
  'SEOCOMPODF CL_SALV_TABLE': 'firma-seocompodf.xml',
  'SEOSUBCODF CL_SALV_TABLE': 'firma-seosubcodf.xml',
  'SEOSUBCO CL_SALV_TABLE': 'firma-seosubco.xml',
  'SEOSUBCOTX CL_SALV_TABLE': 'firma-seosubcotx.xml',
  'SEOCOMPOTX CL_SALV_TABLE': 'firma-seocompotx.xml',
  'SEOMETAREL CL_SALV_TABLE': 'firma-seometarel.xml',
  'SEOCLASSTX CL_SALV_TABLE': 'firma-seoclasstx.xml',
};

function tablaDe(sql: string): string {
  const tabla = /FROM (\w+)/.exec(sql)?.[1] ?? '?';
  return tabla === 'SEOCOMPODF' && sql.includes("EXPOSURE = '2'") ? 'SEOCOMPODF-PUBLICOS' : tabla;
}

function objetoDe(sql: string): string {
  return /(?:CLSNAME|FUNCNAME) = '([^']+)'/.exec(sql)?.[1] ?? '?';
}

type Respondedor = (p: PeticionAdt) => RespuestaAdt | undefined;

interface TransporteFalso extends TransporteAdt { peticiones: PeticionAdt[]; respondedores: Respondedor[] }

function respuestaPorDefecto(p: PeticionAdt): RespuestaAdt {
  if (p.metodo === 'GET') {
    const archivo = RUTAS_FIXTURE[p.ruta];
    return archivo ? { estado: 200, cuerpo: fixture(archivo) } : { estado: 404, cuerpo: '' };
  }
  const sql = p.cuerpo ?? '';
  const archivo = SQL_FIXTURE[`${tablaDe(sql)} ${objetoDe(sql)}`];
  return { estado: 200, cuerpo: archivo ? fixture(archivo) : SIN_FILAS };
}

function crearTransporte(): TransporteFalso {
  const peticiones: PeticionAdt[] = [];
  const respondedores: Respondedor[] = [];
  return {
    peticiones,
    respondedores,
    peticion: async (p) => {
      peticiones.push(p);
      for (const r of respondedores) {
        const respuesta = r(p);
        if (respuesta) { return respuesta; }
      }
      return respuestaPorDefecto(p);
    },
  };
}

/** Responde con `filas` a las consultas sobre `tabla` del objeto `objeto`. */
function responderFilas(tabla: string, objeto: string, filas: Record<string, string>[]): Respondedor {
  return (p) => {
    const sql = p.cuerpo ?? '';
    return p.metodo === 'POST' && tablaDe(sql) === tabla && objetoDe(sql) === objeto
      ? { estado: 200, cuerpo: dataPreview(filas) }
      : undefined;
  };
}

const CABECERA_M = { CMPNAME: 'M', EXPOSURE: '2', MTDDECLTYP: '0', MTDABSTRCT: '', MTDFINAL: '', MTDNEWEXC: 'X', REDEFIN: '' };

interface Entorno {
  servicio: ServicioFirmas;
  transporte: TransporteFalso;
  registros: string[];
  reloj: { ahora: number };
}

function crearEntorno(opciones: { sinConexion?: boolean } = {}): Entorno {
  const transporte = crearTransporte();
  const registros: string[] = [];
  const reloj = { ahora: 1_000 };
  const conexion = new ConexionAdt(transporte);
  const deps: DependenciasServicio = {
    conexion: async () => (opciones.sinConexion ? undefined : conexion),
    idiomaDe: () => 'E',
    ahora: () => reloj.ahora,
    registrar: (m) => registros.push(m),
  };
  return { servicio: new ServicioFirmas(deps), transporte, registros, reloj };
}

function consultas(transporte: TransporteFalso): string[] {
  return transporte.peticiones.map((p) => (p.metodo === 'GET' ? p.ruta : `${tablaDe(p.cuerpo ?? '')} ${objetoDe(p.cuerpo ?? '')}`));
}

suite('firmas-servicio', () => {
  suite('firmaFuncion', () => {
    test('DDIF_FIELDINFO_GET: firma completa con cuatro consultas; la segunda llamada sale de caché', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      const firma = await servicio.firmaFuncion('DEST', 'ddif_fieldinfo_get');
      assert.equal(firma?.nombre, 'DDIF_FIELDINFO_GET');
      assert.equal(firma?.grupo, 'SDIFRUNTIME');
      assert.equal(firma?.parametros.length, 14);
      assert.equal(firma?.excepciones.length, 2);
      assert.equal(firma?.descripcion, 'DD: Interface for Reading Text on Tables or Types');
      assert.deepEqual([...consultas(transporte)].sort(), [
        'FUNCT DDIF_FIELDINFO_GET', 'FUPARAREF DDIF_FIELDINFO_GET', 'TFDIR DDIF_FIELDINFO_GET', 'TFTIT DDIF_FIELDINFO_GET',
      ]);
      assert.ok(transporte.peticiones.every((p) => p.tiempoMs === TIEMPO_HOVER_MS));
      assert.deepEqual(registros, ['Firmas: funcion → ok (14 parámetros, 2 excepciones)']);
      assert.equal((await servicio.firmaFuncion('DEST', 'DDIF_FIELDINFO_GET'))?.nombre, 'DDIF_FIELDINFO_GET');
      assert.equal(transporte.peticiones.length, 4);
    });

    test('sin fila de TFDIR → undefined, y el 404 se cachea', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      assert.equal(await servicio.firmaFuncion('DEST', 'Z_NO_EXISTE'), undefined);
      assert.equal(await servicio.firmaFuncion('DEST', 'Z_NO_EXISTE'), undefined);
      assert.equal(transporte.peticiones.length, 4);
      assert.deepEqual(registros, ['Firmas: funcion → 404']);
    });

    test('un fallo en FUPARAREF rechaza y no se cachea', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      let fallar = true;
      transporte.respondedores.push((p) =>
        fallar && tablaDe(p.cuerpo ?? '') === 'FUPARAREF' ? { estado: 500, cuerpo: '' } : undefined);
      await assert.rejects(servicio.firmaFuncion('DEST', 'DDIF_FIELDINFO_GET'));
      assert.deepEqual(registros, ['Firmas: funcion → error ErrorAdt']);
      fallar = false;
      assert.equal((await servicio.firmaFuncion('DEST', 'DDIF_FIELDINFO_GET'))?.parametros.length, 14);
      assert.equal(transporte.peticiones.length, 8);
    });

    test('un fallo en los textos no impide la firma: queda sin textos', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push((p) => (tablaDe(p.cuerpo ?? '') === 'FUNCT' ? { estado: 500, cuerpo: '' } : undefined));
      const firma = await servicio.firmaFuncion('DEST', 'DDIF_FIELDINFO_GET');
      assert.equal(firma?.parametros.length, 14);
      assert.ok(firma?.parametros.every((p) => p.texto === undefined));
    });

    test('un nombre que no es identificador no consulta', async () => {
      const { servicio, transporte } = crearEntorno();
      assert.equal(await servicio.firmaFuncion('DEST', "Z_X' OR '1"), undefined);
      assert.equal(transporte.peticiones.length, 0);
    });
  });

  suite('firmaMetodo', () => {
    test('CL_SALV_TABLE=>FACTORY: firma con cinco consultas y caché', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      const firma = await servicio.firmaMetodo('DEST', 'cl_salv_table', 'factory');
      assert.equal(firma?.clase, 'CL_SALV_TABLE');
      assert.equal(firma?.nombre, 'FACTORY');
      assert.equal(firma?.parametros.length, 5);
      assert.equal(firma?.heredadoDe, undefined);
      assert.equal(firma?.deInterfaz, undefined);
      assert.equal(firma?.uriAdt, '/sap/bc/adt/oo/classes/cl_salv_table');
      assert.equal(transporte.peticiones.length, 5);
      assert.deepEqual(registros, ['Firmas: metodo → ok (5 parámetros, 1 excepciones)']);
      await servicio.firmaMetodo('DEST', 'CL_SALV_TABLE', 'FACTORY');
      assert.equal(transporte.peticiones.length, 5);
    });

    test('heredado: sin cabecera en ZCL_HIJA se busca en su superclase', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      transporte.respondedores.push(responderFilas('SEOMETAREL', 'ZCL_HIJA', [{ REFCLSNAME: 'CL_SALV_TABLE', RELTYPE: '2' }]));
      const firma = await servicio.firmaMetodo('DEST', 'ZCL_HIJA', 'FACTORY');
      assert.equal(firma?.clase, 'CL_SALV_TABLE');
      assert.equal(firma?.heredadoDe, 'CL_SALV_TABLE');
      assert.equal(firma?.parametros.length, 5);
      assert.deepEqual(consultas(transporte).slice(0, 3), ['SEOCOMPODF ZCL_HIJA', 'SEOMETAREL ZCL_HIJA', 'SEOCOMPODF CL_SALV_TABLE']);
      assert.deepEqual(registros, ['Firmas: metodo → ok (5 parámetros, 1 excepciones, heredado)']);
    });

    test('redefinición: con REDEFIN = X en ZCL_HIJA la firma sale de la superclase, marcada como heredada', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(
        responderFilas('SEOCOMPODF', 'ZCL_HIJA', [{ ...CABECERA_M, CMPNAME: 'FACTORY', REDEFIN: 'X' }]),
        responderFilas('SEOMETAREL', 'ZCL_HIJA', [{ REFCLSNAME: 'CL_SALV_TABLE', RELTYPE: '2' }]),
      );
      const firma = await servicio.firmaMetodo('DEST', 'ZCL_HIJA', 'FACTORY');
      assert.equal(firma?.clase, 'CL_SALV_TABLE');
      assert.equal(firma?.heredadoDe, 'CL_SALV_TABLE');
      assert.equal(firma?.parametros.length, 5);
      assert.ok(!consultas(transporte).includes('SEOSUBCODF ZCL_HIJA'));
    });

    test('desdeSuper empieza directamente en la superclase y se cachea aparte', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(responderFilas('SEOMETAREL', 'ZCL_HIJA', [{ REFCLSNAME: 'CL_SALV_TABLE', RELTYPE: '2' }]));
      const firma = await servicio.firmaMetodo('DEST', 'ZCL_HIJA', 'FACTORY', { desdeSuper: true });
      assert.equal(firma?.heredadoDe, 'CL_SALV_TABLE');
      assert.ok(!consultas(transporte).includes('SEOCOMPODF ZCL_HIJA'));
      await servicio.firmaMetodo('DEST', 'ZCL_HIJA', 'FACTORY');
      assert.ok(consultas(transporte).includes('SEOCOMPODF ZCL_HIJA'));
    });

    test('una cadena circular A → B → A termina sin firma', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      transporte.respondedores.push(
        responderFilas('SEOMETAREL', 'ZCL_A', [{ REFCLSNAME: 'ZCL_B', RELTYPE: '2' }]),
        responderFilas('SEOMETAREL', 'ZCL_B', [{ REFCLSNAME: 'ZCL_A', RELTYPE: '2' }]),
      );
      assert.equal(await servicio.firmaMetodo('DEST', 'ZCL_A', 'M'), undefined);
      assert.ok(transporte.peticiones.length <= 2 * PROFUNDIDAD_HERENCIA);
      assert.deepEqual(registros, ['Firmas: metodo → 404']);
    });

    test('una cadena más larga que PROFUNDIDAD_HERENCIA se corta', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push((p) => {
        const sql = p.cuerpo ?? '';
        const n = /^ZCL_(\d+)$/.exec(objetoDe(sql))?.[1];
        return tablaDe(sql) === 'SEOMETAREL' && n !== undefined
          ? { estado: 200, cuerpo: dataPreview([{ REFCLSNAME: `ZCL_${Number(n) + 1}`, RELTYPE: '2' }]) }
          : undefined;
      });
      assert.equal(await servicio.firmaMetodo('DEST', 'ZCL_0', 'M'), undefined);
      assert.equal(consultas(transporte).filter((c) => c.startsWith('SEOCOMPODF ')).length, PROFUNDIDAD_HERENCIA);
    });

    test('zif~m consulta directamente la interfaz y marca deInterfaz', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(responderFilas('SEOCOMPODF', 'ZIF_X', [CABECERA_M]));
      const firma = await servicio.firmaMetodo('DEST', 'ZCL_X', 'zif_x~m');
      assert.equal(firma?.clase, 'ZIF_X');
      assert.equal(firma?.nombre, 'M');
      assert.equal(firma?.deInterfaz, 'ZIF_X');
      assert.equal(firma?.uriAdt, '/sap/bc/adt/oo/interfaces/zif_x');
      assert.ok(consultas(transporte).every((c) => c.endsWith(' ZIF_X')));
      assert.ok(transporte.peticiones.every((p) => !(p.cuerpo ?? '').includes('~')));
    });

    test('un método que solo está en una interfaz de la clase se encuentra allí', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(
        responderFilas('SEOMETAREL', 'ZCL_Y', [{ REFCLSNAME: 'ZIF_Y', RELTYPE: '1' }]),
        responderFilas('SEOCOMPODF', 'ZIF_Y', [CABECERA_M]),
      );
      const firma = await servicio.firmaMetodo('DEST', 'ZCL_Y', 'M');
      assert.equal(firma?.deInterfaz, 'ZIF_Y');
      assert.equal(firma?.heredadoDe, undefined);
      assert.equal(firma?.uriAdt, '/sap/bc/adt/oo/interfaces/zif_y');
    });

    test('nombres que no son identificadores no consultan', async () => {
      const { servicio, transporte } = crearEntorno();
      assert.equal(await servicio.firmaMetodo('DEST', 'ZCL_X', "A'B"), undefined);
      assert.equal(await servicio.firmaMetodo('DEST', 'ZCL X', 'M'), undefined);
      assert.equal(await servicio.firmaMetodo('DEST', 'ZCL_X', 'ZIF~'), undefined);
      assert.equal(transporte.peticiones.length, 0);
    });
  });

  suite('clase', () => {
    const PUBLICOS_PADRE = [
      { CMPNAME: 'GET_COLUMNS', MTDDECLTYP: '0', EDITORDER: '1' },
      { CMPNAME: 'GET_DISPLAY_SETTINGS', MTDDECLTYP: '0', EDITORDER: '2' },
    ];
    const COMPONENTES_PADRE = [{ CMPNAME: 'GET_COLUMNS', CMPTYPE: '1' }, { CMPNAME: 'GET_DISPLAY_SETTINGS', CMPTYPE: '1' }];

    test('CL_SALV_TABLE: 6 métodos propios y los heredados de CL_SALV_MODEL_LIST; la segunda llamada sale de caché', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      transporte.respondedores.push(
        responderFilas('SEOCOMPODF-PUBLICOS', 'CL_SALV_MODEL_LIST', PUBLICOS_PADRE),
        responderFilas('SEOCOMPO', 'CL_SALV_MODEL_LIST', COMPONENTES_PADRE),
      );
      const resumen = await servicio.clase('DEST', 'cl_salv_table');
      assert.equal(resumen?.esInterfaz, false);
      assert.equal(resumen?.superclase, 'CL_SALV_MODEL_LIST');
      assert.equal(resumen?.metodos.length, 6);
      assert.deepEqual(resumen?.heredados.map((m) => [m.nombre, m.origen]), [
        ['GET_COLUMNS', 'CL_SALV_MODEL_LIST'],
        ['GET_DISPLAY_SETTINGS', 'CL_SALV_MODEL_LIST'],
      ]);
      const [metadatos, estructura] = transporte.peticiones;
      assert.equal(metadatos.cabeceras.accept, 'application/vnd.sap.adt.oo.classes.v2+xml');
      assert.equal(estructura.ruta, '/sap/bc/adt/oo/classes/cl_salv_table/objectstructure');
      assert.deepEqual(estructura.parametros, { version: 'active', withShortDescriptions: 'true' });
      assert.equal(estructura.cabeceras.accept, 'application/vnd.sap.adt.objectstructure.v2+xml');
      assert.deepEqual(registros, ['Firmas: clase → ok (6 métodos, 2 heredados)']);
      const antes = transporte.peticiones.length;
      await servicio.clase('DEST', 'CL_SALV_TABLE');
      assert.equal(transporte.peticiones.length, antes);
    });

    test('con 404 en clases prueba como interfaz', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push((p) => {
        if (p.ruta === '/sap/bc/adt/oo/interfaces/zif_y') {
          return { estado: 200, cuerpo: '<intf:abapInterface adtcore:name="ZIF_Y" adtcore:description="Interfaz Y"/>' };
        }
        return p.ruta === '/sap/bc/adt/oo/interfaces/zif_y/objectstructure'
          ? { estado: 200, cuerpo: '<abapsource:objectStructureElement adtcore:type="INTF/OI" adtcore:name="ZIF_Y"/>' }
          : undefined;
      });
      const resumen = await servicio.clase('DEST', 'ZIF_Y');
      assert.equal(resumen?.esInterfaz, true);
      assert.equal(resumen?.descripcion, 'Interfaz Y');
      assert.equal(resumen?.uriAdt, '/sap/bc/adt/oo/interfaces/zif_y');
      assert.equal(transporte.peticiones[1].cabeceras.accept, 'application/vnd.sap.adt.oo.interfaces.v2+xml');
    });

    test('404 como clase y como interfaz → undefined cacheado', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      assert.equal(await servicio.clase('DEST', 'ZCL_NADA'), undefined);
      assert.equal(await servicio.clase('DEST', 'ZCL_NADA'), undefined);
      assert.deepEqual(consultas(transporte), ['/sap/bc/adt/oo/classes/zcl_nada', '/sap/bc/adt/oo/interfaces/zcl_nada']);
      assert.deepEqual(registros, ['Firmas: clase → 404']);
    });
  });

  test('sin conexión: undefined y una sola línea de aviso por destino', async () => {
    const { servicio, transporte, registros } = crearEntorno({ sinConexion: true });
    assert.equal(await servicio.firmaFuncion('DEST', 'DDIF_FIELDINFO_GET'), undefined);
    assert.equal(await servicio.firmaMetodo('DEST', 'CL_SALV_TABLE', 'FACTORY'), undefined);
    assert.equal(await servicio.clase('DEST', 'CL_SALV_TABLE'), undefined);
    assert.equal(transporte.peticiones.length, 0);
    assert.deepEqual(registros, ['Firmas: sin conexión RFC']);
  });

  test('vaciar(destino) obliga a volver a pedir', async () => {
    const { servicio, transporte } = crearEntorno();
    await servicio.firmaFuncion('DEST', 'DDIF_FIELDINFO_GET');
    servicio.vaciar('OTRO');
    await servicio.firmaFuncion('DEST', 'DDIF_FIELDINFO_GET');
    assert.equal(transporte.peticiones.length, 4);
    servicio.vaciar('DEST');
    await servicio.firmaFuncion('DEST', 'DDIF_FIELDINFO_GET');
    assert.equal(transporte.peticiones.length, 8);
  });

  test('el TTL de metadatos caduca la caché', async () => {
    const { servicio, transporte, reloj } = crearEntorno();
    await servicio.firmaFuncion('DEST', 'DDIF_FIELDINFO_GET');
    reloj.ahora += 600_000;
    await servicio.firmaFuncion('DEST', 'DDIF_FIELDINFO_GET');
    assert.equal(transporte.peticiones.length, 8);
  });
});
