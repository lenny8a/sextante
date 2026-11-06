import { descodificarEntidades, leerAtributos } from './busqueda-modelo';

export interface Version {
  id: string;
  activa: boolean;
  autor: string;
  /** `atom:updated` tal cual (ISO en UTC). */
  fecha: string;
  src: string;
  orden?: string;
  textoOrden?: string;
}

const ID_VERSION_ACTIVA = '00000';
const REL_ORDEN = 'http://www.sap.com/adt/relations/transport/request';

const ENTRADA = /<atom:entry\b[^>]*>([\s\S]*?)<\/atom:entry>/g;
const ENLACE = /<atom:link((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g;
const CONTENIDO = /<atom:content((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/;

function textoDe(entrada: string, etiqueta: string): string {
  const m = new RegExp(`<atom:${etiqueta}>([\\s\\S]*?)</atom:${etiqueta}>`).exec(entrada);
  return m === null ? '' : descodificarEntidades(m[1]).trim();
}

function ordenDe(entrada: string): { orden: string; textoOrden: string } | undefined {
  for (const m of entrada.matchAll(ENLACE)) {
    const atributos = leerAtributos(m[1]);
    const orden = atributos.get('adtcore:name');
    if (atributos.get('rel') === REL_ORDEN && orden !== undefined && orden !== '') {
      return { orden, textoOrden: atributos.get('title') ?? '' };
    }
  }
  return undefined;
}

function analizarEntrada(entrada: string): Version | undefined {
  const id = textoDe(entrada, 'id');
  const contenido = CONTENIDO.exec(entrada);
  if (id === '' || contenido === null) {
    return undefined;
  }
  const version: Version = {
    id,
    activa: id === ID_VERSION_ACTIVA,
    autor: textoDe(entrada, 'name'),
    fecha: textoDe(entrada, 'updated'),
    src: leerAtributos(contenido[1]).get('src') ?? '',
  };
  const orden = ordenDe(entrada);
  if (orden !== undefined) {
    version.orden = orden.orden;
    version.textoOrden = orden.textoOrden;
  }
  return version;
}

/** Lista de versiones del feed Atom, en el orden del servidor (la más reciente primero). Un 404 da `[]`. */
export function analizarVersiones(xml: string): Version[] {
  const versiones: Version[] = [];
  for (const m of xml.matchAll(ENTRADA)) {
    const version = analizarEntrada(m[1]);
    if (version !== undefined) {
      versiones.push(version);
    }
  }
  return versiones;
}

function dos(n: number): string {
  return String(n).padStart(2, '0');
}

/** `2026-10-28 21:09` en hora local (o en UTC con `utc`, para los tests). Un texto ilegible se devuelve igual. */
export function formatearFechaIso(iso: string, utc = false): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) {
    return iso;
  }
  const anio = utc ? fecha.getUTCFullYear() : fecha.getFullYear();
  const mes = (utc ? fecha.getUTCMonth() : fecha.getMonth()) + 1;
  const dia = utc ? fecha.getUTCDate() : fecha.getDate();
  const hora = utc ? fecha.getUTCHours() : fecha.getHours();
  const minuto = utc ? fecha.getUTCMinutes() : fecha.getMinutes();
  return `${anio}-${dos(mes)}-${dos(dia)} ${dos(hora)}:${dos(minuto)}`;
}
