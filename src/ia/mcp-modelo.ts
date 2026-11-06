import {
  CODIGOS,
  esPeticion,
  respuestaError,
  respuestaOk,
  type MensajeJsonRpc,
  type RespuestaJsonRpc,
} from './jsonrpc-modelo';
import { validarArgs, type EsquemaEntrada } from './esquemas';

export const VERSIONES_SOPORTADAS = ['2025-03-26', '2025-06-18'] as const;
export const VERSION_POR_DEFECTO = '2025-03-26';
export const NOMBRE_SERVIDOR = 'sextante';
const MAX_RESUMEN = 120;

export type ResultadoHerramienta = { texto: string; esError?: boolean };

export interface HerramientaMcp {
  nombre: string;
  descripcion: string;
  inputSchema: EsquemaEntrada;
  ejecutar(args: Record<string, unknown>): Promise<ResultadoHerramienta>;
}

export interface RegistroLlamada {
  hora: number;
  herramienta: string;
  resumen: string;
  resultado: 'ok' | 'error';
  detalle?: string;
  uri?: string;
}

export interface DependenciasDespacho {
  catalogo: readonly HerramientaMcp[];
  version: string;
  instrucciones: string;
  registrar?(llamada: RegistroLlamada): void;
  ahora?(): number;
}

export const INSTRUCCIONES_AGENTE = [
  'Procedimiento para trabajar con Sextante:',
  '0. Para cualquier tarea sobre código ABAP usa primero las herramientas de sextante. Si además tienes registrado el servidor adt de SAP (herramientas abap_*), úsalo solo para lo que sextante no cubre (transportes) y nunca para leer, editar, verificar, activar ni pasar el ATC de un objeto que puedas tratar con sextante.',
  '1. Llama a contexto_actual al empezar y antes de cada edición.',
  '2. Abre el objeto en pantalla antes de leerlo.',
  '3. Lee el programa completo antes de proponer cambios.',
  '4. Los cambios de código van siempre por proponer_cambio; nunca por otro servidor ni por edición directa.',
  '5. Activa solo cuando el usuario lo pida expresamente. Si el objeto tiene includes o hay varios objetos inactivos, activa con todo: true (lista «Activate All» de la extensión oficial), no archivo por archivo.',
  '6. En sistemas QAS o PRD haz solo análisis, sin modificar nada.',
  '7. Si contexto_actual trae diario, llama a diario_objeto antes de leer o proponer: ahí está lo que se hizo antes en ese objeto y por qué. Si trabajas sobre un include, consulta también el diario del programa principal (pasa su uri).',
  '8. Al terminar una tarea sobre un objeto, o al tomar una decisión que convenga recordar, anota el porqué con anotar_diario; en proponer_cambio da siempre porque.',
  '9. Antes de afirmar algo del sistema (release, sentencias disponibles, clases estándar) o de un objeto, consúltalo con info_sistema, leer_programa o diccionario; si no puedes, pregunta al usuario. Nunca sigas adelante con un supuesto marcado como no verificado.',
  '10. Si necesitas un objeto que no existe, pídelo con crear_objeto. Un objeto principal (programa, clase, grupo de funciones) va por el asistente de la extensión oficial: el usuario elige ahí tipo, paquete y orden. Un include de un programa que ya existe se crea directo indicando programaPrincipal: hereda el paquete y la orden del programa y el usuario solo confirma. Nunca supongas un paquete ni una orden. Un objeto que ya existe se queda en su paquete. Si no puedes crear, para y díselo. Nunca guardes código en archivos locales ni inventes nombres, paquetes o rutas sin preguntar.',
  '11. Al terminar el código de una tarea, y con verificar_sintaxis sin errores, pasa el ATC con ejecutar_atc sobre el objeto. Corrige con proponer_cambio todos los errores y advertencias que salgan y vuelve a pasar el ATC; repite hasta que no quede ninguno. No des la tarea por terminada sin un ATC limpio. Si un hallazgo no se puede corregir sin cambiar lo que pidió el usuario, o sigue saliendo después de corregirlo, para y explícaselo al usuario en vez de insistir.',
].join('\n');

export function negociarVersion(pedida: unknown): string {
  const encontrada = VERSIONES_SOPORTADAS.find((v) => v === pedida);
  return encontrada ?? VERSION_POR_DEFECTO;
}

export function resumenDeArgs(args: Record<string, unknown>): string {
  const texto = Object.entries(args)
    .map(([clave, valor]) => `${clave}=${String(valor)}`)
    .join(', ');
  return texto.slice(0, MAX_RESUMEN);
}

function resultadoTexto(texto: string, esError: boolean): { content: { type: 'text'; text: string }[]; isError: boolean } {
  return { content: [{ type: 'text', text: texto }], isError: esError };
}

/** El registro es accesorio: si falla, el resultado de la herramienta no cambia. */
function registrarSinFallar(deps: DependenciasDespacho, llamada: RegistroLlamada): void {
  try {
    deps.registrar?.(llamada);
  } catch {
    // Se ignora a propósito.
  }
}

function comoObjeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null ? (valor as Record<string, unknown>) : {};
}

async function llamarHerramienta(
  id: number | string,
  params: unknown,
  deps: DependenciasDespacho,
): Promise<RespuestaJsonRpc> {
  const { name, arguments: argumentos } = comoObjeto(params);
  const herramienta = typeof name === 'string' ? deps.catalogo.find((h) => h.nombre === name) : undefined;
  if (!herramienta) {
    return respuestaError(id, CODIGOS.paramsInvalidos, 'Herramienta desconocida');
  }
  const hora = (deps.ahora ?? Date.now)();
  const validacion = validarArgs(herramienta.inputSchema, argumentos);
  if (!validacion.ok) {
    registrarSinFallar(deps, { hora, herramienta: herramienta.nombre, resumen: '', resultado: 'error', detalle: validacion.motivo });
    return respuestaOk(id, resultadoTexto(validacion.motivo, true));
  }
  const resumen = resumenDeArgs(validacion.args);
  const uri = typeof validacion.args.uri === 'string' ? { uri: validacion.args.uri } : {};
  let resultado: ResultadoHerramienta;
  try {
    resultado = await herramienta.ejecutar(validacion.args);
  } catch (error) {
    const clase = error instanceof Error ? error.name : 'Error';
    registrarSinFallar(deps, { hora, herramienta: herramienta.nombre, resumen, resultado: 'error', detalle: clase, ...uri });
    return respuestaOk(id, resultadoTexto(`Error interno de la herramienta: ${clase}`, true));
  }
  const esError = resultado.esError === true;
  registrarSinFallar(deps, { hora, herramienta: herramienta.nombre, resumen, resultado: esError ? 'error' : 'ok', ...uri });
  return respuestaOk(id, resultadoTexto(resultado.texto, esError));
}

export async function despachar(
  mensaje: MensajeJsonRpc,
  deps: DependenciasDespacho,
): Promise<RespuestaJsonRpc | undefined> {
  if (!esPeticion(mensaje)) return undefined;
  switch (mensaje.method) {
    case 'initialize':
      return respuestaOk(mensaje.id, {
        protocolVersion: negociarVersion(comoObjeto(mensaje.params).protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: NOMBRE_SERVIDOR, version: deps.version },
        instructions: deps.instrucciones,
      });
    case 'ping':
      return respuestaOk(mensaje.id, {});
    case 'tools/list':
      return respuestaOk(mensaje.id, {
        tools: deps.catalogo.map((h) => ({ name: h.nombre, description: h.descripcion, inputSchema: h.inputSchema })),
      });
    case 'tools/call':
      return llamarHerramienta(mensaje.id, mensaje.params, deps);
    default:
      return respuestaError(mensaje.id, CODIGOS.metodoDesconocido, 'Método desconocido');
  }
}
