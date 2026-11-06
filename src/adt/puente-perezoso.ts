import { existsSync, readdirSync } from 'node:fs';
import { localizarPiezas, type ListadorDirectorios, type PiezasOficial, type ResultadoPiezas } from './puente-piezas';
import { PuenteRfc, type ConexionRfc, type RespuestaPuente } from './puente-rfc';
import type { PuenteSesiones } from './sesiones';
import type { ConsultaTabla, LectorDeTablas, ResultadoTabla } from './tablas-legibles';
import type { PeticionAdt } from './transporte';

/** Lo que el puente perezoso usa del `PuenteRfc` real. */
export type PuenteCerrable = Omit<PuenteSesiones, 'disponible'> & LectorDeTablas & { cerrar(): void };

type MotivoPiezas = Extract<ResultadoPiezas, { ok: false }>['motivo'];

export interface OpcionesPuentePerezoso {
  localizar(): ResultadoPiezas;
  crearPuente(piezas: PiezasOficial): PuenteCerrable;
}

const TEXTO_MOTIVO: Record<MotivoPiezas, string> = {
  sinOficial: 'no está instalada la extensión oficial de SAP',
  sinAdtLs: 'la extensión oficial no trae adt-ls',
  sinJre: 'no se encontró el Java de la extensión oficial',
  sinJco: 'no se encontró SAP JCo en la extensión oficial',
  sinNativa: 'no se encontró la biblioteca nativa de SAP JCo',
  plataforma: 'solo está disponible en Windows x64',
};

/**
 * Un único `PuenteRfc` por ventana, creado en el primer uso. `disponible()` solo busca las piezas: un éxito se
 * guarda y un fallo se vuelve a evaluar, así instalar la oficial después funciona sin reiniciar VS Code.
 */
export class PuentePerezoso implements PuenteSesiones, LectorDeTablas {
  private piezas: PiezasOficial | undefined;
  private puente: PuenteCerrable | undefined;

  constructor(private readonly opciones: OpcionesPuentePerezoso) {}

  disponible(): { ok: true } | { ok: false; motivo: string } {
    if (this.piezas) {
      return { ok: true };
    }
    const resultado = this.opciones.localizar();
    if (!resultado.ok) {
      return { ok: false, motivo: TEXTO_MOTIVO[resultado.motivo] };
    }
    this.piezas = resultado.piezas;
    return { ok: true };
  }

  async preparar(): Promise<void> {
    await this.obtener().preparar();
  }

  async logon(destino: string, conexion: ConexionRfc, usuario: string, contrasena: string): Promise<{ sistema: string; release: string }> {
    return this.obtener().logon(destino, conexion, usuario, contrasena);
  }

  async peticion(destino: string, p: PeticionAdt): Promise<RespuestaPuente> {
    return this.obtener().peticion(destino, p);
  }

  async tabla(destino: string, consulta: ConsultaTabla, tiempoMs?: number): Promise<ResultadoTabla> {
    return this.obtener().tabla(destino, consulta, tiempoMs);
  }

  /** Sin puente creado no hay sesión que olvidar: no se arranca solo para eso. */
  async olvidar(destino: string): Promise<void> {
    await this.puente?.olvidar(destino);
  }

  cerrar(): void {
    this.puente?.cerrar();
  }

  dispose(): void {
    this.cerrar();
  }

  // Solo se llama desde métodos async: el error llega como rechazo.
  private obtener(): PuenteCerrable {
    if (this.puente) {
      return this.puente;
    }
    const disponibilidad = this.disponible();
    if (!disponibilidad.ok || !this.piezas) {
      throw new Error(`El puente RFC no está disponible: ${disponibilidad.ok ? 'sin piezas' : disponibilidad.motivo}`);
    }
    this.puente = this.opciones.crearPuente(this.piezas);
    return this.puente;
  }
}

/** `fs` real para `localizarPiezas`; una carpeta ilegible cuenta como vacía. */
const listadorReal: ListadorDirectorios = {
  existe: (ruta) => existsSync(ruta),
  listar: (ruta) => {
    try {
      return readdirSync(ruta);
    } catch {
      return [];
    }
  },
};

export interface OpcionesPuenteReal {
  /** Carpeta de la extensión oficial; se consulta en cada evaluación porque puede instalarse después. */
  raizOficial(): string | undefined;
  carpetaLib: string;
  clasesPuente: string;
  registrar?: (m: string) => void;
}

/** Puente perezoso de producción: piezas de la oficial en disco y `PuenteRfc` real. */
export function crearPuentePerezoso(opciones: OpcionesPuenteReal): PuentePerezoso {
  return new PuentePerezoso({
    localizar: () => localizarPiezas(opciones.raizOficial(), process.platform, process.arch, listadorReal),
    crearPuente: (piezas) => {
      opciones.registrar?.('Puente RFC: se crea el puente con las piezas de la oficial');
      return new PuenteRfc({
        piezas,
        carpetaLib: opciones.carpetaLib,
        clasesPuente: opciones.clasesPuente,
        registrar: opciones.registrar,
      });
    },
  });
}
