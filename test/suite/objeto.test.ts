import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { simbolosDe } from '../../src/bridge/simbolos-oficial';
import {
  ErrorRepotree,
  existe,
  listarCarpeta,
  uriDeRuta,
  type EntradaRepotree,
} from '../../src/bridge/repotree-oficial';
import { ESQUEMA_BLOQUE, rutaDeBloque } from '../../src/bloques/bloque-modelo';
import { irANodo, lanzarAccion } from '../../src/commands/objeto';
import {
  ACCIONES_OBJETO,
  MSG_BLOQUE_SIN_GUARDAR,
  MSG_PESTANA_AJENA,
  MSG_SIN_OBJETO_ABIERTO,
  type AccionObjeto,
} from '../../src/commands/objeto-acciones';
import type { RolSistema } from '../../src/config/navegador-config';
import { AVISO_SIN_SIMBOLOS, type NodoObjeto, type SimboloDocumento } from '../../src/tree/objeto-modelo';
import { ProveedorObjeto, type ObjetoAbierto } from '../../src/tree/objeto-proveedor';

suite('Puentes de la oficial', () => {
  test('simbolosDe sobre un documento untitled devuelve lista vacía', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'x' });
    assert.deepStrictEqual(await simbolosDe(doc.uri), []);
  });

  test('uriDeRuta conserva espacios y paréntesis en path y los codifica (también los paréntesis) en toString', () => {
    const uri = uriDeRuta('/repotree-v1/DEST/Local Objects ($TMP)');
    assert.strictEqual(uri.path, '/repotree-v1/DEST/Local Objects ($TMP)');
    assert.strictEqual(uri.toString(), 'abap:/repotree-v1/DEST/Local%20Objects%20%28%24TMP%29');
  });

  test('listarCarpeta reintenta mientras el proveedor devuelve vacío', async () => {
    let llamadas = 0;
    const registro = vscode.workspace.registerFileSystemProvider('abap-navigator-prueba', proveedorFsPerezoso(() => {
      llamadas++;
      return llamadas < 3 ? [] : [['ZPAQ_S4', vscode.FileType.Directory], ['zpaq_s4.devc.json', vscode.FileType.File]];
    }));
    try {
      const uri = vscode.Uri.from({ scheme: 'abap-navigator-prueba', path: '/repotree-v1/DEST-S4' });
      assert.deepStrictEqual(await listarCarpeta(uri, { esperaMs: 0 }), [
        { nombre: 'ZPAQ_S4', esCarpeta: true },
        { nombre: 'zpaq_s4.devc.json', esCarpeta: false },
      ]);
      assert.strictEqual(llamadas, 3);
      llamadas = -10;
      assert.deepStrictEqual(await listarCarpeta(uri, { reintentos: 1, esperaMs: 0 }), []);
      assert.strictEqual(llamadas, -8);
    } finally {
      registro.dispose();
    }
  });

  test('listarCarpeta sin la oficial lanza ErrorRepotree y existe devuelve false', async () => {
    await assert.rejects(
      listarCarpeta(uriDeRuta('/repotree-v1/DEST')),
      (e) => e instanceof ErrorRepotree,
    );
    assert.strictEqual(await existe(uriDeRuta('/repotree-v1/DEST')), false);
  });
});

/** Proveedor de archivos mínimo que solo sabe listar: simula la carga perezosa del repotree. */
function proveedorFsPerezoso(listar: () => [string, vscode.FileType][]): vscode.FileSystemProvider {
  const noDisponible = (): never => {
    throw vscode.FileSystemError.NoPermissions('solo listado');
  };
  return {
    onDidChangeFile: new vscode.EventEmitter<vscode.FileChangeEvent[]>().event,
    watch: () => new vscode.Disposable(() => undefined),
    stat: () => ({ type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 }),
    readDirectory: () => listar(),
    createDirectory: noDisponible,
    readFile: noDisponible,
    writeFile: noDisponible,
    delete: noDisponible,
    rename: noDisponible,
  };
}

interface InformeRepotree {
  informe: {
    simbolos: SimboloDocumento[];
    hermanos: { entradas: { nombre: string }[] };
  };
}

function leerInforme(nombre: string): InformeRepotree {
  const ruta = path.resolve(__dirname, '../../../test/fixtures/repotree', `${nombre}.json`);
  return JSON.parse(fs.readFileSync(ruta, 'utf8')) as InformeRepotree;
}

const CLASE = leerInforme('clase');
const PROGRAMA = leerInforme('programa');

const URI_CLASE = vscode.Uri.parse(
  'abap:/repotree-v1/DEST/System%20Library/ZPAQ1/Source%20Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap',
);
const URI_PROGRAMA = vscode.Uri.parse(
  'abap:/repotree-v1/DEST/System%20Library/ZPAQ2/Source%20Library/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap',
);

function informeDe(uri: vscode.Uri): InformeRepotree {
  return uri.path.includes('/Programs/') ? PROGRAMA : CLASE;
}

interface OpcionesStub {
  falla?: boolean;
  rol?: RolSistema;
  /** Si está presente, listarCarpeta espera a que se resuelva antes de responder. */
  espera?: Promise<void>;
  /** Símbolos propios de un archivo concreto (por ejemplo un include local); el resto usa el fixture del repotree. */
  simbolosDeArchivo?: Record<string, SimboloDocumento[]>;
  /** Cuenta las peticiones de símbolos para observar los refrescos. */
  peticiones?: vscode.Uri[];
  retardoGuardadoMs?: number;
}

function crearProveedor(opciones: OpcionesStub = {}): ProveedorObjeto {
  return new ProveedorObjeto({
    simbolosDe: async (uri) => {
      opciones.peticiones?.push(uri);
      if (opciones.falla) {
        throw new Error('sin símbolos');
      }
      const archivo = uri.path.split('/').pop() ?? '';
      return opciones.simbolosDeArchivo?.[archivo] ?? informeDe(uri).informe.simbolos;
    },
    listarCarpeta: async (uri): Promise<EntradaRepotree[]> => {
      await opciones.espera;
      if (opciones.falla) {
        throw new ErrorRepotree('sin carpeta');
      }
      return informeDe(uri).informe.hermanos.entradas.map((e) => ({ nombre: e.nombre, esCarpeta: false }));
    },
    rolDe: () => opciones.rol,
    retardoGuardadoMs: opciones.retardoGuardadoMs,
  });
}

function hermanoDe(uri: vscode.Uri, archivo: string): vscode.Uri {
  return uri.with({ path: uri.path.replace(/[^/]+$/, archivo) });
}

function simbolo(nombre: string, nombreKind: string, hijos: SimboloDocumento[] = []): SimboloDocumento {
  return { nombre, kind: 0, nombreKind, rango: [0, 0, 0, 0], hijos };
}

const LOCALTYPES = 'zcl_ejemplo.clas.localtypes.abap';
const SIMBOLOS_INCLUDE: Record<string, SimboloDocumento[]> = {
  [LOCALTYPES]: [
    simbolo('LCL_UNO', 'Class', [simbolo('METODO_LOCAL', 'Method')]),
    simbolo('LCL_DOS', 'Class', [simbolo('OTRO_LOCAL', 'Method')]),
    simbolo('LCL_TRES', 'Class'),
  ],
  'zcl_ejemplo.clas.json': [simbolo('header', 'Module')],
};

async function etiquetasPrimerNivel(proveedor: ProveedorObjeto): Promise<string[]> {
  const [raiz] = await proveedor.getChildren();
  return (await proveedor.getChildren(raiz)).map((n) => n.etiqueta);
}

async function esperarHasta(condicion: () => boolean, limiteMs = 2_000): Promise<void> {
  const inicio = Date.now();
  while (!condicion()) {
    if (Date.now() - inicio > limiteMs) {
      throw new Error('tiempo agotado esperando la condición');
    }
    await new Promise((resolver) => setTimeout(resolver, 10));
  }
}

suite('Vista Objeto', () => {
  let proveedor: ProveedorObjeto;

  setup(() => {
    proveedor = crearProveedor();
  });

  teardown(() => {
    proveedor.dispose();
  });

  test('mostrar construye el árbol y expone el objeto', async () => {
    await proveedor.mostrar(URI_CLASE);
    assert.strictEqual(proveedor.objeto?.nombre, 'zcl_ejemplo');
    assert.strictEqual(proveedor.objeto?.tipo, 'clase');
    const [raiz] = await proveedor.getChildren();
    assert.strictEqual(raiz.etiqueta, 'ZCL_EJEMPLO');
    assert.deepStrictEqual(
      (await proveedor.getChildren(raiz)).map((n) => n.etiqueta),
      ['Definición', 'Implementación', 'Includes locales'],
    );
  });

  test('un editor no abap conserva el objeto; uno fijado no cambia', async () => {
    await proveedor.mostrar(URI_CLASE);
    await proveedor.alCambiarEditor(vscode.Uri.parse('untitled:x'));
    assert.strictEqual(proveedor.objeto?.nombre, 'zcl_ejemplo');
    proveedor.fijar(true);
    await proveedor.alCambiarEditor(URI_PROGRAMA);
    assert.strictEqual(proveedor.objeto?.nombre, 'zcl_ejemplo');
    proveedor.fijar(false);
    await proveedor.alCambiarEditor(URI_PROGRAMA);
    assert.strictEqual(proveedor.objeto?.tipo, 'programa');
  });

  test('fallo al listar o pedir símbolos deja aviso y no lanza', async () => {
    proveedor.dispose();
    proveedor = crearProveedor({ falla: true });
    await proveedor.mostrar(URI_CLASE);
    assert.deepStrictEqual(proveedor.objeto?.archivos, []);
    const [raiz] = await proveedor.getChildren();
    const [primero] = await proveedor.getChildren(raiz);
    assert.strictEqual(primero.etiqueta, AVISO_SIN_SIMBOLOS);
    assert.strictEqual(proveedor.uriDeNodo(raiz), undefined);
  });

  test('protegido según el rol del destino', async () => {
    proveedor.dispose();
    proveedor = crearProveedor({ rol: 'QAS' });
    await proveedor.mostrar(URI_CLASE);
    assert.strictEqual(proveedor.objeto?.protegido, true);
    const [raiz] = await proveedor.getChildren();
    assert.strictEqual(proveedor.getTreeItem(raiz).tooltip, 'ZPAQ1 · Classes · DEST');
  });

  test('uriDeNodo apunta a la carpeta del objeto', async () => {
    await proveedor.mostrar(URI_CLASE);
    const [raiz] = await proveedor.getChildren();
    const includes = (await proveedor.getChildren(raiz)).find((n) => n.etiqueta === 'Includes locales');
    assert.ok(includes);
    const [archivo] = await proveedor.getChildren(includes);
    const uri = proveedor.uriDeNodo(archivo);
    assert.ok(uri?.path.endsWith('/ZCL_EJEMPLO/zcl_ejemplo.clas.localtypes.abap'), uri?.path);
    assert.strictEqual(uri?.scheme, 'abap');
    const item = proveedor.getTreeItem(archivo);
    assert.strictEqual(item.command?.command, 'abapNavigator.objeto.ir');
    assert.deepStrictEqual(item.command?.arguments, [archivo]);
    assert.strictEqual(proveedor.getParent(archivo), includes);
  });

  test('refrescar durante la carga de otro objeto termina en el último pedido', async () => {
    const opciones: OpcionesStub = {};
    proveedor.dispose();
    proveedor = crearProveedor(opciones);
    await proveedor.mostrar(URI_CLASE);
    let soltar = (): void => undefined;
    opciones.espera = new Promise<void>((resolver) => {
      soltar = resolver;
    });
    const carga = proveedor.mostrar(URI_PROGRAMA);
    const refresco = proveedor.refrescar();
    soltar();
    await Promise.all([carga, refresco]);
    assert.strictEqual(proveedor.objeto?.tipo, 'programa');
    assert.strictEqual(proveedor.objeto?.nombre, 'zprog_ejemplo');
  });

  test('cambio de archivo dentro del mismo objeto conserva la estructura de la clase', async () => {
    proveedor.dispose();
    proveedor = crearProveedor({ simbolosDeArchivo: SIMBOLOS_INCLUDE });
    const esperado = ['Definición', 'Implementación', 'Includes locales'];
    await proveedor.mostrar(URI_CLASE);
    for (const archivo of [LOCALTYPES, 'zcl_ejemplo.clas.json']) {
      await proveedor.alCambiarEditor(hermanoDe(URI_CLASE, archivo));
      assert.deepStrictEqual(await etiquetasPrimerNivel(proveedor), esperado, archivo);
      assert.strictEqual(proveedor.objeto?.uri.path, URI_CLASE.path, archivo);
    }
    await proveedor.alCambiarEditor(URI_CLASE);
    assert.deepStrictEqual(await etiquetasPrimerNivel(proveedor), esperado);
  });

  test('mostrar una clase desde un include local usa los símbolos del archivo principal', async () => {
    proveedor.dispose();
    proveedor = crearProveedor({ simbolosDeArchivo: SIMBOLOS_INCLUDE });
    await proveedor.mostrar(hermanoDe(URI_CLASE, LOCALTYPES));
    assert.deepStrictEqual(await etiquetasPrimerNivel(proveedor), ['Definición', 'Implementación', 'Includes locales']);
    assert.strictEqual(proveedor.objeto?.uri.path, URI_CLASE.path);
  });

  test('guardar un archivo del objeto actual vuelve a pedir los símbolos una sola vez', async () => {
    const peticiones: vscode.Uri[] = [];
    proveedor.dispose();
    proveedor = crearProveedor({ peticiones, retardoGuardadoMs: 20 });
    await proveedor.mostrar(URI_CLASE);
    const antes = peticiones.length;
    proveedor.alGuardar(URI_PROGRAMA);
    proveedor.alGuardar(URI_CLASE);
    proveedor.alGuardar(hermanoDe(URI_CLASE, LOCALTYPES));
    await esperarHasta(() => peticiones.length > antes);
    await new Promise((resolver) => setTimeout(resolver, 60));
    assert.strictEqual(peticiones.length, antes + 1);
    assert.strictEqual(peticiones[peticiones.length - 1].path, URI_CLASE.path);
  });

  test('guardar un archivo de otro objeto no refresca', async () => {
    const peticiones: vscode.Uri[] = [];
    proveedor.dispose();
    proveedor = crearProveedor({ peticiones, retardoGuardadoMs: 0 });
    await proveedor.mostrar(URI_CLASE);
    const antes = peticiones.length;
    proveedor.alGuardar(URI_PROGRAMA);
    proveedor.alGuardar(vscode.Uri.parse('untitled:x'));
    await new Promise((resolver) => setTimeout(resolver, 40));
    assert.strictEqual(peticiones.length, antes);
  });

  test('los comandos de objeto están registrados', async () => {
    const comandos = await vscode.commands.getCommands(true);
    for (const nombre of ['abrir', 'ir', 'refrescar', 'fijar', 'soltar', 'buscarOficial']) {
      assert.ok(comandos.includes(`abapNavigator.objeto.${nombre}`), nombre);
    }
  });

  test('abrir con un URI no válido avisa y no lanza', async () => {
    const resultado = await vscode.commands.executeCommand<string>('abapNavigator.objeto.abrir', 'file:///x.txt');
    assert.strictEqual(resultado, 'uriNoValido');
  });
});

interface InformeS4 {
  uri: string;
  informe: {
    simbolos: SimboloDocumento[];
    hermanos: { entradas: { nombre: string }[] };
    primeraPalabraPorLinea?: Record<string, string>;
  };
}

function leerS4(nombre: string): InformeS4 {
  const ruta = path.resolve(__dirname, '../../../test/fixtures/repotree-s4', `${nombre}.json`);
  return JSON.parse(fs.readFileSync(ruta, 'utf8')) as InformeS4;
}

suite('Vista Objeto en S/4', () => {
  const programa = leerS4('programa');
  const grupo = leerS4('grupo-funciones');
  const uriPrograma = vscode.Uri.parse(programa.uri);
  const uriGrupo = vscode.Uri.parse(grupo.uri);
  const SIMBOLOS_SAPL: SimboloDocumento[] = [
    { nombre: 'LZFG_EJEMPLOTOP', kind: 18, nombreKind: 'Object', rango: [0, 0, 0, 24], hijos: [] },
  ];

  interface OpcionesS4 {
    primerasPalabras?: (uri: vscode.Uri, lineas: number[]) => Promise<Map<number, string>>;
    versionDe?: (uri: vscode.Uri) => number | undefined;
    simbolosPedidos?: string[];
    simbolosPorRuta?: Record<string, SimboloDocumento[]>;
    /** Si devuelve una promesa, la petición de símbolos de esa ruta espera a que se resuelva. */
    retener?: (ruta: string) => Promise<void> | undefined;
    retardoGuardadoMs?: number;
  }

  let proveedores: ProveedorObjeto[];

  setup(() => {
    proveedores = [];
  });

  teardown(() => {
    for (const p of proveedores) {
      p.dispose();
    }
  });

  function crear(opciones: OpcionesS4 = {}): ProveedorObjeto {
    const proveedor = new ProveedorObjeto({
      simbolosDe: async (uri) => {
        const archivo = uri.path.split('/').pop() ?? '';
        opciones.simbolosPedidos?.push(archivo);
        await opciones.retener?.(uri.path);
        const propios = opciones.simbolosPorRuta?.[uri.path];
        if (propios !== undefined) {
          return propios;
        }
        if (uri.path.includes('/ZFG_EJEMPLO/')) {
          return archivo.endsWith('.reps.abap') ? SIMBOLOS_SAPL : [];
        }
        return programa.informe.simbolos;
      },
      listarCarpeta: async (uri): Promise<EntradaRepotree[]> => {
        const informe = uri.path.includes('/ZFG_EJEMPLO') ? grupo : programa;
        return informe.informe.hermanos.entradas.map((e) => ({ nombre: e.nombre, esCarpeta: false }));
      },
      rolDe: () => undefined,
      primerasPalabras: opciones.primerasPalabras,
      versionDe: opciones.versionDe,
      retardoGuardadoMs: opciones.retardoGuardadoMs,
    });
    proveedores.push(proveedor);
    return proveedor;
  }

  const palabrasPrograma = async (_uri: vscode.Uri, lineas: number[]): Promise<Map<number, string>> => {
    const palabras = new Map<number, string>();
    for (const linea of lineas) {
      const palabra = programa.informe.primeraPalabraPorLinea?.[String(linea)];
      if (palabra !== undefined) {
        palabras.set(linea, palabra);
      }
    }
    return palabras;
  };
  const todasInclude = async (_uri: vscode.Uri, lineas: number[]): Promise<Map<number, string>> =>
    new Map(lineas.map((linea) => [linea, 'INCLUDE']));

  async function seccion(proveedor: ProveedorObjeto, etiqueta: string): Promise<NodoObjeto | undefined> {
    const [raiz] = await proveedor.getChildren();
    return (await proveedor.getChildren(raiz)).find((n) => n.etiqueta === etiqueta);
  }

  test('programa: la primera palabra de la línea separa Includes de Tablas sin tocar los símbolos', async () => {
    const proveedor = crear({ primerasPalabras: palabrasPrograma });
    await proveedor.mostrar(uriPrograma);
    assert.deepStrictEqual(await etiquetasPrimerNivel(proveedor), ['Includes', 'Tablas', 'Datos', 'Eventos', 'Forms']);
    const includes = await seccion(proveedor, 'Includes');
    assert.deepStrictEqual(
      includes?.hijos.map((n) => [n.clase, n.nombreInclude]),
      [['include', 'ZPROG_EJEMPLO_S4_TOP'], ['include', 'ZPROG_EJEMPLO_S4_F01']],
    );
    const tablas = await seccion(proveedor, 'Tablas');
    assert.deepStrictEqual(tablas?.hijos.map((n) => n.etiqueta), ['TABLA_1']);
    assert.ok(programa.informe.simbolos.every((s) => s.detalle === undefined));
    const nodo = includes?.hijos[0];
    assert.ok(nodo);
    const item = proveedor.getTreeItem(nodo);
    assert.strictEqual(item.contextValue, 'include');
    assert.strictEqual(item.command?.command, 'abapNavigator.objeto.ir');
    assert.deepStrictEqual(item.command?.arguments, [nodo]);
  });

  test('la raíz abre el archivo principal y el include conserva su comando', async () => {
    const proveedor = crear({ primerasPalabras: palabrasPrograma });
    await proveedor.mostrar(uriPrograma);
    const [raiz] = await proveedor.getChildren();
    const item = proveedor.getTreeItem(raiz);
    assert.strictEqual(item.command?.command, 'abapNavigator.objeto.ir');
    assert.deepStrictEqual(item.command?.arguments, [raiz]);
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    const abiertos: string[] = [];
    const resultado = await irANodo(raiz, {
      proveedor,
      mostrarDocumento: async (uri) => {
        abiertos.push(uri.path);
      },
    });
    assert.strictEqual(resultado, 'abierto');
    assert.deepStrictEqual(abiertos, [proveedor.uriDeNodo(raiz)?.path]);
    assert.ok(abiertos[0]?.endsWith('.prog.abap'));
    const includes = await seccion(proveedor, 'Includes');
    const nodo = includes?.hijos[0];
    assert.ok(nodo);
    assert.strictEqual(proveedor.getTreeItem(nodo).command?.command, 'abapNavigator.objeto.ir');
  });

  test('programa: sin primerasPalabras o si falla, los Object no evento van a Tablas', async () => {
    const sinFuncion = crear();
    await sinFuncion.mostrar(uriPrograma);
    assert.deepStrictEqual(await etiquetasPrimerNivel(sinFuncion), ['Tablas', 'Datos', 'Eventos', 'Forms']);
    const fallando = crear({
      primerasPalabras: async () => {
        throw new Error('sin documento');
      },
    });
    await fallando.mostrar(uriPrograma);
    assert.deepStrictEqual(await etiquetasPrimerNivel(fallando), ['Tablas', 'Datos', 'Eventos', 'Forms']);
  });

  test('uriDeInclude apunta a la carpeta Includes del mismo paquete y categoría', async () => {
    const proveedor = crear({ primerasPalabras: palabrasPrograma });
    assert.strictEqual(proveedor.uriDeInclude('ZPROG_EJEMPLO_S4_TOP'), undefined);
    await proveedor.mostrar(uriPrograma);
    const uri = proveedor.uriDeInclude('ZPROG_EJEMPLO_S4_TOP');
    assert.strictEqual(
      uri?.path,
      '/repotree-v1/DEST-S4/System Library/ZPAQ_S4/Source Code Library/Includes/ZPROG_EJEMPLO_S4_TOP/zprog_ejemplo_s4_top.prog.abap',
    );
    assert.strictEqual(uri?.scheme, 'abap');
  });

  test('grupo de funciones: desde el .fugr.json usa el SAPL y sus includes abren su archivo', async () => {
    const simbolosPedidos: string[] = [];
    const proveedor = crear({ primerasPalabras: todasInclude, simbolosPedidos });
    await proveedor.mostrar(uriGrupo);
    assert.strictEqual(proveedor.objeto?.tipo, 'grupoFunciones');
    assert.strictEqual(proveedor.objeto?.nombre, 'zfg_ejemplo');
    assert.deepStrictEqual(simbolosPedidos, ['zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap']);
    assert.deepStrictEqual(await etiquetasPrimerNivel(proveedor), [
      'Módulos de función',
      'Includes',
      'Estructura de SAPLZFG_EJEMPLO',
    ]);
    const uri = proveedor.uriDeInclude('LZFG_EJEMPLOTOP');
    assert.ok(uri?.path.endsWith('/Function Groups/ZFG_EJEMPLO/zfg_ejemplo.fugr.lzfg_ejemplotop.reps.abap'), uri?.path);
    const modulos = await seccion(proveedor, 'Módulos de función');
    const [modulo] = modulos?.hijos ?? [];
    assert.ok(proveedor.uriDeNodo(modulo)?.path.endsWith('/ZFG_EJEMPLO/zfg_ejemplo.fugr.z_fm_ejemplo.func.abap'));
  });

  test('grupo de funciones: cambiar al .json conserva la estructura del archivo abierto', async () => {
    const simbolosPedidos: string[] = [];
    const proveedor = crear({ primerasPalabras: todasInclude, simbolosPedidos });
    const sapl = hermanoDe(uriGrupo, 'zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap');
    await proveedor.mostrar(sapl);
    await proveedor.alCambiarEditor(uriGrupo);
    assert.deepStrictEqual(simbolosPedidos, ['zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap']);
    assert.strictEqual(proveedor.objeto?.uri.path, sapl.path);
  });

  const NODO_INCLUDE_TOP: NodoObjeto = {
    id: 'include:x',
    clase: 'include',
    etiqueta: 'ZPROG_EJEMPLO_S4_TOP',
    icono: 'file-submodule',
    nombreInclude: 'ZPROG_EJEMPLO_S4_TOP',
    hijos: [],
  };
  const RUTA_INCLUDE_TOP =
    '/repotree-v1/DEST-S4/System Library/ZPAQ_S4/Source Code Library/Includes/ZPROG_EJEMPLO_S4_TOP/zprog_ejemplo_s4_top.prog.abap';

  test('ir sobre un nodo include sin objeto abierto resuelve sinObjeto', async () => {
    const resultado = await vscode.commands.executeCommand<string>('abapNavigator.objeto.ir', NODO_INCLUDE_TOP);
    assert.strictEqual(resultado, 'sinObjeto');
  });

  test('ir sobre un include que existe lo abre en la carpeta Includes', async () => {
    const proveedor = crear({ primerasPalabras: palabrasPrograma });
    await proveedor.mostrar(uriPrograma);
    const abiertos: string[] = [];
    const resultado = await irANodo(NODO_INCLUDE_TOP, {
      proveedor,
      mostrarDocumento: async (uri) => {
        abiertos.push(uri.path);
      },
    });
    assert.strictEqual(resultado, 'abierto');
    assert.deepStrictEqual(abiertos, [RUTA_INCLUDE_TOP]);
  });

  test('ir sobre un include que no existe lo intenta abrir sin stat previo y avisa fueraDelPaquete', async () => {
    const proveedor = crear({ primerasPalabras: palabrasPrograma });
    await proveedor.mostrar(uriPrograma);
    const intentos: string[] = [];
    const resultado = await irANodo(NODO_INCLUDE_TOP, {
      proveedor,
      mostrarDocumento: async (uri) => {
        intentos.push(uri.path);
        throw vscode.FileSystemError.FileNotFound(uri);
      },
    });
    assert.strictEqual(resultado, 'fueraDelPaquete');
    assert.deepStrictEqual(intentos, [RUTA_INCLUDE_TOP]);
  });

  test('ir sobre un include de grupo de funciones abre su propio archivo', async () => {
    const proveedor = crear({ primerasPalabras: todasInclude });
    await proveedor.mostrar(uriGrupo);
    const abiertos: string[] = [];
    const nodo: NodoObjeto = { ...NODO_INCLUDE_TOP, etiqueta: 'LZFG_EJEMPLOTOP', nombreInclude: 'LZFG_EJEMPLOTOP' };
    const resultado = await irANodo(nodo, {
      proveedor,
      mostrarDocumento: async (uri) => {
        abiertos.push(uri.path);
      },
    });
    assert.strictEqual(resultado, 'abierto');
    assert.ok(abiertos[0]?.endsWith('/Function Groups/ZFG_EJEMPLO/zfg_ejemplo.fugr.lzfg_ejemplotop.reps.abap'), abiertos[0]);
  });

  const uriIncludeTop = uriDeRuta(RUTA_INCLUDE_TOP);
  const uriOtroPrograma = uriDeRuta(
    '/repotree-v1/DEST-S4/System Library/ZPAQ_S4/Source Code Library/Programs/ZPROG_OTRO_S4/zprog_otro_s4.prog.abap',
  );
  const uriIncludeAjeno = uriDeRuta(
    '/repotree-v1/DEST-S4/System Library/ZPAQ_S4/Source Code Library/Includes/ZINC_AJENO_S4/zinc_ajeno_s4.prog.abap',
  );
  const SIMBOLOS_TOP: SimboloDocumento[] = [
    { nombre: 'GV_UNO', kind: 12, nombreKind: 'Variable', rango: [1, 0, 1, 20], rangoSeleccion: [1, 5, 1, 11], hijos: [] },
    { nombre: 'GV_DOS', kind: 12, nombreKind: 'Variable', rango: [2, 0, 2, 20], rangoSeleccion: [2, 5, 2, 11], hijos: [] },
    { nombre: 'GV_TRES', kind: 12, nombreKind: 'Variable', rango: [3, 0, 3, 20], rangoSeleccion: [3, 5, 3, 12], hijos: [] },
    { nombre: 'FORM_TOP', kind: 11, nombreKind: 'Function', rango: [5, 0, 7, 9], rangoSeleccion: [5, 5, 5, 13], hijos: [] },
  ];

  function crearConInclude(
    simbolosPedidos?: string[],
    versionDe?: (uri: vscode.Uri) => number | undefined,
  ): ProveedorObjeto {
    return crear({
      primerasPalabras: palabrasPrograma,
      versionDe,
      simbolosPedidos,
      simbolosPorRuta: { [RUTA_INCLUDE_TOP]: SIMBOLOS_TOP },
      retardoGuardadoMs: 10,
    });
  }

  async function nodoIncludeTop(proveedor: ProveedorObjeto): Promise<NodoObjeto> {
    const includes = await seccion(proveedor, 'Includes');
    const nodo = includes?.hijos.find((n) => n.nombreInclude === 'ZPROG_EJEMPLO_S4_TOP');
    assert.ok(nodo);
    return nodo;
  }

  test('programa: activar un include suyo conserva la raíz y cuelga su estructura del nodo include', async () => {
    const proveedor = crearConInclude();
    await proveedor.mostrar(uriPrograma);
    const objetoAntes = proveedor.objeto;
    await proveedor.alCambiarEditor(uriIncludeTop);
    assert.strictEqual(proveedor.objeto, objetoAntes);
    assert.strictEqual(proveedor.objeto?.tipo, 'programa');
    assert.strictEqual(proveedor.objeto?.nombre, 'zprog_ejemplo_s4');
    const [raiz] = await proveedor.getChildren();
    assert.strictEqual(raiz.etiqueta, 'ZPROG_EJEMPLO_S4');
    const top = await nodoIncludeTop(proveedor);
    const secciones = await proveedor.getChildren(top);
    assert.deepStrictEqual(secciones.map((n) => n.etiqueta), ['Datos', 'Forms']);
    const item = proveedor.getTreeItem(top);
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.strictEqual(item.command?.command, 'abapNavigator.objeto.ir');
    const includes = await seccion(proveedor, 'Includes');
    const f01 = includes?.hijos.find((n) => n.nombreInclude === 'ZPROG_EJEMPLO_S4_F01');
    assert.ok(f01);
    assert.strictEqual(proveedor.getTreeItem(f01).collapsibleState, vscode.TreeItemCollapsibleState.None);
    const simbolo = secciones[0].hijos[0];
    assert.ok(proveedor.uriDeNodo(simbolo)?.path.endsWith('/Includes/ZPROG_EJEMPLO_S4_TOP/zprog_ejemplo_s4_top.prog.abap'));
    const abiertos: [string, vscode.TextDocumentShowOptions | undefined][] = [];
    const resultado = await irANodo(simbolo, {
      proveedor,
      mostrarDocumento: async (uri, opciones) => {
        abiertos.push([uri.path, opciones]);
      },
    });
    assert.strictEqual(resultado, 'abierto');
    assert.strictEqual(abiertos[0][0], RUTA_INCLUDE_TOP);
    assert.ok(abiertos[0][1]?.selection);
  });

  test('programa: otro objeto cambia la raíz y vacía los includes abiertos', async () => {
    const proveedor = crearConInclude();
    await proveedor.mostrar(uriPrograma);
    await proveedor.alCambiarEditor(uriIncludeTop);
    await proveedor.alCambiarEditor(uriOtroPrograma);
    assert.strictEqual(proveedor.objeto?.nombre, 'zprog_otro_s4');
    await proveedor.alCambiarEditor(uriPrograma);
    assert.strictEqual(proveedor.objeto?.nombre, 'zprog_ejemplo_s4');
    assert.deepStrictEqual((await nodoIncludeTop(proveedor)).hijos, []);
  });

  test('programa: un include que no está en su sección Includes es otro objeto', async () => {
    const proveedor = crearConInclude();
    await proveedor.mostrar(uriPrograma);
    await proveedor.alCambiarEditor(uriIncludeAjeno);
    assert.strictEqual(proveedor.objeto?.tipo, 'include');
    assert.strictEqual(proveedor.objeto?.nombre, 'zinc_ajeno_s4');
  });

  test('programa fijado: activar un include suyo no cambia nada', async () => {
    const simbolosPedidos: string[] = [];
    const proveedor = crearConInclude(simbolosPedidos);
    await proveedor.mostrar(uriPrograma);
    proveedor.fijar(true);
    try {
      await proveedor.alCambiarEditor(uriIncludeTop);
    } finally {
      proveedor.fijar(false);
    }
    assert.deepStrictEqual(simbolosPedidos, ['zprog_ejemplo_s4.prog.abap']);
    assert.deepStrictEqual((await nodoIncludeTop(proveedor)).hijos, []);
  });

  test('refrescar pide el programa y sus includes abiertos; guardar el include solo pide el include', async () => {
    const simbolosPedidos: string[] = [];
    const proveedor = crearConInclude(simbolosPedidos);
    await proveedor.mostrar(uriPrograma);
    await proveedor.alCambiarEditor(uriIncludeTop);
    simbolosPedidos.length = 0;
    await proveedor.refrescar();
    assert.deepStrictEqual([...simbolosPedidos].sort(), ['zprog_ejemplo_s4.prog.abap', 'zprog_ejemplo_s4_top.prog.abap']);
    const tras = await proveedor.getChildren(await nodoIncludeTop(proveedor));
    assert.deepStrictEqual(tras.map((n) => n.etiqueta), ['Datos', 'Forms']);
    simbolosPedidos.length = 0;
    proveedor.alGuardar(uriIncludeTop);
    proveedor.alGuardar(uriIncludeTop);
    await esperarHasta(() => simbolosPedidos.length > 0);
    await new Promise((resolver) => setTimeout(resolver, 50));
    assert.deepStrictEqual(simbolosPedidos, ['zprog_ejemplo_s4_top.prog.abap']);
    assert.strictEqual(proveedor.objeto?.nombre, 'zprog_ejemplo_s4');
    assert.strictEqual((await proveedor.getChildren(await nodoIncludeTop(proveedor))).length, 2);
  });

  test('primerasPalabras se pide una vez por documento con todas las líneas de los Object', async () => {
    const llamadas: [string, number[]][] = [];
    const proveedor = crear({
      simbolosPorRuta: { [RUTA_INCLUDE_TOP]: SIMBOLOS_TOP },
      primerasPalabras: async (uri, lineas) => {
        llamadas.push([uri.path.split('/').pop() ?? '', [...lineas]]);
        return palabrasPrograma(uri, lineas);
      },
    });
    await proveedor.mostrar(uriPrograma);
    assert.deepStrictEqual(llamadas, [['zprog_ejemplo_s4.prog.abap', [7, 8, 10, 14]]]);
    assert.deepStrictEqual(await etiquetasPrimerNivel(proveedor), ['Includes', 'Tablas', 'Datos', 'Eventos', 'Forms']);
    await proveedor.alCambiarEditor(uriIncludeTop);
    assert.strictEqual(llamadas.length, 1);
  });

  test('re-activar el mismo include con la misma versión no vuelve a pedir sus símbolos', async () => {
    const simbolosPedidos: string[] = [];
    const proveedor = crearConInclude(simbolosPedidos, () => 1);
    await proveedor.mostrar(uriPrograma);
    await proveedor.alCambiarEditor(uriIncludeTop);
    let cambios = 0;
    const suscripcion = proveedor.onDidChangeTreeData(() => {
      cambios++;
    });
    try {
      await proveedor.alCambiarEditor(uriIncludeTop);
    } finally {
      suscripcion.dispose();
    }
    assert.strictEqual(cambios, 0);
    await proveedor.alCambiarEditor(uriPrograma);
    await proveedor.alCambiarEditor(uriIncludeTop);
    assert.deepStrictEqual(simbolosPedidos, ['zprog_ejemplo_s4.prog.abap', 'zprog_ejemplo_s4_top.prog.abap']);
    const top = await nodoIncludeTop(proveedor);
    assert.deepStrictEqual((await proveedor.getChildren(top)).map((n) => n.etiqueta), ['Datos', 'Forms']);
    assert.strictEqual(proveedor.getTreeItem(top).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  });

  test('guardar el include o refrescar ignoran la caché; otra versión vuelve a pedir', async () => {
    const simbolosPedidos: string[] = [];
    let version = 1;
    const proveedor = crearConInclude(simbolosPedidos, () => version);
    await proveedor.mostrar(uriPrograma);
    await proveedor.alCambiarEditor(uriIncludeTop);
    simbolosPedidos.length = 0;
    version = 2;
    proveedor.alGuardar(uriIncludeTop);
    await esperarHasta(() => simbolosPedidos.length > 0);
    await new Promise((resolver) => setTimeout(resolver, 50));
    assert.deepStrictEqual(simbolosPedidos, ['zprog_ejemplo_s4_top.prog.abap']);
    await proveedor.alCambiarEditor(uriIncludeTop);
    assert.deepStrictEqual(simbolosPedidos, ['zprog_ejemplo_s4_top.prog.abap']);
    version = 3;
    await proveedor.alCambiarEditor(uriIncludeTop);
    assert.deepStrictEqual(simbolosPedidos, ['zprog_ejemplo_s4_top.prog.abap', 'zprog_ejemplo_s4_top.prog.abap']);
    simbolosPedidos.length = 0;
    await proveedor.refrescar();
    assert.deepStrictEqual([...simbolosPedidos].sort(), ['zprog_ejemplo_s4.prog.abap', 'zprog_ejemplo_s4_top.prog.abap']);
  });

  test('una activación descartada no deja como cargado el include con símbolos de otra versión', async () => {
    let versionTop = 1;
    let soltar = (): void => undefined;
    let retenido: Promise<void> | undefined;
    const simbolosPorRuta: Record<string, SimboloDocumento[]> = { [RUTA_INCLUDE_TOP]: SIMBOLOS_TOP };
    const proveedor = crear({
      primerasPalabras: palabrasPrograma,
      simbolosPorRuta,
      versionDe: (uri) => (uri.path === RUTA_INCLUDE_TOP ? versionTop : 1),
      retener: (ruta) => (ruta === RUTA_INCLUDE_TOP ? retenido : undefined),
    });
    await proveedor.mostrar(uriPrograma);
    await proveedor.alCambiarEditor(uriIncludeTop);
    versionTop = 2;
    simbolosPorRuta[RUTA_INCLUDE_TOP] = [SIMBOLOS_TOP[0]];
    await proveedor.alCambiarEditor(uriPrograma);
    retenido = new Promise<void>((resolver) => {
      soltar = resolver;
    });
    const activacion = proveedor.alCambiarEditor(uriIncludeTop);
    await proveedor.alCambiarEditor(uriPrograma);
    retenido = undefined;
    soltar();
    await activacion;
    await proveedor.alCambiarEditor(uriIncludeTop);
    const secciones = await proveedor.getChildren(await nodoIncludeTop(proveedor));
    assert.deepStrictEqual(secciones.map((n) => n.etiqueta), ['Datos']);
    assert.deepStrictEqual(secciones[0].hijos.map((n) => n.etiqueta), ['GV_UNO']);
  });

  test('mostrar otro objeto vacía la caché de símbolos', async () => {
    const simbolosPedidos: string[] = [];
    const proveedor = crearConInclude(simbolosPedidos, () => 1);
    await proveedor.mostrar(uriPrograma);
    await proveedor.alCambiarEditor(uriPrograma);
    assert.deepStrictEqual(simbolosPedidos, ['zprog_ejemplo_s4.prog.abap']);
    await proveedor.alCambiarEditor(uriOtroPrograma);
    await proveedor.alCambiarEditor(uriPrograma);
    assert.deepStrictEqual(simbolosPedidos, [
      'zprog_ejemplo_s4.prog.abap',
      'zprog_otro_s4.prog.abap',
      'zprog_ejemplo_s4.prog.abap',
    ]);
  });

  test('ir sobre un archivo abre con su rango y sobre una sección resuelve sinArchivo', async () => {
    const proveedor = crear({ primerasPalabras: palabrasPrograma });
    await proveedor.mostrar(uriPrograma);
    const abiertos: [string, vscode.TextDocumentShowOptions | undefined][] = [];
    const deps = {
      proveedor,
      mostrarDocumento: async (uri: vscode.Uri, opciones?: vscode.TextDocumentShowOptions) => {
        abiertos.push([uri.path, opciones]);
      },
    };
    const forms = await seccion(proveedor, 'Forms');
    assert.ok(forms);
    assert.strictEqual(await irANodo(forms, deps), 'sinArchivo');
    assert.strictEqual(await irANodo(forms.hijos[0], deps), 'abierto');
    assert.ok(abiertos[0][0].endsWith('/zprog_ejemplo_s4.prog.abap'));
    assert.ok(abiertos[0][1]?.selection);
  });
});

suite('Acciones', () => {
  test('las acciones de objeto están registradas y sin objeto avisan sin lanzar', async () => {
    const comandos = await vscode.commands.getCommands(true);
    for (const a of ACCIONES_OBJETO) {
      assert.ok(comandos.includes(`abapNavigator.objeto.${a.id}`), a.id);
    }
    await vscode.commands.executeCommand('abapNavigator.objeto.verificar');
  });
});

suite('Búsqueda siempre visible', () => {
  interface EntradaMenu {
    command: string;
    when?: string;
  }

  test('buscar está en view/title de Objeto y Paquetes sin condición de objeto abierto', () => {
    const paquete = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
      contributes: { menus: Record<string, EntradaMenu[]> };
    };
    const entradas = paquete.contributes.menus['view/title'].filter((e) => e.command === 'abapNavigator.buscar');
    const condiciones = entradas.map((e) => e.when);
    assert.ok(condiciones.includes('view == abapNavigator.objeto'));
    assert.ok(condiciones.includes('view == abapNavigator.paquetes'));
  });
});

suite('Acciones sobre la pestaña del editor', () => {
  let proveedor: ProveedorObjeto;
  const URI_AJENA = vscode.Uri.parse(
    'abap:/repotree-v1/DEST/System%20Library/ZPAQ3/Source%20Library/Classes/ZCL_AJENA_EJEMPLO/zcl_ajena_ejemplo.clas.abap',
  );
  const bloqueDe = (uri: vscode.Uri): vscode.Uri =>
    vscode.Uri.from({ scheme: ESQUEMA_BLOQUE, path: rutaDeBloque(uri.path, 'METODO_UNO', 'method') });
  const accion = (id: string): AccionObjeto => {
    const encontrada = ACCIONES_OBJETO.find((a) => a.id === id);
    assert.ok(encontrada, id);
    return encontrada;
  };

  setup(() => {
    proveedor = crearProveedor();
  });

  teardown(() => {
    proveedor.dispose();
  });

  test('pertenece: sin objeto false; archivo principal y bloque del objeto true; otro objeto false', async () => {
    assert.strictEqual(proveedor.pertenece(URI_CLASE), false);
    await proveedor.mostrar(URI_CLASE);
    assert.strictEqual(proveedor.pertenece(URI_CLASE), true);
    assert.strictEqual(proveedor.pertenece(hermanoDe(URI_CLASE, LOCALTYPES)), true);
    assert.strictEqual(proveedor.pertenece(bloqueDe(URI_CLASE)), true);
    assert.strictEqual(proveedor.pertenece(URI_AJENA), false);
    assert.strictEqual(proveedor.pertenece(bloqueDe(URI_AJENA)), false);
    assert.strictEqual(proveedor.pertenece(URI_PROGRAMA), false);
  });

  test('con la Uri de otra pestaña no ejecuta y avisa', async () => {
    await proveedor.mostrar(URI_CLASE);
    const ejecutadas: string[] = [];
    const resultado = await lanzarAccion(accion('verificar'), URI_AJENA, {
      proveedor,
      ejecutar: async (a) => {
        ejecutadas.push(a.id);
      },
    });
    assert.deepStrictEqual(resultado, { ejecutar: false, motivo: MSG_PESTANA_AJENA });
    assert.deepStrictEqual(ejecutadas, []);
  });

  test('con la Uri propia o sin Uri (vista Acciones, paleta) sigue el camino normal', async () => {
    await proveedor.mostrar(URI_CLASE);
    const ejecutadas: string[] = [];
    const deps = {
      proveedor,
      ejecutar: async (a: AccionObjeto, objeto: ObjetoAbierto) => {
        ejecutadas.push(`${a.id}:${objeto.nombre}`);
      },
    };
    assert.deepStrictEqual(await lanzarAccion(accion('verificar'), URI_CLASE, deps), { ejecutar: true });
    assert.deepStrictEqual(await lanzarAccion(accion('atc'), undefined, deps), { ejecutar: true });
    assert.deepStrictEqual(ejecutadas, ['verificar:zcl_ejemplo', 'atc:zcl_ejemplo']);
  });

  test('sin objeto mostrado no ejecuta y avisa que abra un objeto', async () => {
    const ejecutadas: string[] = [];
    const resultado = await lanzarAccion(accion('ejecutar'), undefined, {
      proveedor,
      ejecutar: async (a) => {
        ejecutadas.push(a.id);
      },
    });
    assert.deepStrictEqual(resultado, { ejecutar: false, motivo: MSG_SIN_OBJETO_ABIERTO });
    assert.deepStrictEqual(ejecutadas, []);
  });

  test('un bloque con cambios se guarda antes de ejecutar; si no se guarda no ejecuta', async () => {
    await proveedor.mostrar(URI_CLASE);
    const pasos: string[] = [];
    const deps = (guarda: boolean, sucio = true) => ({
      proveedor,
      ejecutar: async (a: AccionObjeto) => {
        pasos.push(`ejecutar:${a.id}`);
      },
      documentoDe: () => ({
        isDirty: sucio,
        save: async () => {
          pasos.push('guardar');
          return guarda;
        },
      }),
    });
    assert.deepStrictEqual(await lanzarAccion(accion('verificar'), bloqueDe(URI_CLASE), deps(true)), { ejecutar: true });
    assert.deepStrictEqual(pasos, ['guardar', 'ejecutar:verificar']);

    pasos.length = 0;
    assert.deepStrictEqual(await lanzarAccion(accion('verificar'), bloqueDe(URI_CLASE), deps(false)), {
      ejecutar: false,
      motivo: MSG_BLOQUE_SIN_GUARDAR,
    });
    assert.deepStrictEqual(pasos, ['guardar']);

    pasos.length = 0;
    await lanzarAccion(accion('verificar'), bloqueDe(URI_CLASE), deps(true, false));
    await lanzarAccion(accion('verificar'), URI_CLASE, deps(true));
    assert.deepStrictEqual(pasos, ['ejecutar:verificar', 'ejecutar:verificar']);
  });

  test('el comando registrado con la Uri de una pestaña ajena no ejecuta', async () => {
    await vscode.extensions.getExtension('lenny.sextante')?.activate();
    assert.deepStrictEqual(await vscode.commands.executeCommand('abapNavigator.objeto.verificar', URI_AJENA), {
      ejecutar: false,
      motivo: MSG_PESTANA_AJENA,
    });
  });
});
