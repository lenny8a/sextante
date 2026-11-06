import * as assert from 'assert';
import type { ObjetoOrden, OrdenDeObjeto } from '../../src/adt/transportes-modelo';
import { mostrarOrdenesDelObjeto, type DependenciasOrdenObjeto } from '../../src/objeto/orden-objeto';
import { MSG_TIPO_NO_SOPORTADO, type ItemObjeto, type ItemOrden } from '../../src/objeto/orden-objeto-modelo';
import type { ResultadoOrdenesDeObjeto, Truncado } from '../../src/objeto/servicio';
import type { ObjetoAbierto } from '../../src/tree/objeto-proveedor';

function orden(numero: string, estado: OrdenDeObjeto['estado']): OrdenDeObjeto {
  return { numero, estado, estadoCrudo: 'D', propietario: 'USUARIO_1', fecha: '2026-10-01', hora: '', partes: [] };
}

const ARCHIVOS = ['z_ejemplo_1.clas.abap', 'z_ejemplo_1.clas.json'];
const OBJETO_ABIERTO = { nombre: 'Z_EJEMPLO_1', tipo: 'clase', archivos: ARCHIVOS, analisis: { destino: 'DEV-X' } } as unknown as ObjetoAbierto;
const OBJ: ObjetoOrden = { pgmid: 'R3TR', tipo: 'CLAS', nombre: 'Z_EJEMPLO_2' };

interface Registro {
  avisos: string[];
  informes: string[];
  copiados: string[];
  abiertos: ObjetoOrden[];
  consultasObjetos: string[];
  organizador: number;
  llamadas: Array<{ archivos?: readonly string[]; forzar?: boolean }>;
  sesionesPedidas: number;
  titulos: string[];
}

interface Opciones {
  objeto?: ObjetoAbierto;
  sinObjeto?: boolean;
  sesion?: boolean;
  elegirObjeto?: (items: ItemObjeto[]) => ItemObjeto | undefined;
  alcance?: ResultadoOrdenesDeObjeto['alcance'];
  truncadoOrdenes?: Truncado;
  truncadoObjetos?: Truncado;
}

function crear(ordenes: OrdenDeObjeto[] | undefined, opciones: Opciones = {}): { deps: DependenciasOrdenObjeto; r: Registro } {
  const r: Registro = {
    avisos: [], informes: [], copiados: [], abiertos: [], consultasObjetos: [], organizador: 0, llamadas: [], sesionesPedidas: 0, titulos: [],
  };
  const deps: DependenciasOrdenObjeto = {
    objeto: () => (opciones.sinObjeto ? undefined : (opciones.objeto ?? OBJETO_ABIERTO)),
    servicio: {
      ordenesDeObjeto: async (_destino, _nombre, _tipo, op = {}) => {
        r.llamadas.push(op);
        if (ordenes === undefined) {
          return undefined;
        }
        const base: ResultadoOrdenesDeObjeto = { ordenes, alcance: opciones.alcance ?? 'objeto' };
        return opciones.truncadoOrdenes === undefined ? base : { ...base, truncado: opciones.truncadoOrdenes };
      },
      objetosDeOrden: async (_destino, numero) => {
        r.consultasObjetos.push(numero);
        return opciones.truncadoObjetos === undefined ? { objetos: [OBJ] } : { objetos: [OBJ], truncado: opciones.truncadoObjetos };
      },
    },
    asegurarSesion: async () => {
      r.sesionesPedidas++;
      return opciones.sesion ?? true;
    },
    elegirOrden: async (items: ItemOrden[], titulo) => {
      r.titulos.push(titulo);
      return items[0];
    },
    elegirObjeto: async (items) => (opciones.elegirObjeto ? opciones.elegirObjeto(items) : items[0]),
    abrirObjeto: async (objeto) => {
      r.abiertos.push(objeto);
    },
    copiar: async (texto) => {
      r.copiados.push(texto);
    },
    organizadorOficial: async () => {
      r.organizador++;
    },
    avisar: (mensaje) => r.avisos.push(mensaje),
    informar: (mensaje) => r.informes.push(mensaje),
  };
  return { deps, r };
}

suite('orden-objeto (integración)', () => {
  test('sin objeto abierto', async () => {
    const { deps, r } = crear([], { sinObjeto: true });
    assert.strictEqual(await mostrarOrdenesDelObjeto(deps), 'sinObjeto');
    assert.strictEqual(r.avisos.length, 1);
  });

  test('sin sesión RFC avisa que conecte', async () => {
    const { deps, r } = crear([], { sesion: false });
    assert.strictEqual(await mostrarOrdenesDelObjeto(deps), 'sinConexion');
    assert.deepStrictEqual(r.avisos, ['Conecta primero al sistema']);
  });

  test('servicio sin conexión (undefined) también es sinConexion', async () => {
    const { deps } = crear(undefined);
    assert.strictEqual(await mostrarOrdenesDelObjeto(deps), 'sinConexion');
  });

  test('sin órdenes informa', async () => {
    const { deps, r } = crear([]);
    assert.strictEqual(await mostrarOrdenesDelObjeto(deps), 'sinOrdenes');
    assert.ok(r.informes[0]?.includes('no está en ninguna orden'));
  });

  test('elegir un objeto de la orden lo abre', async () => {
    const { deps, r } = crear([orden('DEVK900001', 'modificable'), orden('DEVK900002', 'liberada')]);
    assert.strictEqual(await mostrarOrdenesDelObjeto(deps), 'abierto');
    assert.deepStrictEqual(r.consultasObjetos, ['DEVK900001']);
    assert.deepStrictEqual(r.abiertos, [OBJ]);
    assert.deepStrictEqual(r.informes, []);
  });

  test('pide las órdenes frescas (forzar) con los archivos del objeto', async () => {
    const { deps, r } = crear([orden('DEVK900001', 'modificable')]);
    await mostrarOrdenesDelObjeto(deps);
    assert.deepStrictEqual(r.llamadas, [{ archivos: ARCHIVOS, forzar: true }]);
  });

  test('un tipo sin órdenes avisa "tipo no soportado" sin pedir sesión ni consultar', async () => {
    const desconocido = { ...OBJETO_ABIERTO, tipo: 'desconocido' } as ObjetoAbierto;
    const { deps, r } = crear([], { objeto: desconocido });
    assert.strictEqual(await mostrarOrdenesDelObjeto(deps), 'tipoNoSoportado');
    assert.deepStrictEqual(r.avisos, [MSG_TIPO_NO_SOPORTADO]);
    assert.strictEqual(r.sesionesPedidas, 0);
    assert.deepStrictEqual(r.llamadas, []);
  });

  test('una lista truncada avisa "lista incompleta (N de M)" en las órdenes y en el contenido', async () => {
    const { deps, r } = crear([orden('DEVK900001', 'modificable')], {
      truncadoOrdenes: { recibidas: 5000, total: 6100 },
      truncadoObjetos: { recibidas: 5000, total: 8000 },
    });
    assert.strictEqual(await mostrarOrdenesDelObjeto(deps), 'abierto');
    assert.deepStrictEqual(r.informes, ['Lista incompleta (5000 de 6100)', 'Lista incompleta (5000 de 8000)']);
  });

  test('el título del QuickPick dice el alcance de un grupo de funciones', async () => {
    const { deps, r } = crear([orden('DEVK900001', 'modificable')], { alcance: 'grupo' });
    await mostrarOrdenesDelObjeto(deps);
    assert.deepStrictEqual(r.titulos, ['Z_EJEMPLO_1 · órdenes (grupo y sus includes)']);
  });

  test('elegir copiar copia el número', async () => {
    const { deps, r } = crear([orden('DEVK900001', 'modificable')], {
      elegirObjeto: (items) => items.find((i) => i.clase === 'copiar'),
    });
    assert.strictEqual(await mostrarOrdenesDelObjeto(deps), 'copiado');
    assert.deepStrictEqual(r.copiados, ['DEVK900001']);
  });

  test('elegir organizador lo lanza', async () => {
    const { deps, r } = crear([orden('DEVK900001', 'modificable')], {
      elegirObjeto: (items) => items.find((i) => i.clase === 'organizador'),
    });
    assert.strictEqual(await mostrarOrdenesDelObjeto(deps), 'organizador');
    assert.strictEqual(r.organizador, 1);
  });

  test('cancelar la elección devuelve cancelado', async () => {
    const { deps } = crear([orden('DEVK900001', 'modificable')], { elegirObjeto: () => undefined });
    assert.strictEqual(await mostrarOrdenesDelObjeto(deps), 'cancelado');
  });
});
