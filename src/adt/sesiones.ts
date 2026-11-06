import type { Destino } from '../config/destinos';
import { esProtegido, type RolSistema } from '../config/navegador-config';
import { nombreDeError } from '../util/errores';
import { ConexionAdt, ErrorAdt, type CredencialesBasicas } from './conexion-adt';
import { ErrorDelPuente, type ConexionRfc, type RespuestaPuente } from './puente-rfc';
import type { PeticionAdt } from './transporte';
import { TransporteHttp } from './transporte-http';
import { TransporteRfc } from './transporte-rfc';
import type { Credenciales } from './credenciales';
import { candidatosUrl, deducirUrl, restDisponible, type MotivoSinRest } from './url-sistema';

export type ResultadoSesion =
  | { estado: 'ok'; conexion: ConexionAdt; via: 'http' | 'rfc'; sistema?: { id: string; release: string } }
  | { estado: 'sinRest'; motivo: MotivoSinRest }
  | { estado: 'sinContrasena' } | { estado: 'noAutorizado' }
  | { estado: 'error'; mensaje: string };

/** Vía resuelta para un destino: ADT por RFC, ADT REST por HTTP o, sin ninguna de las dos, el buscador de la oficial. */
export type ViaSesion = 'rfc' | 'http' | 'oficial';

/** Lo que las sesiones necesitan del puente RFC; `disponible` dice sin arrancarlo si se puede usar. */
export interface PuenteSesiones {
  disponible(): { ok: true } | { ok: false; motivo: string };
  preparar(): Promise<void>;
  logon(destino: string, conexion: ConexionRfc, usuario: string, contrasena: string): Promise<{ sistema: string; release: string }>;
  peticion(destino: string, p: PeticionAdt): Promise<RespuestaPuente>;
  olvidar(destino: string): Promise<void>;
}

export interface DependenciasSesiones {
  destinoDe(id: string): Destino | undefined;
  urlDe(id: string): string | undefined;
  guardarUrl(id: string, url: string): Promise<void>;
  // Confirmación antes de enviar credenciales por http (sin cifrar). Ausente = se rechaza por seguridad.
  confirmarInseguro?(url: string, destino: string): Promise<boolean>;
  credenciales: Credenciales;
  fetchFn?: typeof fetch;
  registrar?: (mensaje: string) => void;
  /** Sin puente disponible, las sesiones de un destino rfc van por HTTP si hay una URL que responda. */
  puente?: PuenteSesiones;
  /** QAS y PRD abren la sesión RFC en solo lectura; sin rol, lectura y escritura. */
  rolDe(id: string): RolSistema | undefined;
  ahora?: () => number;
}

/** Cuánto se recuerda un resultado negativo de una sesión silenciosa: el hover no reintenta el logon en cada parada. */
export const VENTANA_SILENCIOSA_MS = 30_000;

const NO_AUTORIZADO = 401;
const INTENTOS_CONTRASENA = 2;
// Sondeo de candidatos sin usuario: solo interesa si el servidor contesta, sin sumar intentos fallidos.
const SIN_CREDENCIALES: CredencialesBasicas = { usuario: '', contrasena: '' };
const PROTOCOLO_RFC = 'rfc';
const MOTIVO_SIN_PUENTE = 'no se cargó el puente';

interface UrlResuelta { url: string; nueva: boolean }

interface NegativoSilencioso { hasta: number; resultado: ResultadoSesion }

/** Una sesión silenciosa llegó a un paso que exige al usuario (confirmar un origen http). */
class ConfirmacionPendiente extends Error {}

/** Un 401 de ADT: la contraseña guardada ya no vale. */
export function esNoAutorizado(error: unknown): boolean {
  return error instanceof ErrorAdt && error.estado === NO_AUTORIZADO;
}

/** Parámetros de conexión JCo tal como están en destinations.json; sin servidor o número no hay a dónde ir. */
function conexionDe(destino: Destino): ConexionRfc | undefined {
  if (!destino.servidorAplicacion?.trim() || !destino.numeroSistema?.trim()) {
    return undefined;
  }
  return {
    ashost: destino.servidorAplicacion,
    sysnr: destino.numeroSistema,
    client: destino.mandante,
    lang: destino.idioma,
    saprouter: destino.rutaRouter,
    sysid: destino.systemId,
  };
}

export class SesionesAdt {
  // Se guarda la promesa para que dos llamadas simultáneas compartan el mismo diálogo de contraseña.
  // También se guarda `sinRest`: sin vía no se vuelve a sondear ni a confirmar hasta invalidar el destino.
  private readonly sesiones = new Map<string, Promise<ResultadoSesion>>();
  private readonly silenciosas = new WeakSet<Promise<ResultadoSesion>>();
  private readonly vias = new Map<string, ViaSesion>();
  /** Negativos de sesiones silenciosas (`sinContrasena`, `error`, `noAutorizado`) durante VENTANA_SILENCIOSA_MS. */
  private readonly negativosSilenciosos = new Map<string, NegativoSilencioso>();
  /** Destinos en los que una sesión silenciosa ya registró la línea «vía RFC». */
  private readonly viaRfcRegistrada = new Set<string>();
  private readonly oyentesVia: Array<(id: string) => void> = [];

  constructor(private readonly deps: DependenciasSesiones) {}

  /** Última vía resuelta para el destino; `undefined` mientras ninguna sesión llegó a decidirla. */
  viaDe(id: string): ViaSesion | undefined {
    return this.vias.get(id);
  }

  /** Avisa con el id del destino cada vez que una sesión resuelve su vía. */
  alCambiarVia(cb: (id: string) => void): void {
    this.oyentesVia.push(cb);
  }

  sesion(id: string): Promise<ResultadoSesion> {
    this.negativosSilenciosos.delete(id);
    const existente = this.sesiones.get(id);
    if (existente && this.silenciosas.has(existente)) {
      // La silenciosa en curso no pregunta: si acaba sin sesión, esta llamada abre la suya y sí pregunta.
      return existente.then((resultado) => (seRecuerda(resultado) ? resultado : this.sesion(id)));
    }
    return existente ?? this.iniciar(id, false);
  }

  /**
   * Como `sesion`, con la misma caché, pero sin ningún diálogo: sin contraseña guardada resuelve
   * `sinContrasena` y un origen http que habría que confirmar resuelve `error`. Un resultado negativo se
   * recuerda VENTANA_SILENCIOSA_MS solo para las silenciosas; `sesion()` e `invalidar` lo borran.
   */
  sesionSilenciosa(id: string): Promise<ResultadoSesion> {
    const existente = this.sesiones.get(id);
    if (existente) {
      return existente;
    }
    const negativo = this.negativosSilenciosos.get(id);
    if (negativo && negativo.hasta > this.ahora()) {
      return Promise.resolve(negativo.resultado);
    }
    this.negativosSilenciosos.delete(id);
    return this.iniciar(id, true);
  }

  private iniciar(id: string, silenciosa: boolean): Promise<ResultadoSesion> {
    const nueva = this.abrir(id, silenciosa).then((resultado) => {
      if (!seRecuerda(resultado) && this.sesiones.get(id) === nueva) {
        this.sesiones.delete(id);
        if (silenciosa) {
          this.negativosSilenciosos.set(id, { hasta: this.ahora() + VENTANA_SILENCIOSA_MS, resultado });
        }
      }
      return resultado;
    });
    if (silenciosa) {
      this.silenciosas.add(nueva);
    }
    this.sesiones.set(id, nueva);
    return nueva;
  }

  /** Descarta la sesión y la vía recordadas; el árbol se entera para quitar el sufijo de la vía. */
  invalidar(id: string): void {
    this.sesiones.delete(id);
    this.negativosSilenciosos.delete(id);
    this.viaRfcRegistrada.delete(id);
    if (this.vias.delete(id)) {
      this.avisarVia(id);
    }
  }

  private async abrir(id: string, silenciosa: boolean): Promise<ResultadoSesion> {
    let resultado: ResultadoSesion;
    try {
      resultado = await this.abrirSinCapturar(id, silenciosa);
    } catch (error) {
      if (error instanceof ConfirmacionPendiente) {
        this.registrar('Sesión ADT silenciosa: el origen http necesita confirmación; no se pregunta');
        return (await this.deps.credenciales.guardada(id).catch(() => false))
          ? { estado: 'error', mensaje: 'La sesión necesita confirmar un origen http' }
          : { estado: 'sinContrasena' };
      }
      return { estado: 'error', mensaje: `Fallo inesperado al abrir la sesión ADT (${nombreDeError(error)})` };
    }
    this.anotarVia(id, resultado);
    return resultado;
  }

  // Solo `ok` y `sinRest` deciden la vía; sin contraseña o con error la vía sigue sin saberse.
  private anotarVia(id: string, resultado: ResultadoSesion): void {
    const via = viaDeResultado(resultado);
    if (via === undefined) {
      return;
    }
    this.vias.set(id, via);
    this.registrar(`Sesión ADT: vía resuelta ${via}`);
    this.avisarVia(id);
  }

  private avisarVia(id: string): void {
    for (const oyente of this.oyentesVia) {
      oyente(id);
    }
  }

  // Orden: RFC si el destino es rfc y hay puente; si no, HTTP con una URL guardada o deducida; si no, la oficial.
  private async abrirSinCapturar(id: string, silenciosa: boolean): Promise<ResultadoSesion> {
    const destino = this.deps.destinoDe(id);
    if (!destino) {
      return { estado: 'error', mensaje: 'El destino ya no existe en destinations.json' };
    }
    if (destino.protocolo === PROTOCOLO_RFC) {
      const porRfc = await this.intentarRfc(id, destino, silenciosa);
      if (porRfc) {
        return porRfc;
      }
    }
    return this.abrirHttp(id, destino, silenciosa);
  }

  /** `undefined` = el puente no está disponible: se sigue por HTTP. */
  private async intentarRfc(id: string, destino: Destino, silenciosa: boolean): Promise<ResultadoSesion | undefined> {
    // NO VERIFICADO: logon RFC con SNC/SSO; sin contraseña que enviar, se trata como la búsqueda REST.
    const disponibilidadRest = restDisponible(destino);
    if (!disponibilidadRest.disponible && disponibilidadRest.motivo !== 'sinServidor') {
      this.registrar(`Sesión ADT: logon RFC no disponible (${disponibilidadRest.motivo})`);
      return { estado: 'sinRest', motivo: disponibilidadRest.motivo };
    }
    const puente = this.deps.puente;
    const disponibilidad = puente?.disponible() ?? { ok: false, motivo: MOTIVO_SIN_PUENTE };
    if (puente && disponibilidad.ok) {
      if (!silenciosa || !this.viaRfcRegistrada.has(id)) {
        this.registrar('Sesión ADT: vía RFC (puente disponible)');
      }
      if (silenciosa) {
        this.viaRfcRegistrada.add(id);
      }
      return this.abrirRfc(id, destino, puente, silenciosa);
    }
    const motivo = disponibilidad.ok ? MOTIVO_SIN_PUENTE : disponibilidad.motivo;
    this.registrar(`Sesión ADT: puente RFC no disponible (${motivo}); se sigue por HTTP`);
    return undefined;
  }

  // No se llama a descubrir(): el logon del puente ya valida las credenciales con un ping.
  private async abrirRfc(id: string, destino: Destino, puente: PuenteSesiones, silenciosa: boolean): Promise<ResultadoSesion> {
    if (!destino.usuario) {
      return { estado: 'error', mensaje: 'El destino no tiene usuario' };
    }
    const conexion = conexionDe(destino);
    if (!conexion) {
      return { estado: 'error', mensaje: 'El destino no tiene servidor de aplicación' };
    }
    for (let intento = 1; intento <= INTENTOS_CONTRASENA; intento++) {
      const contrasena = await this.contrasena(id, destino.usuario, silenciosa);
      if (contrasena === undefined) {
        return { estado: 'sinContrasena' };
      }
      try {
        await puente.preparar();
        const { sistema, release } = await puente.logon(id, conexion, destino.usuario, contrasena);
        this.registrar(`Sesión ADT RFC abierta (intento ${intento})`);
        return { estado: 'ok', via: 'rfc', conexion: this.conexionRfc(id, puente), sistema: { id: sistema, release } };
      } catch (error) {
        if (!(error instanceof ErrorDelPuente)) {
          throw error;
        }
        if (error.detalle.clase !== 'logon') {
          this.registrar(`Sesión ADT RFC: error ${error.detalle.clase}`);
          return { estado: 'error', mensaje: `No se pudo abrir la sesión RFC: ${error.message}` };
        }
        this.registrar(`Sesión ADT RFC: logon rechazado en el intento ${intento}; se olvida la contraseña`);
        await this.deps.credenciales.olvidar(id);
      }
    }
    return { estado: 'noAutorizado' };
  }

  // Si el puente perdió la sesión se descarta la cacheada: la siguiente búsqueda repite el logon con la contraseña guardada.
  private conexionRfc(id: string, puente: PuenteSesiones): ConexionAdt {
    const sesionActual = this.sesiones.get(id);
    return new ConexionAdt(
      new TransporteRfc({
        puente,
        destino: id,
        soloLectura: () => esProtegido(this.deps.rolDe(id)),
        registrar: this.deps.registrar,
        alPerderSesion: () => {
          if (this.sesiones.get(id) === sesionActual) {
            this.registrar('Sesión ADT RFC: el puente perdió la sesión; se repetirá el logon');
            this.invalidar(id);
          }
        },
      }),
      this.deps.registrar,
    );
  }

  private async abrirHttp(id: string, destino: Destino, silenciosa: boolean): Promise<ResultadoSesion> {
    const disponibilidad = restDisponible(destino);
    if (!disponibilidad.disponible) {
      this.registrar(`Sesión ADT: búsqueda REST no disponible (${disponibilidad.motivo})`);
      return { estado: 'sinRest', motivo: disponibilidad.motivo };
    }
    if (!destino.usuario) {
      return { estado: 'error', mensaje: 'El destino no tiene usuario' };
    }
    const resuelta = await this.resolverUrl(id, destino, silenciosa);
    if (!resuelta) {
      return { estado: 'sinRest', motivo: 'sinVia' };
    }
    if (resuelta.nueva) {
      await this.deps.guardarUrl(id, resuelta.url);
    }
    return this.autenticar(id, destino, destino.usuario, resuelta.url, silenciosa);
  }

  // Un origen http enviaría la contraseña sin cifrar: se confirma antes de autenticar y antes de guardar la URL.
  // Nunca se pregunta la URL: sin una guardada o deducida que se acepte, se usa la búsqueda oficial.
  private async resolverUrl(id: string, destino: Destino, silenciosa: boolean): Promise<UrlResuelta | undefined> {
    const guardada = this.deps.urlDe(id);
    if (guardada) {
      if (await this.aceptable(guardada, id, silenciosa)) {
        return { url: guardada, nueva: false };
      }
      this.registrar('Sesión ADT: URL guardada rechazada; se usa la búsqueda oficial');
      return undefined;
    }
    const candidatos = candidatosUrl(destino);
    const deducida = await deducirUrl(candidatos, (url) => this.responde(url, destino));
    if (!deducida) {
      this.registrar(`Sesión ADT: ningún candidato respondió (${candidatos.length}); se usa la búsqueda oficial`);
      return undefined;
    }
    this.registrar(`Sesión ADT: URL deducida (candidato ${candidatos.indexOf(deducida) + 1} de ${candidatos.length})`);
    if (await this.aceptable(deducida, id, silenciosa)) {
      return { url: deducida, nueva: true };
    }
    this.registrar('Sesión ADT: URL deducida rechazada; se usa la búsqueda oficial');
    return undefined;
  }

  private async aceptable(url: string, id: string, silenciosa: boolean): Promise<boolean> {
    if (!this.esHttp(url)) {
      return true;
    }
    if (silenciosa) {
      throw new ConfirmacionPendiente();
    }
    return this.confirmarHttp(url, id);
  }

  private contrasena(id: string, usuario: string, silenciosa: boolean): Promise<string | undefined> {
    return silenciosa ? this.deps.credenciales.obtenerSinPreguntar(id) : this.deps.credenciales.obtener(id, usuario);
  }

  // NO VERIFICADO: que cualquier estado HTTP (401, 403, 404…) indique que en esa URL está el ICM del sistema.
  private async responde(url: string, destino: Destino): Promise<boolean> {
    try {
      await this.conexion(url, destino, SIN_CREDENCIALES).descubrir();
      return true;
    } catch (error) {
      return error instanceof ErrorAdt && error.estado > 0;
    }
  }

  private async confirmarHttp(url: string, id: string): Promise<boolean> {
    const permitido = this.deps.confirmarInseguro ? await this.deps.confirmarInseguro(url, id) : false;
    if (!permitido) {
      this.registrar('Sesión ADT: origen http sin confirmar; no se envían credenciales');
    }
    return permitido;
  }

  private async autenticar(id: string, destino: Destino, usuario: string, url: string, silenciosa: boolean): Promise<ResultadoSesion> {
    for (let intento = 1; intento <= INTENTOS_CONTRASENA; intento++) {
      const contrasena = await this.contrasena(id, usuario, silenciosa);
      if (contrasena === undefined) {
        return { estado: 'sinContrasena' };
      }
      const conexion = this.conexion(url, destino, { usuario, contrasena });
      try {
        await conexion.descubrir();
        this.registrar(`Sesión ADT abierta (intento ${intento})`);
        return { estado: 'ok', via: 'http', conexion };
      } catch (error) {
        if (!(error instanceof ErrorAdt)) {
          throw error;
        }
        if (!esNoAutorizado(error)) {
          return { estado: 'error', mensaje: error.message };
        }
        this.registrar(`Sesión ADT: ${NO_AUTORIZADO} en el intento ${intento}; se olvida la contraseña`);
        await this.deps.credenciales.olvidar(id);
      }
    }
    return { estado: 'noAutorizado' };
  }

  private conexion(url: string, destino: Destino, credenciales: CredencialesBasicas): ConexionAdt {
    return new ConexionAdt(new TransporteHttp({
      url,
      cliente: destino.mandante,
      idioma: destino.idioma,
      credenciales,
      fetchFn: this.deps.fetchFn,
      registrar: this.deps.registrar,
    }), this.deps.registrar);
  }

  private esHttp(url: string): boolean {
    try {
      return new URL(url).protocol === 'http:';
    } catch {
      return false;
    }
  }

  private ahora(): number {
    return this.deps.ahora?.() ?? Date.now();
  }

  private registrar(mensaje: string): void {
    this.deps.registrar?.(mensaje);
  }
}

// Sin contraseña, rechazada o con error se reintenta en la siguiente búsqueda.
function seRecuerda(resultado: ResultadoSesion): boolean {
  return resultado.estado === 'ok' || resultado.estado === 'sinRest';
}

function viaDeResultado(resultado: ResultadoSesion): ViaSesion | undefined {
  switch (resultado.estado) {
    case 'ok':
      return resultado.via;
    case 'sinRest':
      return 'oficial';
    default:
      return undefined;
  }
}
