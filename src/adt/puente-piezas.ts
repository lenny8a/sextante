import * as path from 'node:path';

export interface PiezasOficial { java: string; jarJco: string; fragmentoNativo: string; raiz: string }

export type ResultadoPiezas =
  | { ok: true; piezas: PiezasOficial }
  | { ok: false; motivo: 'sinOficial' | 'sinAdtLs' | 'sinJre' | 'sinJco' | 'sinNativa' | 'plataforma' };

export interface ListadorDirectorios { existe(ruta: string): boolean; listar(ruta: string): string[] }

const PLUGINS_WIN32_X64 = ['win32', 'win32', 'x86_64', 'plugins'];
const PREFIJO_JRE = 'com.sap.adt.jvm.sapmachineminimal.win32.x86_64_';
const PREFIJO_JCO = 'com.sap.conn.jco_';
const PREFIJO_JCO_CLASSPATH = 'com.sap.conn.jco-';
const PREFIJO_NATIVA = 'com.sap.conn.jco.win32.x86_64_';

/** `com.sap.conn.jco_3.1.14.jar` → [3, 1, 14]; acepta carpetas sin `.jar` y calificadores tras la versión. */
export function versionDelNombre(nombre: string): number[] {
  const coincidencia = /_(\d+(?:\.\d+)*)(?:[.-][^_]*)?$/.exec(nombre);
  return coincidencia ? coincidencia[1].split('.').map(Number) : [];
}

export function compararVersiones(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diferencia = (a[i] ?? 0) - (b[i] ?? 0);
    if (diferencia !== 0) {
      return diferencia;
    }
  }
  return 0;
}

/** Entradas de `carpeta` que empiezan por `prefijo` y acaban en `sufijo`, de la versión mayor a la menor. */
function porVersionDescendente(fs: ListadorDirectorios, carpeta: string, prefijo: string, sufijo: string): string[] {
  return fs.listar(carpeta)
    .filter((nombre) => nombre.startsWith(prefijo) && nombre.endsWith(sufijo))
    .sort((a, b) => compararVersiones(versionDelNombre(b), versionDelNombre(a)));
}

// Solo Windows x64 está verificado. NO VERIFICADO: rutas de adt-ls en darwin y linux.
export function localizarPiezas(
  raizOficial: string | undefined, plataforma: NodeJS.Platform, arquitectura: string, fs: ListadorDirectorios,
): ResultadoPiezas {
  if (!raizOficial) {
    return { ok: false, motivo: 'sinOficial' };
  }
  if (plataforma !== 'win32' || arquitectura !== 'x64') {
    return { ok: false, motivo: 'plataforma' };
  }
  const adtLs = path.join(raizOficial, 'adt-ls');
  const plugins = path.join(adtLs, ...PLUGINS_WIN32_X64);
  if (!fs.existe(adtLs) || !fs.existe(plugins)) {
    return { ok: false, motivo: 'sinAdtLs' };
  }
  const java = porVersionDescendente(fs, plugins, PREFIJO_JRE, '')
    .map((carpeta) => path.join(plugins, carpeta, 'jre', 'bin', 'java.exe'))
    .find((ruta) => fs.existe(ruta));
  if (!java) {
    return { ok: false, motivo: 'sinJre' };
  }
  const [jarJco] = porVersionDescendente(fs, plugins, PREFIJO_JCO, '.jar');
  if (!jarJco) {
    return { ok: false, motivo: 'sinJco' };
  }
  const [fragmentoNativo] = porVersionDescendente(fs, plugins, PREFIJO_NATIVA, '.jar');
  if (!fragmentoNativo) {
    return { ok: false, motivo: 'sinNativa' };
  }
  return {
    ok: true,
    piezas: { java, jarJco: path.join(plugins, jarJco), fragmentoNativo: path.join(plugins, fragmentoNativo), raiz: raizOficial },
  };
}

/** JCo comprueba el nombre de su JAR: el verificado es `com.sap.conn.jco-<versión>.jar`, con guion. */
export function rutaJarParaClasspath(jarJco: string, carpetaLib: string): string {
  const nombre = path.basename(jarJco);
  const conGuion = nombre.startsWith(PREFIJO_JCO) ? PREFIJO_JCO_CLASSPATH + nombre.slice(PREFIJO_JCO.length) : nombre;
  return path.join(carpetaLib, conGuion);
}
