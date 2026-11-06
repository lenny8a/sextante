import assert from 'node:assert/strict';
import type { ResultadoAbrir } from '../../src/adt/abrir-resultado';
import { FILTROS_TIPO, type ResultadoBusqueda } from '../../src/adt/busqueda-modelo';
import type { EstadoDestino } from '../../src/bridge/logon-oficial';
import type { ContextoActual } from '../../src/ia/contexto-modelo';
import { ESQUEMAS } from '../../src/ia/esquemas';
import {
  ESPERA_LOGON_MS,
  ErrorHerramienta,
  TIPOS_ABRIR,
  crearCatalogoLectura,
  rutaDeUriTexto,
  type DependenciasHerramientas,
} from '../../src/ia/herramientas';
import { formatearPrograma, recopilarPrograma } from '../../src/ia/lectura-modelo';
import type { HerramientaMcp, ResultadoHerramienta } from '../../src/ia/mcp-modelo';
import { construirArbolObjeto, type NodoObjeto } from '../../src/tree/objeto-modelo';

const RUTA_PROG = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap';
const RUTA_TOP = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Includes/ZPROG_EJEMPLO_TOP/zprog_ejemplo_top.prog.abap';
const RUTA_F01 = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Includes/ZPROG_EJEMPLO_F01/zprog_ejemplo_f01.prog.abap';
const RUTA_VACIA = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Includes/ZPROG_EJEMPLO_VACIO/zprog_ejemplo_vacio.prog.abap';
const CARPETA_PROG = '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Programs/ZPROG_EJEMPLO';

const TEXTOS: Record<string, string> = {
  [RUTA_PROG]: 'REPORT zprog_ejemplo.\nINCLUDE zprog_ejemplo_top.\nINCLUDE zprog_ejemplo_f01.\n',
  [RUTA_TOP]: 'DATA gv_x TYPE i.\n',
  [RUTA_F01]: 'FORM calcular.\nENDFORM.\n',
  [RUTA_VACIA]: '',
};

const CONTEXTO: ContextoActual = {
  sistema: { id: 'DEST', rol: 'DEV', via: 'rfc', origen: 'editor' },
  archivo: { uri: `abap:${RUTA_PROG}`, nombre: 'zprog_ejemplo.prog.abap', esInclude: false },
  cursor: { linea: 1, columna: 1 },
  soloLectura: false,
  modoBloque: false,
  origenEditor: 'activo',
  editoresAbiertos: [{ uri: `abap:${RUTA_PROG}`, objeto: 'ZPROG_EJEMPLO', sistema: 'DEST', esActivo: true }],
  propuestasPendientes: [],
};

function resultado(nombre: string, tipo = 'PROG/P'): ResultadoBusqueda {
  return { nombre, tipo, descripcion: `Descripción de ${nombre}`, paquete: 'ZPAQ1', uriAdt: `/sap/bc/adt/programs/programs/${nombre.toLowerCase()}` };
}

interface Registro {
  conectados: string[];
  consultas: [string, string, string | undefined][];
  abiertos: [ResultadoBusqueda, string][];
  leidas: string[];
  arboles: string[];
  esperas: number[];
}

interface Opciones {
  estado?: EstadoDestino;
  conectar?: 'conecta' | 'nunca' | 'cancela';
  porDefecto?: string;
  resultados?: ResultadoBusqueda[];
  abrir?: { resultado: ResultadoAbrir; ruta?: string };
  via?: string;
  arbol?: NodoObjeto;
}

function falsas(opciones: Opciones = {}): { deps: DependenciasHerramientas; registro: Registro } {
  const registro: Registro = { conectados: [], consultas: [], abiertos: [], leidas: [], arboles: [], esperas: [] };
  let estado: EstadoDestino = opciones.estado ?? 'conectado';
  let reloj = 0;
  const deps: DependenciasHerramientas = {
    contexto: async () => CONTEXTO,
    sistemaPorDefecto: () => opciones.porDefecto,
    estadoDe: async () => estado,
    conectar: (id) => {
      registro.conectados.push(id);
      if (opciones.conectar === 'nunca') {
        return new Promise<void>(() => undefined);
      }
      if (opciones.conectar === 'cancela') {
        return Promise.reject(new Error('cancelado'));
      }
      estado = 'conectado';
      return Promise.resolve();
    },
    consultar: async (destino, texto, filtroId) => {
      registro.consultas.push([destino, texto, filtroId]);
      return opciones.resultados ?? [];
    },
    abrirResultado: async (r, destino) => {
      registro.abiertos.push([r, destino]);
      return opciones.abrir ?? { resultado: 'abierto', ruta: RUTA_PROG };
    },
    viaDe: () => opciones.via,
    leerTexto: async (ruta) => {
      registro.leidas.push(ruta);
      return TEXTOS[ruta];
    },
    arbolDe: async (ruta) => {
      registro.arboles.push(ruta);
      return opciones.arbol;
    },
    ahora: () => reloj,
    esperar: async (ms) => {
      registro.esperas.push(ms);
      reloj += ms;
    },
  };
  return { deps, registro };
}

function herramienta(deps: DependenciasHerramientas, nombre: string): HerramientaMcp {
  const encontrada = crearCatalogoLectura(deps).find((h) => h.nombre === nombre);
  assert.ok(encontrada, `falta la herramienta ${nombre}`);
  return encontrada;
}

async function llamar(deps: DependenciasHerramientas, nombre: string, args: Record<string, unknown>): Promise<ResultadoHerramienta> {
  return herramienta(deps, nombre).ejecutar(args);
}

suite('IA: herramientas de lectura', () => {
  test('el catálogo trae las 7 herramientas en el orden de la spec con sus esquemas', () => {
    const catalogo = crearCatalogoLectura(falsas().deps);
    assert.deepEqual(
      catalogo.map((h) => h.nombre),
      ['contexto_actual', 'abrir_objeto', 'abrir_transaccion', 'leer_programa', 'leer_archivo', 'estructura_objeto', 'editores_abiertos'],
    );
    for (const h of catalogo) {
      assert.equal(h.inputSchema, ESQUEMAS[h.nombre as keyof typeof ESQUEMAS]);
      assert.ok(h.descripcion.length > 40, `${h.nombre} necesita una descripción como paso del procedimiento`);
    }
    const ids = FILTROS_TIPO.map((f) => f.id);
    for (const id of Object.values(TIPOS_ABRIR)) {
      assert.ok(ids.includes(id), `${id} no es un filtro de la búsqueda`);
    }
    assert.deepEqual(Object.keys(TIPOS_ABRIR).sort(), [...(ESQUEMAS.abrir_objeto.properties.tipo.enum ?? [])].sort());
  });

  test('abrir_objeto conecta si hace falta, busca con el filtro del tipo y abre el único resultado exacto', async () => {
    const { deps, registro } = falsas({
      estado: 'desconectado',
      resultados: [resultado('ZPROG_EJEMPLO_OLD'), resultado('ZPROG_EJEMPLO')],
    });
    const r = await llamar(deps, 'abrir_objeto', { nombre: 'zprog_ejemplo', tipo: 'PROG', sistema: 'DEST' });
    assert.equal(r.esError, undefined);
    assert.deepEqual(registro.conectados, ['DEST']);
    assert.deepEqual(registro.consultas, [['DEST', 'ZPROG_EJEMPLO', 'programa']]);
    assert.equal(registro.abiertos.length, 1);
    assert.deepEqual(registro.abiertos[0], [resultado('ZPROG_EJEMPLO'), 'DEST']);
    assert.deepEqual(JSON.parse(r.texto), { uri: `abap:${RUTA_PROG}`, tipo: 'PROG/P', paquete: 'ZPAQ1', nombre: 'ZPROG_EJEMPLO' });
  });

  test('abrir_objeto con varios candidatos no abre y los lista; sin resultados da error legible', async () => {
    const varios = falsas({ resultados: [resultado('ZPROG_EJEMPLO_A'), resultado('ZPROG_EJEMPLO_B')] });
    const r = await llamar(varios.deps, 'abrir_objeto', { nombre: 'ZPROG_EJEMPLO', sistema: 'DEST' });
    assert.equal(r.esError, undefined);
    assert.deepEqual(varios.registro.conectados, []);
    assert.deepEqual(varios.registro.consultas, [['DEST', 'ZPROG_EJEMPLO', undefined]]);
    assert.deepEqual(varios.registro.abiertos, []);
    const lista = JSON.parse(r.texto) as { candidatos: { nombre: string }[]; indicacion: string };
    assert.deepEqual(
      lista.candidatos.map((c) => c.nombre),
      ['ZPROG_EJEMPLO_A', 'ZPROG_EJEMPLO_B'],
    );
    assert.match(lista.indicacion, /vuelve a llamar/);

    const ninguno = falsas({ resultados: [] });
    const vacio = await llamar(ninguno.deps, 'abrir_objeto', { nombre: 'ZPROG_EJEMPLO', tipo: 'PROG', sistema: 'DEST' });
    assert.equal(vacio.esError, true);
    assert.match(vacio.texto, /No hay programa ZPROG_EJEMPLO en DEST/);
    assert.deepEqual(ninguno.registro.abiertos, []);
  });

  test('abrir_objeto con un único resultado que no es el nombre exacto lo ofrece como candidato sin abrirlo', async () => {
    const { deps, registro } = falsas({ resultados: [resultado('ZPROG_EJEMPLO_BIS')] });
    const r = await llamar(deps, 'abrir_objeto', { nombre: 'ZPROG_EJEMPLO', sistema: 'DEST' });
    assert.equal(r.esError, undefined);
    assert.deepEqual(registro.abiertos, []);
    const lista = JSON.parse(r.texto) as { candidatos: { nombre: string }[]; indicacion: string };
    assert.deepEqual(lista.candidatos.map((c) => c.nombre), ['ZPROG_EJEMPLO_BIS']);
    assert.match(lista.indicacion, /Ningún objeto se llama exactamente ZPROG_EJEMPLO/);
  });

  test('abrir_objeto con dos resultados del mismo nombre exacto los lista y pide el tipo', async () => {
    const { deps, registro } = falsas({ resultados: [resultado('ZPROG_EJEMPLO'), resultado('ZPROG_EJEMPLO', 'CLAS/OC'), resultado('ZPROG_EJEMPLO_X')] });
    const r = await llamar(deps, 'abrir_objeto', { nombre: 'zprog_ejemplo', sistema: 'DEST' });
    assert.deepEqual(registro.abiertos, []);
    const lista = JSON.parse(r.texto) as { candidatos: { tipo: string }[]; indicacion: string };
    assert.deepEqual(lista.candidatos.map((c) => c.tipo), ['PROG/P', 'CLAS/OC']);
    assert.match(lista.indicacion, /indicando el tipo/);
  });

  test('un ErrorHerramienta de una dependencia llega al agente tal cual, sin el envoltorio genérico', async () => {
    const { deps } = falsas();
    const sinSesion: DependenciasHerramientas = {
      ...deps,
      consultar: () => Promise.reject(new ErrorHerramienta('Sin conexión ADT propia con DEST: vuelve a intentarlo')),
    };
    const r = await llamar(sinSesion, 'abrir_objeto', { nombre: 'ZPROG_EJEMPLO', sistema: 'DEST' });
    assert.deepEqual(r, { texto: 'Sin conexión ADT propia con DEST: vuelve a intentarlo', esError: true });
    const generico = await llamar({ ...deps, consultar: () => Promise.reject(new Error('caído')) }, 'abrir_objeto', { nombre: 'ZPROG_EJEMPLO', sistema: 'DEST' });
    assert.match(generico.texto, /^abrir_objeto falló: caído\. Comprueba/);
  });

  test('tras el logon el estado se sondea en silencio (sin avisos en el log por vuelta)', async () => {
    const { deps } = falsas({ estado: 'desconectado', resultados: [resultado('ZPROG_EJEMPLO')] });
    const respuestas: EstadoDestino[] = ['desconectado', 'desconocido', 'desconocido', 'conectado'];
    const silencios: (boolean | undefined)[] = [];
    let reloj = 0;
    const sondeado: DependenciasHerramientas = {
      ...deps,
      // La carrera con conectar no debe consumir el plazo: solo avanzan el reloj las esperas del sondeo.
      ahora: () => reloj,
      esperar: async (ms) => {
        reloj += ms === ESPERA_LOGON_MS ? 0 : ms;
      },
      estadoDe: async (_id, silencioso) => {
        silencios.push(silencioso);
        return respuestas.shift() ?? 'conectado';
      },
    };
    const r = await llamar(sondeado, 'abrir_objeto', { nombre: 'ZPROG_EJEMPLO', sistema: 'DEST' });
    assert.equal(r.esError, undefined);
    assert.deepEqual(silencios, [undefined, true, true, true]);
  });

  test('abrir_objeto cuando el logon no termina en ESPERA_LOGON_MS devuelve esError "esperando el logon"', async () => {
    const { deps, registro } = falsas({ estado: 'desconectado', conectar: 'nunca', resultados: [resultado('ZPROG_EJEMPLO')] });
    const r = await llamar(deps, 'abrir_objeto', { nombre: 'ZPROG_EJEMPLO', sistema: 'DEST' });
    assert.equal(r.esError, true);
    assert.match(r.texto, /El destino DEST está esperando el logon del usuario en VS Code; vuelve a llamar/);
    assert.deepEqual(registro.conectados, ['DEST']);
    assert.deepEqual(registro.esperas, [ESPERA_LOGON_MS]);
    assert.deepEqual(registro.consultas, []);
    assert.deepEqual(registro.abiertos, []);
  });

  test('abrir_objeto cuando el usuario cancela el logon pide conectar desde la vista Sistemas', async () => {
    const { deps, registro } = falsas({ estado: 'desconectado', conectar: 'cancela', resultados: [resultado('ZPROG_EJEMPLO')] });
    const r = await llamar(deps, 'abrir_objeto', { nombre: 'ZPROG_EJEMPLO', sistema: 'DEST' });
    assert.equal(r.esError, true);
    assert.match(r.texto, /cancel/);
    assert.match(r.texto, /vista Sistemas/);
    assert.doesNotMatch(r.texto, /esperando el logon/);
    assert.deepEqual(registro.conectados, ['DEST']);
    assert.deepEqual(registro.consultas, []);
  });

  test('la espera del logon no deja temporizadores vivos cuando conectar termina antes', async () => {
    const { deps } = falsas({ estado: 'desconectado', resultados: [resultado('ZPROG_EJEMPLO')] });
    const sinReloj: DependenciasHerramientas = { ...deps, ahora: undefined, esperar: undefined };
    const temporizadores = (): number => process.getActiveResourcesInfo().filter((t) => t === 'Timeout').length;
    // Mocha arma su propio temporizador de timeout cuando la prueba devuelve la promesa: contar después.
    await new Promise<void>((resolver) => setImmediate(resolver));
    const antes = temporizadores();
    const r = await llamar(sinReloj, 'abrir_objeto', { nombre: 'ZPROG_EJEMPLO', sistema: 'DEST' });
    assert.equal(r.esError, undefined);
    assert.equal(temporizadores(), antes);
  });

  test('abrir_transaccion sin vía RFC → esError que nombra la vía; con RFC abre la TRAN y devuelve la uri', async () => {
    const rest = falsas({ via: 'rest' });
    const sinRfc = await llamar(rest.deps, 'abrir_transaccion', { tcode: 'ZEJEMPLO', sistema: 'DEST' });
    assert.equal(sinRfc.esError, true);
    assert.match(sinRfc.texto, /La transacción solo se resuelve por RFC; DEST va por rest/);
    assert.deepEqual(rest.registro.abiertos, []);

    const rfc = falsas({ via: 'rfc' });
    const abierta = await llamar(rfc.deps, 'abrir_transaccion', { tcode: 'zejemplo', sistema: 'DEST' });
    assert.equal(abierta.esError, undefined);
    assert.deepEqual(rfc.registro.abiertos, [
      [{ nombre: 'ZEJEMPLO', tipo: 'TRAN/T', descripcion: '', paquete: '', uriAdt: '' }, 'DEST'],
    ]);
    assert.equal((JSON.parse(abierta.texto) as { uri: string }).uri, `abap:${RUTA_PROG}`);

    const sinDestino = falsas({ via: 'rfc', abrir: { resultado: 'transaccionSinDestino' } });
    const vacia = await llamar(sinDestino.deps, 'abrir_transaccion', { tcode: 'ZEJEMPLO', sistema: 'DEST' });
    assert.equal(vacia.esError, true);
    assert.match(vacia.texto, /La transacción ZEJEMPLO no ejecuta un programa ni una clase \(o no existe\)/);
  });

  test('leer_programa recopila con leerTexto y formatea; uri con %20 se descodifica a espacio', async () => {
    assert.equal(rutaDeUriTexto(`abap:${RUTA_PROG.replace(/ /g, '%20')}`), RUTA_PROG);
    assert.equal(rutaDeUriTexto(`abap:${RUTA_PROG}`), RUTA_PROG);
    assert.equal(rutaDeUriTexto('abap:/repotree-v1/DEST/mal%E0'), '/repotree-v1/DEST/mal%E0');

    const { deps, registro } = falsas();
    const r = await llamar(deps, 'leer_programa', { uri: `abap:${RUTA_PROG.replace(/ /g, '%20')}` });
    assert.equal(r.esError, undefined);
    assert.deepEqual(registro.leidas, [RUTA_PROG, RUTA_TOP, RUTA_F01]);
    const esperado = formatearPrograma(await recopilarPrograma(RUTA_PROG, async (ruta) => TEXTOS[ruta], true), { maxLineasPorArchivo: 2000 });
    assert.equal(r.texto, esperado);
    assert.ok(r.texto.startsWith(`=== ${RUTA_PROG} (3 líneas) ===\n1| REPORT zprog_ejemplo.`));
    assert.ok(r.texto.includes(`=== ${RUTA_F01} (2 líneas) ===\n1| FORM calcular.\n2| ENDFORM.`));

    const solo = falsas();
    const corto = await llamar(solo.deps, 'leer_programa', { uri: `abap:${RUTA_PROG}`, incluirIncludes: false, maxLineasPorArchivo: 1 });
    assert.deepEqual(solo.registro.leidas, [RUTA_PROG]);
    assert.match(corto.texto, /… 2 líneas más: leer_archivo desde la 2/);

    const ilegible = await llamar(falsas().deps, 'leer_programa', { uri: 'abap:/repotree-v1/DEST/System Library/ZPAQ1/x.prog.abap' });
    assert.equal(ilegible.esError, true);
    assert.match(ilegible.texto, /abrir_objeto/);
  });

  test('leer_archivo valida el rango y numera 1-based', async () => {
    const { deps, registro } = falsas();
    const uri = `abap:${RUTA_F01}`;
    const fuera = await llamar(deps, 'leer_archivo', { uri, desdeLinea: 1, hastaLinea: 3 });
    assert.equal(fuera.esError, true);
    assert.match(fuera.texto, /hasta \(3\) supera el total de líneas \(2\)/);

    const r = await llamar(deps, 'leer_archivo', { uri, desdeLinea: 2, hastaLinea: 2 });
    assert.equal(r.esError, undefined);
    assert.equal(r.texto, `=== ${RUTA_F01} (líneas 2-2 de 2) ===\n2| ENDFORM.`);
    assert.deepEqual(registro.leidas, [RUTA_F01, RUTA_F01]);

    const ilegible = await llamar(deps, 'leer_archivo', { uri: 'abap:/repotree-v1/DEST/x.prog.abap', desdeLinea: 1, hastaLinea: 1 });
    assert.equal(ilegible.esError, true);
  });

  test('leer_archivo sobre un archivo vacío dice que está vacío', async () => {
    const r = await llamar(falsas().deps, 'leer_archivo', { uri: `abap:${RUTA_VACIA}`, desdeLinea: 1, hastaLinea: 1 });
    assert.equal(r.esError, true);
    assert.match(r.texto, /el archivo está vacío/);
    assert.doesNotMatch(r.texto, /entre 1 y 0/);
  });

  test('estructura_objeto devuelve tal cual el error de la vista fijada en otro objeto', async () => {
    const { deps } = falsas();
    const fijada: DependenciasHerramientas = {
      ...deps,
      arbolDe: () => Promise.reject(new ErrorHerramienta('La vista Objeto está fijada en otro objeto; pide al usuario que la suelte')),
    };
    const r = await llamar(fijada, 'estructura_objeto', { uri: `abap:${RUTA_PROG}` });
    assert.deepEqual(r, { texto: 'La vista Objeto está fijada en otro objeto; pide al usuario que la suelte', esError: true });
  });

  test('estructura_objeto sin árbol → esError; con árbol → JSON con rangos 1-based', async () => {
    const sinArbol = falsas();
    const vacio = await llamar(sinArbol.deps, 'estructura_objeto', { uri: `abap:${RUTA_PROG.replace(/ /g, '%20')}` });
    assert.equal(vacio.esError, true);
    assert.match(vacio.texto, /El objeto no está cargado en la vista Objeto; ábrelo primero/);
    assert.deepEqual(sinArbol.registro.arboles, [RUTA_PROG]);

    const arbol = construirArbolObjeto({
      tipo: 'programa',
      nombre: 'ZPROG_EJEMPLO',
      archivoAbierto: 'zprog_ejemplo.prog.abap',
      archivos: ['zprog_ejemplo.prog.abap'],
      simbolos: [{ nombre: 'CALCULAR', kind: 12, nombreKind: 'Function', rango: [4, 0, 9, 7], hijos: [] }],
    });
    const { deps } = falsas({ arbol });
    const r = await llamar(deps, 'estructura_objeto', { uri: `abap:${RUTA_PROG}` });
    assert.equal(r.esError, undefined);
    const texto = r.texto;
    assert.ok(!texto.includes('"id"') && !texto.includes('"icono"') && !texto.includes('"archivo"') && !texto.includes('"ruta"'));
    interface Salida {
      etiqueta: string;
      clase: string;
      nombreKind?: string;
      nombreInclude?: string;
      uri?: string;
      rango?: { desdeLinea: number; hastaLinea: number };
      hijos: Salida[];
    }
    const raiz = JSON.parse(texto) as Salida;
    assert.equal(raiz.etiqueta, 'ZPROG_EJEMPLO');
    assert.equal(raiz.clase, 'raiz');
    const pendientes = [...raiz.hijos];
    let form: Salida | undefined;
    while (pendientes.length > 0 && form === undefined) {
      const nodo = pendientes.shift() as Salida;
      form = nodo.nombreKind === 'Function' ? nodo : undefined;
      pendientes.push(...nodo.hijos);
    }
    assert.ok(form, 'el FORM debe estar en el árbol');
    assert.equal(form.clase, 'simbolo');
    assert.deepEqual(form.rango, { desdeLinea: 5, hastaLinea: 10 });
    assert.equal(form.uri, `abap:${CARPETA_PROG}/zprog_ejemplo.prog.abap`);
    assert.deepEqual(form.hijos, []);
    assert.equal(raiz.uri, `abap:${CARPETA_PROG}/zprog_ejemplo.prog.abap`);

    const conInclude: NodoObjeto = {
      id: 'objeto:zprog_ejemplo',
      clase: 'raiz',
      etiqueta: 'ZPROG_EJEMPLO',
      icono: 'symbol-file',
      hijos: [
        {
          id: 'include:zprog_ejemplo_f01',
          clase: 'include',
          etiqueta: 'ZPROG_EJEMPLO_F01',
          icono: 'file-code',
          nombreInclude: 'zprog_ejemplo_f01',
          hijos: [
            {
              id: 'simbolo:calcular',
              clase: 'simbolo',
              etiqueta: 'CALCULAR',
              icono: 'symbol-method',
              archivo: 'zprog_ejemplo_f01.prog.abap',
              ruta: RUTA_F01,
              rango: [0, 0, 1, 8],
              nombreKind: 'Function',
              hijos: [],
            },
          ],
        },
      ],
    };
    const otra = await llamar(falsas({ arbol: conInclude }).deps, 'estructura_objeto', { uri: `abap:${RUTA_PROG}` });
    const raizInclude = JSON.parse(otra.texto) as Salida;
    assert.equal(raizInclude.uri, undefined);
    const [include] = raizInclude.hijos;
    assert.equal(include.nombreInclude, 'zprog_ejemplo_f01');
    assert.equal(include.uri, undefined);
    assert.deepEqual(include.hijos[0], {
      etiqueta: 'CALCULAR',
      clase: 'simbolo',
      nombreKind: 'Function',
      uri: `abap:${RUTA_F01}`,
      rango: { desdeLinea: 1, hastaLinea: 2 },
      hijos: [],
    });
  });

  test('sistema omitido usa sistemaPorDefecto; sin ninguno → esError "indica el sistema"', async () => {
    const conDefecto = falsas({ porDefecto: 'DEST', resultados: [resultado('ZPROG_EJEMPLO')] });
    const r = await llamar(conDefecto.deps, 'abrir_objeto', { nombre: 'ZPROG_EJEMPLO' });
    assert.equal(r.esError, undefined);
    assert.deepEqual(conDefecto.registro.consultas, [['DEST', 'ZPROG_EJEMPLO', undefined]]);
    assert.deepEqual(conDefecto.registro.abiertos[0][1], 'DEST');

    const explicito = falsas({ porDefecto: 'OTRO', resultados: [resultado('ZPROG_EJEMPLO')] });
    await llamar(explicito.deps, 'abrir_objeto', { nombre: 'ZPROG_EJEMPLO', sistema: 'DEST' });
    assert.equal(explicito.registro.consultas[0][0], 'DEST');

    const sinNinguno = falsas({ via: 'rfc' });
    for (const [nombre, args] of [
      ['abrir_objeto', { nombre: 'ZPROG_EJEMPLO' }],
      ['abrir_transaccion', { tcode: 'ZEJEMPLO' }],
    ] as const) {
      const fallo = await llamar(sinNinguno.deps, nombre, args);
      assert.equal(fallo.esError, true);
      assert.match(fallo.texto, /indica el sistema/);
    }
    assert.deepEqual(sinNinguno.registro.conectados, []);
    assert.deepEqual(sinNinguno.registro.consultas, []);
    assert.deepEqual(sinNinguno.registro.abiertos, []);
  });

  test('contexto_actual y editores_abiertos devuelven el JSON del contexto', async () => {
    const { deps } = falsas();
    const contexto = await llamar(deps, 'contexto_actual', {});
    assert.equal(contexto.texto, JSON.stringify(CONTEXTO, null, 1));
    const editores = await llamar(deps, 'editores_abiertos', {});
    assert.equal(editores.texto, JSON.stringify(CONTEXTO.editoresAbiertos, null, 1));
  });
});
