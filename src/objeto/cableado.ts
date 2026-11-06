import * as vscode from 'vscode';
import type { ResultadoAbrir } from '../adt/abrir-resultado';
import { buscar } from '../adt/busqueda-cliente';
import type { ResultadoBusqueda } from '../adt/busqueda-modelo';
import type { Credenciales } from '../adt/credenciales';
import type { ResultadoSesion, SesionesAdt } from '../adt/sesiones';
import { enfocarVistaOficial } from '../commands/herramientas';
import { COMANDO_FOCO_TRANSPORTES } from '../commands/objeto-acciones';
import type { Destino } from '../config/destinos';
import { compararConDe, rolDe, type ConfigNavegador } from '../config/navegador-config';
import type { SistemaActivo } from '../config/sistema-activo';
import {
  conexionDiccionario,
  idiomaDiccionario,
  motivoSinDiccionario,
  textoMotivoSinRfc,
  textoSinRest,
  type PuenteDiccionario,
} from '../diccionario/cableado';
import { log } from '../log';
import type { ProveedorObjeto } from '../tree/objeto-proveedor';
import { mensajeDe, nombreDeError } from '../util/errores';
import {
  abrirDiffVscode,
  archivosDeVscode,
  compararConOtrosSistemas,
  configurarSistemasAComparar,
  conProgresoNotificacion,
  crearElegirHermanos,
  documentoComparableDe,
  elegirResultadoConQuickPick,
  leerLocalVscode,
  ofrecerCambiarConAviso,
  type DependenciasCompararSistemas,
  type ResultadoComparar,
} from './comparar-sistemas';
import { ProveedorFuente, registrarProveedorFuente } from './documento-fuente';
import { elegirObjetoConQuickPick, elegirOrdenConQuickPick, registrarOrdenObjeto } from './orden-objeto';
import { abrirObjetoDeOrden, registrarVistaOrdenes, type DependenciasOrdenes, type ProveedorOrdenes } from './ordenes-proveedor';
import { ServicioObjeto } from './servicio';
import { registrarVistaVersiones, type ProveedorVersiones } from './versiones-proveedor';

/** Resultados de la búsqueda por nombre exacto con los que se intenta abrir un objeto de una orden. */
const RESULTADOS_BUSCAR_EXACTO = 10;
const COMANDO_CONFIGURAR_COMPARAR = 'abapNavigator.objeto.compararConfigurar';

export interface OpcionesObjetoActivo {
  sesiones: Pick<SesionesAdt, 'sesion' | 'sesionSilenciosa' | 'viaDe' | 'alCambiarVia'>;
  credenciales: Pick<Credenciales, 'guardada'>;
  destinoPorId(id: string): Destino | undefined;
  destinos(): Destino[];
  config(): ConfigNavegador;
  fijarCompararCon(id: string, ids: string[]): Promise<void>;
  proveedorObjeto: Pick<ProveedorObjeto, 'objeto' | 'onDidChangeObjeto'>;
  sistemaActivo: Pick<SistemaActivo, 'id' | 'onDidChange'>;
  abrirResultado(r: ResultadoBusqueda, destino: string): Promise<ResultadoAbrir>;
  puente?: PuenteDiccionario;
}

export interface ObjetoActivoRegistrado {
  servicio: ServicioObjeto;
  proveedorFuente: ProveedorFuente;
  ordenes: ProveedorOrdenes;
  versiones: ProveedorVersiones;
  compararSistemas(): Promise<ResultadoComparar>;
}

function informar(mensaje: string): void {
  void vscode.window.showInformationMessage(mensaje);
}

function advertir(mensaje: string): void {
  void vscode.window.showWarningMessage(mensaje);
}

async function copiar(texto: string): Promise<void> {
  await vscode.env.clipboard.writeText(texto);
}

/** Como el aviso de «Conectar» del diccionario: estas vistas también van solo por RFC. */
function avisarConexion(resultado: ResultadoSesion, destino: string): void {
  switch (resultado.estado) {
    case 'ok':
      if (resultado.via !== 'rfc') {
        informar(`Órdenes y versiones necesitan la conexión RFC; ${destino} quedó conectado por HTTP`);
      }
      return;
    case 'noAutorizado':
      void vscode.window.showErrorMessage(`${destino} rechazó el usuario o la contraseña`);
      return;
    case 'error':
      void vscode.window.showErrorMessage(resultado.mensaje);
      return;
    case 'sinRest':
      informar(`Órdenes y versiones necesitan la conexión RFC: ${textoSinRest(resultado.motivo)}`);
      return;
    case 'sinContrasena':
      return;
  }
}

function descripcionSesion(resultado: ResultadoSesion): string {
  return resultado.estado === 'ok' ? `ok (${resultado.via})` : resultado.estado;
}

/** Órdenes, Versiones, Orden del objeto, Comparar con otro sistema y las fuentes de solo lectura, sobre las sesiones de la búsqueda. */
export function activarObjetoActivo(context: vscode.ExtensionContext, opciones: OpcionesObjetoActivo): ObjetoActivoRegistrado {
  const { sesiones, destinoPorId, abrirResultado } = opciones;
  const servicio = new ServicioObjeto({
    conexion: (destino) => conexionDiccionario(sesiones, destino),
    idiomaDe: (destino) => idiomaDiccionario(destinoPorId(destino)),
    registrar: (m) => log.info(m),
    advertir: (m) => log.warn(m),
  });
  // Solo al perder la vía: la que se resuelve al abrir la sesión no debe tirar las peticiones en curso.
  sesiones.alCambiarVia((destino) => {
    if (sesiones.viaDe(destino) === undefined) {
      servicio.vaciar(destino);
    }
  });

  const proveedorFuente = new ProveedorFuente({
    fuente: (destino, ruta, version) => servicio.fuente(destino, ruta, version),
    vaciarFuentes: (destino) => servicio.vaciarFuentes(destino),
  });
  registrarProveedorFuente(context, proveedorFuente);

  const motivoSinRfc = (destino: string): string | undefined => {
    const motivo = motivoSinDiccionario(destinoPorId(destino), opciones.puente);
    return motivo && textoMotivoSinRfc(motivo);
  };
  const credencialGuardada = (destino: string): Promise<boolean> => opciones.credenciales.guardada(destino);
  /** Pide la contraseña una vez si hace falta; `true` solo con sesión por RFC. */
  const abrirSesionRfc = async (destino: string): Promise<boolean> => {
    const resultado = await sesiones.sesion(destino);
    log.info(`Objeto: conectar → ${descripcionSesion(resultado)}`);
    avisarConexion(resultado, destino);
    return resultado.estado === 'ok' && resultado.via === 'rfc';
  };
  const conectar = async (destino: string): Promise<void> => {
    await abrirSesionRfc(destino);
  };
  const buscarExacto = async (nombre: string, destino: string): Promise<ResultadoBusqueda[]> => {
    const conexion = await conexionDiccionario(sesiones, destino);
    return conexion === undefined ? [] : buscar(conexion, { patron: nombre }, undefined, RESULTADOS_BUSCAR_EXACTO);
  };
  const apertura: Pick<DependenciasOrdenes, 'abrirResultado' | 'buscarExacto' | 'avisar'> = {
    abrirResultado,
    buscarExacto,
    avisar: informar,
  };

  const ordenes = registrarVistaOrdenes(context, {
    ...apertura,
    sistemaActivo: opciones.sistemaActivo,
    servicio,
    usuarioDe: (destino) => destinoPorId(destino)?.usuario,
    motivoSinRfc,
    credencialGuardada,
    conectar,
  });

  registrarOrdenObjeto(context, {
    objeto: () => opciones.proveedorObjeto.objeto,
    servicio,
    asegurarSesion: abrirSesionRfc,
    elegirOrden: elegirOrdenConQuickPick,
    elegirObjeto: elegirObjetoConQuickPick,
    abrirObjeto: (objeto, destino) => abrirObjetoDeOrden(objeto, destino, apertura),
    copiar,
    organizadorOficial: () => enfocarVistaOficial(COMANDO_FOCO_TRANSPORTES),
    avisar: advertir,
    informar,
  });

  const cambioEditor = new vscode.EventEmitter<vscode.Uri | undefined>();
  context.subscriptions.push(
    cambioEditor,
    vscode.window.onDidChangeActiveTextEditor((editor) => cambioEditor.fire(editor?.document.uri)),
  );
  const versiones = registrarVistaVersiones(context, {
    editorActivo: () => vscode.window.activeTextEditor?.document.uri,
    onCambioEditor: cambioEditor.event,
    servicio,
    proveedorFuente,
    credencialGuardada,
    motivoSinRfc,
    conectar,
    abrirDiff: abrirDiffVscode,
    mostrar: async (uri) => {
      await vscode.window.showTextDocument(uri);
    },
    copiar,
    avisar: informar,
  });

  const describirSistema = (id: string): string =>
    [rolDe(opciones.config(), id) ?? 'rol sin definir', sesiones.viaDe(id)].filter(Boolean).join(' · ');
  const comparar: DependenciasCompararSistemas = {
    documento: () => documentoComparableDe(vscode.window.activeTextEditor?.document.uri, opciones.proveedorObjeto.objeto),
    destinos: () => opciones.destinos(),
    rolDe: (id) => rolDe(opciones.config(), id),
    compararConDe: (id) => compararConDe(opciones.config(), id),
    guardarCompararCon: (id, ids) => opciones.fijarCompararCon(id, ids),
    sesionSilenciosa: (id) => sesiones.sesionSilenciosa(id),
    sesion: (id) => sesiones.sesion(id),
    motivoSinRfc,
    archivosDe: archivosDeVscode,
    servicio,
    leerLocal: leerLocalVscode,
    elegirHermanos: crearElegirHermanos(describirSistema),
    elegirResultado: elegirResultadoConQuickPick,
    abrirDiff: abrirDiffVscode,
    conProgreso: conProgresoNotificacion,
    avisar: informar,
    ofrecerCambiar: ofrecerCambiarConAviso,
    yaPropuestos: new Set<string>(),
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(COMANDO_CONFIGURAR_COMPARAR, async () => {
      try {
        const resultado = await configurarSistemasAComparar(comparar);
        log.info(`Comparar: elegir sistemas → ${resultado}`);
        return resultado;
      } catch (err) {
        log.warn(`Falló elegir sistemas a comparar (${nombreDeError(err)})`);
        await vscode.window.showErrorMessage(mensajeDe(err));
        return undefined;
      }
    }),
  );

  return { servicio, proveedorFuente, ordenes, versiones, compararSistemas: () => compararConOtrosSistemas(comparar) };
}
