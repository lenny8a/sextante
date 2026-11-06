import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ResultadoAbrir } from '../../src/adt/abrir-resultado';
import type { ResultadoBusqueda } from '../../src/adt/busqueda-modelo';
import { analizarOrdenes, type ObjetoOrden } from '../../src/adt/transportes-modelo';
import type { NodoOrdenes } from '../../src/objeto/ordenes-modelo';
import { ProveedorOrdenes, type DependenciasOrdenes } from '../../src/objeto/ordenes-proveedor';

const ordenes = analizarOrdenes(
  fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real/ordenes-lista.xml'), 'utf8'),
);

interface Registro {
  abiertos: ResultadoBusqueda[];
  busquedas: string[];
  avisos: string[];
}

function nuevoRegistro(): Registro {
  return { abiertos: [], busquedas: [], avisos: [] };
}

function dependencias(parcial: Partial<DependenciasOrdenes> = {}, registro?: Registro): DependenciasOrdenes {
  const emisor = new vscode.EventEmitter<string | undefined>();
  return {
    sistemaActivo: { id: 'DEST', onDidChange: emisor.event },
    servicio: { ordenes: async () => ordenes },
    usuarioDe: () => 'USUARIO_1',
    motivoSinRfc: () => undefined,
    credencialGuardada: async () => true,
    conectar: async () => undefined,
    abrirResultado: async (r): Promise<ResultadoAbrir> => {
      registro?.abiertos.push(r);
      return 'abierto';
    },
    buscarExacto: async (nombre) => {
      registro?.busquedas.push(nombre);
      return [];
    },
    avisar: (mensaje) => registro?.avisos.push(mensaje),
    ...parcial,
  };
}

function nodoObjeto(parcial: Partial<ObjetoOrden>): NodoOrdenes {
  return {
    clase: 'objeto',
    numero: 'DEVK900001',
    abrible: true,
    objeto: { pgmid: 'R3TR', tipo: 'CLAS', nombre: 'Z_EJEMPLO_1', ...parcial },
  };
}

suite('Vista Órdenes', () => {
  test('la vista está declarada y se puede enfocar', async () => {
    const ext = vscode.extensions.getExtension('lenny.sextante');
    assert.ok(ext, 'extensión no encontrada');
    await ext.activate();
    const paquete = ext.packageJSON as { contributes: { views: Record<string, Array<{ id: string }>> } };
    const vistas = Object.values(paquete.contributes.views).flat().map((v) => v.id);
    assert.ok(vistas.includes('abapNavigator.ordenes'), vistas.join(', '));
    await vscode.commands.executeCommand('abapNavigator.ordenes.focus');
  });

  test('sin credencial, un aviso conectar', async () => {
    const proveedor = new ProveedorOrdenes(dependencias({ credencialGuardada: async () => false }));
    await proveedor.alCambiarVisibilidad(true);
    assert.deepEqual(await proveedor.getChildren(), [{ clase: 'aviso', motivo: 'conectar', destino: 'DEST' }]);
    proveedor.dispose();
  });

  test('visible con datos: dos grupos', async () => {
    const proveedor = new ProveedorOrdenes(dependencias());
    await proveedor.alCambiarVisibilidad(true);
    const raices = await proveedor.getChildren();
    assert.deepEqual(raices.map((n) => n.clase === 'grupo' && n.grupo), ['modificables', 'liberadas']);
    assert.equal((await proveedor.getChildren(raices[0])).length, 2);
    proveedor.dispose();
  });

  test('sin vía RFC, aviso sinVia', async () => {
    const proveedor = new ProveedorOrdenes(dependencias({ motivoSinRfc: () => 'destino con SSO' }));
    await proveedor.alCambiarVisibilidad(true);
    const [aviso] = await proveedor.getChildren();
    assert.equal(aviso.clase === 'aviso' && aviso.motivo, 'sinVia');
    proveedor.dispose();
  });

  test('un fallo del servicio da un aviso de error que reintenta al abrirlo', async () => {
    let falla = true;
    const proveedor = new ProveedorOrdenes(
      dependencias({
        servicio: {
          ordenes: async () => {
            if (falla) {
              throw new Error('falló la lectura');
            }
            return ordenes;
          },
        },
      }),
    );
    await proveedor.alCambiarVisibilidad(true);
    const [aviso] = await proveedor.getChildren();
    assert.equal(aviso.clase === 'aviso' && aviso.motivo, 'error');
    falla = false;
    await proveedor.abrir(aviso);
    assert.equal((await proveedor.getChildren()).length, 2);
    proveedor.dispose();
  });

  test('abrir un objeto de clase llama a abrirResultado con su tipo', async () => {
    const registro = nuevoRegistro();
    const proveedor = new ProveedorOrdenes(dependencias({}, registro));
    await proveedor.alCambiarVisibilidad(true);
    await proveedor.abrir(nodoObjeto({ tipoWb: 'CLAS/OC' }));
    assert.equal(registro.abiertos.length, 1);
    assert.equal(registro.abiertos[0].tipo, 'CLAS/OC');
    assert.equal(registro.busquedas.length, 0);
    proveedor.dispose();
  });

  test('abrir un TABU busca por nombre y, sin resultados, avisa', async () => {
    const registro = nuevoRegistro();
    const proveedor = new ProveedorOrdenes(dependencias({}, registro));
    await proveedor.alCambiarVisibilidad(true);
    await proveedor.abrir(nodoObjeto({ tipo: 'TABU', nombre: 'MARA' }));
    assert.deepEqual(registro.busquedas, ['MARA']);
    assert.equal(registro.abiertos.length, 0);
    assert.deepEqual(registro.avisos, ['MARA (TABU) no se puede abrir desde aquí']);
    proveedor.dispose();
  });

  test('si abrirResultado no localiza, se busca por nombre y se abre el primero con carpeta', async () => {
    const registro = nuevoRegistro();
    const encontrado: ResultadoBusqueda = {
      nombre: 'MARA',
      tipo: 'TABL/DT',
      descripcion: '',
      paquete: 'ZPAQ1',
      uriAdt: '/x',
    };
    let llamadas = 0;
    const proveedor = new ProveedorOrdenes(
      dependencias(
        {
          abrirResultado: async (r) => {
            registro.abiertos.push(r);
            llamadas += 1;
            return llamadas === 1 ? 'noLocalizado' : 'abierto';
          },
          buscarExacto: async () => [encontrado],
        },
        registro,
      ),
    );
    await proveedor.alCambiarVisibilidad(true);
    await proveedor.abrir(nodoObjeto({ tipoWb: 'CLAS/OC', nombre: 'MARA' }));
    assert.deepEqual(registro.abiertos.map((r) => r.tipo), ['CLAS/OC', 'TABL/DT']);
    proveedor.dispose();
  });
});
