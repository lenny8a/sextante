import { spawn } from 'node:child_process';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { rutaJarParaClasspath, type PiezasOficial } from './puente-piezas';
import { validarConsulta, type ConsultaTabla, type ResultadoTabla } from './tablas-legibles';
import type { PeticionAdt } from './transporte';

export interface ConexionRfc { ashost?: string; sysnr?: string; client?: string; lang?: string; saprouter?: string; sysid?: string }

export type ErrorPuente = { clase: 'logon' | 'comunicacion' | 'funcion' | 'abap' | 'protocolo' | 'proceso' | 'tiempo' | 'otro'; mensaje: string };

export interface RespuestaPuente { estado: number; razon: string; cabeceras: Record<string, string>; cuerpo: Buffer }

export interface ProcesoHijo {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on(ev: 'exit', cb: (codigo: number | null) => void): void;
  kill(): void;
}

export interface OpcionesPuente {
  piezas: PiezasOficial;
  carpetaLib: string;
  /** Carpeta con las clases compiladas del puente (`out/puente-rfc`). */
  clasesPuente: string;
  lanzar?: (comando: string, args: string[]) => ProcesoHijo;
  /** Tiempo máximo por petición si la petición no trae el suyo. */
  tiempoMs?: number;
  registrar?: (m: string) => void;
}

export class ErrorDelPuente extends Error {
  constructor(readonly detalle: ErrorPuente) {
    super(detalle.mensaje);
    this.name = 'ErrorDelPuente';
  }
}

const TIEMPO_POR_DEFECTO_MS = 60_000;
const ESPERA_SALIR_MS = 2_000;
const CLASES_DE_ERROR: ReadonlyArray<ErrorPuente['clase']> = ['logon', 'comunicacion', 'funcion', 'abap', 'protocolo', 'proceso', 'tiempo', 'otro'];

type Objeto = Record<string, unknown>;

interface Pendiente {
  resolver: (respuesta: Objeto) => void;
  rechazar: (error: ErrorDelPuente) => void;
  temporizador: NodeJS.Timeout;
}

interface ProcesoActivo { hijo: ProcesoHijo; resto: string; vivo: boolean; preparado: boolean }

function esObjeto(valor: unknown): valor is Objeto {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esClaseDeError(valor: unknown): valor is ErrorPuente['clase'] {
  return typeof valor === 'string' && (CLASES_DE_ERROR as readonly string[]).includes(valor);
}

function esColumna(valor: unknown): valor is ResultadoTabla['columnas'][number] {
  return esObjeto(valor) && typeof valor.nombre === 'string' && typeof valor.longitud === 'number';
}

function esFilaDeTextos(valor: unknown): valor is string[] {
  return Array.isArray(valor) && valor.every((celda) => typeof celda === 'string');
}

function esMapaDeTextos(valor: unknown): valor is Record<string, string> {
  return esObjeto(valor) && Object.values(valor).every((v) => typeof v === 'string');
}

function errorDeRespuesta(error: unknown): ErrorPuente {
  const detalle = esObjeto(error) ? error : {};
  return {
    clase: esClaseDeError(detalle.clase) ? detalle.clase : 'otro',
    mensaje: typeof detalle.mensaje === 'string' ? detalle.mensaje : '',
  };
}

function errorDeProceso(mensaje: string): ErrorDelPuente {
  return new ErrorDelPuente({ clase: 'proceso', mensaje });
}

function errorDeProtocolo(mensaje: string): ErrorDelPuente {
  return new ErrorDelPuente({ clase: 'protocolo', mensaje });
}

function uriDe(p: PeticionAdt): string {
  const parametros = p.parametros && Object.keys(p.parametros).length ? `?${new URLSearchParams(p.parametros).toString()}` : '';
  return p.ruta + parametros;
}

/** `spawn` real en la carpeta del puente: las trazas que JCo pudiera escribir caen ahí, no en la de VS Code. */
function lanzadorReal(cwd: string): (comando: string, args: string[]) => ProcesoHijo {
  return (comando, args) => {
    const hijo = spawn(comando, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const alSalir: Array<(codigo: number | null) => void> = [];
    let terminado = false;
    const terminar = (codigo: number | null): void => {
      if (!terminado) {
        terminado = true;
        alSalir.forEach((cb) => cb(codigo));
      }
    };
    hijo.on('exit', (codigo) => terminar(codigo));
    // Un spawn fallido (p. ej. java ausente) emite 'error' sin 'exit'.
    hijo.on('error', () => terminar(null));
    return {
      stdin: hijo.stdin, stdout: hijo.stdout, stderr: hijo.stderr,
      on: (_ev, cb) => { alSalir.push(cb); },
      kill: () => { hijo.kill(); },
    };
  };
}

async function copiarSiHaceFalta(origen: string, destino: string): Promise<void> {
  const tamanoDestino = await stat(destino).then((s) => s.size, () => undefined);
  if (tamanoDestino !== (await stat(origen)).size) {
    await copyFile(origen, destino);
  }
}

/** Cliente del proceso Java `PuenteRfc`: una línea JSON por mensaje, respuestas emparejadas por `id`. */
export class PuenteRfc {
  private readonly lanzar: (comando: string, args: string[]) => ProcesoHijo;
  private readonly tiempoMs: number;
  private readonly registrar: (m: string) => void;
  private readonly pendientes = new Map<number, Pendiente>();
  /** Destinos con logon hecho alguna vez (sin contraseña); sobreviven a un reinicio del proceso. */
  private readonly recordados = new Map<string, ConexionRfc>();
  /** Destinos con logon en el proceso actual. */
  private readonly abiertos = new Set<string>();
  private proceso: ProcesoActivo | undefined;
  private preparando: Promise<void> | undefined;
  private siguienteId = 1;
  private generacion = 0;

  constructor(private readonly opciones: OpcionesPuente) {
    this.lanzar = opciones.lanzar ?? lanzadorReal(path.dirname(opciones.carpetaLib));
    this.tiempoMs = opciones.tiempoMs ?? TIEMPO_POR_DEFECTO_MS;
    this.registrar = opciones.registrar ?? (() => undefined);
  }

  preparar(): Promise<void> {
    if (this.proceso?.vivo && this.proceso.preparado) {
      return Promise.resolve();
    }
    this.preparando ??= this.arrancar().finally(() => { this.preparando = undefined; });
    return this.preparando;
  }

  async logon(destino: string, conexion: ConexionRfc, usuario: string, contrasena: string): Promise<{ sistema: string; release: string }> {
    await this.preparar();
    let respuesta: Objeto;
    try {
      respuesta = await this.enviar('logon', { destino, conexion, usuario, contrasena });
    } catch (error) {
      this.abiertos.delete(destino);
      this.recordados.delete(destino);
      throw error;
    }
    const { sistema, release } = respuesta;
    if (typeof sistema !== 'string' || typeof release !== 'string') {
      throw errorDeProtocolo('respuesta de logon mal formada');
    }
    this.abiertos.add(destino);
    this.recordados.set(destino, { ...conexion });
    return { sistema, release };
  }

  async peticion(destino: string, p: PeticionAdt): Promise<RespuestaPuente> {
    await this.preparar();
    if (this.recordados.has(destino) && !this.abiertos.has(destino)) {
      throw errorDeProceso('el puente RFC se reinició y el sistema perdió la sesión: vuelve a buscar');
    }
    const respuesta = await this.enviar('peticion', {
      destino,
      metodo: p.metodo,
      uri: uriDe(p),
      cabeceras: p.cabeceras,
      cuerpo: p.cuerpo === undefined ? '' : Buffer.from(p.cuerpo, 'utf8').toString('base64'),
    }, p.tiempoMs ?? this.tiempoMs);
    const { estado, razon, cabeceras, cuerpo } = respuesta;
    if (typeof estado !== 'number' || typeof razon !== 'string' || !esMapaDeTextos(cabeceras) || typeof cuerpo !== 'string') {
      throw errorDeProtocolo('respuesta de petición mal formada');
    }
    return { estado, razon, cabeceras, cuerpo: Buffer.from(cuerpo, 'base64') };
  }

  async tabla(destino: string, consulta: ConsultaTabla, tiempoMs?: number): Promise<ResultadoTabla> {
    const motivo = validarConsulta(consulta);
    if (motivo !== undefined) {
      throw errorDeProtocolo(motivo);
    }
    await this.preparar();
    if (this.recordados.has(destino) && !this.abiertos.has(destino)) {
      throw errorDeProceso('el puente RFC se reinició y el sistema perdió la sesión: vuelve a buscar');
    }
    const respuesta = await this.enviar('tabla', {
      destino,
      tabla: consulta.tabla,
      campos: consulta.campos,
      condiciones: consulta.condiciones,
      filasMax: consulta.filasMax ?? 0,
    }, tiempoMs ?? this.tiempoMs);
    const { columnas, filas } = respuesta;
    if (!Array.isArray(columnas) || !columnas.every(esColumna) || !Array.isArray(filas) || !filas.every(esFilaDeTextos)) {
      throw errorDeProtocolo('respuesta de tabla mal formada');
    }
    return { columnas, filas };
  }

  async olvidar(destino: string): Promise<void> {
    this.recordados.delete(destino);
    const estabaAbierto = this.abiertos.delete(destino);
    if (estabaAbierto && this.proceso?.vivo) {
      await this.enviar('olvidar', { destino });
    }
  }

  cerrar(): void {
    this.generacion++;
    const actual = this.proceso;
    if (!actual) {
      return;
    }
    this.descartarProceso(actual, 'el puente se cerró');
    if (!actual.vivo) {
      return;
    }
    const temporizador = setTimeout(() => { if (actual.vivo) { actual.hijo.kill(); } }, ESPERA_SALIR_MS);
    temporizador.unref();
    actual.hijo.on('exit', () => clearTimeout(temporizador));
    this.registrar(`puente: → salir #${this.siguienteId}`);
    actual.hijo.stdin.write(`${JSON.stringify({ id: this.siguienteId++, tipo: 'salir' })}\n`);
  }

  private async arrancar(): Promise<void> {
    const generacion = this.generacion;
    if (!this.proceso?.vivo) {
      const { piezas, carpetaLib, clasesPuente } = this.opciones;
      await mkdir(carpetaLib, { recursive: true });
      const jar = rutaJarParaClasspath(piezas.jarJco, carpetaLib);
      await copiarSiHaceFalta(piezas.jarJco, jar);
      if (generacion !== this.generacion) {
        throw errorDeProceso('el puente se cerró');
      }
      const args = [`-Djava.library.path=${carpetaLib}`, '-cp', `${clasesPuente}${path.delimiter}${jar}`, 'PuenteRfc'];
      this.conectar(this.lanzar(piezas.java, args));
      this.registrar('puente: proceso lanzado');
    }
    await this.enviar('preparar', { fragmentoJar: this.opciones.piezas.fragmentoNativo, carpetaLib: this.opciones.carpetaLib });
    if (this.proceso) {
      this.proceso.preparado = true;
    }
  }

  private conectar(hijo: ProcesoHijo): void {
    const activo: ProcesoActivo = { hijo, resto: '', vivo: true, preparado: false };
    this.proceso = activo;
    hijo.stdout.setEncoding('utf8');
    hijo.stdout.on('data', (trozo: string | Buffer) => this.recibir(activo, String(trozo)));
    // stderr lleva ids de destino: se consume para que la tubería no se llene, pero no se registra.
    hijo.stderr.resume();
    hijo.stdin.on('error', () => undefined);
    hijo.on('exit', (codigo) => {
      activo.vivo = false;
      if (this.proceso === activo) {
        const motivo = codigo === null ? 'señal' : `código ${codigo}`;
        this.registrar(`puente: el proceso terminó (${motivo})`);
        this.descartarProceso(activo, `el puente terminó (${motivo})`);
      }
    });
  }

  /** Olvida el proceso actual: rechaza las pendientes y los destinos dejan de estar abiertos. */
  private descartarProceso(activo: ProcesoActivo, mensaje: string): void {
    if (this.proceso === activo) {
      this.proceso = undefined;
    }
    this.abiertos.clear();
    for (const [id, pendiente] of this.pendientes) {
      clearTimeout(pendiente.temporizador);
      this.pendientes.delete(id);
      pendiente.rechazar(errorDeProceso(mensaje));
    }
  }

  /** Un plazo agotado solo rechaza esta petición (clase `tiempo`); el proceso y las demás pendientes siguen. */
  private enviar(tipo: string, campos: Objeto, tiempoMs = this.tiempoMs): Promise<Objeto> {
    const activo = this.proceso;
    if (!activo?.vivo) {
      return Promise.reject(errorDeProceso('el puente no está en marcha'));
    }
    const id = this.siguienteId++;
    return new Promise<Objeto>((resolver, rechazar) => {
      const temporizador = setTimeout(() => {
        this.pendientes.delete(id);
        this.registrar(`puente: #${id} sin respuesta en ${tiempoMs} ms`);
        rechazar(new ErrorDelPuente({ clase: 'tiempo', mensaje: `sin respuesta en ${tiempoMs} ms` }));
      }, tiempoMs);
      this.pendientes.set(id, { resolver, rechazar, temporizador });
      this.registrar(`puente: → ${tipo} #${id}`);
      activo.hijo.stdin.write(`${JSON.stringify({ id, tipo, ...campos })}\n`);
    });
  }

  private recibir(activo: ProcesoActivo, trozo: string): void {
    activo.resto += trozo;
    let corte = activo.resto.indexOf('\n');
    while (corte >= 0) {
      const linea = activo.resto.slice(0, corte).replace(/\r$/, '');
      activo.resto = activo.resto.slice(corte + 1);
      if (linea.trim()) {
        this.procesarLinea(linea);
      }
      corte = activo.resto.indexOf('\n');
    }
  }

  private procesarLinea(linea: string): void {
    let mensaje: unknown;
    try {
      mensaje = JSON.parse(linea);
    } catch {
      this.registrar(`puente: línea ilegible (${linea.length} caracteres)`);
      return;
    }
    if (!esObjeto(mensaje)) {
      this.registrar('puente: línea ilegible (no es un objeto)');
      return;
    }
    const { id } = mensaje;
    if (typeof id !== 'number') {
      this.registrar(`puente: respuesta sin id (clase ${errorDeRespuesta(mensaje.error).clase})`);
      return;
    }
    const pendiente = this.pendientes.get(id);
    if (!pendiente) {
      this.registrar(`puente: respuesta #${id} sin petición pendiente`);
      return;
    }
    this.pendientes.delete(id);
    clearTimeout(pendiente.temporizador);
    if ('error' in mensaje) {
      const error = errorDeRespuesta(mensaje.error);
      this.registrar(`puente: ← #${id} error (clase ${error.clase})`);
      pendiente.rechazar(new ErrorDelPuente(error));
      return;
    }
    this.registrar(typeof mensaje.estado === 'number' ? `puente: ← #${id} estado ${mensaje.estado}` : `puente: ← #${id} ok`);
    pendiente.resolver(mensaje);
  }
}
