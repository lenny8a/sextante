import { descodificarEntidades } from './busqueda-modelo';
import { ErrorAdt } from './transporte';
import { mensajeDe } from '../util/errores';

/** Raíz `exc:exception` de los errores de ADT (dp-sql-malo.xml, dp-tstc-sin-csrf.xml). */
const RAIZ_EXCEPCION = /<exc:exception[\s>]/;
const MENSAJE_LOCALIZADO = /<localizedMessage\b[^>]*>([\s\S]*?)<\/localizedMessage>/;
const MENSAJE = /<message\b[^>]*>([\s\S]*?)<\/message>/;

function textoDe(patron: RegExp, xml: string): string | undefined {
  const crudo = patron.exec(xml)?.[1];
  const texto = crudo === undefined ? '' : descodificarEntidades(crudo).trim();
  return texto === '' ? undefined : texto;
}

/** Texto legible de una excepción de ADT: `localizedMessage` (idioma del usuario) o, si falta, `message`. */
export function mensajeDeExcepcionAdt(cuerpo: string): string | undefined {
  if (!RAIZ_EXCEPCION.test(cuerpo)) {
    return undefined;
  }
  const xml = cuerpo.replace(/<!--[\s\S]*?-->/g, '');
  return textoDe(MENSAJE_LOCALIZADO, xml) ?? textoDe(MENSAJE, xml);
}

/** Mensaje para el usuario: el texto del servidor si el error trae una excepción de ADT; si no, el del error. */
export function mensajeLegibleDe(err: unknown): string {
  if (err instanceof ErrorAdt && err.cuerpo !== undefined) {
    return mensajeDeExcepcionAdt(err.cuerpo) ?? err.message;
  }
  return mensajeDe(err);
}
