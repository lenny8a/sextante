export const ESQUEMA_FUENTE = 'abap-navigator-fuente';

export interface ClaveFuente {
  destino: string;
  ruta: string;
  nombre: string;
  extension: string;
  etiqueta: string;
  version?: 'active';
}

export interface PartesUri { scheme: string; path: string; query: string }

/** Ruta legible para la pestaña (`/<etiqueta>/<nombre>.<extension>`); lo que identifica la fuente va en la consulta. */
export function partesUriFuente(clave: ClaveFuente): PartesUri {
  const version = clave.version === undefined ? '' : `&v=${clave.version}`;
  return {
    scheme: ESQUEMA_FUENTE,
    path: `/${clave.etiqueta}/${clave.nombre}.${clave.extension}`,
    query: `d=${encodeURIComponent(clave.destino)}&r=${encodeURIComponent(clave.ruta)}${version}`,
  };
}

export function analizarUriFuente(uri: PartesUri): ClaveFuente | undefined {
  if (uri.scheme !== ESQUEMA_FUENTE) {
    return undefined;
  }
  const parametros = new Map(uri.query.split('&').map((p): [string, string] => {
    const i = p.indexOf('=');
    return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)];
  }));
  const destino = parametros.get('d');
  const ruta = parametros.get('r');
  const partes = /^\/([^/]+)\/(.+)\.([^./]+)$/.exec(uri.path);
  if (destino === undefined || ruta === undefined || partes === null) {
    return undefined;
  }
  const clave: ClaveFuente = {
    destino: decodeURIComponent(destino),
    ruta: decodeURIComponent(ruta),
    nombre: partes[2],
    extension: partes[3],
    etiqueta: partes[1],
  };
  return parametros.get('v') === 'active' ? { ...clave, version: 'active' } : clave;
}

export function textoError(clave: ClaveFuente, motivo: string): string {
  return `* No se pudo leer ${clave.nombre} de ${clave.destino} (${motivo})`;
}
