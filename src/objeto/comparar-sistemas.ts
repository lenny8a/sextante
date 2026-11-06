import * as vscode from 'vscode';
import {
  compararFuentes,
  extensionDe,
  includeDeArchivo,
  normalizarFuente,
  piezasDe,
  type PiezaFuente,
} from '../adt/fuente-adt';
import type { ResultadoSesion } from '../adt/sesiones';
import {
  analizarNombreAff,
  analizarUriAbap,
  archivoPrincipal,
  rutaDeObjeto,
  tipoObjetoDe,
  type TipoObjeto,
} from '../bridge/adt-uri';
import type { Destino } from '../config/destinos';
import type { RolSistema } from '../config/navegador-config';
import { log } from '../log';
import type { ObjetoAbierto } from '../tree/objeto-proveedor';
import { nombreDeError } from '../util/errores';
import { uriFuente } from './documento-fuente';
import {
  BOTON_CAMBIAR,
  ETIQUETA_CAMBIAR,
  MSG_SIN_OBJETO,
  MSG_SIN_OTRO_SISTEMA,
  candidatosConGuardados,
  consolidar,
  hermanosPropuestos,
  nuevosDeLaFamilia,
  ordenarPorRol,
  piezaParaDiff,
  resumenDe,
  tituloComparacion,
  type CandidatoHermano,
  type EstadoPieza,
  type PiezaComparada,
  type ResultadoSistema,
} from './comparar-sistemas-modelo';
import type { ResultadoFuente, ServicioObjeto } from './servicio';

export type ResultadoComparar = 'sinObjeto' | 'sinOtroSistema' | 'cancelado' | 'abierto' | 'resumen';
export type ResultadoConfigurarComparar = 'sinObjeto' | 'sinOtroSistema' | 'cancelado' | 'guardado';

export interface DocumentoComparable {
  uri: vscode.Uri;
  destino: string;
  tipo: TipoObjeto;
  nombre: string;
  archivos: string[];
  archivo?: string;
  /** El editor es de otro objeto que el de la vista: `archivos` es solo el abierto y se completa listando la carpeta. */
  archivosPendientes?: boolean;
}

export interface DependenciasCompararSistemas {
  /** Editor activo `abap:` de código; si no, el archivo principal del objeto de la vista Objeto. */
  documento(): DocumentoComparable | undefined;
  destinos(): Destino[];
  rolDe(id: string): RolSistema | undefined;
  compararConDe(id: string): string[] | undefined;
  guardarCompararCon(id: string, ids: string[]): Promise<void>;
  sesionSilenciosa(id: string): Promise<ResultadoSesion>;
  /** Pide la contraseña si hace falta. */
  sesion(id: string): Promise<ResultadoSesion>;
  /** SSO, SNC, sin puente… */
  motivoSinRfc(id: string): string | undefined;
  /** Nombres de los archivos de la carpeta del objeto en el repotree. */
  archivosDe(carpeta: vscode.Uri): Promise<string[]>;
  servicio: Pick<ServicioObjeto, 'fuente'>;
  leerLocal(uri: vscode.Uri): Promise<string>;
  elegirHermanos(candidatos: CandidatoHermano[]): Promise<string[] | undefined>;
  /** Un sistema igual/distinto abre el diff; sin conexión pide la contraseña y repite; el resto no hace nada. */
  elegirResultado(resultados: ResultadoSistema[]): Promise<{ destino: string } | 'cambiar' | undefined>;
  abrirDiff(izquierda: vscode.Uri, derecha: vscode.Uri, titulo: string): Promise<void>;
  conProgreso<T>(titulo: string, tarea: () => Promise<T>): Promise<T>;
  avisar(mensaje: string): void;
  /** Aviso del resultado único con el botón «Cambiar sistemas…»; pulsarlo llama a `cambiar`. No bloquea el diff. */
  ofrecerCambiar(mensaje: string, cambiar: () => Promise<void>): void;
  /** `destino|candidatos nuevos` ya propuestos en esta sesión de VS Code: no se vuelve a preguntar. */
  yaPropuestos: Set<string>;
}

const EXTENSIONES_CODIGO = ['.abap', '.acds', '.ddic'];
const TIPOS_DICCIONARIO: readonly TipoObjeto[] = ['tabla', 'estructura', 'cds'];
const TITULO_PROGRESO = 'Comparando con otros sistemas…';

function esArchivoDeCodigo(archivo: string | undefined): archivo is string {
  return archivo !== undefined && EXTENSIONES_CODIGO.some((extension) => archivo.endsWith(extension));
}

export function documentoComparableDe(editor: vscode.Uri | undefined, objeto: ObjetoAbierto | undefined): DocumentoComparable | undefined {
  const analisis = editor === undefined ? undefined : analizarUriAbap(editor);
  if (editor !== undefined && analisis?.objeto !== undefined && esArchivoDeCodigo(analisis.archivo)) {
    const mismo = objeto?.analisis.destino === analisis.destino && objeto.objeto.nombre === analisis.objeto.nombre;
    return {
      uri: editor,
      destino: analisis.destino,
      tipo: tipoObjetoDe(analisis.objeto.tipoCarpeta, analizarNombreAff(analisis.archivo)?.tipo),
      nombre: analisis.objeto.nombre,
      archivos: mismo ? objeto.archivos : [analisis.archivo],
      archivo: analisis.archivo,
      ...(mismo ? {} : { archivosPendientes: true }),
    };
  }
  if (objeto === undefined) {
    return undefined;
  }
  const archivo = archivoPrincipal(objeto.archivos);
  return {
    uri: objeto.uri,
    destino: objeto.analisis.destino,
    tipo: objeto.tipo,
    nombre: objeto.objeto.nombre,
    archivos: objeto.archivos,
    ...(archivo === undefined ? {} : { archivo }),
  };
}

function esDiccionario(documento: DocumentoComparable): boolean {
  return TIPOS_DICCIONARIO.includes(documento.tipo);
}

function uriLocalDe(documento: DocumentoComparable, pieza: PiezaFuente): vscode.Uri | undefined {
  const objeto = analizarUriAbap(documento.uri)?.objeto;
  if (objeto === undefined || pieza.archivo === undefined) {
    return undefined;
  }
  return documento.uri.with({ path: rutaDeObjeto(documento.destino, objeto, pieza.archivo) });
}

function lineasDe(texto: string): number {
  return normalizarFuente(texto).length;
}

function textoEstadoSesion(sesion: ResultadoSesion): string {
  switch (sesion.estado) {
    case 'ok': return 'sin vía RFC';
    case 'sinRest': return 'sin vía RFC';
    case 'sinContrasena': return 'sin contraseña';
    case 'noAutorizado': return 'contraseña rechazada';
    case 'error': return sesion.mensaje;
  }
}

function sinConexion(destino: string, motivo: string, soloArchivo: boolean): ResultadoSistema {
  return { destino, estado: 'sinConexion', piezas: [], motivo, soloArchivo };
}

function usable(sesion: ResultadoSesion): boolean {
  return sesion.estado === 'ok' && sesion.via === 'rfc';
}

async function sinLanzar(abrir: () => Promise<ResultadoSesion>): Promise<ResultadoSesion> {
  try {
    return await abrir();
  } catch (error) {
    return { estado: 'error', mensaje: error instanceof Error ? error.name : 'desconocido' };
  }
}

/** Sesiones de todos los hermanos: las silenciosas en paralelo; las que piden contraseña, en serie. */
async function abrirSesiones(deps: DependenciasCompararSistemas, ids: string[]): Promise<Map<string, ResultadoSesion>> {
  const silenciosas = await Promise.all(ids.map((id) => sinLanzar(() => deps.sesionSilenciosa(id))));
  const sesiones = new Map<string, ResultadoSesion>(ids.map((id, i) => [id, silenciosas[i]]));
  for (const id of ids) {
    if (sesiones.get(id)?.estado === 'sinContrasena') {
      sesiones.set(id, await sinLanzar(() => deps.sesion(id)));
    }
  }
  return sesiones;
}

async function leerLado(
  deps: DependenciasCompararSistemas,
  documento: DocumentoComparable,
  pieza: PiezaFuente,
): Promise<ResultadoFuente> {
  if (esDiccionario(documento)) {
    return deps.servicio.fuente(documento.destino, pieza.rutaFuente);
  }
  const uri = uriLocalDe(documento, pieza);
  if (uri === undefined) {
    return { estado: 'noExiste' };
  }
  try {
    return { estado: 'ok', texto: await deps.leerLocal(uri) };
  } catch {
    return { estado: 'error', mensaje: 'no se pudo leer el fuente local' };
  }
}

type Veredicto = { tipo: 'pieza'; estado: EstadoPieza; lineas: number } | { tipo: 'fallo'; fallo: ResultadoFuente };

function veredictoDe(local: ResultadoFuente, remoto: ResultadoFuente): Veredicto {
  if (local.estado === 'ok' && remoto.estado === 'ok') {
    const c = compararFuentes(local.texto, remoto.texto);
    return { tipo: 'pieza', estado: c.igual ? 'igual' : 'distinto', lineas: c.lineas };
  }
  if (local.estado === 'ok' && remoto.estado === 'noExiste') {
    return { tipo: 'pieza', estado: 'soloAqui', lineas: lineasDe(local.texto) };
  }
  if (local.estado === 'noExiste' && remoto.estado === 'ok') {
    return { tipo: 'pieza', estado: 'soloAlli', lineas: lineasDe(remoto.texto) };
  }
  if (local.estado === 'noExiste' && remoto.estado === 'noExiste') {
    return { tipo: 'pieza', estado: 'noExiste', lineas: 0 };
  }
  return { tipo: 'fallo', fallo: local.estado === 'ok' || local.estado === 'noExiste' ? remoto : local };
}

async function compararHermano(
  deps: DependenciasCompararSistemas,
  documento: DocumentoComparable,
  piezas: PiezaFuente[],
  hermano: string,
  soloArchivo: boolean,
): Promise<ResultadoSistema> {
  const comparadas: PiezaComparada[] = [];
  for (const pieza of piezas) {
    const [local, remoto] = await Promise.all([leerLado(deps, documento, pieza), deps.servicio.fuente(hermano, pieza.rutaFuente)]);
    const veredicto = veredictoDe(local, remoto);
    if (veredicto.tipo === 'fallo') {
      if (veredicto.fallo.estado === 'sinConexion') {
        return sinConexion(hermano, 'sin conexión con el sistema', soloArchivo);
      }
      const motivo = veredicto.fallo.estado === 'error' ? veredicto.fallo.mensaje : 'desconocido';
      return { destino: hermano, estado: 'error', piezas: [], motivo, soloArchivo };
    }
    // Una pieza que no existe en ningún lado (include de clase sin crear) no cuenta.
    if (veredicto.estado !== 'noExiste') {
      comparadas.push({ pieza, estado: veredicto.estado, lineas: veredicto.lineas, uriLocal: uriLocalDe(documento, pieza) });
    }
  }
  // Nada de lo local está en el hermano: el objeto no existe allí.
  const estado = comparadas.length === 0 || comparadas.every((p) => p.estado === 'soloAqui') ? 'noExiste' : consolidar(comparadas);
  return { destino: hermano, estado, piezas: comparadas, soloArchivo };
}

async function compararTodos(
  deps: DependenciasCompararSistemas,
  documento: DocumentoComparable,
  hermanos: string[],
  soloArchivo: boolean,
): Promise<ResultadoSistema[]> {
  const piezas = piezasDe(documento, documento.archivo);
  const sesiones = await abrirSesiones(deps, hermanos);
  const resultados = await Promise.all(
    hermanos.map(async (id): Promise<ResultadoSistema> => {
      const sesion = sesiones.get(id);
      if (sesion === undefined || !usable(sesion)) {
        return sinConexion(id, deps.motivoSinRfc(id) ?? (sesion === undefined ? 'sin sesión' : textoEstadoSesion(sesion)), soloArchivo);
      }
      return compararHermano(deps, documento, piezas, id, soloArchivo);
    }),
  );
  const cuenta = (estado: ResultadoSistema['estado']): number => resultados.filter((r) => r.estado === estado).length;
  log.info(
    `Comparar: ${resultados.length} sistemas → igual ${cuenta('igual')}, distinto ${cuenta('distinto')}, no existe ${cuenta('noExiste')}, sin conexión ${cuenta('sinConexion')}`,
  );
  return resultados;
}

async function abrirComparacion(deps: DependenciasCompararSistemas, documento: DocumentoComparable, r: ResultadoSistema): Promise<boolean> {
  const comparada = piezaParaDiff(r, documento.archivo === undefined ? undefined : includeDeArchivo(documento.archivo));
  if (comparada === undefined) {
    return false;
  }
  const { pieza } = comparada;
  const clave = { ruta: pieza.rutaFuente, nombre: pieza.nombre, extension: extensionDe(pieza.archivo) };
  const remoto = uriFuente({ ...clave, destino: r.destino, etiqueta: r.destino });
  const local = esDiccionario(documento)
    ? uriFuente({ ...clave, destino: documento.destino, etiqueta: documento.destino })
    : uriLocalDe(documento, pieza);
  if (local === undefined) {
    return false;
  }
  const detalle = pieza.include !== undefined && pieza.include !== 'main' ? ` · ${pieza.etiqueta}` : '';
  const titulo = tituloComparacion(`${documento.nombre.toUpperCase()}${detalle}`, r.destino, documento.destino);
  await deps.abrirDiff(remoto, local, titulo);
  return true;
}

function candidatosDe(deps: DependenciasCompararSistemas, documento: DocumentoComparable): CandidatoHermano[] {
  const destinos = deps.destinos();
  const actual = destinos.find((d) => d.id === documento.destino) ?? { id: documento.destino, protocolo: '', ssoActivado: false };
  return hermanosPropuestos(actual, destinos);
}

function guardadosDe(deps: DependenciasCompararSistemas, documento: DocumentoComparable): string[] {
  const existentes = new Set(deps.destinos().map((d) => d.id));
  return (deps.compararConDe(documento.destino) ?? []).filter((id) => existentes.has(id) && id !== documento.destino);
}

/** QuickPick de hermanos con los guardados preseleccionados; guarda la elección. `undefined` = cancelado o nada elegido. */
async function elegirYGuardar(deps: DependenciasCompararSistemas, documento: DocumentoComparable): Promise<string[] | undefined> {
  const candidatos = candidatosDe(deps, documento);
  if (candidatos.length === 0) {
    return undefined;
  }
  const elegidos = await deps.elegirHermanos(candidatosConGuardados(candidatos, guardadosDe(deps, documento)));
  if (elegidos === undefined || elegidos.length === 0) {
    return undefined;
  }
  await deps.guardarCompararCon(documento.destino, elegidos);
  log.info(`Comparar: sistemas elegidos → ${elegidos.length}`);
  return elegidos;
}

/** Hay hermanos de la familia (o del router) sin guardar: se propone elegir, una vez por sesión; cancelar deja los guardados. */
async function proponerNuevos(deps: DependenciasCompararSistemas, documento: DocumentoComparable, guardados: string[]): Promise<string[]> {
  const nuevos = nuevosDeLaFamilia(candidatosDe(deps, documento), guardados);
  const clave = `${documento.destino}|${nuevos.join(',')}`;
  if (nuevos.length === 0 || deps.yaPropuestos.has(clave)) {
    return guardados;
  }
  deps.yaPropuestos.add(clave);
  log.info(`Comparar: ${nuevos.length} sistemas nuevos de la familia sin elegir; se propone`);
  return (await elegirYGuardar(deps, documento)) ?? guardados;
}

/** `undefined` = cancelado; `[]` = no hay con qué comparar. */
async function resolverHermanos(deps: DependenciasCompararSistemas, documento: DocumentoComparable): Promise<string[] | undefined> {
  const guardados = guardadosDe(deps, documento);
  if (guardados.length > 0) {
    return proponerNuevos(deps, documento, guardados);
  }
  const candidatos = candidatosDe(deps, documento);
  if (candidatos.length === 0) {
    return [];
  }
  const elegidos = candidatos.length === 1 ? [candidatos[0].destino.id] : await deps.elegirHermanos(candidatos);
  if (elegidos === undefined || elegidos.length === 0) {
    return undefined;
  }
  await deps.guardarCompararCon(documento.destino, elegidos);
  return elegidos;
}

/** Lista la carpeta del objeto para comparar la clase entera; `undefined` si no se pudo. */
async function completarArchivos(deps: DependenciasCompararSistemas, documento: DocumentoComparable): Promise<DocumentoComparable | undefined> {
  const objeto = analizarUriAbap(documento.uri)?.objeto;
  if (objeto === undefined) {
    return undefined;
  }
  try {
    const archivos = await deps.archivosDe(documento.uri.with({ path: rutaDeObjeto(documento.destino, objeto) }));
    return archivos.length === 0 ? undefined : { ...documento, archivos, archivosPendientes: false };
  } catch {
    return undefined;
  }
}

async function compararConOtrosSistemasDe(deps: DependenciasCompararSistemas, documento: DocumentoComparable): Promise<ResultadoComparar> {
  let soloArchivo = documento.tipo === 'grupoFunciones';
  if (documento.archivosPendientes === true) {
    const completo = await completarArchivos(deps, documento);
    soloArchivo = soloArchivo || completo === undefined;
    documento = completo ?? documento;
  }
  let hermanos = await resolverHermanos(deps, documento);
  if (hermanos === undefined) {
    return 'cancelado';
  }
  if (hermanos.length === 0) {
    deps.avisar(MSG_SIN_OTRO_SISTEMA);
    return 'sinOtroSistema';
  }
  for (;;) {
    const ordenados = ordenarPorRol(hermanos, deps.rolDe);
    const resultados = await deps.conProgreso(TITULO_PROGRESO, () => compararTodos(deps, documento, ordenados, soloArchivo));
    if (resultados.length === 1) {
      const [unico] = resultados;
      deps.ofrecerCambiar(`${unico.destino}: ${resumenDe(unico).texto}`, async () => {
        await elegirYGuardar(deps, documento);
      });
      if (unico.estado === 'igual' || unico.estado === 'distinto') {
        await abrirComparacion(deps, documento, unico);
        return 'abierto';
      }
      return 'resumen';
    }
    const eleccion = await deps.elegirResultado(resultados);
    if (eleccion === undefined) {
      return 'resumen';
    }
    if (eleccion === 'cambiar') {
      const elegidos = await elegirYGuardar(deps, documento);
      if (elegidos === undefined) {
        return 'resumen';
      }
      hermanos = elegidos;
      continue;
    }
    const elegido = resultados.find((r) => r.destino === eleccion.destino);
    if (elegido === undefined) {
      return 'resumen';
    }
    if (elegido.estado === 'sinConexion') {
      await deps.sesion(elegido.destino);
      continue;
    }
    if (elegido.estado === 'igual' || elegido.estado === 'distinto') {
      await abrirComparacion(deps, documento, elegido);
      return 'abierto';
    }
    return 'resumen';
  }
}

export async function compararConOtrosSistemas(deps: DependenciasCompararSistemas): Promise<ResultadoComparar> {
  const documento = deps.documento();
  if (documento === undefined) {
    deps.avisar(MSG_SIN_OBJETO);
    return 'sinObjeto';
  }
  return compararConOtrosSistemasDe(deps, documento);
}

/** «Comparar con otro sistema: elegir sistemas…» de la paleta: el QuickPick de hermanos del destino del objeto. */
export async function configurarSistemasAComparar(deps: DependenciasCompararSistemas): Promise<ResultadoConfigurarComparar> {
  const documento = deps.documento();
  if (documento === undefined) {
    deps.avisar(MSG_SIN_OBJETO);
    return 'sinObjeto';
  }
  if (candidatosDe(deps, documento).length === 0) {
    deps.avisar(MSG_SIN_OTRO_SISTEMA);
    return 'sinOtroSistema';
  }
  return (await elegirYGuardar(deps, documento)) === undefined ? 'cancelado' : 'guardado';
}

interface ItemResultado extends vscode.QuickPickItem {
  eleccion: { destino: string } | 'cambiar';
}

export function crearElegirHermanos(describir: (id: string) => string): DependenciasCompararSistemas['elegirHermanos'] {
  return async (candidatos) => {
    const elegidos = await vscode.window.showQuickPick(
      candidatos.map((c) => ({ label: c.destino.id, description: describir(c.destino.id), picked: c.propuesto })),
      { canPickMany: true, placeHolder: 'Sistemas con los que comparar', ignoreFocusOut: true },
    );
    return elegidos?.map((e) => e.label);
  };
}

export const elegirResultadoConQuickPick: DependenciasCompararSistemas['elegirResultado'] = async (resultados) => {
  const items: ItemResultado[] = resultados.map((r) => {
    const { icono, texto } = resumenDe(r);
    return { label: `$(${icono}) ${r.destino}`, description: texto, eleccion: { destino: r.destino } };
  });
  items.push({ label: `$(gear) ${ETIQUETA_CAMBIAR}`, eleccion: 'cambiar' });
  const elegido = await vscode.window.showQuickPick(items, { placeHolder: 'Resultado por sistema' });
  return elegido?.eleccion;
};

export const ofrecerCambiarConAviso: DependenciasCompararSistemas['ofrecerCambiar'] = (mensaje, cambiar) => {
  void vscode.window.showInformationMessage(mensaje, BOTON_CAMBIAR).then(async (boton) => {
    if (boton !== BOTON_CAMBIAR) {
      return;
    }
    try {
      await cambiar();
    } catch (error) {
      log.warn(`Falló Cambiar sistemas (${nombreDeError(error)})`);
    }
  });
};

export const conProgresoNotificacion: DependenciasCompararSistemas['conProgreso'] = (titulo, tarea) =>
  Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: titulo }, () => tarea()));

export const abrirDiffVscode: DependenciasCompararSistemas['abrirDiff'] = async (izquierda, derecha, titulo) => {
  await vscode.commands.executeCommand('vscode.diff', izquierda, derecha, titulo);
};

export const archivosDeVscode: DependenciasCompararSistemas['archivosDe'] = async (carpeta) =>
  (await vscode.workspace.fs.readDirectory(carpeta)).map(([nombre]) => nombre);

export const leerLocalVscode: DependenciasCompararSistemas['leerLocal'] = async (uri) =>
  (await vscode.workspace.openTextDocument(uri)).getText();
