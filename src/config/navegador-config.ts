import * as fs from 'node:fs';
import * as path from 'node:path';

export type RolSistema = 'DEV' | 'QAS' | 'PRD';

export const ROLES: readonly RolSistema[] = ['DEV', 'QAS', 'PRD'];

export interface ConfigDestino {
  rol?: RolSistema;
  url?: string;
  /** Prefijos de los objetos del cliente para «Dónde se usa»: `Z`, `Y` o un namespace `/X/`. */
  prefijosPropios?: string[];
  /** Ids de los destinos con los que comparar un objeto; `[]` = ninguno elegido. */
  compararCon?: string[];
}

export interface ConfigNavegador {
  version: 1;
  destinos: Record<string, ConfigDestino>;
}

type Registro = Record<string, unknown>;

export const PREFIJOS_PROPIOS_POR_DEFECTO: readonly string[] = ['Z', 'Y'];

const PATRON_PREFIJO = /^(\/[A-Z0-9_]{1,10}\/|[A-Z][A-Z0-9_]{0,9})$/;

/** Clave del selector de modo de búsqueda retirado en la fase 5: se descarta al leer. */
const CLAVE_BUSQUEDA_ANTIGUA = 'busqueda';

export class ErrorConfig extends Error {
  constructor(mensaje: string, opciones?: { cause?: unknown }) {
    super(mensaje, opciones);
    this.name = 'ErrorConfig';
  }
}

export function configVacia(): ConfigNavegador {
  return { version: 1, destinos: {} };
}

/** `registrar` recibe una línea (solo forma) si se descartan claves antiguas; el archivo se reescribe al siguiente cambio. */
export function leerConfig(ruta: string, registrar?: (mensaje: string) => void): ConfigNavegador {
  let contenido: string;
  try {
    contenido = fs.readFileSync(ruta, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return configVacia();
    }
    throw new ErrorConfig(`No se pudo leer ${ruta}`, { cause: error });
  }
  return analizarConfig(contenido, registrar);
}

export function escribirConfig(ruta: string, config: ConfigNavegador): void {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const temporal = `${ruta}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporal, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    fs.renameSync(temporal, ruta);
  } catch (error) {
    fs.rmSync(temporal, { force: true });
    throw error;
  }
}

export function conRol(config: ConfigNavegador, id: string, rol: RolSistema): ConfigNavegador {
  return {
    version: 1,
    destinos: { ...config.destinos, [id]: { ...config.destinos[id], rol } },
  };
}

export function rolDe(config: ConfigNavegador, id: string): RolSistema | undefined {
  return config.destinos[id]?.rol;
}

export function conUrl(config: ConfigNavegador, id: string, url: string): ConfigNavegador {
  return {
    version: 1,
    destinos: { ...config.destinos, [id]: { ...config.destinos[id], url } },
  };
}

export function urlDe(config: ConfigNavegador, id: string): string | undefined {
  return config.destinos[id]?.url;
}

export function prefijosPropiosDe(config: ConfigNavegador, id: string): string[] {
  return [...(config.destinos[id]?.prefijosPropios ?? PREFIJOS_PROPIOS_POR_DEFECTO)];
}

/** Añade el prefijo en mayúsculas sin repetirlo; un prefijo no válido lanza ErrorConfig. */
export function conPrefijoPropio(config: ConfigNavegador, id: string, prefijo: string): ConfigNavegador {
  const nuevo = prefijo.toUpperCase();
  if (!PATRON_PREFIJO.test(nuevo)) {
    throw new ErrorConfig('Prefijo propio no válido (use Z, Y o un namespace /X/)');
  }
  const actuales = prefijosPropiosDe(config, id);
  const prefijosPropios = actuales.includes(nuevo) ? actuales : [...actuales, nuevo];
  return {
    version: 1,
    destinos: { ...config.destinos, [id]: { ...config.destinos[id], prefijosPropios } },
  };
}

export function compararConDe(config: ConfigNavegador, id: string): string[] | undefined {
  const ids = config.destinos[id]?.compararCon;
  return ids === undefined || ids.length === 0 ? undefined : [...ids];
}

/** Guarda los destinos de comparación sin el propio id ni repetidos; `[]` significa «ninguno elegido». */
export function conCompararCon(config: ConfigNavegador, id: string, ids: string[]): ConfigNavegador {
  const compararCon = [...new Set(ids.filter((otro) => otro !== id))];
  return {
    version: 1,
    destinos: { ...config.destinos, [id]: { ...config.destinos[id], compararCon } },
  };
}

/** Lo que cambia la conexión con cada destino (rol y url); los prefijos propios no cuentan. */
export function firmaConexion(config: ConfigNavegador): string {
  const entradas = Object.entries(config.destinos)
    .map(([id, d]) => [id, d.rol ?? null, d.url ?? null] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entradas);
}

export function sinUrl(config: ConfigNavegador, id: string): ConfigNavegador {
  return sinCampo(config, id, 'url');
}

function sinCampo(config: ConfigNavegador, id: string, campo: keyof ConfigDestino): ConfigNavegador {
  const actual = config.destinos[id];
  if (actual?.[campo] === undefined) {
    return config;
  }
  const resto: ConfigDestino = { ...actual };
  delete resto[campo];
  return { version: 1, destinos: { ...config.destinos, [id]: resto } };
}

const SEPARADOR_TOKENS = /[-_ .]+/;
const PATRONES_ROL: ReadonlyArray<readonly [RolSistema, RegExp]> = [
  ['PRD', /^(PRD|PROD|PRO)\d*$/],
  ['QAS', /^(QAS|QA)\d*$/],
  ['DEV', /^DEV\d*$/],
];

/**
 * Deduce el rol a partir de tokens del id de sistema y del id del destino.
 * Un token coincide si es exactamente DEV, QAS, QA, PRD, PROD o PRO, opcionalmente seguido de dígitos.
 * Orden de evaluación PRD, QAS, DEV: los conflictos resuelven hacia más protección.
 */
export function sugerirRol(systemId: string | undefined, id: string): RolSistema | undefined {
  const tokens = [systemId, id].flatMap((valor) => (valor ?? '').toUpperCase().split(SEPARADOR_TOKENS));
  return PATRONES_ROL.find(([, patron]) => tokens.some((token) => patron.test(token)))?.[0];
}

export function esProtegido(rol: RolSistema | undefined): boolean {
  return rol === 'QAS' || rol === 'PRD';
}

function analizarConfig(json: string, registrar?: (mensaje: string) => void): ConfigNavegador {
  const datos = parsearJson(json);
  if (!esRegistro(datos) || datos.version !== 1 || !esRegistro(datos.destinos)) {
    throw new ErrorConfig('abap-navigator.json debe tener "version": 1 y un objeto "destinos"');
  }
  const entradas = Object.entries(datos.destinos);
  const destinos = Object.fromEntries(entradas.map(([id, entrada]) => [id, analizarDestino(id, entrada)]));
  const antiguas = entradas.filter(([, entrada]) => esRegistro(entrada) && entrada[CLAVE_BUSQUEDA_ANTIGUA] !== undefined);
  if (antiguas.length > 0) {
    registrar?.(`abap-navigator.json: se descarta la clave antigua "${CLAVE_BUSQUEDA_ANTIGUA}" en ${antiguas.length} destino(s)`);
  }
  return { version: 1, destinos };
}

function parsearJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new ErrorConfig('abap-navigator.json no es JSON válido', { cause: error });
  }
}

function analizarDestino(id: string, entrada: unknown): ConfigDestino {
  if (!esRegistro(entrada)) {
    throw new ErrorConfig(`El destino "${id}" no es un objeto`);
  }
  const destino: ConfigDestino = {};
  if (entrada.rol !== undefined) {
    if (!esRol(entrada.rol)) {
      throw new ErrorConfig(`El destino "${id}" tiene un rol no válido (use ${ROLES.join(', ')})`);
    }
    destino.rol = entrada.rol;
  }
  if (entrada.url !== undefined) {
    if (typeof entrada.url !== 'string') {
      throw new ErrorConfig(`El destino "${id}" tiene una url que no es texto`);
    }
    destino.url = entrada.url;
  }
  if (entrada.prefijosPropios !== undefined) {
    if (!esListaPrefijos(entrada.prefijosPropios)) {
      throw new ErrorConfig(`El destino "${id}" tiene prefijosPropios no válidos (use Z, Y o namespaces /X/ en mayúsculas)`);
    }
    destino.prefijosPropios = [...entrada.prefijosPropios];
  }
  if (entrada.compararCon !== undefined) {
    if (!Array.isArray(entrada.compararCon) || !entrada.compararCon.every((d) => typeof d === 'string')) {
      throw new ErrorConfig(`El destino "${id}" tiene compararCon que no es una lista de textos`);
    }
    destino.compararCon = [...(entrada.compararCon as string[])];
  }
  return destino;
}

function esListaPrefijos(valor: unknown): valor is string[] {
  return Array.isArray(valor) && valor.every((p) => typeof p === 'string' && PATRON_PREFIJO.test(p));
}

function esRol(valor: unknown): valor is RolSistema {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor);
}

function esRegistro(valor: unknown): valor is Registro {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}
