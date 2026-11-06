import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compararVersiones, versionDelNombre } from '../src/adt/puente-piezas';
import { localizarExtensionOficial } from '../src/bridge/adt-oficial-doc';

const RAIZ_REPO = path.resolve(__dirname, '../..');
const FUENTES = path.join(RAIZ_REPO, 'puente-rfc', 'src');
const SALIDA = path.join(RAIZ_REPO, 'out', 'puente-rfc');
const PLUGINS_WIN32 = ['adt-ls', 'win32', 'win32', 'x86_64', 'plugins'];
const PREFIJO_JCO = 'com.sap.conn.jco_';

function avisarYSalir(motivo: string): never {
  console.warn(`compilar-puente: ${motivo}; el puente RFC no estará disponible.`);
  process.exit(0);
}

function responde(comando: string): boolean {
  const resultado = spawnSync(comando, ['-version'], { stdio: 'ignore' });
  return !resultado.error && resultado.status === 0;
}

function localizarJavac(): string | undefined {
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const candidato = path.join(javaHome, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
    if (fs.existsSync(candidato)) {
      return candidato;
    }
  }
  return responde('javac') ? 'javac' : undefined;
}

function localizarJarJco(): string | undefined {
  const raiz = localizarExtensionOficial();
  if (!raiz) {
    return undefined;
  }
  const plugins = path.join(raiz, ...PLUGINS_WIN32);
  if (!fs.existsSync(plugins)) {
    return undefined;
  }
  const jars = fs.readdirSync(plugins)
    .filter((nombre) => nombre.startsWith(PREFIJO_JCO) && nombre.endsWith('.jar'))
    .sort((a, b) => compararVersiones(versionDelNombre(b), versionDelNombre(a)));
  return jars.length ? path.join(plugins, jars[0]) : undefined;
}

function compilar(javac: string, opcionesVersion: string[], jarJco: string, fuentes: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    javac,
    ['-encoding', 'UTF-8', ...opcionesVersion, '-cp', jarJco, '-d', SALIDA, ...fuentes],
    { encoding: 'utf8' },
  );
}

function principal(): void {
  const javac = localizarJavac();
  if (!javac) {
    avisarYSalir('no se encontró javac (JAVA_HOME ni PATH)');
  }
  const jarJco = localizarJarJco();
  if (!jarJco) {
    avisarYSalir('no se encontró el JAR de JCo de la extensión oficial');
  }
  const fuentes = fs.readdirSync(FUENTES)
    .filter((nombre) => nombre.endsWith('.java'))
    .map((nombre) => path.join(FUENTES, nombre));
  fs.rmSync(SALIDA, { recursive: true, force: true });
  fs.mkdirSync(SALIDA, { recursive: true });
  let resultado = compilar(javac, ['--release', '8'], jarJco, fuentes);
  if (resultado.status !== 0) {
    resultado = compilar(javac, ['-source', '8', '-target', '8'], jarJco, fuentes);
  }
  if (resultado.status !== 0) {
    process.stderr.write(String(resultado.stderr ?? ''));
    process.stdout.write(String(resultado.stdout ?? ''));
    console.error('compilar-puente: javac falló');
    process.exit(1);
  }
  console.log(`compilar-puente: ${fuentes.length} fuentes compiladas en out/puente-rfc`);
}

principal();
