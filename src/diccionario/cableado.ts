import type { ConexionAdt } from '../adt/conexion-adt';
import type { Credenciales } from '../adt/credenciales';
import type { PuenteSesiones, ResultadoSesion, SesionesAdt } from '../adt/sesiones';
import { restDisponible, type MotivoSinRest } from '../adt/url-sistema';
import { analizarUriAbap, type UriMinimo } from '../bridge/adt-uri';
import type { Destino } from '../config/destinos';
import { ServicioFirmas } from '../firmas/servicio';
import { claveIdiomaSap } from './modelo';
import { ServicioDiccionario, type DependenciasServicio } from './servicio';

const PROTOCOLO_RFC = 'rfc';
const IDIOMA_POR_DEFECTO = 'E';

/** Por qué un destino no tiene diccionario: sin vía RFC posible no hay hover ni «Conéctate». */
export type MotivoSinDiccionario = 'sinDestino' | 'noRfc' | 'sso' | 'snc' | 'sinPuente';

export type PuenteDiccionario = Pick<PuenteSesiones, 'disponible'>;

const TEXTO_SIN_REST: Readonly<Record<MotivoSinRest, string>> = {
  sinVia: 'el puente RFC no está disponible',
  sso: 'el destino usa SSO',
  snc: 'el destino usa SNC',
  sinServidor: 'el destino no tiene servidor de aplicación',
};

export type SesionesDiccionario = Pick<SesionesAdt, 'sesion' | 'sesionSilenciosa' | 'viaDe' | 'alCambiarVia'>;

export interface OpcionesCableadoDiccionario {
  sesiones: SesionesDiccionario;
  credenciales: Pick<Credenciales, 'guardada'>;
  destinoPorId(id: string): Destino | undefined;
  /** Sin puente disponible, un destino rfc no tiene diccionario: la sesión silenciosa caería en HTTP. */
  puente?: PuenteDiccionario;
  registrar?: (m: string) => void;
}

/** Lo que el hover y el panel necesitan, sobre las sesiones y credenciales de la búsqueda. */
export interface CableadoDiccionario {
  servicio: ServicioDiccionario;
  /** Firmas de funciones y métodos, sobre la misma sesión RFC; se vacía junto con `servicio`. */
  firmas: ServicioFirmas;
  destinoDe(uri: UriMinimo): string | undefined;
  /** Solo mira si hay contraseña guardada; nunca la pide. */
  credencialGuardada(destino: string): Promise<boolean>;
  /** Abre la sesión (pide la contraseña una vez si hace falta) y vacía la caché del destino. */
  conectar(destino: string): Promise<ResultadoSesion>;
}

const TEXTO_SIN_DICCIONARIO: Readonly<Record<MotivoSinDiccionario, string>> = {
  sinDestino: 'el destino no existe',
  noRfc: 'el destino no es RFC',
  sso: TEXTO_SIN_REST.sso,
  snc: TEXTO_SIN_REST.snc,
  sinPuente: TEXTO_SIN_REST.sinVia,
};

/** Texto corto de por qué un destino no tiene vía RFC. */
export function textoMotivoSinRfc(motivo: MotivoSinDiccionario): string {
  return TEXTO_SIN_DICCIONARIO[motivo];
}

// NO VERIFICADO: logon RFC con SSO o SNC; sin contraseña que enviar, el diccionario queda apagado como la búsqueda.
export function motivoSinDiccionario(destino: Destino | undefined, puente?: PuenteDiccionario): MotivoSinDiccionario | undefined {
  if (destino === undefined) {
    return 'sinDestino';
  }
  if (destino.protocolo !== PROTOCOLO_RFC) {
    return 'noRfc';
  }
  const disponibilidad = restDisponible(destino);
  if (!disponibilidad.disponible && (disponibilidad.motivo === 'sso' || disponibilidad.motivo === 'snc')) {
    return disponibilidad.motivo;
  }
  return puente !== undefined && !puente.disponible().ok ? 'sinPuente' : undefined;
}

/** Texto corto de por qué una sesión acabó sin vía (`sinRest`). */
export function textoSinRest(motivo: MotivoSinRest): string {
  return TEXTO_SIN_REST[motivo];
}

/** Aviso de «Conectar» cuando la sesión acaba sin vía (`sinRest`): el diccionario solo va por RFC. */
export function mensajeSinRfc(motivo: MotivoSinRest): string {
  return `El diccionario necesita la conexión RFC: ${TEXTO_SIN_REST[motivo]}`;
}

/**
 * Solo la sesión silenciosa por RFC. NO VERIFICADO: que el Data Preview por HTTP responda en el mismo
 * formato; hasta confirmarlo, una sesión HTTP no se usa para el diccionario.
 */
export async function conexionDiccionario(
  sesiones: Pick<SesionesAdt, 'sesionSilenciosa'>, destino: string,
): Promise<ConexionAdt | undefined> {
  const resultado = await sesiones.sesionSilenciosa(destino);
  return resultado.estado === 'ok' && resultado.via === 'rfc' ? resultado.conexion : undefined;
}

/** destinations.json guarda el idioma en ISO 639-1 («ES», verificado 2026-10-30); las consultas usan la clave SAP. */
export function idiomaDiccionario(destino: Destino | undefined): string {
  return claveIdiomaSap(destino?.idioma) ?? IDIOMA_POR_DEFECTO;
}

function descripcionConectar(resultado: ResultadoSesion): string {
  return resultado.estado === 'ok' ? `ok (${resultado.via})` : resultado.estado;
}

export function crearCableadoDiccionario(opciones: OpcionesCableadoDiccionario): CableadoDiccionario {
  const { sesiones, credenciales, destinoPorId } = opciones;
  const registrar = (m: string): void => opciones.registrar?.(m);
  const avisados = new Map<string, MotivoSinDiccionario>();
  const dependencias: DependenciasServicio = {
    conexion: (destino) => conexionDiccionario(sesiones, destino),
    idiomaDe: (destino) => idiomaDiccionario(destinoPorId(destino)),
    registrar,
  };
  const servicio = new ServicioDiccionario(dependencias);
  const firmas = new ServicioFirmas(dependencias);

  // "Olvidar contraseña y URL", una contraseña caducada o una sesión perdida dejan la vía sin resolver.
  sesiones.alCambiarVia((id) => {
    if (sesiones.viaDe(id) === undefined) {
      servicio.vaciar(id);
      firmas.vaciar(id);
    }
  });

  const destinoDe = (uri: UriMinimo): string | undefined => {
    const id = analizarUriAbap(uri)?.destino;
    if (id === undefined) {
      return undefined;
    }
    const motivo = motivoSinDiccionario(destinoPorId(id), opciones.puente);
    if (motivo === undefined) {
      avisados.delete(id);
      return id;
    }
    if (avisados.get(id) !== motivo) {
      avisados.set(id, motivo);
      registrar(`Diccionario: desactivado para un destino (${motivo})`);
    }
    return undefined;
  };

  const conectar = async (destino: string): Promise<ResultadoSesion> => {
    const resultado = await sesiones.sesion(destino);
    registrar(`Diccionario: conectar → ${descripcionConectar(resultado)}`);
    servicio.vaciar(destino);
    firmas.vaciar(destino);
    return resultado;
  };

  return {
    servicio,
    firmas,
    destinoDe,
    credencialGuardada: (destino) => credenciales.guardada(destino),
    conectar,
  };
}
