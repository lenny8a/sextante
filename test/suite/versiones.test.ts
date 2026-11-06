import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConexionAdt } from '../../src/adt/conexion-adt';
import type { PeticionAdt, TransporteAdt } from '../../src/adt/transporte';
import { analizarVersiones } from '../../src/adt/versiones-modelo';
import { ProveedorFuente, uriFuente } from '../../src/objeto/documento-fuente';
import { ESQUEMA_FUENTE, analizarUriFuente } from '../../src/objeto/documento-fuente-modelo';
import { MSG_SELECCIONA_DOS, type NodoVersiones } from '../../src/objeto/versiones-modelo';
import { ProveedorVersiones, type DependenciasVersiones } from '../../src/objeto/versiones-proveedor';
import { ServicioObjeto, type ResultadoVersiones } from '../../src/objeto/servicio';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

const versionesProg = analizarVersiones(fixture('versiones-prog.xml'));
const versionesClase = analizarVersiones(fixture('versiones-clas-main.xml'));

const uriClase = vscode.Uri.parse(
  'abap:/repotree-v1/DEST/System%20Library/ZPAQ1/Source%20Code%20Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap',
);
const uriPrograma = vscode.Uri.parse(
  'abap:/repotree-v1/DEST/System%20Library/ZPAQ1/Source%20Code%20Library/Programs/ZPRG_EJEMPLO/zprg_ejemplo.prog.abap',
);

interface Registro {
  diffs: Array<{ izquierda: vscode.Uri; derecha: vscode.Uri; titulo: string }>;
  avisos: string[];
  pedidas: string[];
  invalidadas: string[];
}

function nuevoRegistro(): Registro {
  return { diffs: [], avisos: [], pedidas: [], invalidadas: [] };
}

function dependencias(parcial: Partial<DependenciasVersiones> = {}, registro: Registro = nuevoRegistro()): DependenciasVersiones {
  const emisor = new vscode.EventEmitter<vscode.Uri | undefined>();
  return {
    editorActivo: () => undefined,
    onCambioEditor: emisor.event,
    servicio: {
      versiones: async (_destino, ruta): Promise<ResultadoVersiones> => {
        registro.pedidas.push(ruta);
        return { estado: 'ok', versiones: ruta.includes('/programs/') ? versionesProg : versionesClase };
      },
      fuente: async () => ({ estado: 'ok', texto: '' }),
    },
    proveedorFuente: { invalidar: (destino) => void registro.invalidadas.push(destino) },
    credencialGuardada: async () => true,
    motivoSinRfc: () => undefined,
    conectar: async () => undefined,
    abrirDiff: async (izquierda, derecha, titulo) => void registro.diffs.push({ izquierda, derecha, titulo }),
    mostrar: async () => undefined,
    seleccion: () => [],
    copiar: async () => undefined,
    avisar: (m) => void registro.avisos.push(m),
    ...parcial,
  };
}

async function esperar(condicion: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condicion(); i++) {
    await new Promise((resolver) => setTimeout(resolver, 5));
  }
  assert.ok(condicion(), 'la condición no se cumplió a tiempo');
}

async function versionNodo(proveedor: ProveedorVersiones, indice: number): Promise<NodoVersiones> {
  const raices = await proveedor.getChildren();
  const nodo = raices[0].clase === 'pieza' ? (await proveedor.getChildren(raices[0]))[indice] : raices[indice];
  return nodo;
}

suite('Vista Versiones', () => {
  test('la vista está declarada y se puede enfocar', async () => {
    const ext = vscode.extensions.getExtension('lenny.sextante');
    assert.ok(ext, 'extensión no encontrada');
    await ext.activate();
    const paquete = ext.packageJSON as { contributes: { views: Record<string, Array<{ id: string }>> } };
    const vistas = Object.values(paquete.contributes.views).flat().map((v) => v.id);
    assert.ok(vistas.includes('abapNavigator.versiones'), vistas.join(', '));
    assert.ok(vistas.indexOf('abapNavigator.versiones') < vistas.indexOf('abapNavigator.ordenes'));
    await vscode.commands.executeCommand('abapNavigator.versiones.focus');
  });

  test('una clase deja main en ok y el resto pendiente', async () => {
    const registro = nuevoRegistro();
    const proveedor = new ProveedorVersiones(dependencias({}, registro));
    await proveedor.alCambiarVisibilidad(true);
    await proveedor.alCambiarEditor(uriClase);
    const estados = proveedor.estado.piezas.map((p) => p.estado);
    assert.equal(estados.length, 5);
    assert.equal(estados[0], 'ok');
    assert.ok(estados.slice(1).every((e) => e === 'pendiente'), estados.join(','));
    assert.equal(registro.pedidas.length, 1);
    proveedor.dispose();
  });

  test('abrirDiff de una versión antigua contra el editor', async () => {
    const registro = nuevoRegistro();
    const proveedor = new ProveedorVersiones(dependencias({}, registro));
    await proveedor.alCambiarVisibilidad(true);
    await proveedor.alCambiarEditor(uriPrograma);
    const antigua = versionesProg.findIndex((v) => !v.activa);
    await proveedor.abrirDiff(await versionNodo(proveedor, antigua));
    assert.equal(registro.diffs.length, 1);
    const { izquierda, derecha } = registro.diffs[0];
    assert.equal(izquierda.scheme, ESQUEMA_FUENTE);
    assert.ok(izquierda.query.includes(`r=${encodeURIComponent(versionesProg[antigua].src)}`), izquierda.query);
    assert.ok(!izquierda.query.includes('v=active'));
    assert.equal(derecha.toString(), uriPrograma.toString());
    proveedor.dispose();
  });

  test('abrirDiff de la versión activa usa la fuente activa', async () => {
    const registro = nuevoRegistro();
    const proveedor = new ProveedorVersiones(dependencias({}, registro));
    await proveedor.alCambiarVisibilidad(true);
    await proveedor.alCambiarEditor(uriPrograma);
    const activa = versionesProg.findIndex((v) => v.activa);
    await proveedor.abrirDiff(await versionNodo(proveedor, activa));
    const clave = analizarUriFuente(registro.diffs[0].izquierda);
    assert.ok(registro.diffs[0].izquierda.query.includes('v=active'));
    assert.equal(clave?.ruta, proveedor.estado.piezas[0].pieza.rutaFuente);
    proveedor.dispose();
  });

  test('compararSeleccion con una sola versión avisa', async () => {
    const registro = nuevoRegistro();
    let seleccion: NodoVersiones[] = [];
    const proveedor = new ProveedorVersiones(dependencias({ seleccion: () => seleccion }, registro));
    await proveedor.alCambiarVisibilidad(true);
    await proveedor.alCambiarEditor(uriPrograma);
    seleccion = [await versionNodo(proveedor, 0)];
    await proveedor.compararSeleccion();
    assert.deepEqual(registro.avisos, [MSG_SELECCIONA_DOS]);
    assert.equal(registro.diffs.length, 0);
    proveedor.dispose();
  });

  test('compararSeleccion con dos versiones pone la antigua a la izquierda', async () => {
    const registro = nuevoRegistro();
    let seleccion: NodoVersiones[] = [];
    const proveedor = new ProveedorVersiones(dependencias({ seleccion: () => seleccion }, registro));
    await proveedor.alCambiarVisibilidad(true);
    await proveedor.alCambiarEditor(uriPrograma);
    assert.ok(versionesProg.length >= 2);
    seleccion = [await versionNodo(proveedor, 1), await versionNodo(proveedor, 0)];
    await proveedor.compararSeleccion();
    assert.equal(registro.diffs.length, 1);
    const ordenadas = [...versionesProg].sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha));
    const izquierda = analizarUriFuente(registro.diffs[0].izquierda);
    const derecha = analizarUriFuente(registro.diffs[0].derecha);
    const rutaDe = (v: (typeof ordenadas)[number]): string => (v.activa ? proveedor.estado.piezas[0].pieza.rutaFuente : v.src);
    assert.equal(izquierda?.ruta, rutaDe(ordenadas[0]));
    assert.equal(derecha?.ruta, rutaDe(ordenadas[1]));
    proveedor.dispose();
  });

  test('refrescar invalida las fuentes y fuerza las versiones', async () => {
    const registro = nuevoRegistro();
    const cache = new Map<string, ResultadoVersiones>();
    let actuales = versionesProg.slice(0, 1);
    const servicio: DependenciasVersiones['servicio'] = {
      versiones: async (_destino, ruta, _etiqueta, forzar) => {
        registro.pedidas.push(ruta);
        const guardado = forzar === true ? undefined : cache.get(ruta);
        if (guardado !== undefined) {
          return guardado;
        }
        const fresco: ResultadoVersiones = { estado: 'ok', versiones: actuales };
        cache.set(ruta, fresco);
        return fresco;
      },
      fuente: async () => ({ estado: 'ok', texto: '' }),
    };
    const proveedor = new ProveedorVersiones(dependencias({ servicio }, registro));
    await proveedor.alCambiarVisibilidad(true);
    await proveedor.alCambiarEditor(uriPrograma);
    assert.equal(proveedor.estado.piezas[0].versiones.length, 1);
    actuales = versionesProg;
    await proveedor.refrescar();
    assert.deepEqual(registro.invalidadas, ['DEST']);
    assert.equal(registro.pedidas.length, 2);
    assert.equal(proveedor.estado.piezas[0].versiones.length, versionesProg.length);
    proveedor.dispose();
  });

  test('refrescar con el servicio y el proveedor de fuentes reales: fuentes y versiones de todas las piezas cargadas, frescas', async () => {
    const peticiones: PeticionAdt[] = [];
    let feed = '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"/>';
    let activa = 'CLASS zcl_ejemplo v1.';
    const transporte: TransporteAdt = {
      peticion: async (p) => {
        peticiones.push(p);
        if (p.ruta.endsWith('/versions')) {
          return { estado: 200, cuerpo: feed };
        }
        if (p.ruta.endsWith('/source/main')) {
          return { estado: 200, cuerpo: activa };
        }
        return { estado: 404, cuerpo: '' };
      },
    };
    const conexion = new ConexionAdt(transporte);
    const servicio = new ServicioObjeto({ conexion: async () => conexion, idiomaDe: () => 'E' });
    const proveedorFuente = new ProveedorFuente({
      fuente: (destino, ruta, version) => servicio.fuente(destino, ruta, version),
      vaciarFuentes: (destino) => servicio.vaciarFuentes(destino),
    });
    const cambiadas: string[] = [];
    const suscripcion = proveedorFuente.onDidChange((uri) => cambiadas.push(uri.toString()));
    const proveedor = new ProveedorVersiones(dependencias({ servicio, proveedorFuente }));
    try {
      await proveedor.alCambiarVisibilidad(true);
      await proveedor.alCambiarEditor(uriClase);
      const [main, definiciones, otra] = proveedor.estado.piezas;
      assert.equal(main.estado, 'ok');
      assert.equal(main.versiones.length, 0);
      // El usuario despliega la segunda pieza: se carga perezosamente.
      const raices = await proveedor.getChildren();
      const nodoDefiniciones = raices.find((n) => n.clase === 'pieza' && n.pieza === definiciones);
      assert.ok(nodoDefiniciones);
      await proveedor.getChildren(nodoDefiniciones);
      await esperar(() => definiciones.estado === 'ok');
      assert.equal(otra.estado, 'pendiente');

      const uriActiva = uriFuente({ destino: 'DEST', ruta: main.pieza.rutaFuente, nombre: 'zcl_ejemplo', extension: 'abap', etiqueta: 'v00000', version: 'active' });
      assert.equal(await proveedorFuente.provideTextDocumentContent(uriActiva), 'CLASS zcl_ejemplo v1.');

      feed = fixture('versiones-prog.xml');
      activa = 'CLASS zcl_ejemplo v2.';
      await proveedor.refrescar();

      assert.ok(cambiadas.includes(uriActiva.toString()), 'el documento de la fuente activa no se invalidó');
      const [mainNueva, definicionesNueva, otraNueva] = proveedor.estado.piezas;
      assert.equal(mainNueva.versiones.length, versionesProg.length);
      assert.equal(definicionesNueva.estado, 'ok');
      assert.equal(definicionesNueva.versiones.length, versionesProg.length, 'la pieza ya cargada no se forzó');
      assert.equal(otraNueva.estado, 'pendiente');
      assert.equal(await proveedorFuente.provideTextDocumentContent(uriActiva), 'CLASS zcl_ejemplo v2.');
      const feeds = peticiones.filter((p) => p.ruta.endsWith('/versions')).map((p) => p.ruta);
      assert.equal(feeds.length, 4, feeds.join(', '));
    } finally {
      suscripcion.dispose();
      proveedor.dispose();
      proveedorFuente.dispose();
    }
  });

  test('el aviso "conectar" lleva al comando refrescar (que conecta)', async () => {
    let conectados = 0;
    const proveedor = new ProveedorVersiones(
      dependencias({
        credencialGuardada: async () => false,
        conectar: async () => {
          conectados++;
        },
      }),
    );
    await proveedor.alCambiarVisibilidad(true);
    await proveedor.alCambiarEditor(uriPrograma);
    const [aviso] = await proveedor.getChildren();
    assert.equal(aviso.clase === 'aviso' ? aviso.motivo : undefined, 'conectar');
    const item = proveedor.getTreeItem(aviso);
    assert.equal(item.command?.command, 'abapNavigator.versiones.refrescar');
    await proveedor.refrescar();
    assert.equal(conectados, 1);
    proveedor.dispose();
  });

  test('abrirDiff de otra pieza de la clase compara con su fuente activa', async () => {
    const registro = nuevoRegistro();
    const proveedor = new ProveedorVersiones(dependencias({}, registro));
    await proveedor.alCambiarVisibilidad(true);
    await proveedor.alCambiarEditor(uriClase);
    const otra = proveedor.estado.piezas[1];
    otra.estado = 'ok';
    otra.versiones = versionesClase;
    await proveedor.abrirDiff({ clase: 'version', pieza: otra, version: versionesClase[0] });
    assert.equal(registro.diffs.length, 1);
    const { derecha, titulo } = registro.diffs[0];
    assert.equal(derecha.scheme, ESQUEMA_FUENTE);
    assert.ok(derecha.query.includes('v=active'), derecha.query);
    assert.ok(derecha.query.includes(`r=${encodeURIComponent(otra.pieza.rutaFuente)}`), derecha.query);
    assert.ok(titulo.endsWith('Activa'), titulo);
    proveedor.dispose();
  });
});
