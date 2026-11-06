import {
  analizarNombreAff,
  analizarUriAbap,
  rutaDeObjeto,
  tipoObjetoDe,
  type TipoObjeto,
  type UriMinimo,
} from '../bridge/adt-uri';
import { analizarRutaBloque, uriOrigenDe } from '../bloques/bloque-modelo';
import { esProtegido, type RolSistema } from '../config/navegador-config';
import { esEvento, type SimboloDocumento } from '../tree/objeto-modelo';

export const MAX_TEXTO_SELECCION = 4000;
/** `contexto_actual` no espera más que esto al release: si vence, lo omite. */
export const TIEMPO_RELEASE_MS = 3000;

/** El valor de `promesa` o undefined si `esperar(ms)` termina antes. */
export function conTope<T>(promesa: Promise<T>, ms: number, esperar: (ms: number) => Promise<void>): Promise<T | undefined> {
  return Promise.race([promesa, esperar(ms).then(() => undefined)]);
}

/** Líneas y columnas 0-based, como en VS Code. */
export interface FotoEditor {
  uri: UriMinimo;
  linea: number;
  columna: number;
  seleccion?: { desdeLinea: number; hastaLinea: number; texto: string };
  esActivo: boolean;
}

export interface PropuestaPendiente {
  id: string;
  resumen: string;
  uri: string;
}

export interface ResumenDiario {
  entradas: number;
  ultima?: string;
  archivo: string;
}

export interface EntradaContexto {
  /** El abap:/bloque activo o el último que lo fue. */
  editor?: FotoEditor;
  origenEditor: 'activo' | 'ultimoEditor' | 'ninguno';
  /** Símbolos del archivo origen del editor ([] si no hay). */
  simbolos: SimboloDocumento[];
  editoresAbiertos: FotoEditor[];
  sistemaActivo?: string;
  rolDe(id: string): RolSistema | undefined;
  viaDe(id: string): string | undefined;
  /** Release ya conocido del sistema, resuelto antes de llamar. */
  releaseDe(id: string): string | undefined;
  modoBloque: boolean;
  propuestasPendientes: PropuestaPendiente[];
  /** Resumen del diario del objeto del editor, ya resuelto. */
  diario?: ResumenDiario;
}

/** Líneas y columnas 1-based en la salida. */
export interface ContextoActual {
  sistema?: { id: string; rol?: RolSistema; via?: string; release?: string; origen: 'editor' | 'sistemaActivo' };
  objeto?: { tipo: TipoObjeto; nombre: string; paquete: string; uriRaiz: string };
  archivo?: {
    uri: string;
    nombre: string;
    esInclude: boolean;
    include?: string;
    bloque?: { tipo: 'method' | 'form'; nombre: string };
  };
  cursor?: { linea: number; columna: number };
  bloque?: { tipo: 'method' | 'form' | 'event'; nombre: string };
  diario?: ResumenDiario;
  seleccion?: { desdeLinea: number; hastaLinea: number; texto: string; recortada: boolean };
  soloLectura: boolean;
  modoBloque: boolean;
  origenEditor: EntradaContexto['origenEditor'];
  editoresAbiertos: { uri: string; objeto?: string; sistema?: string; esActivo: boolean }[];
  propuestasPendientes: PropuestaPendiente[];
}

type Bloque = NonNullable<ContextoActual['bloque']>;
type Objeto = NonNullable<ContextoActual['objeto']>;
type Abierto = ContextoActual['editoresAbiertos'][number];

function contiene(simbolo: SimboloDocumento, linea: number): boolean {
  return linea >= simbolo.rango[0] && linea <= simbolo.rango[2];
}

function bloqueDe(simbolo: SimboloDocumento): Bloque | undefined {
  if (simbolo.nombreKind === 'Function') {
    return { tipo: 'form', nombre: simbolo.nombre };
  }
  if (simbolo.nombreKind === 'Method') {
    return { tipo: 'method', nombre: simbolo.nombre };
  }
  if (simbolo.nombreKind === 'Object' && esEvento(simbolo.nombre)) {
    return { tipo: 'event', nombre: simbolo.nombre };
  }
  return undefined;
}

/** `linea` 0-based, como los rangos de los símbolos. */
export function bloqueBajoCursor(simbolos: SimboloDocumento[], linea: number): ContextoActual['bloque'] {
  for (const simbolo of simbolos.filter((s) => contiene(s, linea))) {
    if (simbolo.nombreKind === 'Class') {
      const metodo = simbolo.hijos.find((h) => h.nombreKind === 'Method' && contiene(h, linea));
      if (metodo !== undefined) {
        return bloqueDe(metodo);
      }
      continue;
    }
    const bloque = bloqueDe(simbolo);
    if (bloque !== undefined) {
      return bloque;
    }
  }
  return undefined;
}

export function uriTexto(uri: UriMinimo): string {
  return `${uri.scheme}:${uri.path}`;
}

function datosDeEditor(editor: FotoEditor): { destino?: string; objeto?: Objeto } {
  const analizada = analizarUriAbap(uriOrigenDe(editor.uri));
  if (analizada === undefined) {
    return {};
  }
  const { objeto } = analizada;
  if (objeto === undefined) {
    return { destino: analizada.destino };
  }
  const tipoAff = analizada.archivo === undefined ? undefined : analizarNombreAff(analizada.archivo)?.tipo;
  return {
    destino: analizada.destino,
    objeto: {
      tipo: tipoObjetoDe(objeto.tipoCarpeta, tipoAff),
      nombre: objeto.nombre,
      paquete: objeto.paquete,
      uriRaiz: rutaDeObjeto(analizada.destino, objeto),
    },
  };
}

function archivoDe(editor: FotoEditor, objeto: Objeto | undefined): NonNullable<ContextoActual['archivo']> {
  const origen = uriOrigenDe(editor.uri);
  const esInclude = objeto?.tipo === 'include';
  const archivo: NonNullable<ContextoActual['archivo']> = {
    uri: uriTexto(origen),
    nombre: origen.path.slice(origen.path.lastIndexOf('/') + 1),
    esInclude,
  };
  if (esInclude && objeto !== undefined) {
    archivo.include = objeto.nombre;
  }
  const ruta = origen === editor.uri ? undefined : analizarRutaBloque(editor.uri.path);
  if (ruta !== undefined) {
    archivo.bloque = { tipo: ruta.tipo, nombre: ruta.nombre };
  }
  return archivo;
}

function seleccionDe(seleccion: FotoEditor['seleccion']): ContextoActual['seleccion'] {
  if (seleccion === undefined) {
    return undefined;
  }
  return {
    desdeLinea: seleccion.desdeLinea + 1,
    hastaLinea: seleccion.hastaLinea + 1,
    texto: seleccion.texto.slice(0, MAX_TEXTO_SELECCION),
    recortada: seleccion.texto.length > MAX_TEXTO_SELECCION,
  };
}

function abiertoDe(editor: FotoEditor): Abierto {
  const { destino, objeto } = datosDeEditor(editor);
  const abierto: Abierto = { uri: uriTexto(uriOrigenDe(editor.uri)), esActivo: editor.esActivo };
  if (objeto !== undefined) {
    abierto.objeto = objeto.nombre;
  }
  if (destino !== undefined) {
    abierto.sistema = destino;
  }
  return abierto;
}

export function contextoActualDe(entrada: EntradaContexto): ContextoActual {
  const { editor } = entrada;
  const datos = editor === undefined ? {} : datosDeEditor(editor);
  const idSistema = datos.destino ?? entrada.sistemaActivo;
  const rol = idSistema === undefined ? undefined : entrada.rolDe(idSistema);
  const contexto: ContextoActual = {
    soloLectura: esProtegido(rol),
    modoBloque: entrada.modoBloque,
    origenEditor: entrada.origenEditor,
    editoresAbiertos: entrada.editoresAbiertos.map(abiertoDe),
    propuestasPendientes: entrada.propuestasPendientes,
  };
  if (idSistema !== undefined) {
    contexto.sistema = {
      id: idSistema,
      rol,
      via: entrada.viaDe(idSistema),
      origen: datos.destino === undefined ? 'sistemaActivo' : 'editor',
    };
    const release = entrada.releaseDe(idSistema);
    if (release !== undefined) {
      contexto.sistema.release = release;
    }
  }
  if (editor === undefined) {
    return contexto;
  }
  if (datos.objeto !== undefined) {
    contexto.objeto = datos.objeto;
  }
  const archivo = archivoDe(editor, datos.objeto);
  contexto.archivo = archivo;
  contexto.cursor = { linea: editor.linea + 1, columna: editor.columna + 1 };
  contexto.bloque = archivo.bloque ?? bloqueBajoCursor(entrada.simbolos, editor.linea);
  if (entrada.diario !== undefined && entrada.diario.entradas > 0) {
    contexto.diario = entrada.diario;
  }
  const seleccion = seleccionDe(editor.seleccion);
  if (seleccion !== undefined) {
    contexto.seleccion = seleccion;
  }
  return contexto;
}
