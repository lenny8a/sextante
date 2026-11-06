import type { ConexionAdt } from '../adt/conexion-adt';
import { ErrorDelPuente } from '../adt/puente-rfc';
import type { LectorDeTablas, ResultadoTabla } from '../adt/tablas-legibles';
import { mensajeDe, nombreDeError } from '../util/errores';
import type { EstadoDumpCompleto } from './dump-texto';
import {
  ACCEPT_DUMPS,
  TOP_DUMPS,
  TOP_MAXIMO,
  analizarFeedDumps,
  esDeHoy,
  medianocheLocal,
  rutaDumps,
  type Dump,
} from './dumps-modelo';
import { claveDeDump, consultasSnap, dumpCompletoDe, reensamblarFilas, registrosDe } from './snap-modelo';
import { ACCEPT_INACTIVOS, RUTA_INACTIVOS, analizarInactivos, filtrarMios, type ObjetoInactivo } from './inactivos-modelo';

export const TIEMPO_MONITOR_MS = 20_000;

export interface DependenciasServicioMonitor {
  /** `undefined` = sin sesión RFC: no se consulta. */
  conexionDe(destino: string): Promise<ConexionAdt | undefined>;
  registrar?: (mensaje: string) => void;
  ahora?: () => Date;
  lector?: LectorDeTablas;
  /** Solo tests: plazo global de las lecturas de SNAP. */
  tiempoMs?: number;
}

export type ResultadoDumpCompleto = Exclude<EstadoDumpCompleto, { clase: 'cargando' }>;

class ErrorSnapSinFilas extends Error {
  constructor() {
    super('el dump ya no está en SNAP');
    this.name = 'ErrorSnapSinFilas';
  }
}

export function motivoDeErrorSnap(err: unknown): string {
  if (err instanceof ErrorSnapSinFilas) {
    return err.message;
  }
  if (err instanceof ErrorSinSesion) {
    return 'sin sesión RFC';
  }
  if (err instanceof ErrorDelPuente) {
    const { clase, mensaje } = err.detalle;
    if (clase === 'abap') {
      return mensaje.includes('NOT_AUTHORIZED') ? 'sin autorización para leer SNAP en este sistema' : `SNAP: ${mensaje}`;
    }
    if (clase === 'funcion') {
      return 'el sistema no expone RFC_READ_TABLE';
    }
    if (clase === 'tiempo') {
      return 'tiempo agotado leyendo SNAP';
    }
  }
  return mensajeDe(err);
}

export interface ResultadoDumps {
  dumps: Dump[];
  /** Llegaron tantas entradas como `top`: puede haber más. */
  llena: boolean;
  top: number;
}

export class ErrorSinSesion extends Error {
  constructor() {
    super('Sin sesión RFC para el monitor');
    this.name = 'ErrorSinSesion';
  }
}

export class ServicioMonitor {
  constructor(private readonly deps: DependenciasServicioMonitor) {}

  async dumps(destino: string, opciones: { usuario?: string; top?: number }, signal?: AbortSignal): Promise<ResultadoDumps> {
    const ahora = (this.deps.ahora ?? (() => new Date()))();
    const top = Math.min(opciones.top ?? TOP_DUMPS, TOP_MAXIMO);
    try {
      const conexion = await this.conexion(destino);
      // NO VERIFICADO: `$query` por usuario, `from` a medianoche local y `$top` mayor que 50.
      // La consulta viaja solo en la ruta: el puente recodificaría `$` y los espacios si fuera en parámetros.
      const ruta = rutaDumps({ usuario: opciones.usuario, desde: medianocheLocal(ahora), top });
      const respuesta = await conexion.get(ruta, undefined, ACCEPT_DUMPS, signal, TIEMPO_MONITOR_MS);
      const dumps = analizarFeedDumps(respuesta.cuerpo);
      const deHoy = dumps.filter((d) => esDeHoy(d, ahora)).length;
      this.registrar(`Monitor: dumps → ok (${dumps.length} entradas, ${deHoy} de hoy)`);
      return { dumps, llena: dumps.length >= top, top };
    } catch (err) {
      this.registrar(`Monitor: dumps → error ${nombreDeError(err)}`);
      throw err;
    }
  }

  /** `usuario` solo sirve para contar «míos» en el log; la lista devuelta es siempre completa. */
  async inactivos(destino: string, signal?: AbortSignal, usuario?: string): Promise<ObjetoInactivo[]> {
    try {
      const conexion = await this.conexion(destino);
      const respuesta = await conexion.get(RUTA_INACTIVOS, undefined, ACCEPT_INACTIVOS, signal, TIEMPO_MONITOR_MS);
      const objetos = analizarInactivos(respuesta.cuerpo);
      this.registrar(`Monitor: inactivos → ok (${objetos.length} objetos, ${filtrarMios(objetos, usuario).length} míos)`);
      return objetos;
    } catch (err) {
      this.registrar(`Monitor: inactivos → error ${nombreDeError(err)}`);
      throw err;
    }
  }

  /** Nunca lanza: el motivo del fallo va en el resultado. */
  async dumpCompleto(destino: string, dump: Dump): Promise<ResultadoDumpCompleto> {
    try {
      await this.conexion(destino);
      const lector = this.deps.lector;
      if (lector === undefined) {
        return { clase: 'error', motivo: 'sin puente RFC' };
      }
      const clave = claveDeDump(dump.id);
      if (clave === undefined) {
        return { clase: 'error', motivo: 'id del dump no reconocido' };
      }
      const respuestas = await this.leerSnap(lector, destino, clave);
      if (respuestas.some((r) => r.filas.length === 0)) {
        throw new ErrorSnapSinFilas();
      }
      const filas = reensamblarFilas(respuestas);
      const { registros, incompleto } = registrosDe(filas);
      const completo = { ...dumpCompletoDe(registros), incompleto };
      this.registrar(`Monitor: SNAP → ok (${filas.length} filas, ${registros.length} registros, ${completo.pila.length} niveles)`);
      return { clase: 'ok', completo };
    } catch (err) {
      const clase = err instanceof ErrorDelPuente ? err.detalle.clase : nombreDeError(err);
      this.registrar(`Monitor: SNAP → error ${clase}`);
      return { clase: 'error', motivo: motivoDeErrorSnap(err) };
    }
  }

  private async leerSnap(lector: LectorDeTablas, destino: string, clave: NonNullable<ReturnType<typeof claveDeDump>>): Promise<ResultadoTabla[]> {
    const tiempoMs = this.deps.tiempoMs ?? TIEMPO_MONITOR_MS;
    let temporizador: NodeJS.Timeout | undefined;
    const plazo = new Promise<never>((_, rechazar) => {
      temporizador = setTimeout(() => rechazar(new ErrorDelPuente({ clase: 'tiempo', mensaje: 'tiempo agotado leyendo SNAP' })), tiempoMs);
    });
    const lecturas = Promise.all(consultasSnap(clave).map((c) => lector.tabla(destino, c, tiempoMs)));
    lecturas.catch(() => undefined);
    try {
      return await Promise.race([lecturas, plazo]);
    } finally {
      clearTimeout(temporizador);
    }
  }

  private async conexion(destino: string): Promise<ConexionAdt> {
    const conexion = await this.deps.conexionDe(destino);
    if (conexion === undefined) {
      throw new ErrorSinSesion();
    }
    return conexion;
  }

  private registrar(mensaje: string): void {
    this.deps.registrar?.(mensaje);
  }
}
