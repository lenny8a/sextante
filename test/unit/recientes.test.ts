import assert from 'node:assert/strict';
import { ResultadoBusqueda } from '../../src/adt/busqueda-modelo';
import { anotarReciente, MAX_RECIENTES, MementoMinimo, PREFIJO_RECIENTES, Recientes } from '../../src/adt/recientes';

function resultado(nombre: string, tipo = 'CLAS/OC'): ResultadoBusqueda {
  return { nombre, tipo, descripcion: 'Descripción', paquete: 'ZPAQ1', uriAdt: `/sap/bc/adt/oo/classes/${nombre.toLowerCase()}` };
}

function mementoEnMemoria(): MementoMinimo & { datos: Map<string, unknown> } {
  const datos = new Map<string, unknown>();
  return {
    datos,
    get<T>(clave: string): T | undefined {
      return datos.get(clave) as T | undefined;
    },
    async update(clave: string, valor: unknown): Promise<void> {
      if (valor === undefined) {
        datos.delete(clave);
      } else {
        datos.set(clave, valor);
      }
    },
  };
}

suite('anotarReciente', () => {
  test('pone el nuevo primero', () => {
    const lista = anotarReciente([resultado('Z_A_EJEMPLO')], resultado('Z_B_EJEMPLO'));
    assert.deepEqual(lista.map((r) => r.nombre), ['Z_B_EJEMPLO', 'Z_A_EJEMPLO']);
  });

  test('quita duplicados por tipo y nombre y sube el repetido al principio', () => {
    const base = [resultado('Z_A_EJEMPLO'), resultado('Z_B_EJEMPLO')];
    const lista = anotarReciente(base, resultado('Z_B_EJEMPLO'));
    assert.deepEqual(lista.map((r) => r.nombre), ['Z_B_EJEMPLO', 'Z_A_EJEMPLO']);
  });

  test('el mismo nombre con otro tipo no es duplicado', () => {
    const lista = anotarReciente([resultado('Z_A_EJEMPLO', 'CLAS/OC')], resultado('Z_A_EJEMPLO', 'PROG/P'));
    assert.equal(lista.length, 2);
  });

  test('corta a MAX_RECIENTES conservando los más nuevos', () => {
    let lista: ResultadoBusqueda[] = [];
    for (let i = 0; i < MAX_RECIENTES + 1; i++) {
      lista = anotarReciente(lista, resultado(`Z_${i}_EJEMPLO`));
    }
    assert.equal(lista.length, MAX_RECIENTES);
    assert.equal(lista[0].nombre, `Z_${MAX_RECIENTES}_EJEMPLO`);
    assert.equal(lista[MAX_RECIENTES - 1].nombre, 'Z_1_EJEMPLO');
  });

  test('no muta la lista de entrada', () => {
    const base = [resultado('Z_A_EJEMPLO')];
    anotarReciente(base, resultado('Z_B_EJEMPLO'));
    assert.equal(base.length, 1);
  });
});

suite('Recientes', () => {
  test('listar devuelve vacío sin datos', () => {
    assert.deepEqual(new Recientes(mementoEnMemoria()).listar('DEST'), []);
  });

  test('anotar guarda bajo la clave del destino', async () => {
    const memento = mementoEnMemoria();
    const recientes = new Recientes(memento);
    await recientes.anotar('DEST', resultado('Z_A_EJEMPLO'));
    assert.equal(recientes.listar('DEST').length, 1);
    assert.ok(memento.datos.has(`${PREFIJO_RECIENTES}DEST`));
    assert.deepEqual(recientes.listar('OTRO'), []);
  });

  test('datos basura devuelven vacío', () => {
    const memento = mementoEnMemoria();
    const recientes = new Recientes(memento);
    memento.datos.set(`${PREFIJO_RECIENTES}DEST`, 'basura');
    assert.deepEqual(recientes.listar('DEST'), []);
    memento.datos.set(`${PREFIJO_RECIENTES}DEST`, [resultado('Z_A_EJEMPLO'), { nombre: 1 }]);
    assert.deepEqual(recientes.listar('DEST'), []);
  });

  test('anotar sobre datos basura empieza de cero', async () => {
    const memento = mementoEnMemoria();
    memento.datos.set(`${PREFIJO_RECIENTES}DEST`, 42);
    const recientes = new Recientes(memento);
    await recientes.anotar('DEST', resultado('Z_A_EJEMPLO'));
    assert.equal(recientes.listar('DEST').length, 1);
  });

  test('vaciar elimina la lista del destino', async () => {
    const recientes = new Recientes(mementoEnMemoria());
    await recientes.anotar('DEST', resultado('Z_A_EJEMPLO'));
    await recientes.vaciar('DEST');
    assert.deepEqual(recientes.listar('DEST'), []);
  });
});
