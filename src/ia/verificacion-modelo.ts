import { analizarNombreAff, analizarUriAbap } from '../bridge/adt-uri';
import { rutaDeUriTexto } from './herramientas';
import type { Diagnostico } from './herramientas-escritura';

/** `source` de los diagnósticos que el servidor de lenguaje de la oficial publica tras una activación. */
export const ORIGEN_ACTIVACION = 'abapActivation';

export const INDICACION_INCLUDES_SIN_ACTIVAR =
  'si el programa tiene includes sin activar, los errores de tipos o subrutinas desconocidos pueden deberse a eso: ' +
  'activa con activar { todo: true } y vuelve a verificar';

/**
 * La oficial publica «Objeto(s) activado(s)» con severidad error y origen abapActivation sobre el `.json` de metadatos:
 * es el mensaje de éxito de la activación, no un problema, y se devuelve como info.
 */
export function normalizarDiagnostico(diagnostico: Diagnostico, uri: string): Diagnostico {
  const esMetadatos = rutaDeUriTexto(uri).toLowerCase().endsWith('.json');
  return diagnostico.origen === ORIGEN_ACTIVACION && esMetadatos ? { ...diagnostico, severidad: 'info' } : diagnostico;
}

/** true si la uri es el `.prog.abap` de la carpeta de un programa (no un include ni sus metadatos). */
export function esArchivoPrincipalDePrograma(uri: string): boolean {
  const analizada = analizarUriAbap({ scheme: 'abap', path: rutaDeUriTexto(uri) });
  if (analizada?.objeto?.tipoCarpeta !== 'Programs' || analizada.archivo === undefined) return false;
  const aff = analizarNombreAff(analizada.archivo);
  return aff?.tipo === 'prog' && aff.extension === 'abap';
}

/** Indicación para el agente cuando la verificación del programa principal trae errores; `undefined` si no aplica. */
export function indicacionPorErrores(diagnosticos: readonly Diagnostico[], uri: string): string | undefined {
  const hayErrores = diagnosticos.some((d) => d.severidad === 'error');
  return hayErrores && esArchivoPrincipalDePrograma(uri) ? INDICACION_INCLUDES_SIN_ACTIVAR : undefined;
}
