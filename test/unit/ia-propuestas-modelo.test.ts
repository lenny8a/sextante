import assert from 'node:assert/strict';
import {
  construirPropuesto,
  decisionDe,
  esMotivoTecnico,
  MAX_DECIDIDAS,
  MOTIVO_SIN_CAMBIOS,
  MSG_ARCHIVO_CAMBIO,
  MSG_SIN_APLICAR,
  MSG_SIN_DIFF,
  MSG_SIN_GUARDAR,
  MSG_YA_APLICADO,
  RegistroPropuestas,
  type DatosPropuesta,
} from '../../src/ia/propuestas-modelo';

function datos(uri = 'abap:/x'): DatosPropuesta {
  return { uri, resumen: 'r', entrada: { textoCompleto: 'b' }, textoBase: 'a', textoPropuesto: 'b' };
}

suite('IA: modelo de propuestas', () => {
  test('construirPropuesto aplica los cambios en orden y exige un único match', () => {
    const texto = 'a\nb\nc\n';
    assert.deepEqual(
      construirPropuesto(texto, { cambios: [{ buscar: 'b', reemplazar: 'B' }, { buscar: 'B\nc', reemplazar: 'x' }] }),
      { ok: true, texto: 'a\nx\n' },
    );
    const dos = construirPropuesto('a a', { cambios: [{ buscar: 'a', reemplazar: 'b' }] });
    assert.ok(!dos.ok && dos.motivo === 'el fragmento 1 a buscar aparece 2 veces en el archivo; tiene que aparecer exactamente una');
    const cero = construirPropuesto('a', { cambios: [{ buscar: 'z', reemplazar: 'b' }] });
    assert.ok(!cero.ok && cero.motivo.includes('aparece 0 veces'));
    const vacio = construirPropuesto('a', { cambios: [{ buscar: '', reemplazar: 'b' }] });
    assert.ok(!vacio.ok && vacio.motivo === 'el fragmento 1 a buscar está vacío');
    const igual = construirPropuesto('a', { cambios: [{ buscar: 'a', reemplazar: 'a' }] });
    assert.ok(!igual.ok && igual.motivo === 'la propuesta no cambia nada');
    assert.ok(!construirPropuesto('a', { textoCompleto: 'a' }).ok);
    assert.deepEqual(construirPropuesto('a', { textoCompleto: 'b' }), { ok: true, texto: 'b' });
  });

  test('construirPropuesto numera los fragmentos desde 1', () => {
    const r = construirPropuesto('a b', { cambios: [{ buscar: 'a', reemplazar: 'x' }, { buscar: 'q', reemplazar: 'y' }] });
    assert.ok(!r.ok && r.motivo.startsWith('el fragmento 2 '));
  });

  test('construirPropuesto trata `buscar` como texto literal, no como expresión regular ni patrón de reemplazo', () => {
    assert.deepEqual(
      construirPropuesto('x.*y $1', { cambios: [{ buscar: '.*', reemplazar: '$&' }] }),
      { ok: true, texto: 'x$&y $1' },
    );
  });

  test('crear → pendiente; decidir despierta a esperarDecision; decidir dos veces no vale', async () => {
    const r = new RegistroPropuestas({ generarId: () => 'id1', ahora: () => 10 });
    const p = r.crear(datos());
    assert.strictEqual(p.id, 'id1');
    assert.strictEqual(p.estado, 'pendiente');
    assert.strictEqual(r.pendientes.length, 1);
    const espera = r.esperarDecision('id1', 60_000);
    assert.ok(r.decidir('id1', 'aplicada'));
    assert.deepEqual(await espera, { id: 'id1', estado: 'aplicado' });
    assert.ok(!r.decidir('id1', 'rechazada'));
    assert.strictEqual(r.pendientes.length, 0);
    assert.strictEqual(r.decididas[0]?.id, 'id1');
  });

  test('esperarDecision vence con pendiente y no espera con un id desconocido', async () => {
    const esperas: number[] = [];
    const r = new RegistroPropuestas({ esperar: (ms) => { esperas.push(ms); return Promise.resolve(); } });
    const p = r.crear(datos());
    assert.deepEqual(await r.esperarDecision(p.id, 500), { id: p.id, estado: 'pendiente' });
    assert.deepEqual(esperas, [500]);
    const d = await r.esperarDecision('nada', 500);
    assert.strictEqual(d.estado, 'desconocida');
    assert.deepEqual(esperas, [500]);
  });

  test('esperarDecision de una propuesta ya decidida responde al instante', async () => {
    const r = new RegistroPropuestas({ generarId: () => 'a1' });
    r.crear(datos());
    r.decidir('a1', 'rechazada', 'no');
    assert.deepEqual(await r.esperarDecision('a1', 60_000), { id: 'a1', estado: 'rechazado', motivo: 'no' });
  });

  test('caducada se presenta como rechazado con motivo; decididas guarda las últimas 20; pendientesDe filtra por uri', () => {
    let n = 0;
    const r = new RegistroPropuestas({ generarId: () => `p${n++}` });
    const p = r.crear(datos());
    r.decidir(p.id, 'caducada', 'el editor cambió');
    assert.deepEqual(decisionDe(r.obtener(p.id), p.id), { id: p.id, estado: 'rechazado', motivo: 'el editor cambió' });
    assert.strictEqual(decisionDe(undefined, 'zz').estado, 'desconocida');
    assert.deepEqual(decisionDe(r.crear(datos()), 'p1'), { id: 'p1', estado: 'pendiente' });

    const r2 = new RegistroPropuestas({ generarId: () => `q${n++}` });
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) ids.push(r2.crear(datos()).id);
    for (const id of ids) r2.decidir(id, 'aplicada');
    assert.strictEqual(r2.decididas.length, MAX_DECIDIDAS);
    assert.strictEqual(r2.decididas[0]?.id, ids[21]);
    assert.strictEqual(r2.obtener(ids[0] as string), undefined);

    const r3 = new RegistroPropuestas();
    r3.crear(datos('abap:/a'));
    r3.crear(datos('abap:/b'));
    r3.crear(datos('abap:/a'));
    assert.strictEqual(r3.pendientesDe('abap:/a').length, 2);
    assert.strictEqual(r3.pendientesDe('abap:/c').length, 0);
  });

  test('onDidChange avisa al crear y al decidir, y un oyente que falla no rompe', () => {
    const r = new RegistroPropuestas({ generarId: () => 'k' });
    let avisos = 0;
    r.onDidChange(() => { throw new Error('boom'); });
    const sub = r.onDidChange(() => { avisos++; });
    r.crear(datos());
    assert.strictEqual(avisos, 1);
    assert.ok(r.decidir('k', 'aplicada'));
    assert.strictEqual(avisos, 2);
    sub.dispose();
    r.crear(datos());
    assert.strictEqual(avisos, 2);
  });

  test('recalcular cambia base y propuesto de una pendiente y avisa; decidida o desconocida no cambia', () => {
    const r = new RegistroPropuestas({ generarId: () => 'k' });
    r.crear(datos());
    let avisos = 0;
    r.onDidChange(() => { avisos++; });
    assert.ok(r.recalcular('k', 'a2', 'c'));
    assert.strictEqual(r.obtener('k')?.textoBase, 'a2');
    assert.strictEqual(r.obtener('k')?.textoPropuesto, 'c');
    assert.strictEqual(avisos, 1);
    assert.strictEqual(r.recalcular('otro', 'x', 'd'), false);
    assert.ok(r.decidir('k', 'aplicada'));
    assert.strictEqual(r.recalcular('k', 'x', 'd'), false);
    assert.strictEqual(r.obtener('k')?.textoBase, 'a2');
    assert.strictEqual(r.obtener('k')?.textoPropuesto, 'c');
    assert.strictEqual(avisos, 2);
  });

  test('contar cuenta las apariciones solapadas: "aa" en "aaa" no es único', () => {
    const r = construirPropuesto('aaa', { cambios: [{ buscar: 'aa', reemplazar: 'b' }] });
    assert.ok(!r.ok && r.motivo.includes('aparece 2 veces'), JSON.stringify(r));
  });

  test('documento CRLF: un buscar multilínea con LF encuentra el fragmento y el resultado sigue en CRLF', () => {
    const actual = 'FORM a.\r\n  x = 1.\r\nENDFORM.\r\n';
    assert.deepEqual(
      construirPropuesto(actual, { cambios: [{ buscar: 'FORM a.\n  x = 1.', reemplazar: 'FORM a.\n  x = 2.\n  y = 3.' }] }),
      { ok: true, texto: 'FORM a.\r\n  x = 2.\r\n  y = 3.\r\nENDFORM.\r\n' },
    );
    assert.deepEqual(
      construirPropuesto(actual, { cambios: [{ buscar: 'x = 1.\r\nEND', reemplazar: 'x = 2.\r\nEND' }] }),
      { ok: true, texto: 'FORM a.\r\n  x = 2.\r\nENDFORM.\r\n' },
      'un fragmento que ya viene en CRLF no se duplica',
    );
  });

  test('documento LF: los saltos se dejan tal cual', () => {
    assert.deepEqual(construirPropuesto('a\nb\n', { cambios: [{ buscar: 'a\nb', reemplazar: 'a\nc' }] }), { ok: true, texto: 'a\nc\n' });
    const crlfEnLf = construirPropuesto('a\nb\n', { cambios: [{ buscar: 'a\r\nb', reemplazar: 'x' }] });
    assert.ok(!crlfEnLf.ok && crlfEnLf.motivo.includes('aparece 0 veces'));
  });

  test('textoCompleto con LF contra un documento CRLF idéntico salvo los saltos → la propuesta no cambia nada', () => {
    const r = construirPropuesto('a\r\nb\r\n', { textoCompleto: 'a\nb\n' });
    assert.ok(!r.ok && r.motivo === MOTIVO_SIN_CAMBIOS);
    assert.deepEqual(construirPropuesto('a\r\nb\r\n', { textoCompleto: 'a\nc\n' }), { ok: true, texto: 'a\r\nc\r\n' });
  });

  test('onDidDecidir avisa con la propuesta decidida en los tres estados finales y tolera oyentes que lanzan', () => {
    const registro = new RegistroPropuestas();
    const vistas: string[] = [];
    registro.onDidDecidir(() => { throw new Error('x'); });
    registro.onDidDecidir((p) => vistas.push(`${p.id}:${p.estado}`));
    const a = registro.crear({ ...datos(), porque: 'porque sí' });
    const b = registro.crear(datos());
    const c = registro.crear(datos());
    registro.decidir(a.id, 'aplicada');
    registro.decidir(b.id, 'rechazada', 'no');
    registro.decidir(c.id, 'caducada', MSG_SIN_DIFF);
    assert.deepEqual(vistas, [`${a.id}:aplicada`, `${b.id}:rechazada`, `${c.id}:caducada`]);
    assert.strictEqual(registro.obtener(a.id)?.porque, 'porque sí');
    assert.strictEqual(registro.decidir(a.id, 'rechazada'), false, 'una segunda decisión no avisa');
    assert.strictEqual(vistas.length, 3);
  });

  test('esMotivoTecnico distingue los motivos escritos por Sextante de los del usuario', () => {
    for (const m of [MSG_ARCHIVO_CAMBIO, MSG_SIN_GUARDAR, MSG_SIN_APLICAR, MSG_YA_APLICADO, MSG_SIN_DIFF]) assert.ok(esMotivoTecnico(m));
    assert.ok(!esMotivoTecnico('prefiero otro nombre'));
    assert.ok(!esMotivoTecnico(undefined));
  });
});
