import { analizarUriAbap } from '../bridge/adt-uri';
import type { RolSistema } from '../config/navegador-config';
import { ESPERA_ATC_MS, pasadaVigente, respuestaDeResultado, respuestaEnCurso, type ResultadoAtc } from './atc-modelo';
import { ESQUEMAS } from './esquemas';
import {
  MSG_SEGMENTOS_RELATIVOS,
  argTexto,
  envolverConProteccion,
  resultadoError,
  resultadoJson,
  rutaDeUriTexto,
  tieneSegmentosRelativos,
} from './herramientas';
import type { HerramientaMcp, ResultadoHerramienta } from './mcp-modelo';
import {
  ESPERA_DECISION_MS,
  construirPropuesto,
  type CambioBuscar,
  type DatosPropuesta,
  type Decision,
  type EntradaPropuesta,
  type Propuesta,
} from './propuestas-modelo';
import { indicacionPorErrores, normalizarDiagnostico } from './verificacion-modelo';

export interface Diagnostico {
  severidad: 'error' | 'aviso' | 'info' | 'pista';
  /** Desde 1. */
  linea: number;
  /** Desde 1. */
  columna: number;
  mensaje: string;
  origen?: string;
}

export interface ResultadoVerificacion {
  diagnosticos: Diagnostico[];
  /** false si la oficial no publicó diagnósticos en el plazo: no equivale a "sin errores". */
  publicados: boolean;
}

export interface DependenciasEscritura {
  rolDe(destino: string): RolSistema | undefined;
  leerTexto(ruta: string): Promise<string | undefined>;
  /** Registra la propuesta y abre el diff en la ventana del usuario. */
  proponer(datos: DatosPropuesta): Promise<Propuesta>;
  esperarDecision(id: string, limiteMs: number): Promise<Decision>;
  verificar(uri: string): Promise<ResultadoVerificacion>;
  /** Lanza el ATC de la oficial sobre el archivo (sin cambiar el editor activo) y espera a que termine. */
  ejecutarAtc(uri: string): Promise<ResultadoAtc>;
  ejecutarUnitTests(uri: string): Promise<void>;
  /** Modal "El agente pide activar <objeto>": true si el usuario acepta. */
  confirmarActivacion(objeto: string): Promise<boolean>;
  activar(uri: string): Promise<void>;
  /** Muestra el archivo y abre la lista «Activate All» de la oficial: el usuario marca y confirma ahí. */
  activarTodo(uri: string): Promise<void>;
  /** Reloj de `ejecutar_atc`; por defecto `Date.now`. */
  ahora?(): number;
  /** Espera de `ejecutar_atc`; por defecto un temporizador. */
  esperar?(ms: number): Promise<void>;
}

export const ORDEN_ESCRITURA = [
  'proponer_cambio',
  'estado_propuesta',
  'verificar_sintaxis',
  'ejecutar_atc',
  'ejecutar_unit_tests',
  'activar',
] as const;

type NombreEscritura = (typeof ORDEN_ESCRITURA)[number];
type Ejecutor = (args: Record<string, unknown>) => Promise<ResultadoHerramienta>;

const DESCRIPCIONES: Record<NombreEscritura, string> = {
  proponer_cambio:
    'Úsala para cualquier cambio de código, siempre después de leer_programa y de contexto_actual. Abre un diff en VS Code y ' +
    'espera hasta 60 s a que el usuario pulse Aplicar o Rechazar. Da cambios (cada buscar debe aparecer exactamente una vez ' +
    'en el archivo; se aplican en orden) o textoCompleto (sustituye todo el archivo; úsalo solo cuando reescribas el archivo ' +
    'entero, por ejemplo un include recién creado con el asistente). Si ' +
    'responde pendiente, llama a estado_propuesta con el id. Nunca edites por otra vía. ' +
    'Da en porque el motivo del cambio en una o dos frases: queda en el diario del objeto cuando el usuario decide.',
  estado_propuesta:
    'Úsala cuando proponer_cambio respondió pendiente: espera hasta 60 s más a la decisión del usuario y devuelve aplicado, ' +
    'rechazado (con motivo) o pendiente.',
  verificar_sintaxis:
    'Úsala después de que un cambio quede aplicado: lanza la verificación de la extensión oficial sobre el archivo y devuelve ' +
    'los diagnósticos (línea y columna desde 1). Un diagnóstico con mensaje "Objeto(s) activado(s)" (origen abapActivation) en el ' +
    '.json de metadatos es el mensaje de éxito de la activación de la oficial, no un error: se devuelve como info.',
  ejecutar_atc:
    'Pasa el ATC (ABAP Test Cockpit) de la extensión oficial sobre el objeto, con la variante por defecto del sistema, y devuelve los hallazgos (errores, advertencias e informativos) con archivo y línea. Úsala al terminar el código, después de verificar_sintaxis sin errores. Si devuelve "en curso", vuelve a llamarla con la misma uri: recoge el resultado, no lanza otro ATC.',
  ejecutar_unit_tests:
    'Úsala solo si el usuario lo pide: lanza los ABAP Unit tests del objeto; el resultado se ve en el panel de pruebas de ' +
    'VS Code, no aquí.',
  activar:
    'Úsala únicamente cuando el usuario pida activar: Sextante le muestra una confirmación y, si acepta, activa con la ' +
    'extensión oficial. Solo con rol DEV. Para un programa con includes (o varios objetos inactivos) usa todo: true: ' +
    'activar archivo por archivo falla porque cada include depende de los demás.',
};

function esCambio(valor: unknown): valor is CambioBuscar {
  if (typeof valor !== 'object' || valor === null) return false;
  const candidato = valor as Record<string, unknown>;
  return typeof candidato.buscar === 'string' && typeof candidato.reemplazar === 'string';
}

function esListaDeCambios(valor: unknown): valor is CambioBuscar[] {
  return Array.isArray(valor) && valor.every(esCambio);
}

type Aprobacion = { ok: true; destino: string; objeto?: string; archivo?: string } | { ok: false; resultado: ResultadoHerramienta };

interface PasadaAtc {
  lanzado: number;
  fase: 'corriendo' | 'lista' | 'fallo';
  resultado?: ResultadoAtc;
  error?: unknown;
  /** Nunca rechaza: al terminar deja el resultado o el fallo en la propia pasada. */
  espera: Promise<void>;
}

export function crearCatalogoEscritura(deps: DependenciasEscritura): HerramientaMcp[] {
  /** Solo se escribe en DEV: un destino sin rol asignado, QAS o PRD se rechaza sin tocar nada. */
  const comprobarRol = (uri: string): Aprobacion => {
    const ruta = rutaDeUriTexto(uri);
    const analizada = analizarUriAbap({ scheme: 'abap', path: ruta });
    if (analizada === undefined) {
      return { ok: false, resultado: resultadoError('la uri no es de un objeto abap: del árbol de la oficial') };
    }
    // Antes del rol: con `..` el destino que se comprueba no sería el que acaba abriendo la oficial.
    if (tieneSegmentosRelativos(ruta)) {
      return { ok: false, resultado: resultadoError(MSG_SEGMENTOS_RELATIVOS) };
    }
    const rol = deps.rolDe(analizada.destino);
    if (rol !== 'DEV') {
      return {
        ok: false,
        resultado: resultadoError(
          `rechazado por rol: ${analizada.destino} tiene rol ${rol ?? 'sin asignar'}; en QAS, PRD o sin rol el agente solo analiza`,
        ),
      };
    }
    return { ok: true, destino: analizada.destino, objeto: analizada.objeto?.nombre, archivo: analizada.archivo };
  };

  const decisionComoResultado = (decision: Decision): ResultadoHerramienta => {
    if (decision.estado === 'desconocida') return resultadoError(decision.motivo ?? 'no hay ninguna propuesta con ese id');
    if (decision.estado === 'pendiente') {
      return resultadoJson({ ...decision, indicacion: 'el usuario aún no decidió; llama a estado_propuesta con este id' });
    }
    return resultadoJson(decision);
  };

  const proponerCambio: Ejecutor = async (args) => {
    const uri = argTexto(args, 'uri') ?? '';
    const aprobacion = comprobarRol(uri);
    if (!aprobacion.ok) return aprobacion.resultado;

    const cambios = args.cambios;
    const textoCompleto = argTexto(args, 'textoCompleto');
    if (cambios !== undefined && textoCompleto !== undefined) {
      return resultadoError('indica cambios (lista de buscar/reemplazar) o textoCompleto, pero no los dos');
    }
    let entrada: EntradaPropuesta;
    if (textoCompleto !== undefined) {
      entrada = { textoCompleto };
    } else if (esListaDeCambios(cambios)) {
      entrada = { cambios };
    } else {
      return resultadoError('indica cambios (lista de buscar/reemplazar) o textoCompleto');
    }

    const textoActual = await deps.leerTexto(rutaDeUriTexto(uri));
    if (textoActual === undefined) {
      return resultadoError(`No se pudo leer ${uri}: ábrelo antes con abrir_objeto o comprueba con contexto_actual que el sistema esté conectado`);
    }
    const construccion = construirPropuesto(textoActual, entrada);
    if (!construccion.ok) return resultadoError(construccion.motivo);

    const porque = argTexto(args, 'porque');
    const propuesta = await deps.proponer({
      uri,
      resumen: argTexto(args, 'resumen') ?? '',
      entrada,
      textoBase: textoActual,
      textoPropuesto: construccion.texto,
      ...(porque !== undefined ? { porque } : {}),
    });
    return decisionComoResultado(await deps.esperarDecision(propuesta.id, ESPERA_DECISION_MS));
  };

  const estadoPropuesta: Ejecutor = async (args) =>
    decisionComoResultado(await deps.esperarDecision(argTexto(args, 'id') ?? '', ESPERA_DECISION_MS));

  const verificarSintaxis: Ejecutor = async (args) => {
    const uri = argTexto(args, 'uri');
    if (uri === undefined || uri === '') return resultadoError('falta la uri del archivo a verificar');
    if (tieneSegmentosRelativos(rutaDeUriTexto(uri))) return resultadoError(MSG_SEGMENTOS_RELATIVOS);
    const verificado = await deps.verificar(uri);
    const resultado: ResultadoVerificacion = {
      ...verificado,
      diagnosticos: verificado.diagnosticos.map((d) => normalizarDiagnostico(d, uri)),
    };
    if (!resultado.publicados) {
      return resultadoJson({
        ...resultado,
        indicacion: 'la extensión oficial no publicó diagnósticos; pide al usuario que mire el panel Problemas',
      });
    }
    const indicacion = indicacionPorErrores(resultado.diagnosticos, uri);
    return resultadoJson(indicacion === undefined ? resultado : { ...resultado, indicacion });
  };

  /** Pasadas de ATC por uri: una segunda llamada con la misma uri se une a la que sigue en marcha. */
  const pasadasAtc = new Map<string, PasadaAtc>();
  const ahora = (): number => (deps.ahora ?? Date.now)();
  const esperaCancelable = (ms: number): { promesa: Promise<void>; cancelar(): void } => {
    if (deps.esperar !== undefined) return { promesa: deps.esperar(ms), cancelar: () => undefined };
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const promesa = new Promise<void>((resolver) => {
      temporizador = setTimeout(resolver, ms);
    });
    return { promesa, cancelar: () => clearTimeout(temporizador) };
  };

  const lanzarPasadaAtc = (uri: string): PasadaAtc => {
    const pasada: PasadaAtc = { lanzado: ahora(), fase: 'corriendo', espera: Promise.resolve() };
    pasada.espera = deps.ejecutarAtc(uri).then(
      (resultado) => {
        pasada.fase = 'lista';
        pasada.resultado = resultado;
      },
      (error: unknown) => {
        pasada.fase = 'fallo';
        pasada.error = error;
      },
    );
    return pasada;
  };

  const ejecutarAtc: Ejecutor = async (args) => {
    const uri = argTexto(args, 'uri');
    if (uri === undefined || uri === '') return resultadoError('falta la uri del archivo sobre el que pasar el ATC');
    const ruta = rutaDeUriTexto(uri);
    if (tieneSegmentosRelativos(ruta)) return resultadoError(MSG_SEGMENTOS_RELATIVOS);

    let pasada = pasadasAtc.get(ruta);
    // Una pasada en marcha nunca se descarta: relanzarla dejaría dos ATC activos y el aviso tardío del viejo ensuciaría el nuevo.
    if (pasada !== undefined && pasada.fase !== 'corriendo' && !pasadaVigente(pasada.lanzado, ahora())) {
      pasadasAtc.delete(ruta);
      pasada = undefined;
    }
    if (pasada === undefined) {
      pasada = lanzarPasadaAtc(uri);
      pasadasAtc.set(ruta, pasada);
    }
    if (pasada.fase === 'corriendo') {
      const limite = esperaCancelable(ESPERA_ATC_MS);
      try {
        await Promise.race([pasada.espera, limite.promesa]);
      } finally {
        limite.cancelar();
      }
    }
    if (pasada.fase === 'corriendo') return resultadoJson(respuestaEnCurso());

    if (pasadasAtc.get(ruta) === pasada) pasadasAtc.delete(ruta);
    if (pasada.fase === 'fallo') throw pasada.error;
    return resultadoJson(respuestaDeResultado(pasada.resultado ?? { hallazgos: [], huboSenal: false }));
  };

  const ejecutarUnitTests: Ejecutor = async (args) => {
    const uri = argTexto(args, 'uri') ?? '';
    const aprobacion = comprobarRol(uri);
    if (!aprobacion.ok) return aprobacion.resultado;
    await deps.ejecutarUnitTests(uri);
    return resultadoJson({
      estado: 'lanzado',
      indicacion: 'el resultado está en el panel de pruebas de VS Code; pídeselo al usuario',
    });
  };

  const activar: Ejecutor = async (args) => {
    const uri = argTexto(args, 'uri') ?? '';
    const aprobacion = comprobarRol(uri);
    if (!aprobacion.ok) return aprobacion.resultado;
    if (args.todo === true) {
      // Sin modal propio: la lista «Activate All» de la oficial es la confirmación.
      await deps.activarTodo(uri);
      return resultadoJson({
        estado: 'lanzado',
        indicacion:
          'el usuario elige en la lista de la extensión oficial qué objetos inactivos activar; cuando confirme, llama a ' +
          'verificar_sintaxis sobre el programa principal',
      });
    }
    const objeto = aprobacion.objeto ?? aprobacion.archivo ?? uri;
    if (!(await deps.confirmarActivacion(objeto))) return resultadoJson({ estado: 'cancelado' });
    await deps.activar(uri);
    return resultadoJson({
      estado: 'activado',
      indicacion: 'la oficial muestra el resultado; si hay errores aparecen en Problemas',
    });
  };

  const ejecutores: Record<NombreEscritura, Ejecutor> = {
    proponer_cambio: proponerCambio,
    estado_propuesta: estadoPropuesta,
    verificar_sintaxis: verificarSintaxis,
    ejecutar_atc: ejecutarAtc,
    ejecutar_unit_tests: ejecutarUnitTests,
    activar,
  };

  return ORDEN_ESCRITURA.map((nombre) => ({
    nombre,
    descripcion: DESCRIPCIONES[nombre],
    inputSchema: ESQUEMAS[nombre],
    ejecutar: envolverConProteccion(nombre, ejecutores[nombre]),
  }));
}
