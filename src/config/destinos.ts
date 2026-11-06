import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface Destino {
  id: string;
  protocolo: string;
  systemId?: string;
  mandante?: string;
  idioma?: string;
  usuario?: string;
  servidorAplicacion?: string;
  numeroSistema?: string;
  ssoActivado: boolean;
  tipoSnc?: string;
  rutaRouter?: string;
}

export class ErrorDestinos extends Error {
  constructor(mensaje: string, opciones?: { cause?: unknown }) {
    super(mensaje, opciones);
    this.name = 'ErrorDestinos';
  }
}

type Registro = Record<string, unknown>;

type CampoTexto = 'systemId' | 'mandante' | 'idioma' | 'usuario' | 'servidorAplicacion' | 'numeroSistema' | 'tipoSnc' | 'rutaRouter';

const CAMPOS_PROPIEDADES: ReadonlyArray<readonly [string, CampoTexto]> = [
  ['systemId', 'systemId'],
  ['client', 'mandante'],
  ['language', 'idioma'],
  ['user', 'usuario'],
  ['applicationServer', 'servidorAplicacion'],
  ['systemNumber', 'numeroSistema'],
  ['sncType', 'tipoSnc'],
  ['sapRouterString', 'rutaRouter'],
];

export function rutaDestinosPorDefecto(): string {
  return path.join(os.homedir(), '.adtls', 'destinations.json');
}

export function analizarDestinos(json: string): Destino[] {
  let datos: unknown;
  try {
    datos = JSON.parse(json);
  } catch (error) {
    throw new ErrorDestinos('destinations.json no es JSON válido', { cause: error });
  }
  if (!esRegistro(datos) || !esArray(datos.destinations)) {
    throw new ErrorDestinos('destinations.json no contiene un array "destinations"');
  }
  return datos.destinations.map(analizarEntrada);
}

export function leerDestinos(ruta: string = rutaDestinosPorDefecto()): Destino[] {
  let contenido: string;
  try {
    contenido = fs.readFileSync(ruta, 'utf8');
  } catch (error) {
    const codigo = (error as NodeJS.ErrnoException).code;
    throw new ErrorDestinos(`No se pudo leer ${ruta}${codigo ? ` (${codigo})` : ''}`, { cause: error });
  }
  return analizarDestinos(contenido);
}

function analizarEntrada(entrada: unknown, indice: number): Destino {
  if (!esRegistro(entrada)) {
    throw new ErrorDestinos(`El destino en el índice ${indice} no es un objeto`);
  }
  if (typeof entrada.id !== 'string') {
    throw new ErrorDestinos(`El destino en el índice ${indice} no tiene "id" de texto`);
  }
  if (typeof entrada.protocol !== 'string') {
    throw new ErrorDestinos(`El destino en el índice ${indice} no tiene "protocol" de texto`);
  }
  const destino: Destino = { id: entrada.id, protocolo: entrada.protocol, ssoActivado: false };
  if (esRegistro(entrada.properties)) {
    copiarPropiedades(entrada.properties, destino);
    destino.ssoActivado = entrada.properties.ssoEnabled === 'true';
  }
  return destino;
}

function copiarPropiedades(propiedades: Registro, destino: Destino): void {
  for (const [campoReal, campoDestino] of CAMPOS_PROPIEDADES) {
    const valor = propiedades[campoReal];
    if (typeof valor !== 'string') {
      continue;
    }
    if (campoDestino === 'rutaRouter' && valor.trim() === '') {
      continue;
    }
    destino[campoDestino] = valor;
  }
}

function esRegistro(valor: unknown): valor is Registro {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esArray(valor: unknown): valor is unknown[] {
  return Array.isArray(valor);
}
