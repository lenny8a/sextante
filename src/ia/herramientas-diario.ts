import type { AlmacenDiario } from './diario';
import { recortarParaAgente, resumenDe, type IdentidadDiario } from './diario-modelo';
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

export const ORDEN_DIARIO = ['diario_objeto', 'anotar_diario'] as const;

export interface DependenciasDiario extends Pick<AlmacenDiario, 'leer' | 'anotar' | 'rutaDe'> {
  /** Diario al que pertenece la uri (`identidadDeUri` o la regla de la vista Objeto); undefined si no es de un objeto. */
  identidadDe(uri: string): IdentidadDiario | undefined;
}

type NombreDiario = (typeof ORDEN_DIARIO)[number];
type Ejecutor = (args: Record<string, unknown>) => Promise<ResultadoHerramienta>;

const DESCRIPCIONES: Record<NombreDiario, string> = {
  diario_objeto:
    'Llama a esta herramienta después de contexto_actual y antes de leer o proponer nada sobre un objeto que tenga diario ' +
    '(contexto_actual lo indica en diario.entradas): devuelve lo trabajado antes en ese objeto y por qué se decidió así. ' +
    'Tenlo en cuenta al proponer.',
  anotar_diario:
    'Úsala al terminar una tarea sobre un objeto, o cuando tomes una decisión de código que convenga recordar: anota qué ' +
    'revisaste, qué decidiste y por qué, para que la próxima sesión lo encuentre con diario_objeto. Escribe para un ' +
    'desarrollador que no estuvo en esta conversación; no pegues código, resume.',
};

const MSG_NOTA_VACIA = 'el texto de la nota está vacío';

type Identificacion = { ok: true; id: IdentidadDiario } | { ok: false; resultado: ResultadoHerramienta };

function identificar(args: Record<string, unknown>, identidadDe: DependenciasDiario['identidadDe']): Identificacion {
  const uri = argTexto(args, 'uri') ?? '';
  if (tieneSegmentosRelativos(rutaDeUriTexto(uri))) return { ok: false, resultado: resultadoError(MSG_SEGMENTOS_RELATIVOS) };
  const id = identidadDe(uri);
  if (id === undefined) {
    return { ok: false, resultado: resultadoError('la uri no es de un objeto abap: del árbol de la oficial') };
  }
  return { ok: true, id };
}

export function crearCatalogoDiario(deps: DependenciasDiario): HerramientaMcp[] {
  const diarioObjeto: Ejecutor = async (args) => {
    const identificado = identificar(args, deps.identidadDe);
    if (!identificado.ok) return identificado.resultado;
    const { id } = identificado;
    let contenido: string | undefined;
    let archivo: string;
    try {
      contenido = await deps.leer(id);
      archivo = deps.rutaDe(id);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      return resultadoError('no se pudo leer el diario: ' + mensaje);
    }
    const base = { objeto: id.nombre, tipo: id.codigo, sistema: id.destino, archivo };
    const entradas = contenido === undefined ? 0 : resumenDe(contenido).entradas;
    if (contenido === undefined || entradas === 0) {
      return resultadoJson({
        ...base,
        entradas: 0,
        texto: '',
        recortado: false,
        indicacion: 'este objeto no tiene diario todavía',
      });
    }
    const { texto, recortado } = recortarParaAgente(contenido, archivo);
    return resultadoJson({ ...base, entradas, texto, recortado });
  };

  const anotarDiario: Ejecutor = async (args) => {
    const identificado = identificar(args, deps.identidadDe);
    if (!identificado.ok) return identificado.resultado;
    const texto = argTexto(args, 'texto') ?? '';
    if (texto.trim() === '') return resultadoError(MSG_NOTA_VACIA);
    try {
      const { ruta, entradas } = await deps.anotar(identificado.id, { tipo: 'nota', texto });
      return resultadoJson({ archivo: ruta, entradas });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      return resultadoError('no se pudo escribir el diario: ' + mensaje);
    }
  };

  const ejecutores: Record<NombreDiario, Ejecutor> = { diario_objeto: diarioObjeto, anotar_diario: anotarDiario };

  return ORDEN_DIARIO.map((nombre) => ({
    nombre,
    descripcion: DESCRIPCIONES[nombre],
    inputSchema: ESQUEMAS[nombre],
    ejecutar: envolverConProteccion(nombre, ejecutores[nombre]),
  }));
}
