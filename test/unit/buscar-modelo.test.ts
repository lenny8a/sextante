import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analizarRespuestaBusqueda, FILTROS_TIPO, type FiltroTipo, type ResultadoBusqueda } from '../../src/adt/busqueda-modelo';
import {
  ControlGeneraciones,
  itemsAlCambiarTexto,
  itemsDe,
  ProgramadorConsultas,
  tituloBusqueda,
  type Programar,
} from '../../src/adt/buscar-modelo';

function resultado(parcial: Partial<ResultadoBusqueda>): ResultadoBusqueda {
  return {
    nombre: 'ZCL_EJEMPLO',
    tipo: 'CLAS/OC',
    descripcion: 'Clase de ejemplo',
    paquete: 'ZPAQ1',
    uriAdt: '/sap/bc/adt/oo/classes/zcl_ejemplo',
    ...parcial,
  };
}

suite('buscar-modelo: ControlGeneraciones', () => {
  test('la segunda generación invalida la primera', () => {
    const control = new ControlGeneraciones();
    const primera = control.siguiente();
    assert.equal(control.esActual(primera), true);
    const segunda = control.siguiente();
    assert.equal(control.esActual(primera), false);
    assert.equal(control.esActual(segunda), true);
  });
});

interface Diferida<T> {
  promesa: Promise<T>;
  resolver(valor: T): void;
  rechazar(error: unknown): void;
}

function diferida<T>(): Diferida<T> {
  let resolver: (valor: T) => void = () => undefined;
  let rechazar: (error: unknown) => void = () => undefined;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

interface Pendiente { accion: () => void; ms: number; cancelada: boolean }

function armarProgramador() {
  const pendientes: Pendiente[] = [];
  const programar: Programar = (accion, ms) => {
    const pendiente: Pendiente = { accion, ms, cancelada: false };
    pendientes.push(pendiente);
    return () => {
      pendiente.cancelada = true;
    };
  };
  const consultas: { texto: string; signal: AbortSignal; respuesta: Diferida<string[]> }[] = [];
  const pintados: string[][] = [];
  const fallos: unknown[] = [];
  const ocupado: boolean[] = [];
  const programador = new ProgramadorConsultas<string[]>({
    esperaMs: 250,
    programar,
    consultar: (texto, signal) => {
      const respuesta = diferida<string[]>();
      consultas.push({ texto, signal, respuesta });
      return respuesta.promesa;
    },
    alResolver: (resultados) => pintados.push(resultados),
    alFallar: (error) => fallos.push(error),
    alCambiarOcupado: (valor) => ocupado.push(valor),
  });
  const disparar = (): void => {
    const pendiente = pendientes[pendientes.length - 1];
    assert.ok(pendiente && !pendiente.cancelada, 'no hay espera pendiente');
    pendiente.accion();
  };
  return { programador, pendientes, consultas, pintados, fallos, ocupado, disparar };
}

const tictac = (): Promise<void> => new Promise((resolver) => setImmediate(resolver));

suite('buscar-modelo: ProgramadorConsultas', () => {
  test('una respuesta tardía de la primera consulta no pisa la de la segunda', async () => {
    const e = armarProgramador();
    e.programador.cambiarTexto('zcl');
    e.disparar();
    e.programador.cambiarTexto('zcl_ej');
    e.disparar();
    assert.deepEqual(e.consultas.map((c) => c.texto), ['zcl', 'zcl_ej']);
    assert.equal(e.consultas[0].signal.aborted, true);
    e.consultas[1].respuesta.resolver(['ZCL_EJEMPLO']);
    await tictac();
    e.consultas[0].respuesta.resolver(['ZCL_VIEJO']);
    await tictac();
    assert.deepEqual(e.pintados, [['ZCL_EJEMPLO']]);
    assert.equal(e.ocupado[e.ocupado.length - 1], false);
  });

  test('la primera consulta resuelta antes que la segunda tampoco pinta si ya se lanzó otra', async () => {
    const e = armarProgramador();
    e.programador.cambiarTexto('a');
    e.disparar();
    e.programador.cambiarTexto('ab');
    e.disparar();
    e.consultas[0].respuesta.resolver(['A']);
    await tictac();
    assert.deepEqual(e.pintados, []);
    e.consultas[1].respuesta.resolver(['AB']);
    await tictac();
    assert.deepEqual(e.pintados, [['AB']]);
  });

  test('espera tras la última tecla: dos teclas seguidas lanzan una sola consulta', () => {
    const e = armarProgramador();
    e.programador.cambiarTexto('z');
    e.programador.cambiarTexto('zc');
    assert.equal(e.pendientes.length, 2);
    assert.equal(e.pendientes[0].cancelada, true);
    assert.equal(e.pendientes[1].ms, 250);
    e.disparar();
    assert.deepEqual(e.consultas.map((c) => c.texto), ['zc']);
  });

  test('con el campo vacío no consulta y deja de estar ocupado', () => {
    const e = armarProgramador();
    e.programador.cambiarTexto('z');
    e.disparar();
    e.programador.cambiarTexto('  ');
    assert.equal(e.pendientes.length, 1);
    assert.equal(e.consultas[0].signal.aborted, true);
    assert.equal(e.ocupado[e.ocupado.length - 1], false);
  });

  test('el fallo de una consulta abortada o vieja no se notifica; el de la actual sí', async () => {
    const e = armarProgramador();
    e.programador.cambiarTexto('a');
    e.disparar();
    e.programador.cambiarTexto('ab');
    e.disparar();
    e.consultas[0].respuesta.rechazar(new Error('abortada'));
    await tictac();
    assert.deepEqual(e.fallos, []);
    const error = new Error('servidor');
    e.consultas[1].respuesta.rechazar(error);
    await tictac();
    assert.deepEqual(e.fallos, [error]);
  });

  test('detener cancela lo pendiente y ya no programa más consultas', async () => {
    const e = armarProgramador();
    e.programador.cambiarTexto('a');
    e.disparar();
    e.programador.detener();
    e.consultas[0].respuesta.resolver(['A']);
    await tictac();
    e.programador.cambiarTexto('ab');
    assert.equal(e.pendientes.length, 1);
    assert.deepEqual(e.pintados, []);
  });
});

suite('buscar-modelo: tituloBusqueda', () => {
  test('muestra el destino y, si lo hay, el filtro activo', () => {
    const programa = FILTROS_TIPO.find((f) => f.id === 'programa') as FiltroTipo;
    assert.equal(tituloBusqueda('DEV-X'), 'Buscar objeto · DEV-X');
    assert.equal(tituloBusqueda('DEV-X', programa), 'Buscar objeto · DEV-X · Programa');
  });
});

suite('buscar-modelo: itemsDe', () => {
  test('un resultado de búsqueda lleva nombre, descripción sin historial y siempre visible', () => {
    const r = resultado({});
    const [item] = itemsDe([r], false);
    assert.ok(item.label.endsWith('ZCL_EJEMPLO'));
    assert.ok(item.label.startsWith('$(symbol-class)'));
    assert.equal(item.description, 'Clase · ZPAQ1 · Clase de ejemplo');
    assert.equal(item.alwaysShow, true);
    assert.equal(item.resultado, r);
  });

  test('los recientes llevan $(history) en la descripción', () => {
    const items = itemsDe([resultado({}), resultado({ nombre: 'ZPROG_EJEMPLO', tipo: 'PROG/P' })], true);
    assert.equal(items.length, 2);
    for (const item of items) {
      assert.ok(item.description.startsWith('$(history) '), item.description);
    }
  });

  test('un módulo de función muestra su grupo', () => {
    const [item] = itemsDe(
      [
        resultado({
          nombre: 'Z_FM_EJEMPLO',
          tipo: 'FUGR/FF',
          uriAdt: '/sap/bc/adt/functions/groups/zgrupo_ejemplo/fmodules/z_fm_ejemplo',
        }),
      ],
      false,
    );
    assert.ok(item.description.includes('ZGRUPO_EJEMPLO'), item.description);
  });

  test('un resultado filtrado real sin paquete ni descripción no deja separadores vacíos (busq-clas.xml)', () => {
    const xml = fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real/busq-clas.xml'), 'utf8');
    const [r] = analizarRespuestaBusqueda(xml);
    const [item] = itemsDe([r], false);
    assert.equal(item.label, '$(symbol-class) Z_EJEMPLO_9');
    assert.equal(item.description, 'Clase');
    assert.equal(itemsDe([r], true)[0].description, '$(history) Clase');
  });

  test('un tipo desconocido usa un icono genérico', () => {
    const [item] = itemsDe([resultado({ tipo: 'XXXX/Y' })], false);
    assert.ok(item.label.startsWith('$(symbol-misc)'));
  });
});

suite('buscar-modelo: itemsAlCambiarTexto', () => {
  test('con el campo vacío muestra los recientes', () => {
    const items = itemsAlCambiarTexto('  ', [resultado({})]);
    assert.equal(items.length, 1);
    assert.ok(items[0].description.startsWith('$(history) '));
  });

  test('con texto vacía la lista hasta que llegue la respuesta: Enter no abre un resultado de otro texto', () => {
    assert.deepEqual(itemsAlCambiarTexto('zcl', [resultado({})]), []);
  });

  test('con el campo vacío y un filtro activo solo muestra los recientes de ese tipo', () => {
    const programa = FILTROS_TIPO.find((f) => f.id === 'programa') as FiltroTipo;
    const recientes = [resultado({}), resultado({ nombre: 'ZPROG_EJEMPLO', tipo: 'PROG/P' })];
    assert.deepEqual(itemsAlCambiarTexto('', recientes, programa).map((i) => i.resultado.nombre), ['ZPROG_EJEMPLO']);
    assert.deepEqual(itemsAlCambiarTexto('zprog', recientes, programa), []);
  });

  test('el include lleva un icono distinto del programa', () => {
    const [programa, include] = itemsDe([resultado({ tipo: 'PROG/P' }), resultado({ tipo: 'PROG/I' })], false);
    assert.ok(programa.label.startsWith('$(symbol-file)'));
    assert.ok(include.label.startsWith('$(file-code)'));
  });
});
