import assert from 'node:assert/strict';
import type { RegistroLlamada } from '../../src/ia/mcp-modelo';
import {
  MAX_LLAMADAS,
  nodosDe,
  RegistroActividad,
  textoBadge,
  textoServidor,
  type NodoActividad,
} from '../../src/ia/actividad-modelo';
import type { EstadoPropuesta, Propuesta } from '../../src/ia/propuestas-modelo';

const SIN_PROPUESTAS = { pendientes: [], decididas: [] };

function propuesta(id: string, estado: EstadoPropuesta, extra: Partial<Propuesta> = {}): Propuesta {
  return {
    id,
    uri: `abap:/repotree-v1/DEST/System Library/ZPAQ1/Programas/ZPROG_EJEMPLO/${id}.abap`,
    resumen: `resumen ${id}`,
    entrada: { textoCompleto: 'x' },
    textoBase: 'a',
    textoPropuesto: 'x',
    creada: 1,
    estado,
    ...extra,
  };
}

function llamada(n: number, resultado: 'ok' | 'error' = 'ok'): RegistroLlamada {
  return {
    hora: new Date(2026, 10, 3, 9, 5, 7).getTime() + n,
    herramienta: `herramienta_${n}`,
    resumen: `resumen ${n}`,
    resultado,
    uri: `abap:/x/${n}`,
  };
}

suite('Actividad de la IA: modelo', () => {
  test('textoServidor cubre los 4 estados', () => {
    assert.equal(textoServidor({ estado: 'escuchando', puerto: 2237, sesiones: 2 }), 'Servidor en 127.0.0.1:2237 · 2 sesiones');
    assert.equal(textoServidor({ estado: 'otraVentana', puerto: 2237 }), 'Atiende otra ventana (2237)');
    assert.equal(textoServidor({ estado: 'parado' }), 'Parado');
    assert.equal(textoServidor({ estado: 'error', mensaje: 'puerto ocupado' }), 'Error: puerto ocupado');
  });

  test('anotar conserva 100 y deja la más reciente primero', () => {
    const registro = new RegistroActividad();
    for (let i = 0; i < MAX_LLAMADAS + 5; i++) registro.anotar(llamada(i));
    assert.equal(registro.llamadas.length, 100);
    assert.equal(registro.llamadas[0].herramienta, 'herramienta_104');
    assert.equal(registro.llamadas[99].herramienta, 'herramienta_5');
  });

  test('nodosDe: servidor, propuestas y llamadas', () => {
    const nodos = nodosDe({ estado: 'parado' }, [llamada(1), llamada(2, 'error')], undefined, SIN_PROPUESTAS);
    assert.equal(nodos.length, 3);
    const [servidor, propuestas, llamadas] = nodos;
    assert.equal(servidor.clase, 'servidor');
    assert.equal(servidor.etiqueta, 'Servidor');
    assert.equal(servidor.descripcion, 'Parado');
    assert.equal(servidor.hijos[0].etiqueta, 'Conectado en Claude Code: sin comprobar');
    assert.equal(nodosDe({ estado: 'parado' }, [], true, SIN_PROPUESTAS)[0].hijos[0].etiqueta, 'Conectado en Claude Code: sí');
    assert.equal(nodosDe({ estado: 'parado' }, [], false, SIN_PROPUESTAS)[0].hijos[0].etiqueta, 'Conectado en Claude Code: no');
    assert.equal(propuestas.clase, 'seccion');
    assert.equal(propuestas.etiqueta, 'Propuestas');
    assert.equal(propuestas.hijos[0].clase, 'aviso');
    assert.equal(propuestas.hijos[0].etiqueta, 'Sin propuestas');
    assert.equal(llamadas.clase, 'seccion');
    assert.equal(llamadas.etiqueta, 'Llamadas');
    assert.equal(llamadas.hijos.length, 2);
    const primera = llamadas.hijos[0];
    assert.equal(primera.clase, 'llamada');
    assert.equal(primera.etiqueta, '09:05:07 herramienta_1');
    assert.equal(primera.descripcion, 'resumen 1');
    assert.equal(primera.icono, 'check');
    assert.equal(primera.uri, 'abap:/x/1');
    assert.equal(llamadas.hijos[1].icono, 'error');
    const ids = new Set<string>();
    const recorrer = (lista: NodoActividad[]): void => {
      for (const nodo of lista) {
        ids.add(nodo.id);
        recorrer(nodo.hijos);
      }
    };
    recorrer(nodos);
    assert.equal(ids.size, 7);
  });

  test('la sección Propuestas lista pendientes primero y decididas después, con icono por estado y propuestaId', () => {
    const propuestas = {
      pendientes: [propuesta('p1', 'pendiente'), propuesta('p2', 'pendiente')],
      decididas: [
        propuesta('p3', 'aplicada'),
        propuesta('p4', 'rechazada', { motivo: 'no me gusta' }),
        propuesta('p5', 'caducada', { motivo: 'el archivo cambió' }),
      ],
    };
    const seccion = nodosDe({ estado: 'parado' }, [], undefined, propuestas)[1];
    assert.deepEqual(
      seccion.hijos.map((n) => n.id),
      ['ia/propuestas/p1', 'ia/propuestas/p2', 'ia/propuestas/p3', 'ia/propuestas/p4', 'ia/propuestas/p5'],
    );
    assert.deepEqual(
      seccion.hijos.map((n) => n.icono),
      ['git-pull-request', 'git-pull-request', 'check', 'close', 'warning'],
    );
    assert.deepEqual(
      seccion.hijos.map((n) => n.propuestaId),
      ['p1', 'p2', 'p3', 'p4', 'p5'],
    );
    assert.deepEqual(
      seccion.hijos.map((n) => n.estadoPropuesta),
      ['pendiente', 'pendiente', 'aplicada', 'rechazada', 'caducada'],
    );
    const primero = seccion.hijos[0];
    assert.equal(primero.clase, 'propuesta');
    assert.equal(primero.etiqueta, 'resumen p1');
    assert.equal(primero.descripcion, 'p1.abap');
    assert.ok(primero.tooltip?.includes('abap:/repotree-v1/DEST/System Library/ZPAQ1/Programas/ZPROG_EJEMPLO/p1.abap'));
    assert.ok(primero.tooltip?.includes('pendiente'));
    assert.ok(seccion.hijos[3].tooltip?.includes('rechazada'));
    assert.ok(seccion.hijos[3].tooltip?.includes('no me gusta'));
    assert.ok(seccion.hijos[4].tooltip?.includes('el archivo cambió'));
  });

  test('sin propuestas la sección muestra el aviso "Sin propuestas"', () => {
    const seccion = nodosDe({ estado: 'parado' }, [], undefined, SIN_PROPUESTAS)[1];
    assert.equal(seccion.hijos.length, 1);
    assert.equal(seccion.hijos[0].clase, 'aviso');
    assert.equal(seccion.hijos[0].etiqueta, 'Sin propuestas');
  });

  test('textoBadge: 0 → undefined; 1 y 2 con su texto', () => {
    assert.equal(textoBadge(0), undefined);
    assert.deepEqual(textoBadge(1), { value: 1, tooltip: '1 propuesta pendiente' });
    assert.deepEqual(textoBadge(2), { value: 2, tooltip: '2 propuestas pendientes' });
  });

  test('onDidChange se dispara en anotar y fijarServidor', () => {
    const registro = new RegistroActividad();
    let cuenta = 0;
    const sub = registro.onDidChange(() => cuenta++);
    registro.anotar(llamada(1));
    registro.fijarServidor({ estado: 'parado' });
    assert.equal(cuenta, 2);
    sub.dispose();
    registro.anotar(llamada(2));
    assert.equal(cuenta, 2);
  });

  test('un oyente que lanza no impide avisar al resto ni sale de anotar o fijarServidor', () => {
    const registro = new RegistroActividad();
    let cuenta = 0;
    registro.onDidChange(() => {
      throw new Error('vista rota');
    });
    registro.onDidChange(() => cuenta++);
    assert.doesNotThrow(() => registro.anotar(llamada(1)));
    assert.doesNotThrow(() => registro.fijarServidor({ estado: 'parado' }));
    assert.equal(cuenta, 2);
    assert.equal(registro.llamadas.length, 1);
  });
});
