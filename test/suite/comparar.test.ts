import * as assert from 'assert';
import * as vscode from 'vscode';
import type { ResultadoSesion } from '../../src/adt/sesiones';
import type { ConexionAdt } from '../../src/adt/conexion-adt';
import type { Destino } from '../../src/config/destinos';
import type { RolSistema } from '../../src/config/navegador-config';
import {
  compararConOtrosSistemas,
  configurarSistemasAComparar,
  documentoComparableDe,
  type DependenciasCompararSistemas,
  type DocumentoComparable,
} from '../../src/objeto/comparar-sistemas';
import {
  MSG_SIN_OBJETO,
  MSG_SIN_OTRO_SISTEMA,
  type CandidatoHermano,
  type ResultadoSistema,
} from '../../src/objeto/comparar-sistemas-modelo';
import { analizarUriFuente } from '../../src/objeto/documento-fuente-modelo';
import type { ResultadoFuente } from '../../src/objeto/servicio';

function uriAbap(destino: string, tipoCarpeta: string, nombre: string, archivo: string): vscode.Uri {
  return vscode.Uri.parse(
    `abap:/repotree-v1/${destino}/System%20Library/ZPAQ1/Source%20Library/${tipoCarpeta}/${nombre}/${archivo}`,
  );
}

function claseDoc(archivo = 'zcl_ejemplo.clas.abap', archivos = ['zcl_ejemplo.clas.abap']): DocumentoComparable {
  return {
    uri: uriAbap('DEV-X', 'Classes', 'ZCL_EJEMPLO', archivo),
    destino: 'DEV-X',
    tipo: 'clase',
    nombre: 'ZCL_EJEMPLO',
    archivos,
    archivo,
  };
}

function tablaDoc(): DocumentoComparable {
  return {
    uri: vscode.Uri.parse('abap:/repotree-v1/DEV-X/System%20Library/ZPAQ1/Dictionary/Tables/ZTAB_EJEMPLO/ztab_ejemplo.tabl.ddic'),
    destino: 'DEV-X',
    tipo: 'tabla',
    nombre: 'ZTAB_EJEMPLO',
    archivos: ['ztab_ejemplo.tabl.ddic'],
    archivo: 'ztab_ejemplo.tabl.ddic',
  };
}

function destino(id: string): Destino {
  return { id, protocolo: 'rfc', ssoActivado: false };
}

const SESION_OK: ResultadoSesion = { estado: 'ok', conexion: {} as ConexionAdt, via: 'rfc' };

interface Opciones {
  documento?: DocumentoComparable | undefined;
  destinos?: string[];
  guardados?: string[];
  /** destino → ruta (o '*') → resultado. */
  fuentes?: Record<string, ResultadoFuente | Record<string, ResultadoFuente>>;
  local?: string;
  archivosDe?: (carpeta: vscode.Uri) => Promise<string[]>;
  sesiones?: Record<string, ResultadoSesion>;
  elegirHermanos?: string[] | undefined;
  elegirResultado?: (r: ResultadoSistema[]) => { destino: string } | 'cambiar' | undefined;
  /** Pulsa "Cambiar sistemas…" en el aviso del resultado único. */
  pulsarCambiar?: boolean;
}

interface Registro {
  diffs: Array<{ izquierda: vscode.Uri; derecha: vscode.Uri; titulo: string }>;
  avisos: string[];
  guardados: Array<[string, string[]]>;
  fuentesPedidas: Array<[string, string]>;
  leidosLocal: vscode.Uri[];
  carpetasListadas: vscode.Uri[];
  resultadosVistos: ResultadoSistema[][];
  candidatosVistos: CandidatoHermano[][];
  ofertasCambiar: string[];
  cambioPendiente?: Promise<void>;
}

function montar(opciones: Opciones): { deps: DependenciasCompararSistemas; registro: Registro } {
  const registro: Registro = {
    diffs: [], avisos: [], guardados: [], fuentesPedidas: [], leidosLocal: [], carpetasListadas: [], resultadosVistos: [], candidatosVistos: [], ofertasCambiar: [],
  };
  const hasOwn = Object.prototype.hasOwnProperty;
  const deps: DependenciasCompararSistemas = {
    documento: () => (hasOwn.call(opciones, 'documento') ? opciones.documento : claseDoc()),
    destinos: () => (opciones.destinos ?? []).map(destino),
    rolDe: (): RolSistema | undefined => undefined,
    compararConDe: () => opciones.guardados,
    guardarCompararCon: async (id, ids) => {
      registro.guardados.push([id, ids]);
    },
    sesionSilenciosa: async (id) => opciones.sesiones?.[id] ?? SESION_OK,
    sesion: async (id) => opciones.sesiones?.[id] ?? SESION_OK,
    motivoSinRfc: (id) => (opciones.sesiones?.[id]?.estado === 'sinRest' ? 'el destino usa SSO' : undefined),
    servicio: {
      fuente: async (dest, ruta) => {
        registro.fuentesPedidas.push([dest, ruta]);
        const porDestino = opciones.fuentes?.[dest];
        if (porDestino === undefined) {
          return { estado: 'noExiste' };
        }
        if (esResultado(porDestino)) {
          return porDestino;
        }
        return porDestino[ruta] ?? porDestino['*'] ?? { estado: 'noExiste' };
      },
    },
    archivosDe: async (carpeta) => {
      registro.carpetasListadas.push(carpeta);
      return opciones.archivosDe ? opciones.archivosDe(carpeta) : [];
    },
    leerLocal: async (uri) => {
      registro.leidosLocal.push(uri);
      return opciones.local ?? 'REPORT x.';
    },
    elegirHermanos: async (candidatos) => {
      registro.candidatosVistos.push(candidatos);
      return opciones.elegirHermanos;
    },
    elegirResultado: async (resultados) => {
      registro.resultadosVistos.push(resultados);
      return opciones.elegirResultado?.(resultados);
    },
    abrirDiff: async (izquierda, derecha, titulo) => {
      registro.diffs.push({ izquierda, derecha, titulo });
    },
    conProgreso: (_titulo, tarea) => tarea(),
    avisar: (mensaje) => {
      registro.avisos.push(mensaje);
    },
    ofrecerCambiar: (mensaje, cambiar) => {
      registro.avisos.push(mensaje);
      registro.ofertasCambiar.push(mensaje);
      if (opciones.pulsarCambiar === true) {
        registro.cambioPendiente = cambiar();
      }
    },
    yaPropuestos: new Set<string>(),
  };
  return { deps, registro };
}

function esResultado(valor: ResultadoFuente | Record<string, ResultadoFuente>): valor is ResultadoFuente {
  return typeof valor.estado === 'string';
}

const OK = (texto: string): ResultadoFuente => ({ estado: 'ok', texto });

suite('Comparar con otros sistemas', () => {
  test('sin documento avisa y devuelve sinObjeto', async () => {
    const { deps, registro } = montar({ documento: undefined });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'sinObjeto');
    assert.deepStrictEqual(registro.avisos, [MSG_SIN_OBJETO]);
    assert.strictEqual(registro.diffs.length, 0);
  });

  test('sin otros destinos avisa y devuelve sinOtroSistema', async () => {
    const { deps, registro } = montar({ destinos: ['DEV-X'] });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'sinOtroSistema');
    assert.deepStrictEqual(registro.avisos, [MSG_SIN_OTRO_SISTEMA]);
  });

  test('cancelar la elección de hermanos no guarda nada', async () => {
    const { deps, registro } = montar({ destinos: ['DEV-X', 'QAS-X', 'PRD-X'], elegirHermanos: undefined });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'cancelado');
    assert.strictEqual(registro.candidatosVistos.length, 1);
    assert.deepStrictEqual(registro.guardados, []);
    assert.strictEqual(registro.diffs.length, 0);
  });

  test('un solo hermano igual: diff directo con el título, hermano a la izquierda y se guarda', async () => {
    const { deps, registro } = montar({
      destinos: ['DEV-X', 'QAS-X'],
      local: 'CLASS zcl_ejemplo.\r\nENDCLASS.',
      fuentes: { 'QAS-X': OK('CLASS zcl_ejemplo.\nENDCLASS.\n') },
    });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'abierto');
    assert.strictEqual(registro.diffs.length, 1);
    assert.strictEqual(registro.diffs[0].titulo, 'ZCL_EJEMPLO: QAS-X ↔ DEV-X');
    assert.strictEqual(analizarUriFuente(registro.diffs[0].izquierda)?.destino, 'QAS-X');
    assert.strictEqual(registro.diffs[0].derecha.scheme, 'abap');
    assert.deepStrictEqual(registro.guardados, [['DEV-X', ['QAS-X']]]);
    assert.deepStrictEqual(registro.avisos, ['QAS-X: igual']);
    assert.strictEqual(registro.candidatosVistos.length, 0);
  });

  test('un hermano falla, los otros se muestran: sin conexión, no existe y distinto', async () => {
    const { deps, registro } = montar({
      destinos: ['DEV-X', 'QAS-X', 'PRD-X', 'TST-X'],
      guardados: ['QAS-X', 'PRD-X', 'TST-X'],
      sesiones: { 'QAS-X': { estado: 'sinRest', motivo: 'sso' } },
      fuentes: { 'PRD-X': { estado: 'noExiste' }, 'TST-X': OK('otro texto\nmás') },
      elegirResultado: (r) => ({ destino: r[r.length - 1].destino }),
    });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'abierto');
    const vistos = registro.resultadosVistos[0];
    const estados = Object.fromEntries(vistos.map((r) => [r.destino, r.estado]));
    assert.deepStrictEqual(estados, { 'QAS-X': 'sinConexion', 'PRD-X': 'noExiste', 'TST-X': 'distinto' });
    assert.strictEqual(vistos.find((r) => r.destino === 'QAS-X')?.motivo, 'el destino usa SSO');
    assert.strictEqual(registro.diffs.length, 1);
    assert.strictEqual(analizarUriFuente(registro.diffs[0].izquierda)?.destino, 'TST-X');
    assert.deepStrictEqual(registro.guardados, []);
  });

  test('elegir un sistema sin conexión pide la sesión y repite la comparación', async () => {
    let sesionPedida = 0;
    const { deps, registro } = montar({
      destinos: ['DEV-X', 'QAS-X', 'PRD-X'],
      guardados: ['QAS-X', 'PRD-X'],
      fuentes: { 'QAS-X': OK('REPORT x.'), 'PRD-X': OK('REPORT x.') },
    });
    deps.sesionSilenciosa = async (id) => (id === 'PRD-X' && sesionPedida < 2 ? { estado: 'sinContrasena' } : SESION_OK);
    deps.sesion = async (id) => {
      if (id !== 'PRD-X') {
        return SESION_OK;
      }
      sesionPedida++;
      return sesionPedida === 1 ? { estado: 'noAutorizado' } : SESION_OK;
    };
    let ronda = 0;
    deps.elegirResultado = async (r) => {
      registro.resultadosVistos.push(r);
      ronda++;
      return ronda === 1 ? { destino: 'PRD-X' } : { destino: 'PRD-X' };
    };
    assert.strictEqual(await compararConOtrosSistemas(deps), 'abierto');
    assert.strictEqual(registro.resultadosVistos.length, 2);
    assert.strictEqual(registro.resultadosVistos[0].find((r) => r.destino === 'PRD-X')?.estado, 'sinConexion');
    assert.strictEqual(sesionPedida, 2);
    assert.strictEqual(registro.resultadosVistos[1].find((r) => r.destino === 'PRD-X')?.estado, 'igual');
    assert.strictEqual(analizarUriFuente(registro.diffs[0].izquierda)?.destino, 'PRD-X');
  });

  test('clase con implementations distinto y include abierto main: el diff es de implementations', async () => {
    const archivos = ['zcl_ejemplo.clas.abap', 'zcl_ejemplo.clas.implementations.abap'];
    const { deps, registro } = montar({
      documento: claseDoc('zcl_ejemplo.clas.abap', archivos),
      destinos: ['DEV-X', 'QAS-X'],
      guardados: ['QAS-X'],
      local: 'igual',
      fuentes: {
        'QAS-X': {
          '/sap/bc/adt/oo/classes/zcl_ejemplo/source/main': OK('igual'),
          '/sap/bc/adt/oo/classes/zcl_ejemplo/includes/implementations': OK('distinto\notro'),
        },
      },
    });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'abierto');
    assert.strictEqual(registro.diffs.length, 1);
    assert.ok(registro.diffs[0].titulo.startsWith('ZCL_EJEMPLO · Implementaciones locales: QAS-X'), registro.diffs[0].titulo);
    assert.ok(registro.diffs[0].derecha.path.endsWith('zcl_ejemplo.clas.implementations.abap'));
    assert.strictEqual(registro.leidosLocal.length, 2);
  });

  test('editor de otro objeto: se lista la carpeta y se compara la clase entera', async () => {
    const doc = { ...claseDoc(), nombre: 'ZCL_OTRA', uri: uriAbap('DEV-X', 'Classes', 'ZCL_OTRA', 'zcl_otra.clas.abap'), archivo: 'zcl_otra.clas.abap', archivos: ['zcl_otra.clas.abap'], archivosPendientes: true };
    const { deps, registro } = montar({
      documento: doc,
      destinos: ['DEV-X', 'QAS-X'],
      guardados: ['QAS-X'],
      archivosDe: async () => ['zcl_otra.clas.abap', 'zcl_otra.clas.macros.abap'],
      local: 'igual',
      fuentes: { 'QAS-X': OK('igual') },
    });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'abierto');
    assert.strictEqual(registro.carpetasListadas.length, 1);
    assert.ok(registro.carpetasListadas[0].path.endsWith('/Classes/ZCL_OTRA'), registro.carpetasListadas[0].path);
    assert.strictEqual(registro.leidosLocal.length, 2);
    assert.ok(!registro.avisos.some((a) => a.includes('solo este módulo')));
  });

  test('editor de otro objeto y el listado falla: una pieza y soloArchivo', async () => {
    const doc = { ...claseDoc(), nombre: 'ZCL_OTRA', uri: uriAbap('DEV-X', 'Classes', 'ZCL_OTRA', 'zcl_otra.clas.abap'), archivo: 'zcl_otra.clas.abap', archivos: ['zcl_otra.clas.abap'], archivosPendientes: true };
    const { deps, registro } = montar({
      documento: doc,
      destinos: ['DEV-X', 'QAS-X'],
      guardados: ['QAS-X'],
      archivosDe: async () => {
        throw new Error('sin acceso');
      },
      local: 'igual',
      fuentes: { 'QAS-X': OK('igual') },
    });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'abierto');
    assert.strictEqual(registro.leidosLocal.length, 1);
    assert.deepStrictEqual(registro.avisos, ['QAS-X: igual · solo este módulo']);
  });

  test('una sesión que lanza no tumba la comparación de los demás', async () => {
    const { deps, registro } = montar({
      destinos: ['DEV-X', 'QAS-X', 'PRD-X'],
      guardados: ['QAS-X', 'PRD-X'],
      fuentes: { 'PRD-X': OK('REPORT x.') },
      elegirResultado: () => undefined,
    });
    deps.sesionSilenciosa = async (id) => {
      if (id === 'QAS-X') {
        throw new TypeError('boom');
      }
      return SESION_OK;
    };
    await compararConOtrosSistemas(deps);
    const estados = Object.fromEntries(registro.resultadosVistos[0].map((r) => [r.destino, r.estado]));
    assert.deepStrictEqual(estados, { 'QAS-X': 'sinConexion', 'PRD-X': 'igual' });
    assert.strictEqual(registro.resultadosVistos[0].find((r) => r.destino === 'QAS-X')?.motivo, 'TypeError');
  });

  test('documento de diccionario: no lee local y pide la fuente también al destino actual', async () => {
    const { deps, registro } = montar({
      documento: tablaDoc(),
      destinos: ['DEV-X', 'QAS-X'],
      fuentes: { 'DEV-X': OK('define table a { x : abap.char(1); }'), 'QAS-X': OK('define table a { y : abap.char(1); }') },
    });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'abierto');
    assert.strictEqual(registro.leidosLocal.length, 0);
    assert.ok(registro.fuentesPedidas.some(([d]) => d === 'DEV-X'));
    assert.ok(registro.fuentesPedidas.some(([d]) => d === 'QAS-X'));
    assert.strictEqual(analizarUriFuente(registro.diffs[0].derecha)?.destino, 'DEV-X');
    assert.strictEqual(analizarUriFuente(registro.diffs[0].izquierda)?.destino, 'QAS-X');
  });

  test('resultado único: el aviso ofrece "Cambiar sistemas…" y guarda la nueva selección con los guardados preseleccionados', async () => {
    const { deps, registro } = montar({
      destinos: ['DEV-X', 'QAS-X', 'OTRO-Y'],
      guardados: ['QAS-X'],
      local: 'igual',
      fuentes: { 'QAS-X': OK('igual') },
      pulsarCambiar: true,
      elegirHermanos: ['QAS-X', 'OTRO-Y'],
    });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'abierto');
    assert.strictEqual(registro.diffs.length, 1);
    assert.deepStrictEqual(registro.ofertasCambiar, ['QAS-X: igual']);
    await registro.cambioPendiente;
    assert.deepStrictEqual(
      registro.candidatosVistos[0].map((c) => [c.destino.id, c.propuesto]),
      [['QAS-X', true], ['OTRO-Y', false]],
    );
    assert.deepStrictEqual(registro.guardados, [['DEV-X', ['QAS-X', 'OTRO-Y']]]);
  });

  test('un hermano guardado y otro nuevo de la familia: se propone una vez con los guardados preseleccionados', async () => {
    const { deps, registro } = montar({
      destinos: ['DEV-X', 'QAS-X', 'PRD-X'],
      guardados: ['QAS-X'],
      local: 'igual',
      fuentes: { 'QAS-X': OK('igual'), 'PRD-X': OK('igual') },
      elegirHermanos: ['QAS-X', 'PRD-X'],
      elegirResultado: () => undefined,
    });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'resumen');
    assert.strictEqual(registro.candidatosVistos.length, 1);
    assert.deepStrictEqual(
      registro.candidatosVistos[0].map((c) => [c.destino.id, c.propuesto]),
      [['QAS-X', true], ['PRD-X', false]],
    );
    assert.deepStrictEqual(registro.guardados, [['DEV-X', ['QAS-X', 'PRD-X']]]);
    assert.deepStrictEqual(registro.resultadosVistos[0].map((r) => r.destino).sort(), ['PRD-X', 'QAS-X']);
    // En la misma sesión no se vuelve a proponer.
    await compararConOtrosSistemas(deps);
    assert.strictEqual(registro.candidatosVistos.length, 1);
  });

  test('cancelar la propuesta del candidato nuevo compara con los guardados y no guarda', async () => {
    const { deps, registro } = montar({
      destinos: ['DEV-X', 'QAS-X', 'PRD-X'],
      guardados: ['QAS-X'],
      local: 'igual',
      fuentes: { 'QAS-X': OK('igual') },
      elegirHermanos: undefined,
    });
    assert.strictEqual(await compararConOtrosSistemas(deps), 'abierto');
    assert.strictEqual(registro.candidatosVistos.length, 1);
    assert.deepStrictEqual(registro.guardados, []);
    assert.strictEqual(analizarUriFuente(registro.diffs[0].izquierda)?.destino, 'QAS-X');
  });

  test('configurar los sistemas a comparar: QuickPick con los guardados preseleccionados y guarda', async () => {
    const { deps, registro } = montar({ destinos: ['DEV-X', 'QAS-X', 'PRD-X'], guardados: ['QAS-X'], elegirHermanos: ['PRD-X'] });
    assert.strictEqual(await configurarSistemasAComparar(deps), 'guardado');
    assert.deepStrictEqual(
      registro.candidatosVistos[0].map((c) => [c.destino.id, c.propuesto]),
      [['QAS-X', true], ['PRD-X', false]],
    );
    assert.deepStrictEqual(registro.guardados, [['DEV-X', ['PRD-X']]]);
    assert.strictEqual(registro.diffs.length, 0);
  });

  test('configurar: sin objeto, sin otros sistemas o cancelado no guarda', async () => {
    const sinObjeto = montar({ documento: undefined });
    assert.strictEqual(await configurarSistemasAComparar(sinObjeto.deps), 'sinObjeto');
    assert.deepStrictEqual(sinObjeto.registro.avisos, [MSG_SIN_OBJETO]);
    const solo = montar({ destinos: ['DEV-X'] });
    assert.strictEqual(await configurarSistemasAComparar(solo.deps), 'sinOtroSistema');
    assert.deepStrictEqual(solo.registro.avisos, [MSG_SIN_OTRO_SISTEMA]);
    const cancelado = montar({ destinos: ['DEV-X', 'QAS-X'], elegirHermanos: undefined });
    assert.strictEqual(await configurarSistemasAComparar(cancelado.deps), 'cancelado');
    assert.deepStrictEqual(cancelado.registro.guardados, []);
  });

  test('documentoComparableDe: el editor abap: de código manda; si no, el objeto de la vista', () => {
    const editor = uriAbap('DEV-X', 'Classes', 'ZCL_EJEMPLO', 'zcl_ejemplo.clas.abap');
    const doc = documentoComparableDe(editor, undefined);
    assert.strictEqual(doc?.tipo, 'clase');
    assert.strictEqual(doc?.destino, 'DEV-X');
    assert.strictEqual(doc?.archivo, 'zcl_ejemplo.clas.abap');
    assert.strictEqual(documentoComparableDe(vscode.Uri.parse('file:///x.txt'), undefined), undefined);
  });
});
