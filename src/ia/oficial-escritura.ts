import * as vscode from 'vscode';
import { ejecutarComandoOficial } from '../bridge/extension-oficial';
import { uriDeRuta } from '../bridge/repotree-oficial';
import { log } from '../log';
import { nombreDeError } from '../util/errores';
import type { HallazgoAtc, PrioridadAtc, ResultadoAtc } from './atc-modelo';
import { ErrorHerramienta, MSG_SEGMENTOS_RELATIVOS, rutaDeUriTexto, tieneSegmentosRelativos } from './herramientas';
import type { DependenciasEscritura, Diagnostico, ResultadoVerificacion } from './herramientas-escritura';

export const ESPERA_DIAGNOSTICOS_MS = 3000;
/** Margen para que un fallo de arranque de «Activate All» llegue al agente; la lista no se espera. */
export const ESPERA_LANZAMIENTO_MS = 1500;

const COMANDO_VERIFICAR = 'adt-vscode.checkObject';
/** Con una `vscode.Uri` como argumento corre sobre ese archivo (bundle de la oficial 1.2.0). */
const COMANDO_ATC = 'adt-vscode.runAtcOnObject';
/** `source` de los diagnósticos de la colección «atc» de la oficial (bundle 1.2.0). */
const ORIGEN_ATC = 'ATC';
const COMANDO_UNIT_TESTS = 'adt-vscode.runAbapUnitTests';
const COMANDO_ACTIVAR = 'adt-vscode.activate';
/** Sin argumentos en la oficial 1.2.0: abre su lista múltiple de objetos inactivos del destino del editor activo. */
const COMANDO_ACTIVAR_TODO = 'adt-vscode.activateAll';
const ACCION_ACTIVAR = 'Activar';
const MSG_SIN_EDITOR_ACTIVO = 'no se pudo poner el archivo en el editor activo; pide al usuario que lo abra y vuelve a llamar';

const SEVERIDADES: Record<vscode.DiagnosticSeverity, Diagnostico['severidad']> = {
  [vscode.DiagnosticSeverity.Error]: 'error',
  [vscode.DiagnosticSeverity.Warning]: 'aviso',
  [vscode.DiagnosticSeverity.Information]: 'info',
  [vscode.DiagnosticSeverity.Hint]: 'pista',
};

/**
 * Espera a `lanzamiento` como mucho `ms`: si falla dentro del margen, el fallo se propaga; si sigue en curso (la lista
 * de la oficial abierta), se devuelve el control y un fallo posterior solo se registra.
 */
export async function lanzarSinEsperar(lanzamiento: Promise<unknown>, ms: number): Promise<void> {
  let devuelto = false;
  lanzamiento.catch((err: unknown) => {
    if (devuelto) {
      log.warn(`IA: el comando lanzado falló después de devolver el control (${nombreDeError(err)})`);
    }
  });
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      lanzamiento,
      new Promise<void>((resolver) => {
        temporizador = setTimeout(resolver, ms);
      }),
    ]);
  } finally {
    clearTimeout(temporizador);
    devuelto = true;
  }
}

function diagnosticoDe(d: vscode.Diagnostic): Diagnostico {
  const diagnostico: Diagnostico = {
    severidad: SEVERIDADES[d.severity],
    linea: d.range.start.line + 1,
    columna: d.range.start.character + 1,
    mensaje: d.message,
  };
  return d.source === undefined ? diagnostico : { ...diagnostico, origen: d.source };
}

/**
 * Los comandos de la oficial actúan sobre el editor activo: se pone el archivo como editor activo y se comprueba, para
 * que ningún comando de la oficial acabe sobre otro objeto (un diff de propuesta, otro grupo).
 */
function normalizarUri(uri: string): vscode.Uri {
  const ruta = rutaDeUriTexto(uri);
  // Segunda defensa tras las herramientas: un `..` no debe llevar los comandos de la oficial a otro destino.
  if (tieneSegmentosRelativos(ruta)) {
    throw new ErrorHerramienta(MSG_SEGMENTOS_RELATIVOS);
  }
  return uriDeRuta(ruta);
}

async function mostrar(uri: string): Promise<vscode.Uri> {
  const normalizada = normalizarUri(uri);
  await vscode.window.showTextDocument(normalizada, { preserveFocus: false });
  if (vscode.window.activeTextEditor?.document.uri.toString() !== normalizada.toString()) {
    throw new ErrorHerramienta(MSG_SIN_EDITOR_ACTIVO);
  }
  return normalizada;
}

/** true si llega un aviso de diagnósticos de `uri` antes de `ms` desde que se llama a `esperarHasta`. */
function escucharDiagnosticos(uri: vscode.Uri): { esperarHasta(ms: number): Promise<boolean>; dispose(): void } {
  const objetivo = uri.toString();
  let llegaron = false;
  let avisar: (() => void) | undefined;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const suscripcion = vscode.languages.onDidChangeDiagnostics((e) => {
    if (e.uris.some((u) => u.toString() === objetivo)) {
      llegaron = true;
      avisar?.();
    }
  });
  return {
    esperarHasta: (ms) =>
      new Promise<boolean>((resolver) => {
        if (llegaron) {
          resolver(true);
          return;
        }
        avisar = () => resolver(true);
        temporizador = setTimeout(() => resolver(false), ms);
      }),
    dispose: () => {
      clearTimeout(temporizador);
      suscripcion.dispose();
    },
  };
}

const PRIORIDADES_ATC: Record<vscode.DiagnosticSeverity, PrioridadAtc> = {
  [vscode.DiagnosticSeverity.Error]: 'error',
  [vscode.DiagnosticSeverity.Warning]: 'aviso',
  [vscode.DiagnosticSeverity.Information]: 'info',
  [vscode.DiagnosticSeverity.Hint]: 'info',
};

function codigoDe(codigo: vscode.Diagnostic['code']): string | undefined {
  if (codigo === undefined) return undefined;
  return String(typeof codigo === 'object' ? codigo.value : codigo);
}

/** Los hallazgos del ATC de la oficial: diagnósticos con `source` «ATC» de cualquier uri. */
function hallazgosAtcActuales(): HallazgoAtc[] {
  const hallazgos: HallazgoAtc[] = [];
  for (const [uri, diagnosticos] of vscode.languages.getDiagnostics()) {
    for (const d of diagnosticos) {
      if (d.source !== ORIGEN_ATC) continue;
      const codigo = codigoDe(d.code);
      hallazgos.push({
        uri: uri.toString(),
        linea: d.range.start.line + 1,
        prioridad: PRIORIDADES_ATC[d.severity],
        mensaje: d.message,
        ...(codigo !== undefined ? { codigo } : {}),
      });
    }
  }
  return hallazgos;
}

/**
 * Pasa el ATC de la oficial sobre el archivo sin tocar el editor activo (la `vscode.Uri` va como argumento del comando,
 * que resuelve cuando el ATC termina y publica). `huboSenal`: la oficial cambió los diagnósticos de alguna uri con ATC.
 */
async function ejecutarAtc(uri: string): Promise<ResultadoAtc> {
  const objetivo = normalizarUri(uri);
  const urisAntes = new Set(hallazgosAtcActuales().map((h) => h.uri));
  const avisadas = new Set<string>();
  const suscripcion = vscode.languages.onDidChangeDiagnostics((e) => {
    for (const u of e.uris) avisadas.add(u.toString());
  });
  try {
    // NO VERIFICADO: si el ATC evalúa la versión activa o la inactiva del objeto.
    await ejecutarComandoOficial(COMANDO_ATC, objetivo);
  } finally {
    suscripcion.dispose();
  }
  const hallazgos = hallazgosAtcActuales();
  const urisDespues = new Set(hallazgos.map((h) => h.uri));
  const huboSenal = [...avisadas].some((u) => urisAntes.has(u) || urisDespues.has(u));
  log.info(`IA: ATC terminado (${hallazgos.length} hallazgos)`);
  return { hallazgos, huboSenal };
}

/** Verificar, ATC, unit tests y activar con los comandos de la oficial sobre el archivo que pide el agente. */
export function dependenciasOficialEscritura(): Pick<
  DependenciasEscritura,
  'verificar' | 'ejecutarAtc' | 'ejecutarUnitTests' | 'confirmarActivacion' | 'activar' | 'activarTodo'
> {
  return {
    ejecutarAtc,
    // NO VERIFICADO: que `adt-vscode.checkObject` publique sus resultados como diagnósticos del documento.
    verificar: async (uri): Promise<ResultadoVerificacion> => {
      const parseada = await mostrar(uri);
      // Se escucha antes de lanzar la verificación: la oficial puede publicar antes de resolver el comando.
      const escucha = escucharDiagnosticos(parseada);
      try {
        await ejecutarComandoOficial(COMANDO_VERIFICAR);
        const publicados = await escucha.esperarHasta(ESPERA_DIAGNOSTICOS_MS);
        return { diagnosticos: vscode.languages.getDiagnostics(parseada).map(diagnosticoDe), publicados };
      } finally {
        escucha.dispose();
      }
    },
    // NO VERIFICADO: que `runAbapUnitTests` y `activate` actúen sobre el editor activo.
    ejecutarUnitTests: async (uri) => {
      await mostrar(uri);
      await ejecutarComandoOficial(COMANDO_UNIT_TESTS);
    },
    confirmarActivacion: async (objeto) =>
      (await vscode.window.showWarningMessage(`El agente pide activar ${objeto}.`, { modal: true }, ACCION_ACTIVAR)) === ACCION_ACTIVAR,
    activar: async (uri) => {
      await mostrar(uri);
      await ejecutarComandoOficial(COMANDO_ACTIVAR);
    },
    // Se muestra antes el archivo para que la oficial liste los inactivos de su destino.
    // NO VERIFICADO: que la lista tome el destino del editor activo y si el comando resuelve antes o después de que el
    // usuario confirme la lista. Por eso no se espera al comando: solo el margen que deja ver un fallo de arranque.
    activarTodo: async (uri) => {
      await mostrar(uri);
      await lanzarSinEsperar(ejecutarComandoOficial(COMANDO_ACTIVAR_TODO), ESPERA_LANZAMIENTO_MS);
    },
  };
}
