import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface ConfiguracionExtension {
  properties?: Record<string, unknown>;
}

export interface PaqueteExtension {
  name: string;
  version: string;
  publisher: string;
  activationEvents?: string[];
  contributes?: {
    commands?: { command: string; title: string }[];
    views?: Record<string, { id: string; name: string }[]>;
    viewsContainers?: Record<string, { id: string; title: string }[]>;
    configuration?: ConfiguracionExtension | ConfiguracionExtension[];
    resourceLabelFormatters?: { scheme: string }[];
  };
}

const PREFIJO_EXTENSION = 'sapse.adt-vscode-';
const ENCABEZADO_OBSERVACIONES = '## Observaciones manuales';
const MARCADOR_PENDIENTE = '_(pendiente: se completa en la Tarea 6)_';

function celda(texto: string): string {
  return texto.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function tabla(cabeceras: string[], filas: string[][]): string[] {
  if (filas.length === 0) {
    return ['_(ninguno)_'];
  }
  return [
    `| ${cabeceras.join(' | ')} |`,
    `| ${cabeceras.map(() => '---').join(' | ')} |`,
    ...filas.map((fila) => `| ${fila.map(celda).join(' | ')} |`),
  ];
}

function clavesDeSettings(contribuciones: PaqueteExtension['contributes']): string[] {
  const bloques = contribuciones?.configuration;
  const lista = Array.isArray(bloques) ? bloques : bloques ? [bloques] : [];
  return lista.flatMap((bloque) => Object.keys(bloque.properties ?? {})).sort();
}

export function generarDocumentoAdtOficial(
  paquete: PaqueteExtension,
  rutaOrigen: string,
  observaciones?: string,
): string {
  const contribuciones = paquete.contributes;
  const vistas = Object.entries(contribuciones?.views ?? {}).flatMap(([contenedor, items]) =>
    items.map((vista) => [`\`${contenedor}\``, `\`${vista.id}\``, vista.name]),
  );
  const contenedores = Object.entries(contribuciones?.viewsContainers ?? {}).flatMap(
    ([ubicacion, items]) => items.map((c) => [`\`${ubicacion}\``, `\`${c.id}\``, c.title]),
  );
  const lineas = [
    `# Extensión oficial SAP: ${paquete.publisher}.${paquete.name} ${paquete.version}`,
    '',
    'Generado automáticamente por `scripts/generar-adt-oficial.ts`; no editar a mano.',
    '',
    `- Origen: \`${rutaOrigen}\``,
    `- Fecha de generación: ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## Activation events',
    '',
    ...(paquete.activationEvents?.length
      ? paquete.activationEvents.map((evento) => `- \`${evento}\``)
      : ['_(ninguno)_']),
    '',
    '## Comandos',
    '',
    ...tabla(['Comando', 'Título'],
      (contribuciones?.commands ?? []).map((c) => [`\`${c.command}\``, c.title])),
    '',
    '## Vistas',
    '',
    ...tabla(['Contenedor', 'Id', 'Nombre'], vistas),
    '',
    '## Contenedores de vistas',
    '',
    ...tabla(['Ubicación', 'Id', 'Título'], contenedores),
    '',
    '## Esquemas de URI',
    '',
    ...tabla(['Esquema'],
      (contribuciones?.resourceLabelFormatters ?? []).map((f) => [`\`${f.scheme}\``])),
    '',
    '## Settings',
    '',
    ...tabla(['Setting'], clavesDeSettings(contribuciones).map((clave) => [`\`${clave}\``])),
    '',
    ENCABEZADO_OBSERVACIONES,
  ];
  const manual = observaciones?.trim() ? observaciones : `\n${MARCADOR_PENDIENTE}\n`;
  return `${lineas.join('\n')}\n${manual.startsWith('\n') ? manual : `\n${manual}`}`;
}

function versionComoNumeros(nombre: string): number[] {
  const coincidencia = /^(\d+)\.(\d+)\.(\d+)/.exec(nombre.slice(PREFIJO_EXTENSION.length));
  return coincidencia ? coincidencia.slice(1).map(Number) : [];
}

function compararVersiones(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diferencia = (a[i] ?? 0) - (b[i] ?? 0);
    if (diferencia !== 0) {
      return diferencia;
    }
  }
  return 0;
}

export function localizarExtensionOficial(
  carpetaExtensiones: string = path.join(os.homedir(), '.vscode', 'extensions'),
): string | undefined {
  if (!fs.existsSync(carpetaExtensiones)) {
    return undefined;
  }
  const candidatas = fs.readdirSync(carpetaExtensiones)
    .filter((nombre) => nombre.startsWith(PREFIJO_EXTENSION))
    .sort((a, b) => compararVersiones(versionComoNumeros(b), versionComoNumeros(a)));
  return candidatas.length ? path.join(carpetaExtensiones, candidatas[0]) : undefined;
}
