import fs from 'node:fs/promises';
import path from 'node:path';
import { analizarUriAbap } from '../bridge/adt-uri';
import type { Suscripcion } from './actividad-modelo';
import {
  anadirEntrada,
  cabeceraDiario,
  etiquetaArchivo,
  formatearEntrada,
  formatearFecha,
  identidadDeUri,
  resumenDe,
  rutaRelativaDiario,
  type IdentidadDiario,
  type NuevaEntrada,
  type ResumenDiario,
} from './diario-modelo';
import { rutaDeUriTexto } from './herramientas';
import { esMotivoTecnico, MSG_SIN_GUARDAR, type Propuesta } from './propuestas-modelo';

export type NivelRegistro = 'info' | 'warn';

export interface OpcionesAlmacenDiario {
  carpetaBase: string;
  ahora?(): number;
  /** Una línea por incidencia (solo forma: nunca nombres de objetos ni texto del diario); `warn` solo en fallos. */
  registrar?(linea: string, nivel: NivelRegistro): void;
  /** Diario al que va la decisión de una propuesta; por defecto `identidadDeUri`. */
  resolverIdentidad?(uri: string): IdentidadDiario | undefined;
}

function formaDelError(error: unknown): string {
  const codigo = (error as { code?: unknown } | null)?.code;
  if (typeof codigo === 'string') {
    return codigo;
  }
  return error instanceof Error ? error.constructor.name : typeof error;
}

async function leerOUndefined(ruta: string): Promise<string | undefined> {
  try {
    return await fs.readFile(ruta, 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function escribirAtomico(ruta: string, contenido: string): Promise<void> {
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  const temporal = `${ruta}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporal, contenido, 'utf8');
    await fs.rename(temporal, ruta);
  } catch (error) {
    await fs.rm(temporal, { force: true });
    throw error;
  }
}

/** Solo las decisiones del usuario: ni caducadas ni rechazos técnicos. */
function esDecisionAnotable(p: Propuesta): boolean {
  if (p.estado === 'aplicada') {
    return true;
  }
  return p.estado === 'rechazada' && !esMotivoTecnico(p.motivo);
}

/** `Archivo:` sale del archivo de la uri respecto al objeto del diario: un include en el diario del programa da su nombre. */
function entradaDeDecision(p: Propuesta, id: IdentidadDiario): NuevaEntrada {
  const archivo = etiquetaArchivo(id.nombre, analizarUriAbap({ scheme: 'abap', path: rutaDeUriTexto(p.uri) })?.archivo);
  const base = { resumen: p.resumen, archivo, ...(p.porque === undefined ? {} : { porque: p.porque }) };
  if (p.estado === 'aplicada') {
    return { tipo: 'aplicado', ...base, sinGuardar: p.motivo === MSG_SIN_GUARDAR };
  }
  return { tipo: 'rechazado', ...base, ...(p.motivo === undefined ? {} : { motivo: p.motivo }) };
}

export class AlmacenDiario {
  private readonly carpetaBase: string;
  private readonly ahora: () => number;
  private readonly registrar: (linea: string, nivel: NivelRegistro) => void;
  private readonly resolverIdentidad: (uri: string) => IdentidadDiario | undefined;
  private readonly colas = new Map<string, Promise<void>>();
  private readonly oyentes = new Set<(id: IdentidadDiario) => void>();

  constructor(opciones: OpcionesAlmacenDiario) {
    this.carpetaBase = opciones.carpetaBase;
    this.ahora = opciones.ahora ?? Date.now;
    this.registrar = opciones.registrar ?? (() => undefined);
    this.resolverIdentidad = opciones.resolverIdentidad ?? identidadDeUri;
  }

  readonly onDidChange = (oyente: (id: IdentidadDiario) => void): Suscripcion => {
    this.oyentes.add(oyente);
    return { dispose: () => void this.oyentes.delete(oyente) };
  };

  rutaDe(id: IdentidadDiario): string {
    const ruta = path.join(this.carpetaBase, rutaRelativaDiario(id));
    const relativa = path.relative(path.resolve(this.carpetaBase), path.resolve(ruta));
    if (relativa === '' || relativa.startsWith('..') || path.isAbsolute(relativa)) {
      throw new Error('ruta del diario fuera de la carpeta base');
    }
    return ruta;
  }

  async leer(id: IdentidadDiario): Promise<string | undefined> {
    return leerOUndefined(this.rutaDe(id));
  }

  async resumen(id: IdentidadDiario): Promise<ResumenDiario> {
    return resumenDe(await this.leer(id));
  }

  async anotar(id: IdentidadDiario, entrada: NuevaEntrada): Promise<{ ruta: string; entradas: number }> {
    const ruta = this.rutaDe(id);
    const bloque = formatearEntrada(entrada, formatearFecha(this.ahora()));
    const entradas = await this.enCola(ruta, async () => {
      const nuevo = anadirEntrada(await leerOUndefined(ruta), id, bloque);
      await escribirAtomico(ruta, nuevo);
      return resumenDe(nuevo).entradas;
    });
    this.avisar(id);
    return { ruta, entradas };
  }

  async crearSiFalta(id: IdentidadDiario): Promise<string> {
    const ruta = this.rutaDe(id);
    const creado = await this.enCola(ruta, async () => {
      if ((await leerOUndefined(ruta)) !== undefined) {
        return false;
      }
      await escribirAtomico(ruta, cabeceraDiario(id));
      return true;
    });
    if (creado) {
      this.avisar(id);
    }
    return ruta;
  }

  async registrarDecision(p: Propuesta): Promise<void> {
    try {
      if (!esDecisionAnotable(p)) {
        return;
      }
      const id = this.resolverIdentidad(p.uri);
      if (id === undefined) {
        this.registrar('diario: la propuesta no es de un objeto; no se anota', 'info');
        return;
      }
      const entrada = entradaDeDecision(p, id);
      const { entradas } = await this.anotar(id, entrada);
      this.registrar(`diario: entrada ${entrada.tipo} añadida (${entradas} entradas)`, 'info');
    } catch (error) {
      this.registrar(`diario: no se pudo escribir la entrada (${formaDelError(error)})`, 'warn');
    }
  }

  notificarCambioExterno(ruta: string): void {
    const relativa = path.relative(path.resolve(this.carpetaBase), path.resolve(ruta));
    if (relativa === '' || relativa.startsWith('..') || path.isAbsolute(relativa) || !relativa.endsWith('.md')) {
      return;
    }
    const id = this.identidadDeRutaRelativa(relativa);
    if (id !== undefined) {
      this.avisar(id);
    }
  }

  private identidadDeRutaRelativa(relativa: string): IdentidadDiario | undefined {
    const partes = relativa.split(/[\\/]/);
    if (partes.length !== 2) {
      return undefined;
    }
    const [destino, archivo] = partes;
    const casa = /^([^-]+)-(.+)\.md$/.exec(archivo);
    if (casa === null) {
      return undefined;
    }
    try {
      return { destino, codigo: casa[1], nombre: decodeURIComponent(casa[2]) };
    } catch {
      return undefined;
    }
  }

  private avisar(id: IdentidadDiario): void {
    for (const oyente of [...this.oyentes]) {
      oyente(id);
    }
  }

  private enCola<T>(ruta: string, operacion: () => Promise<T>): Promise<T> {
    const previa = this.colas.get(ruta) ?? Promise.resolve();
    const resultado = previa.then(operacion);
    const cola = resultado.then(
      () => undefined,
      () => undefined,
    );
    this.colas.set(ruta, cola);
    void cola.then(() => {
      if (this.colas.get(ruta) === cola) {
        this.colas.delete(ruta);
      }
    });
    return resultado;
  }
}
