import assert from 'node:assert/strict';
import type { RolSistema } from '../../src/config/navegador-config';
import { ESQUEMAS } from '../../src/ia/esquemas';
import {
  ORDEN_ESCRITURA,
  crearCatalogoEscritura,
  type DependenciasEscritura,
  type ResultadoVerificacion,
} from '../../src/ia/herramientas-escritura';
import { MSG_SEGMENTOS_RELATIVOS, tieneSegmentosRelativos } from '../../src/ia/herramientas';
import { ESPERA_ATC_MS, INDICACION_EN_CURSO, VIGENCIA_RESULTADO_ATC_MS, type HallazgoAtc, type ResultadoAtc } from '../../src/ia/atc-modelo';
import { INSTRUCCIONES_AGENTE, type HerramientaMcp } from '../../src/ia/mcp-modelo';
import { ESPERA_DECISION_MS, RegistroPropuestas, type DatosPropuesta, type Decision } from '../../src/ia/propuestas-modelo';

const RUTA = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap';
const URI = `abap:${RUTA}`;
const TEXTO = 'REPORT zprog_ejemplo.\nDATA gv_x TYPE i.\nDATA gv_y TYPE i.\n';

interface Montaje {
  catalogo: HerramientaMcp[];
  textos: Map<string, string>;
  registro: RegistroPropuestas;
  propuestos: DatosPropuesta[];
  esperas: { id: string; limiteMs: number }[];
  llamadas: { verificar: string[]; unit: string[]; activar: string[]; confirmar: string[]; activarTodo: string[]; atc: string[] };
  config: { decision?: Decision; confirma: boolean; verificacion: ResultadoVerificacion };
  atc: ControlAtc;
}

/** Cada llamada a `ejecutarAtc` queda pendiente hasta que el test la resuelve o la rechaza; el reloj y la espera son del test. */
interface ControlAtc {
  pendientes: { resolver(r: ResultadoAtc): void; rechazar(e: Error): void }[];
  reloj: number;
  expirarEspera(): void;
}

function montar(...rol: [] | [RolSistema | undefined]): Montaje {
  const registro = new RegistroPropuestas();
  const roles = new Map<string, RolSistema | undefined>([['DEST', rol.length === 0 ? 'DEV' : rol[0]]]);
  const textos = new Map<string, string>([[RUTA, TEXTO]]);
  const propuestos: DatosPropuesta[] = [];
  const esperas: { id: string; limiteMs: number }[] = [];
  const llamadas = {
    verificar: [] as string[],
    unit: [] as string[],
    activar: [] as string[],
    confirmar: [] as string[],
    activarTodo: [] as string[],
    atc: [] as string[],
  };
  const esperasAtc: (() => void)[] = [];
  const atc: ControlAtc = {
    pendientes: [],
    reloj: 0,
    expirarEspera: () => {
      for (const e of esperasAtc.splice(0)) e();
    },
  };
  const config: Montaje['config'] = { confirma: true, verificacion: { diagnosticos: [], publicados: true } };
  const deps: DependenciasEscritura = {
    rolDe: (destino) => roles.get(destino),
    leerTexto: async (ruta) => textos.get(ruta),
    proponer: async (datos) => {
      propuestos.push(datos);
      return registro.crear(datos);
    },
    esperarDecision: async (id, limiteMs) => {
      esperas.push({ id, limiteMs });
      return config.decision ?? { id, estado: 'pendiente' };
    },
    verificar: async (uri) => {
      llamadas.verificar.push(uri);
      return config.verificacion;
    },
    ejecutarAtc: (uri) => {
      llamadas.atc.push(uri);
      return new Promise<ResultadoAtc>((resolver, rechazar) => {
        atc.pendientes.push({ resolver, rechazar });
      });
    },
    ahora: () => atc.reloj,
    esperar: () =>
      new Promise<void>((resolver) => {
        esperasAtc.push(resolver);
      }),
    ejecutarUnitTests: async (uri) => {
      llamadas.unit.push(uri);
    },
    confirmarActivacion: async (objeto) => {
      llamadas.confirmar.push(objeto);
      return config.confirma;
    },
    activar: async (uri) => {
      llamadas.activar.push(uri);
    },
    activarTodo: async (uri) => {
      llamadas.activarTodo.push(uri);
    },
  };
  return { catalogo: crearCatalogoEscritura(deps), textos, registro, propuestos, esperas, llamadas, config, atc };
}

function herramienta(m: Montaje, nombre: string): HerramientaMcp {
  const h = m.catalogo.find((x) => x.nombre === nombre);
  assert.ok(h, `falta ${nombre}`);
  return h;
}

suite('IA: herramientas de escritura', () => {
  test('el catálogo tiene las 6 herramientas en orden con descripción y esquema', () => {
    const m = montar();
    assert.deepEqual(
      m.catalogo.map((h) => h.nombre),
      ['proponer_cambio', 'estado_propuesta', 'verificar_sintaxis', 'ejecutar_atc', 'ejecutar_unit_tests', 'activar'],
    );
    assert.deepEqual([...ORDEN_ESCRITURA], m.catalogo.map((h) => h.nombre));
    for (const h of m.catalogo) {
      assert.ok(h.descripcion.startsWith(h.nombre === 'ejecutar_atc' ? 'Pasa el ATC' : 'Úsala'), h.nombre);
      assert.equal(h.inputSchema, ESQUEMAS[h.nombre as keyof typeof ESQUEMAS]);
    }
  });

  test('el punto 4 de las instrucciones del agente ya no dice "cuando exista"', () => {
    assert.ok(
      INSTRUCCIONES_AGENTE.includes('4. Los cambios de código van siempre por proponer_cambio; nunca por otro servidor ni por edición directa.'),
    );
  });

  test('proponer_cambio pasa porque a la propuesta solo si viene', async () => {
    const m = montar();
    const args = { uri: URI, resumen: 'r', cambios: [{ buscar: 'gv_x', reemplazar: 'gv_z' }] };
    await herramienta(m, 'proponer_cambio').ejecutar({ ...args, porque: 'p' });
    assert.equal(m.propuestos[0].porque, 'p');
    await herramienta(m, 'proponer_cambio').ejecutar(args);
    assert.ok(!('porque' in m.propuestos[1]));
  });

  test('proponer_cambio en QAS, PRD o sin rol → rechazado por rol sin abrir el diff', async () => {
    for (const rol of ['QAS', 'PRD', undefined] as const) {
      const m = montar(rol);
      const r = await herramienta(m, 'proponer_cambio').ejecutar({ uri: URI, resumen: 'cambio secreto', textoCompleto: 'CODIGO SECRETO' });
      assert.equal(r.esError, true);
      assert.ok(r.texto.startsWith('rechazado por rol'), r.texto);
      assert.ok(r.texto.includes(`tiene rol ${rol ?? 'sin asignar'}`), r.texto);
      assert.equal(m.propuestos.length, 0);
    }
  });

  test('proponer_cambio con buscar no único falla antes de abrir el diff con el motivo del modelo', async () => {
    const m = montar();
    const r = await herramienta(m, 'proponer_cambio').ejecutar({
      uri: URI,
      resumen: 'x',
      cambios: [{ buscar: 'DATA', reemplazar: 'CONSTANTS' }],
    });
    assert.equal(r.esError, true);
    assert.ok(r.texto.includes('aparece 2 veces'), r.texto);
    assert.equal(m.propuestos.length, 0);
    assert.equal(m.esperas.length, 0);
  });

  test('proponer_cambio sin cambios ni textoCompleto, o con ambos → error que lo dice', async () => {
    const m = montar();
    const ninguno = await herramienta(m, 'proponer_cambio').ejecutar({ uri: URI, resumen: 'x' });
    assert.equal(ninguno.esError, true);
    assert.equal(ninguno.texto, 'indica cambios (lista de buscar/reemplazar) o textoCompleto');
    const ambos = await herramienta(m, 'proponer_cambio').ejecutar({
      uri: URI,
      resumen: 'x',
      cambios: [{ buscar: 'gv_x', reemplazar: 'gv_z' }],
      textoCompleto: 'otro',
    });
    assert.equal(ambos.esError, true);
    assert.equal(ambos.texto, 'indica cambios (lista de buscar/reemplazar) o textoCompleto, pero no los dos');
    assert.equal(m.propuestos.length, 0);
  });

  test('proponer_cambio con archivo ilegible → error que manda abrir el objeto', async () => {
    const m = montar();
    m.textos.clear();
    const r = await herramienta(m, 'proponer_cambio').ejecutar({ uri: URI, resumen: 'x', textoCompleto: 'a' });
    assert.equal(r.esError, true);
    assert.ok(r.texto.startsWith(`No se pudo leer ${URI}: ábrelo antes con abrir_objeto`), r.texto);
    assert.equal(m.propuestos.length, 0);
  });

  test('proponer_cambio abre el diff y devuelve aplicado cuando el registro decide; pendiente si vence el plazo', async () => {
    const m = montar();
    const args = { uri: URI, resumen: 'renombra gv_x', cambios: [{ buscar: 'gv_x', reemplazar: 'gv_z' }] };
    const pendiente = await herramienta(m, 'proponer_cambio').ejecutar(args);
    assert.equal(pendiente.esError, undefined);
    const p = JSON.parse(pendiente.texto) as Decision & { indicacion?: string };
    assert.equal(p.estado, 'pendiente');
    assert.equal(p.indicacion, 'el usuario aún no decidió; llama a estado_propuesta con este id');
    assert.equal(m.propuestos.length, 1);
    assert.equal(m.propuestos[0].uri, URI);
    assert.equal(m.propuestos[0].resumen, 'renombra gv_x');
    assert.equal(m.propuestos[0].textoBase, TEXTO);
    assert.equal(m.propuestos[0].textoPropuesto, TEXTO.replace('gv_x', 'gv_z'));
    assert.deepEqual(m.esperas, [{ id: p.id, limiteMs: ESPERA_DECISION_MS }]);
    assert.equal(m.registro.obtener(p.id)?.estado, 'pendiente');

    m.config.decision = { id: 'abcd1234', estado: 'aplicado' };
    const aplicado = await herramienta(m, 'proponer_cambio').ejecutar(args);
    assert.equal(aplicado.esError, undefined);
    assert.deepEqual(JSON.parse(aplicado.texto), { id: 'abcd1234', estado: 'aplicado' });
  });

  test('proponer_cambio con textoCompleto propone ese texto', async () => {
    const m = montar();
    await herramienta(m, 'proponer_cambio').ejecutar({ uri: URI, resumen: 'nuevo', textoCompleto: 'REPORT z.\n' });
    assert.equal(m.propuestos[0].textoPropuesto, 'REPORT z.\n');
    assert.deepEqual(m.propuestos[0].entrada, { textoCompleto: 'REPORT z.\n' });
  });

  test('estado_propuesta desconocida → isError con indicación; aplicado → JSON', async () => {
    const m = montar();
    m.config.decision = { id: 'abcd1234', estado: 'desconocida', motivo: 'no hay ninguna propuesta' };
    const d = await herramienta(m, 'estado_propuesta').ejecutar({ id: 'abcd1234' });
    assert.equal(d.esError, true);
    assert.ok(d.texto.includes('no hay ninguna propuesta'));
    m.config.decision = { id: 'abcd1234', estado: 'aplicado' };
    const a = await herramienta(m, 'estado_propuesta').ejecutar({ id: 'abcd1234' });
    assert.equal(a.esError, undefined);
    assert.deepEqual(JSON.parse(a.texto), { id: 'abcd1234', estado: 'aplicado' });
    assert.deepEqual(m.esperas.at(-1), { id: 'abcd1234', limiteMs: ESPERA_DECISION_MS });
  });

  test('verificar_sintaxis funciona con rol QAS y añade indicacion si no hubo diagnósticos publicados', async () => {
    const m = montar('QAS');
    const ok = await herramienta(m, 'verificar_sintaxis').ejecutar({ uri: URI });
    assert.equal(ok.esError, undefined);
    assert.deepEqual(JSON.parse(ok.texto), { diagnosticos: [], publicados: true });
    m.config.verificacion = { diagnosticos: [], publicados: false };
    const sin = await herramienta(m, 'verificar_sintaxis').ejecutar({ uri: URI });
    assert.deepEqual(JSON.parse(sin.texto), {
      diagnosticos: [],
      publicados: false,
      indicacion: 'la extensión oficial no publicó diagnósticos; pide al usuario que mire el panel Problemas',
    });
    assert.deepEqual(m.llamadas.verificar, [URI, URI]);
  });

  test('verificar_sintaxis devuelve los diagnósticos con severidad, posición desde 1 y origen', async () => {
    const m = montar();
    const diagnostico = { severidad: 'error', linea: 2, columna: 1, mensaje: 'falta el punto', origen: 'ABAP' } as const;
    m.config.verificacion = { diagnosticos: [diagnostico], publicados: true };
    const r = await herramienta(m, 'verificar_sintaxis').ejecutar({ uri: URI });
    const json = JSON.parse(r.texto) as { diagnosticos: unknown; publicados: unknown };
    assert.deepEqual(json.diagnosticos, [diagnostico]);
    assert.equal(json.publicados, true);
  });

  test('verificar_sintaxis sin uri → error sin llamar a verificar', async () => {
    const m = montar();
    const r = await herramienta(m, 'verificar_sintaxis').ejecutar({});
    assert.equal(r.esError, true);
    assert.equal(m.llamadas.verificar.length, 0);
  });

  test('ejecutar_unit_tests en DEV lanza y devuelve lanzado; en QAS rechazado por rol', async () => {
    const dev = montar('DEV');
    const r = await herramienta(dev, 'ejecutar_unit_tests').ejecutar({ uri: URI });
    assert.equal(r.esError, undefined);
    assert.deepEqual(JSON.parse(r.texto), {
      estado: 'lanzado',
      indicacion: 'el resultado está en el panel de pruebas de VS Code; pídeselo al usuario',
    });
    assert.deepEqual(dev.llamadas.unit, [URI]);
    const qas = montar('QAS');
    const rq = await herramienta(qas, 'ejecutar_unit_tests').ejecutar({ uri: URI });
    assert.equal(rq.esError, true);
    assert.ok(rq.texto.startsWith('rechazado por rol'));
    assert.equal(qas.llamadas.unit.length, 0);
  });

  test('activar: cancelado si el usuario no confirma; activado si confirma; rechazado por rol en PRD sin preguntar', async () => {
    const m = montar('DEV');
    m.config.confirma = false;
    const c = await herramienta(m, 'activar').ejecutar({ uri: URI });
    assert.deepEqual(JSON.parse(c.texto), { estado: 'cancelado' });
    assert.equal(m.llamadas.activar.length, 0);
    assert.deepEqual(m.llamadas.confirmar, ['ZPROG_EJEMPLO']);
    m.config.confirma = true;
    const a = await herramienta(m, 'activar').ejecutar({ uri: URI });
    assert.deepEqual(JSON.parse(a.texto), {
      estado: 'activado',
      indicacion: 'la oficial muestra el resultado; si hay errores aparecen en Problemas',
    });
    assert.deepEqual(m.llamadas.activar, [URI]);
    const prd = montar('PRD');
    const rp = await herramienta(prd, 'activar').ejecutar({ uri: URI });
    assert.equal(rp.esError, true);
    assert.ok(rp.texto.startsWith('rechazado por rol'));
    assert.equal(prd.llamadas.confirmar.length, 0);
    assert.equal(prd.llamadas.activar.length, 0);
  });

  test('activar con todo: true en DEV abre la lista de la oficial sin modal y devuelve lanzado', async () => {
    const m = montar('DEV');
    const r = await herramienta(m, 'activar').ejecutar({ uri: URI, todo: true });
    assert.equal(r.esError, undefined);
    assert.deepEqual(JSON.parse(r.texto), {
      estado: 'lanzado',
      indicacion:
        'el usuario elige en la lista de la extensión oficial qué objetos inactivos activar; cuando confirme, llama a verificar_sintaxis sobre el programa principal',
    });
    assert.deepEqual(m.llamadas.activarTodo, [URI]);
    assert.equal(m.llamadas.confirmar.length, 0);
    assert.equal(m.llamadas.activar.length, 0);
  });

  test('activar con todo: true fuera de DEV se rechaza por rol sin llamar a nada', async () => {
    for (const rol of ['QAS', 'PRD', undefined] as const) {
      const m = montar(rol);
      const r = await herramienta(m, 'activar').ejecutar({ uri: URI, todo: true });
      assert.equal(r.esError, true, String(rol));
      assert.equal(
        r.texto,
        `rechazado por rol: DEST tiene rol ${rol ?? 'sin asignar'}; en QAS, PRD o sin rol el agente solo analiza`,
      );
      assert.equal(m.llamadas.activarTodo.length + m.llamadas.confirmar.length + m.llamadas.activar.length, 0);
    }
  });

  test('activar con todo: false sigue pidiendo confirmación y activa el archivo', async () => {
    const m = montar('DEV');
    const r = await herramienta(m, 'activar').ejecutar({ uri: URI, todo: false });
    assert.equal(JSON.parse(r.texto).estado, 'activado');
    assert.deepEqual(m.llamadas.confirmar, ['ZPROG_EJEMPLO']);
    assert.deepEqual(m.llamadas.activar, [URI]);
    assert.equal(m.llamadas.activarTodo.length, 0);
  });

  test('la descripción de activar explica todo: true para programas con includes', () => {
    const d = herramienta(montar(), 'activar').descripcion;
    assert.ok(
      d.endsWith(
        'Para un programa con includes (o varios objetos inactivos) usa todo: true: activar archivo por archivo falla porque cada include depende de los demás.',
      ),
    );
    assert.equal(
      ESQUEMAS.activar.properties.todo?.description,
      'Ponlo a true para activar el objeto completo (el programa y todos sus includes, o cualquier conjunto de objetos inactivos): Sextante abre la lista «Activate All» de la extensión oficial y el usuario marca y confirma ahí. Úsalo siempre que hayas creado o cambiado includes.',
    );
  });

  test('verificar_sintaxis: el mensaje de activación en el .json se devuelve como info', async () => {
    const m = montar();
    const json = URI.replace('.prog.abap', '.prog.json');
    const activado = { severidad: 'error', linea: 1, columna: 1, mensaje: 'Objeto(s) activado(s)', origen: 'abapActivation' } as const;
    m.config.verificacion = { diagnosticos: [activado], publicados: true };
    const r = await herramienta(m, 'verificar_sintaxis').ejecutar({ uri: json });
    assert.deepEqual(JSON.parse(r.texto), { diagnosticos: [{ ...activado, severidad: 'info' }], publicados: true });
    assert.ok(herramienta(m, 'verificar_sintaxis').descripcion.includes('se devuelve como info'));
  });

  test('verificar_sintaxis con errores en el programa principal sugiere activar con todo: true; en un include no', async () => {
    const m = montar();
    const error = { severidad: 'error', linea: 3, columna: 5, mensaje: 'El tipo LCL_APP es desconocido' } as const;
    m.config.verificacion = { diagnosticos: [error], publicados: true };
    const r = await herramienta(m, 'verificar_sintaxis').ejecutar({ uri: URI });
    assert.deepEqual(JSON.parse(r.texto), {
      diagnosticos: [error],
      publicados: true,
      indicacion:
        'si el programa tiene includes sin activar, los errores de tipos o subrutinas desconocidos pueden deberse a eso: activa con activar { todo: true } y vuelve a verificar',
    });
    const include = 'abap:/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Includes/ZPROG_TOP/zprog_top.prog.abap';
    const ri = await herramienta(m, 'verificar_sintaxis').ejecutar({ uri: include });
    assert.deepEqual(JSON.parse(ri.texto), { diagnosticos: [error], publicados: true });
  });

  test('una uri que no es del árbol abap: → error legible en las tres herramientas con rol', async () => {
    const m = montar();
    for (const nombre of ['proponer_cambio', 'ejecutar_unit_tests', 'activar']) {
      const r = await herramienta(m, nombre).ejecutar({ uri: 'file:///c/x.abap', resumen: 'x', textoCompleto: 'a' });
      assert.equal(r.esError, true, nombre);
      assert.equal(r.texto, 'la uri no es de un objeto abap: del árbol de la oficial', nombre);
    }
    assert.equal(m.propuestos.length, 0);
    assert.equal(m.llamadas.unit.length + m.llamadas.activar.length + m.llamadas.confirmar.length, 0);
  });

  test('tieneSegmentosRelativos: ".", ".." o vacíos tras la barra inicial; una ruta normal con espacios no', () => {
    assert.equal(tieneSegmentosRelativos('/repotree-v1/DEVSYS/../PRDSYS/x'), true);
    assert.equal(tieneSegmentosRelativos('/repotree-v1/DEVSYS/./x'), true);
    assert.equal(tieneSegmentosRelativos('/repotree-v1/DEVSYS//x'), true);
    assert.equal(tieneSegmentosRelativos('/repotree-v1/DEVSYS/x/'), true);
    assert.equal(tieneSegmentosRelativos(RUTA), false);
    assert.equal(tieneSegmentosRelativos('/repotree-v1/DEST/System Library/ZPAQ1/..zprog'), false);
  });

  test('una uri con ".." (también %2E%2E) → error de segmentos en las cuatro herramientas con uri, sin tocar nada', async () => {
    const m = montar();
    m.textos.set('/repotree-v1/PRDSYS/x', 'a');
    const uris = ['abap:/repotree-v1/DEVSYS/../PRDSYS/x', 'abap:/repotree-v1/DEVSYS/%2E%2E/PRDSYS/x', 'abap:/repotree-v1/DEST/./x'];
    for (const uri of uris) {
      for (const nombre of ['proponer_cambio', 'ejecutar_unit_tests', 'activar', 'verificar_sintaxis']) {
        const r = await herramienta(m, nombre).ejecutar({ uri, resumen: 'x', textoCompleto: 'b' });
        assert.equal(r.esError, true, `${nombre} ${uri}`);
        assert.equal(r.texto, MSG_SEGMENTOS_RELATIVOS, `${nombre} ${uri}`);
      }
    }
    assert.equal(m.propuestos.length, 0);
    const { verificar, unit, activar, confirmar } = m.llamadas;
    assert.equal(verificar.length + unit.length + activar.length + confirmar.length, 0);
  });

  test('una uri normal de System Library pasa el control de segmentos', async () => {
    const m = montar();
    const r = await herramienta(m, 'verificar_sintaxis').ejecutar({ uri: `abap:${RUTA.replace(/ /g, '%20')}` });
    assert.equal(r.esError, undefined);
    assert.deepEqual(m.llamadas.verificar, [`abap:${RUTA.replace(/ /g, '%20')}`]);
    const u = await herramienta(m, 'ejecutar_unit_tests').ejecutar({ uri: URI });
    assert.equal(u.esError, undefined);
  });

  test('el texto del error de rol no incluye el resumen ni el código propuesto', async () => {
    const m = montar('PRD');
    const r = await herramienta(m, 'proponer_cambio').ejecutar({ uri: URI, resumen: 'RESUMEN_SECRETO', textoCompleto: 'CODIGO_SECRETO' });
    assert.ok(!r.texto.includes('RESUMEN_SECRETO'));
    assert.ok(!r.texto.includes('CODIGO_SECRETO'));
  });

  suite('ejecutar_atc', () => {
    const hallazgo = (prioridad: HallazgoAtc['prioridad'], linea: number): HallazgoAtc => ({ uri: URI, linea, prioridad, mensaje: 'm' });
    const limpio: ResultadoAtc = { hallazgos: [], huboSenal: true };
    const vaciarMicrotareas = (): Promise<void> => new Promise((resolver) => setImmediate(resolver));
    const estadoDe = (texto: string): string => (JSON.parse(texto) as { estado: string }).estado;

    test('devuelve los hallazgos ordenados con contadores y funciona en QAS', async () => {
      const m = montar('QAS');
      const llamada = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      m.atc.pendientes[0]?.resolver({ huboSenal: true, hallazgos: [hallazgo('info', 1), hallazgo('error', 9), hallazgo('aviso', 4)] });
      const r = await llamada;
      assert.equal(r.esError, undefined);
      const json = JSON.parse(r.texto) as { estado: string; total: number; errores: number; avisos: number; infos: number; hallazgos: HallazgoAtc[] };
      assert.equal(json.estado, 'con hallazgos');
      assert.deepEqual([json.total, json.errores, json.avisos, json.infos], [3, 1, 1, 1]);
      assert.deepEqual(json.hallazgos.map((h) => h.prioridad), ['error', 'aviso', 'info']);
      assert.deepEqual(m.llamadas.atc, [URI]);
    });

    test('sin uri o con segmentos relativos → error sin lanzar el ATC', async () => {
      const m = montar();
      assert.equal((await herramienta(m, 'ejecutar_atc').ejecutar({})).esError, true);
      const relativa = await herramienta(m, 'ejecutar_atc').ejecutar({ uri: `abap:${RUTA}/../x` });
      assert.equal(relativa.esError, true);
      assert.equal(relativa.texto, MSG_SEGMENTOS_RELATIVOS);
      assert.deepEqual(m.llamadas.atc, []);
    });

    test('pasada lenta → en curso; la segunda llamada se une y recoge el resultado sin lanzar otro ATC', async () => {
      const m = montar();
      const primera = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      m.atc.expirarEspera();
      const enCurso = await primera;
      assert.equal(estadoDe(enCurso.texto), 'en curso');
      assert.equal((JSON.parse(enCurso.texto) as { indicacion: string }).indicacion, INDICACION_EN_CURSO);
      assert.ok(!('hallazgos' in JSON.parse(enCurso.texto)));

      const segunda = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      m.atc.pendientes[0]?.resolver({ huboSenal: true, hallazgos: [hallazgo('aviso', 2)] });
      assert.equal(estadoDe((await segunda).texto), 'con hallazgos');
      assert.equal(m.llamadas.atc.length, 1);
    });

    test('un resultado que llegó tras en curso se conserva hasta que una llamada lo recoge, una sola vez', async () => {
      const m = montar();
      const primera = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      m.atc.expirarEspera();
      await primera;
      m.atc.pendientes[0]?.resolver({ huboSenal: true, hallazgos: [hallazgo('error', 7)] });
      await vaciarMicrotareas();
      m.atc.reloj = VIGENCIA_RESULTADO_ATC_MS - 1;
      const recogida = await herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      assert.equal(estadoDe(recogida.texto), 'con hallazgos');
      assert.equal(m.llamadas.atc.length, 1);

      const nueva = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      assert.equal(m.llamadas.atc.length, 2);
      m.atc.pendientes[1]?.resolver(limpio);
      await nueva;
    });

    test('un resultado sin recoger caduca pasada la vigencia y se lanza un ATC nuevo', async () => {
      const m = montar();
      const primera = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      m.atc.expirarEspera();
      await primera;
      m.atc.pendientes[0]?.resolver({ huboSenal: true, hallazgos: [hallazgo('error', 7)] });
      await vaciarMicrotareas();
      m.atc.reloj = VIGENCIA_RESULTADO_ATC_MS;
      const segunda = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      assert.equal(m.llamadas.atc.length, 2);
      m.atc.pendientes[1]?.resolver(limpio);
      assert.equal(estadoDe((await segunda).texto), 'sin hallazgos');
    });

    test('una pasada en marcha, aunque sea más vieja que la vigencia, sigue en curso y no lanza otra', async () => {
      const m = montar();
      const primera = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      m.atc.expirarEspera();
      await primera;
      m.atc.reloj = VIGENCIA_RESULTADO_ATC_MS + ESPERA_ATC_MS;
      const segunda = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      m.atc.expirarEspera();
      assert.equal(estadoDe((await segunda).texto), 'en curso');
      assert.equal(m.llamadas.atc.length, 1);
    });

    test('un fallo se entrega una vez como error de herramienta y se borra', async () => {
      const m = montar();
      const llamada = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      m.atc.pendientes[0]?.rechazar(new Error('la extensión oficial no está instalada'));
      const r = await llamada;
      assert.equal(r.esError, true);
      assert.match(r.texto, /ejecutar_atc falló: la extensión oficial no está instalada/);

      const siguiente = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      assert.equal(m.llamadas.atc.length, 2);
      m.atc.pendientes[1]?.resolver(limpio);
      assert.equal(estadoDe((await siguiente).texto), 'sin hallazgos');
    });

    test('un fallo tras en curso se entrega en la llamada siguiente', async () => {
      const m = montar();
      const primera = herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      m.atc.expirarEspera();
      await primera;
      m.atc.pendientes[0]?.rechazar(new Error('boom'));
      await vaciarMicrotareas();
      const r = await herramienta(m, 'ejecutar_atc').ejecutar({ uri: URI });
      assert.equal(r.esError, true);
      assert.match(r.texto, /boom/);
      assert.equal(m.llamadas.atc.length, 1);
    });

    test('cada fábrica tiene su propio registro de pasadas', async () => {
      const a = montar();
      const b = montar();
      const lanzada = herramienta(a, 'ejecutar_atc').ejecutar({ uri: URI });
      const otra = herramienta(b, 'ejecutar_atc').ejecutar({ uri: URI });
      await vaciarMicrotareas();
      assert.equal(a.llamadas.atc.length, 1);
      assert.equal(b.llamadas.atc.length, 1);
      a.atc.pendientes[0]?.resolver(limpio);
      b.atc.pendientes[0]?.resolver(limpio);
      await Promise.all([lanzada, otra]);
    });
  });
});
