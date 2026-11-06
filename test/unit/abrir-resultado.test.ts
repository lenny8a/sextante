import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  abrirResultado,
  archivoPreferidoDe,
  carpetaTipoDe,
  grupoDeFuncion,
  objetoRepotreeDe,
  olvidarCategorias,
  type DependenciasAbrir,
} from '../../src/adt/abrir-resultado';
import { buscar, paqueteSinFiltro } from '../../src/adt/busqueda-cliente';
import { FILTROS_TIPO, type ResultadoBusqueda } from '../../src/adt/busqueda-modelo';
import { ConexionAdt } from '../../src/adt/conexion-adt';
import type { PeticionAdt } from '../../src/adt/transporte';

function fixtureReal(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

/** Sirve la respuesta filtrada si la petición lleva objectType y la búsqueda sin filtro si no. */
function conexionBusqueda(filtrada: string, sinFiltro: string, peticiones: PeticionAdt[]): ConexionAdt {
  return new ConexionAdt({
    peticion: async (p) => {
      peticiones.push(p);
      return { estado: 200, cuerpo: fixtureReal(p.parametros?.objectType ? filtrada : sinFiltro) };
    },
  });
}

function resultado(tipo: string, nombre: string, extra: Partial<ResultadoBusqueda> = {}): ResultadoBusqueda {
  return { nombre, tipo, descripcion: '', paquete: 'ZPAQ1', uriAdt: '', ...extra };
}

const URI_FM = '/sap/bc/adt/functions/groups/zfg_ejemplo/fmodules/z_fm_ejemplo';

interface FixtureGrupo {
  informe: { hermanos: { entradas: { nombre: string }[] } };
}
const ARCHIVOS_FUGR = (
  JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/repotree-s4/grupo-funciones.json'), 'utf8'),
  ) as FixtureGrupo
).informe.hermanos.entradas.map((e) => e.nombre);

function dependencias(carpetas: Record<string, string[] | Error>): {
  deps: DependenciasAbrir;
  abiertos: string[];
  paquetes: string[];
  listadas: string[];
} {
  const abiertos: string[] = [];
  const paquetes: string[] = [];
  const listadas: string[] = [];
  const deps: DependenciasAbrir = {
    destino: 'DEST',
    usuario: 'USUARIO',
    listarCarpeta: async (ruta) => {
      listadas.push(ruta);
      const entradas = carpetas[ruta];
      if (entradas === undefined) {
        throw new Error('no existe');
      }
      if (entradas instanceof Error) {
        throw entradas;
      }
      return entradas;
    },
    mostrar: async (ruta) => {
      abiertos.push(ruta);
    },
    irAPaquete: async (nombre) => {
      paquetes.push(nombre);
    },
  };
  return { deps, abiertos, paquetes, listadas };
}

const PAQUETE = '/repotree-v1/DEST/System Library/ZPAQ1';
const CLASE = `${PAQUETE}/Source Library/Classes/ZCL_EJEMPLO`;

suite('abrir-resultado', () => {
  setup(olvidarCategorias);

  test('carpetaTipoDe cubre la tabla de tipos', () => {
    const esperado: [string, string, string][] = [
      ['CLAS/OC', 'codigo', 'Classes'],
      ['INTF/OI', 'codigo', 'Interfaces'],
      ['PROG/P', 'codigo', 'Programs'],
      ['PROG/I', 'codigo', 'Includes'],
      ['FUGR/F', 'codigo', 'Function Groups'],
      ['FUGR/FF', 'codigo', 'Function Groups'],
      ['TABL/DT', 'Dictionary', 'Database Tables'],
      ['TABL/DS', 'Dictionary', 'Structures'],
      ['DDLS/DF', 'Dictionary', 'ABAP DDL Sources'],
    ];
    for (const [tipo, categoria, tipoCarpeta] of esperado) {
      assert.deepStrictEqual(carpetaTipoDe(tipo), { categoria, tipoCarpeta }, tipo);
    }
    assert.strictEqual(carpetaTipoDe('XSLT/XS'), undefined);
  });

  test('grupoDeFuncion lo saca de la uri', () => {
    assert.strictEqual(grupoDeFuncion(URI_FM), 'ZFG_EJEMPLO');
    assert.strictEqual(grupoDeFuncion('/sap/bc/adt/oo/classes/zcl'), undefined);
  });

  test('grupoDeFuncion no lanza con un % mal formado en la uri', () => {
    const uri = '/sap/bc/adt/functions/groups/zfg%E0%A4%A/fmodules/z_fm_ejemplo';
    assert.strictEqual(grupoDeFuncion(uri), 'ZFG%E0%A4%A');
  });

  test('objetoRepotreeDe: un paquete con namespace se busca como (NS)NOMBRE', async () => {
    const r = resultado('CLAS/OC', 'ZCL_EJEMPLO', { paquete: '/ZNS/ZPAQ1' });
    assert.strictEqual(objetoRepotreeDe(r, 'Source Library', 'USUARIO')?.paquete, '(ZNS)ZPAQ1');
    const paquete = '/repotree-v1/DEST/System Library/(ZNS)ZPAQ1';
    const { deps, abiertos } = dependencias({
      [paquete]: ['Source Library'],
      [`${paquete}/Source Library/Classes/ZCL_EJEMPLO`]: ['zcl_ejemplo.clas.abap'],
    });
    assert.strictEqual(await abrirResultado(r, deps), 'abierto');
    assert.deepStrictEqual(abiertos, [`${paquete}/Source Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap`]);
  });

  test('objetoRepotreeDe: clase, $TMP, función y diccionario', () => {
    const clase = objetoRepotreeDe(resultado('CLAS/OC', 'ZCL_EJEMPLO'), 'Source Library', 'USUARIO');
    assert.deepStrictEqual(clase, {
      biblioteca: 'System Library',
      paquete: 'ZPAQ1',
      categoria: 'Source Library',
      tipoCarpeta: 'Classes',
      nombre: 'ZCL_EJEMPLO',
    });
    const local = objetoRepotreeDe(resultado('CLAS/OC', 'ZCL_L', { paquete: '$TMP' }), 'Source Code Library', 'USUARIO');
    assert.strictEqual(local?.biblioteca, 'Local Objects ($TMP)');
    assert.strictEqual(local?.paquete, 'USUARIO');
    const fm = objetoRepotreeDe(resultado('FUGR/FF', 'Z_FM_EJEMPLO', { uriAdt: URI_FM }), 'Source Code Library', 'U');
    assert.strictEqual(fm?.nombre, 'ZFG_EJEMPLO');
    assert.strictEqual(objetoRepotreeDe(resultado('XSLT/XS', 'X'), 'Source Library', 'U'), undefined);
    assert.strictEqual(objetoRepotreeDe(resultado('TABL/DT', 'ZTAB'), 'Source Library', 'U')?.categoria, 'Dictionary');
  });

  test('archivoPreferidoDe: función concreta o archivo principal', () => {
    const fm = resultado('FUGR/FF', 'Z_FM_EJEMPLO', { uriAdt: URI_FM });
    assert.strictEqual(archivoPreferidoDe(fm, ARCHIVOS_FUGR), 'zfg_ejemplo.fugr.z_fm_ejemplo.func.abap');
    assert.strictEqual(
      archivoPreferidoDe(resultado('FUGR/FF', 'Z_OTRA', { uriAdt: URI_FM }), ARCHIVOS_FUGR),
      'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap',
    );
    assert.strictEqual(
      archivoPreferidoDe(resultado('CLAS/OC', 'ZCL'), ['zcl.clas.json', 'zcl.clas.abap']),
      'zcl.clas.abap',
    );
  });

  test('abrirResultado abre el .clas.abap y cachea la categoría', async () => {
    const { deps, abiertos, listadas } = dependencias({
      [PAQUETE]: ['Dictionary', 'Source Library'],
      [CLASE]: ['zcl_ejemplo.clas.json', 'zcl_ejemplo.clas.abap'],
    });
    assert.strictEqual(await abrirResultado(resultado('CLAS/OC', 'ZCL_EJEMPLO'), deps), 'abierto');
    assert.deepStrictEqual(abiertos, [`${CLASE}/zcl_ejemplo.clas.abap`]);
    await abrirResultado(resultado('CLAS/OC', 'ZCL_EJEMPLO'), deps);
    assert.strictEqual(listadas.filter((r) => r === PAQUETE).length, 1);
  });

  test('abrirResultado: carpeta vacía, error o sin categoría dan noLocalizado', async () => {
    const vacia = dependencias({ [PAQUETE]: ['Source Library'], [CLASE]: [] });
    assert.strictEqual(await abrirResultado(resultado('CLAS/OC', 'ZCL_EJEMPLO'), vacia.deps), 'noLocalizado');
    olvidarCategorias();
    const falla = dependencias({ [PAQUETE]: new Error('boom') });
    assert.strictEqual(await abrirResultado(resultado('CLAS/OC', 'ZCL_EJEMPLO'), falla.deps), 'noLocalizado');
    olvidarCategorias();
    const sinCategoria = dependencias({ [PAQUETE]: ['Dictionary'] });
    assert.strictEqual(await abrirResultado(resultado('CLAS/OC', 'ZCL_EJEMPLO'), sinCategoria.deps), 'noLocalizado');
  });

  test('abrirResultado: si irAPaquete rechaza devuelve noLocalizado sin lanzar', async () => {
    const { deps } = dependencias({});
    const registros: string[] = [];
    const fallando: DependenciasAbrir = {
      ...deps,
      irAPaquete: async () => {
        throw new Error('detalle sensible');
      },
      registrar: (m) => registros.push(m),
    };
    assert.strictEqual(await abrirResultado(resultado('DEVC/K', 'ZPAQ1'), fallando), 'noLocalizado');
    assert.strictEqual(registros.length, 1);
    assert.ok(!registros[0].includes('detalle sensible'));
  });

  test('abrirResultado: paquete, transacción y tipo no soportado', async () => {
    const { deps, paquetes, abiertos } = dependencias({});
    assert.strictEqual(await abrirResultado(resultado('DEVC/K', 'ZPAQ1'), deps), 'paquete');
    assert.deepStrictEqual(paquetes, ['ZPAQ1']);
    assert.strictEqual(await abrirResultado(resultado('TRAN/T', 'ZTRX'), deps), 'transaccion');
    assert.strictEqual(await abrirResultado(resultado('XSLT/XS', 'ZX'), deps), 'tipoNoSoportado');
    assert.deepStrictEqual(abiertos, []);
  });

  suite('resultado sin paquete (búsqueda filtrada real)', () => {
    const LOCAL = '/repotree-v1/DEST/Local Objects ($TMP)/USUARIO';

    test('pide el paquete con una segunda búsqueda sin filtro y abre el objeto (busq-prog.xml → busq-xml.xml)', async () => {
      const peticiones: PeticionAdt[] = [];
      const conexion = conexionBusqueda('busq-prog.xml', 'busq-xml.xml', peticiones);
      const programa = FILTROS_TIPO.find((f) => f.id === 'programa');
      const filtrados = await buscar(conexion, { patron: 'Z*', filtro: programa });
      const elegido = filtrados.find((r) => r.nombre === 'Z' && r.tipo === 'PROG/P');
      assert.ok(elegido);
      assert.strictEqual(elegido.paquete, '');
      const { deps, abiertos } = dependencias({
        [LOCAL]: ['Source Code Library'],
        [`${LOCAL}/Source Code Library/Programs/Z`]: ['z.prog.abap'],
      });
      deps.paqueteDe = (nombre, tipo) => paqueteSinFiltro(conexion, nombre, tipo);
      assert.strictEqual(await abrirResultado(elegido, deps), 'abierto');
      assert.deepStrictEqual(abiertos, [`${LOCAL}/Source Code Library/Programs/Z/z.prog.abap`]);
      assert.strictEqual(peticiones.length, 2);
      assert.strictEqual(peticiones[0].parametros?.objectType, 'PROG/P');
      assert.strictEqual(peticiones[1].parametros?.objectType, undefined);
      assert.strictEqual(peticiones[1].parametros?.query, 'Z');
    });

    test('si la segunda búsqueda tampoco trae paquete no se localiza y no se lista nada (busq-clas.xml)', async () => {
      const peticiones: PeticionAdt[] = [];
      const conexion = conexionBusqueda('busq-clas.xml', 'busq-clas.xml', peticiones);
      const [clase] = await buscar(conexion, { patron: 'Z*', filtro: FILTROS_TIPO.find((f) => f.id === 'clase') });
      const { deps, listadas } = dependencias({});
      deps.paqueteDe = (nombre, tipo) => paqueteSinFiltro(conexion, nombre, tipo);
      assert.strictEqual(await abrirResultado(clase, deps), 'noLocalizado');
      assert.strictEqual(peticiones.length, 2);
      assert.deepStrictEqual(listadas, []);
    });

    test('sin forma de pedir el paquete, un paquete vacío no se localiza y no se lista nada', async () => {
      const { deps, listadas } = dependencias({});
      assert.strictEqual(await abrirResultado(resultado('CLAS/OC', 'Z_EJEMPLO_9', { paquete: '' }), deps), 'noLocalizado');
      assert.deepStrictEqual(listadas, []);
    });
  });
});
