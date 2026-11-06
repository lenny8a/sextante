import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProveedorBloques, type DependenciasBloques } from '../../src/bloques/bloque-fs';
import { ESQUEMA_BLOQUE, rutaDeBloque } from '../../src/bloques/bloque-modelo';
import { irANodo, type DependenciasIr } from '../../src/commands/objeto';
import type { NodoObjeto, Rango, SimboloDocumento } from '../../src/tree/objeto-modelo';
import { ProveedorObjeto } from '../../src/tree/objeto-proveedor';

const RUTA_ORIGEN = '/repotree-v1/DEST/System Library/ZPAQ1/Source Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap';
const CONTENIDO = [
  'CLASS zcl_ejemplo DEFINITION PUBLIC.',
  '  PUBLIC SECTION.',
  '    METHODS metodo_1.',
  '    METHODS metodo_2.',
  'ENDCLASS.',
  'CLASS zcl_ejemplo IMPLEMENTATION.',
  '  METHOD metodo_1.',
  '    WRITE 1.',
  '  ENDMETHOD.',
  '  METHOD metodo_2.',
  '    WRITE 2.',
  '    WRITE 3.',
  '  ENDMETHOD.',
  '  METHOD metodo_3.',
  '    WRITE 4.',
  '  ENDMETHOD.',
  'ENDCLASS.',
].join('\n');
const METODO_2 = 'METHOD metodo_2.\n    WRITE 2.\n    WRITE 3.\n  ENDMETHOD.';

function uriBloque(nombre: string): vscode.Uri {
  return vscode.Uri.from({ scheme: ESQUEMA_BLOQUE, path: rutaDeBloque(RUTA_ORIGEN, nombre, 'method') });
}

/** Símbolos como los daría el servidor de lenguaje, calculados sobre el texto actual del documento. */
function simbolosDeTexto(texto: string): SimboloDocumento[] {
  const clases: SimboloDocumento[] = [];
  let metodo: { nombre: string; linea: number; columna: number } | undefined;
  texto.split('\n').forEach((linea, n) => {
    const clase = /^CLASS (\w+)/.exec(linea);
    if (clase !== null) {
      clases.push({ nombre: clase[1].toUpperCase(), kind: 4, nombreKind: 'Class', rango: [n, 0, n, linea.length], hijos: [] });
    }
    const inicio = /^(\s*)METHOD (\w+)\./.exec(linea);
    if (inicio !== null) {
      metodo = { nombre: inicio[2].toUpperCase(), linea: n, columna: inicio[1].length };
    }
    if (/^\s*ENDMETHOD\./.test(linea) && metodo !== undefined) {
      const rango: Rango = [metodo.linea, metodo.columna, n, linea.length];
      clases[clases.length - 1].hijos.push({ nombre: metodo.nombre, kind: 5, nombreKind: 'Method', rango, hijos: [] });
      metodo = undefined;
    }
  });
  return clases;
}

interface Entorno {
  proveedor: ProveedorBloques;
  origen: vscode.TextDocument;
  ediciones: vscode.WorkspaceEdit[];
  guardados: vscode.TextDocument[];
  rutasAbiertas: string[];
}

interface OpcionesEntorno {
  protegido?: boolean;
  aplicarEdicion?: DependenciasBloques['aplicarEdicion'];
  guardar?: DependenciasBloques['guardar'];
  simbolosDe?: (texto: string) => SimboloDocumento[];
}

async function crearEntorno(opciones: OpcionesEntorno = {}): Promise<Entorno> {
  const origen = await vscode.workspace.openTextDocument({ content: CONTENIDO, language: 'abap' });
  const ediciones: vscode.WorkspaceEdit[] = [];
  const guardados: vscode.TextDocument[] = [];
  const rutasAbiertas: string[] = [];
  const proveedor = new ProveedorBloques({
    abrirOrigen: async (ruta) => {
      rutasAbiertas.push(ruta);
      return origen;
    },
    simbolosDe: async (uri) => {
      assert.strictEqual(uri.toString(), origen.uri.toString());
      return (opciones.simbolosDe ?? simbolosDeTexto)(origen.getText());
    },
    aplicarEdicion: async (edit) => {
      ediciones.push(edit);
      return opciones.aplicarEdicion === undefined ? vscode.workspace.applyEdit(edit) : opciones.aplicarEdicion(edit);
    },
    guardar: async (doc) => {
      guardados.push(doc);
      return opciones.guardar === undefined ? true : opciones.guardar(doc);
    },
    protegido: () => opciones.protegido ?? false,
  });
  return { proveedor, origen, ediciones, guardados, rutasAbiertas };
}

function texto(contenido: Uint8Array): string {
  return new TextDecoder().decode(contenido);
}

function bytes(cadena: string): Uint8Array {
  return new TextEncoder().encode(cadena);
}

function esErrorFs(codigo: string): (err: unknown) => boolean {
  return (err) => err instanceof vscode.FileSystemError && err.code === codigo;
}

suite('Editor de bloque: proveedor de archivos', () => {
  test('readFile devuelve exactamente el texto del método desde el archivo origen', async () => {
    const e = await crearEntorno();
    assert.strictEqual(texto(await e.proveedor.readFile(uriBloque('METODO_2'))), METODO_2);
    assert.deepStrictEqual(e.rutasAbiertas, [RUTA_ORIGEN]);
  });

  test('stat: archivo con el tamaño del bloque, mtime = versión del origen y solo lectura si está protegido', async () => {
    const e = await crearEntorno();
    const stat = await e.proveedor.stat(uriBloque('metodo_2'));
    assert.strictEqual(stat.type, vscode.FileType.File);
    assert.strictEqual(stat.size, bytes(METODO_2).byteLength);
    assert.strictEqual(stat.mtime, e.origen.version);
    assert.strictEqual(stat.permissions, undefined);
    const protegido = await crearEntorno({ protegido: true });
    assert.strictEqual((await protegido.proveedor.stat(uriBloque('METODO_2'))).permissions, vscode.FilePermission.Readonly);
  });

  test('writeFile sustituye solo el rango del método en el origen, lo guarda y avisa del cambio', async () => {
    const e = await crearEntorno();
    const uri = uriBloque('METODO_2');
    const cambios: vscode.FileChangeEvent[][] = [];
    const suscripcion = e.proveedor.onDidChangeFile((c) => cambios.push(c));
    const nuevo = 'METHOD metodo_2.\n    WRITE 42.\n  ENDMETHOD.';
    try {
      await e.proveedor.writeFile(uri, bytes(nuevo));
    } finally {
      suscripcion.dispose();
    }
    assert.strictEqual(e.ediciones.length, 1);
    const [[uriEditado, textos]] = e.ediciones[0].entries();
    assert.strictEqual(uriEditado.toString(), e.origen.uri.toString());
    assert.strictEqual(textos.length, 1);
    assert.ok(textos[0].range.isEqual(new vscode.Range(9, 2, 12, 12)));
    assert.strictEqual(textos[0].newText, nuevo);
    assert.deepStrictEqual(e.guardados, [e.origen]);
    assert.deepStrictEqual(cambios, [[{ type: vscode.FileChangeType.Changed, uri }]]);
    assert.strictEqual(e.origen.getText(), CONTENIDO.replace(METODO_2, nuevo));
    assert.strictEqual(texto(await e.proveedor.readFile(uri)), nuevo);
  });

  test('guardar dos veces con un salto final no acumula líneas en blanco tras ENDMETHOD', async () => {
    const e = await crearEntorno();
    const uri = uriBloque('METODO_2');
    const nuevo = 'METHOD metodo_2.\n    WRITE 42.\n  ENDMETHOD.';
    await e.proveedor.writeFile(uri, bytes(`${nuevo}\n`));
    await e.proveedor.writeFile(uri, bytes(`${nuevo}\n`));
    assert.strictEqual(e.origen.getText(), CONTENIDO.replace(METODO_2, nuevo));
  });

  test('símbolos con el inicio bien y el fin desfasado (corto o hasta el método siguiente) no tocan el origen', async () => {
    for (const fin of [
      [11, 12],
      [15, 12],
      [14, 12],
    ]) {
      const e = await crearEntorno({
        simbolosDe: (actual) => {
          const simbolos = simbolosDeTexto(actual);
          const metodo = simbolos[1].hijos[1];
          metodo.rango = [metodo.rango[0], metodo.rango[1], fin[0], fin[1]];
          return simbolos;
        },
      });
      await assert.rejects(
        Promise.resolve(e.proveedor.writeFile(uriBloque('METODO_2'), bytes('METHOD metodo_2.\n  ENDMETHOD.'))),
        (err: unknown) => esErrorFs('Unavailable')(err) && err instanceof Error && err.message.includes('cambió de tamaño'),
        `fin ${fin.join(',')}`,
      );
      await assert.rejects(Promise.resolve(e.proveedor.readFile(uriBloque('METODO_2'))), esErrorFs('Unavailable'));
      assert.strictEqual(e.ediciones.length, 0);
      assert.strictEqual(e.guardados.length, 0);
      assert.strictEqual(e.origen.getText(), CONTENIDO);
    }
  });

  test('writeFile en un sistema protegido rechaza con NoPermissions sin tocar el origen', async () => {
    const e = await crearEntorno({ protegido: true });
    await assert.rejects(
      Promise.resolve(e.proveedor.writeFile(uriBloque('METODO_2'), bytes('x'))),
      esErrorFs('NoPermissions'),
    );
    assert.strictEqual(e.ediciones.length, 0);
    assert.strictEqual(e.guardados.length, 0);
  });

  test('un bloque que no está en el origen da FileNotFound al leer, escribir y en stat', async () => {
    const e = await crearEntorno();
    const uri = uriBloque('NO_EXISTE');
    await assert.rejects(Promise.resolve(e.proveedor.readFile(uri)), esErrorFs('FileNotFound'));
    await assert.rejects(Promise.resolve(e.proveedor.stat(uri)), esErrorFs('FileNotFound'));
    await assert.rejects(Promise.resolve(e.proveedor.writeFile(uri, bytes('x'))), esErrorFs('FileNotFound'));
    assert.strictEqual(e.ediciones.length, 0);
    const sinBloque = vscode.Uri.from({ scheme: ESQUEMA_BLOQUE, path: RUTA_ORIGEN });
    await assert.rejects(Promise.resolve(e.proveedor.readFile(sinBloque)), esErrorFs('FileNotFound'));
  });

  test('si no se aplica el cambio o la oficial no guarda, writeFile rechaza con Unavailable', async () => {
    const sinAplicar = await crearEntorno({ aplicarEdicion: async () => false });
    await assert.rejects(
      Promise.resolve(sinAplicar.proveedor.writeFile(uriBloque('METODO_2'), bytes('x'))),
      esErrorFs('Unavailable'),
    );
    assert.strictEqual(sinAplicar.guardados.length, 0);
    const sinGuardar = await crearEntorno({ guardar: async () => false });
    await assert.rejects(
      Promise.resolve(sinGuardar.proveedor.writeFile(uriBloque('METODO_2'), bytes(METODO_2))),
      esErrorFs('Unavailable'),
    );
    assert.strictEqual(sinGuardar.guardados.length, 1);
  });

  test('símbolos que no corresponden al texto actual rechazan con Unavailable en vez de tocar otro código', async () => {
    const e = await crearEntorno({
      simbolosDe: (actual) => {
        const simbolos = simbolosDeTexto(actual);
        simbolos[1].hijos[1].rango = [7, 0, 8, 12];
        return simbolos;
      },
    });
    await assert.rejects(Promise.resolve(e.proveedor.readFile(uriBloque('METODO_2'))), esErrorFs('Unavailable'));
    await assert.rejects(
      Promise.resolve(e.proveedor.writeFile(uriBloque('METODO_2'), bytes('x'))),
      esErrorFs('Unavailable'),
    );
    assert.strictEqual(e.ediciones.length, 0);
  });

  test('directorios, borrar y renombrar no están permitidos; watch no hace nada', async () => {
    const proveedor: vscode.FileSystemProvider = (await crearEntorno()).proveedor;
    const uri = uriBloque('METODO_2');
    assert.throws(() => proveedor.readDirectory(uri), esErrorFs('NoPermissions'));
    assert.throws(() => proveedor.createDirectory(uri), esErrorFs('NoPermissions'));
    assert.throws(() => proveedor.delete(uri, { recursive: false }), esErrorFs('NoPermissions'));
    assert.throws(() => proveedor.rename(uri, uri, { overwrite: false }), esErrorFs('NoPermissions'));
    proveedor.watch(uri, { recursive: false, excludes: [] }).dispose();
  });
});

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

function crearProveedorObjeto(peticiones: vscode.Uri[]): ProveedorObjeto {
  return new ProveedorObjeto({
    simbolosDe: async (uri) => {
      peticiones.push(uri);
      return informeDe(uri).informe.simbolos;
    },
    listarCarpeta: async (uri) => informeDe(uri).informe.hermanos.entradas.map((e) => ({ nombre: e.nombre, esCarpeta: false })),
    rolDe: () => 'DEV',
    retardoGuardadoMs: 0,
  });
}

function buscarNodo(nodo: NodoObjeto, etiqueta: string): NodoObjeto | undefined {
  if (nodo.clase === 'simbolo' && nodo.etiqueta === etiqueta) {
    return nodo;
  }
  for (const hijo of nodo.hijos) {
    const encontrado = buscarNodo(hijo, etiqueta);
    if (encontrado !== undefined) {
      return encontrado;
    }
  }
  return undefined;
}

async function nodoDe(proveedor: ProveedorObjeto, etiqueta: string): Promise<NodoObjeto> {
  const [raiz] = await proveedor.getChildren();
  const nodo = buscarNodo(raiz, etiqueta);
  assert.ok(nodo, etiqueta);
  return nodo;
}

interface Apertura {
  uri: vscode.Uri;
  opciones?: vscode.TextDocumentShowOptions;
}

function depsIr(
  proveedor: ProveedorObjeto,
  modoBloque: boolean,
): { deps: DependenciasIr; abiertos: Apertura[]; lenguajes: vscode.Uri[] } {
  const abiertos: Apertura[] = [];
  const lenguajes: vscode.Uri[] = [];
  const deps: DependenciasIr = {
    proveedor,
    modoBloque: () => modoBloque,
    mostrarDocumento: async (uri, opciones) => {
      abiertos.push({ uri, opciones });
    },
    fijarLenguaje: async (uri) => {
      lenguajes.push(uri);
    },
  };
  return { deps, abiertos, lenguajes };
}

suite('Editor de bloque: vista Objeto', () => {
  let proveedor: ProveedorObjeto;
  let peticiones: vscode.Uri[];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('lenny.sextante')?.activate();
  });

  setup(() => {
    peticiones = [];
    proveedor = crearProveedorObjeto(peticiones);
  });

  teardown(() => {
    proveedor.dispose();
  });

  test('con modo bloque, ir a un método abre su bloque sin selección y le fija el lenguaje ABAP', async () => {
    await proveedor.mostrar(URI_CLASE);
    const { deps, abiertos, lenguajes } = depsIr(proveedor, true);
    assert.strictEqual(await irANodo(await nodoDe(proveedor, 'METODO_2'), deps), 'bloque');
    assert.strictEqual(abiertos.length, 1);
    assert.strictEqual(abiertos[0].uri.scheme, ESQUEMA_BLOQUE);
    assert.strictEqual(abiertos[0].uri.path, `${URI_CLASE.path}/METODO_2.method.abap`);
    assert.strictEqual(abiertos[0].opciones, undefined);
    assert.deepStrictEqual(lenguajes.map((u) => u.toString()), [abiertos[0].uri.toString()]);
  });

  test('con modo bloque, ir a un FORM abre su bloque form; un símbolo que no es bloque abre el archivo', async () => {
    await proveedor.mostrar(URI_PROGRAMA);
    const { deps, abiertos } = depsIr(proveedor, true);
    assert.strictEqual(await irANodo(await nodoDe(proveedor, 'FORM_1'), deps), 'bloque');
    assert.strictEqual(abiertos[0].uri.path, `${URI_PROGRAMA.path}/FORM_1.form.abap`);
    assert.strictEqual(await irANodo(await nodoDe(proveedor, 'VAR_1'), deps), 'abierto');
    assert.strictEqual(abiertos[1].uri.toString(), URI_PROGRAMA.toString());
    assert.ok(abiertos[1].opciones?.selection);
  });

  test('sin modo bloque, ir a un método abre la clase con la selección del método', async () => {
    await proveedor.mostrar(URI_CLASE);
    const { deps, abiertos, lenguajes } = depsIr(proveedor, false);
    assert.strictEqual(await irANodo(await nodoDe(proveedor, 'METODO_2'), deps), 'abierto');
    assert.strictEqual(abiertos[0].uri.toString(), URI_CLASE.toString());
    assert.ok(abiertos[0].opciones?.selection?.isEqual(new vscode.Range(131, 9, 131, 15)));
    assert.strictEqual(lenguajes.length, 0);
  });

  test('cambiar a un bloque del objeto mostrado no cambia el objeto ni pide símbolos', async () => {
    await proveedor.mostrar(URI_CLASE);
    const antes = peticiones.length;
    const objeto = proveedor.objeto;
    const bloque = vscode.Uri.from({ scheme: ESQUEMA_BLOQUE, path: `${URI_CLASE.path}/METODO_2.method.abap` });
    await proveedor.alCambiarEditor(bloque);
    assert.strictEqual(proveedor.objeto, objeto);
    assert.strictEqual(peticiones.length, antes);
  });

  test('cambiar a un bloque de otro objeto muestra su archivo origen', async () => {
    await proveedor.mostrar(URI_CLASE);
    const bloque = vscode.Uri.from({ scheme: ESQUEMA_BLOQUE, path: `${URI_PROGRAMA.path}/FORM_1.form.abap` });
    await proveedor.alCambiarEditor(bloque);
    assert.strictEqual(proveedor.objeto?.nombre, 'zprog_ejemplo');
    assert.strictEqual(proveedor.objeto?.uri.toString(), URI_PROGRAMA.toString());
  });

  test('guardar un bloque del objeto mostrado refresca sus símbolos', async () => {
    await proveedor.mostrar(URI_CLASE);
    const antes = peticiones.length;
    proveedor.alGuardar(vscode.Uri.from({ scheme: ESQUEMA_BLOQUE, path: `${URI_CLASE.path}/METODO_2.method.abap` }));
    const inicio = Date.now();
    while (peticiones.length === antes && Date.now() - inicio < 2_000) {
      await new Promise((resolver) => setTimeout(resolver, 10));
    }
    assert.strictEqual(peticiones.length, antes + 1);
  });

  test('los comandos de modo bloque están registrados y cambian el modo', async () => {
    const comandos = await vscode.commands.getCommands(true);
    for (const nombre of ['activar', 'desactivar']) {
      assert.ok(comandos.includes(`abapNavigator.objeto.modoBloque.${nombre}`), nombre);
    }
    assert.strictEqual(await vscode.commands.executeCommand('abapNavigator.objeto.modoBloque.desactivar'), false);
    assert.strictEqual(await vscode.commands.executeCommand('abapNavigator.objeto.modoBloque.activar'), true);
  });

  test('package.json tiene los botones de modo bloque con su when y grupo', () => {
    interface EntradaMenu {
      command: string;
      when?: string;
      group?: string;
    }
    const paquete = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
      contributes: { menus: Record<string, EntradaMenu[]> };
    };
    const titulo = paquete.contributes.menus['view/title'];
    const entrada = (comando: string): EntradaMenu | undefined => titulo.find((e) => e.command === comando);
    assert.deepStrictEqual(entrada('abapNavigator.objeto.modoBloque.activar'), {
      command: 'abapNavigator.objeto.modoBloque.activar',
      when: 'view == abapNavigator.objeto && !abapNavigator.objetoModoBloque',
      group: 'navigation@93',
    });
    assert.deepStrictEqual(entrada('abapNavigator.objeto.modoBloque.desactivar'), {
      command: 'abapNavigator.objeto.modoBloque.desactivar',
      when: 'view == abapNavigator.objeto && abapNavigator.objetoModoBloque',
      group: 'navigation@94',
    });
  });
});
