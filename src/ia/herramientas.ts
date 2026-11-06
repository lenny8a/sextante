import type { ResultadoAbrir } from '../adt/abrir-resultado';
import { FILTROS_TIPO, type ResultadoBusqueda } from '../adt/busqueda-modelo';
import type { EstadoDestino } from '../bridge/logon-oficial';
import type { NodoObjeto } from '../tree/objeto-modelo';
import type { ContextoActual } from './contexto-modelo';
import { ESQUEMAS } from './esquemas';
import {
  MAX_LINEAS_POR_DEFECTO,
  contarLineas,
  formatearPrograma,
  numerarLineas,
  rangoValido,
  recopilarPrograma,
} from './lectura-modelo';
import type { HerramientaMcp, ResultadoHerramienta } from './mcp-modelo';

export const ESPERA_LOGON_MS = 60_000;
const INTERVALO_ESTADO_MS = 500;
const ESQUEMA = 'abap:';

export interface DependenciasHerramientas {
  contexto(): Promise<ContextoActual>;
  /** Editor actual → sistema activo. */
  sistemaPorDefecto(): string | undefined;
  /** `silencioso` en los sondeos de la espera del logon: sin avisos en el log por cada vuelta. */
  estadoDe(id: string, silencioso?: boolean): Promise<EstadoDestino>;
  /** Flujo "Conectar" de Sextante en la ventana del usuario. */
  conectar(id: string): Promise<void>;
  consultar(destino: string, texto: string, filtroId?: string): Promise<ResultadoBusqueda[]>;
  abrirResultado(r: ResultadoBusqueda, destino: string): Promise<{ resultado: ResultadoAbrir; ruta?: string }>;
  viaDe(id: string): string | undefined;
  leerTexto(ruta: string): Promise<string | undefined>;
  /** Árbol del objeto como lo muestra la vista Objeto. */
  arbolDe(ruta: string): Promise<NodoObjeto | undefined>;
  ahora?(): number;
  esperar?(ms: number): Promise<void>;
}

type TipoAbrir = 'PROG' | 'CLAS' | 'INTF' | 'FUGR' | 'TABL' | 'DDLS' | 'INCL';

/** Tipo de `abrir_objeto` → id de `FILTROS_TIPO`. */
export const TIPOS_ABRIR: Record<TipoAbrir, string> = {
  PROG: 'programa',
  CLAS: 'clase',
  INTF: 'interfaz',
  FUGR: 'grupo-funciones',
  TABL: 'tabla',
  DDLS: 'cds',
  INCL: 'include',
};

interface NodoEstructura {
  etiqueta: string;
  clase: string;
  nombreKind?: string;
  nombreInclude?: string;
  /** Archivo donde están las líneas de `rango`: es la uri que hay que pasar a `leer_archivo`. */
  uri?: string;
  rango?: { desdeLinea: number; hastaLinea: number };
  hijos: NodoEstructura[];
}

/** Error cuyo mensaje ya está escrito para el agente: la herramienta lo devuelve tal cual. */
export class ErrorHerramienta extends Error {}

interface Espera {
  promesa: Promise<void>;
  cancelar(): void;
}

const DESCRIPCIONES = {
  contexto_actual:
    'Llama a esta herramienta al empezar y antes de cada edición. Devuelve el sistema (rol y vía), el objeto y el archivo ' +
    'del editor activo, el cursor, el bloque bajo el cursor, la selección y si el editor es de solo lectura; líneas y columnas ' +
    'desde 1. Después usa archivo.uri en leer_programa, leer_archivo o estructura_objeto.',
  abrir_objeto:
    'Úsala para abrir en el editor del usuario un objeto que no esté abierto, antes de leerlo. Busca por nombre exacto ' +
    '(acota con tipo si lo sabes). Si el sistema no tiene logon, se lo pide al usuario en VS Code y espera hasta 60 s; si ' +
    'responde que está esperando el logon, vuelve a llamar. Devuelve uri, tipo, paquete y nombre; si no hay un único objeto con ' +
    'ese nombre exacto, lista los candidatos sin abrir y debes volver a llamar con el nombre exacto (y el tipo). Después llama ' +
    'a leer_programa con la uri.',
  abrir_transaccion:
    'Úsala cuando el usuario hable de una transacción: resuelve por RFC el programa o la clase que ejecuta y lo abre en el ' +
    'editor. Solo funciona si el sistema va por RFC. El logon funciona como en abrir_objeto. Devuelve la uri de lo abierto; ' +
    'después llama a leer_programa con ella.',
  leer_programa:
    'Llama a esta herramienta antes de proponer cualquier cambio: lee el programa completo, el archivo de la uri y cada ' +
    'include alcanzable (hasta 40 archivos), cada uno con la cabecera "=== ruta (n líneas) ===" y números de línea desde 1. ' +
    'Si un archivo se corta, sigue con leer_archivo desde la línea que se indica.',
  leer_archivo:
    'Úsala para leer un tramo de un archivo, por ejemplo lo que leer_programa cortó o el bloque que te dio estructura_objeto: ' +
    'devuelve las líneas desdeLinea..hastaLinea (desde 1, ambas incluidas) numeradas.',
  estructura_objeto:
    'Úsala para orientarte en un objeto grande antes de leerlo por tramos: devuelve el árbol SE80/SE24 del objeto (secciones, ' +
    'métodos, FORMs, includes) con nombreKind y rango de líneas desde 1. Cada nodo puede traer uri: es el archivo donde ' +
    'están esas líneas (puede ser un include distinto del que pediste). El objeto tiene que estar abierto en el editor; si ' +
    'no, llama antes a abrir_objeto. Después lee el bloque con leer_archivo usando el rango del nodo y su uri (si no trae, la ' +
    'del nodo antecesor más cercano que la tenga).',
  editores_abiertos:
    'Úsala para saber qué objetos ABAP tiene abiertos el usuario: lista los editores abap: con uri, objeto, sistema y cuál ' +
    'es el activo. Después lee el que te interese con leer_programa pasando su uri.',
} as const;

/** Quita el esquema `abap:` y descodifica el path (`%20` → espacio); un `%` mal formado deja el path tal cual. */
export function rutaDeUriTexto(uri: string): string {
  const ruta = uri.startsWith(ESQUEMA) ? uri.slice(ESQUEMA.length) : uri;
  try {
    return decodeURIComponent(ruta);
  } catch {
    return ruta;
  }
}

export const MSG_SEGMENTOS_RELATIVOS = 'la uri contiene segmentos de ruta no válidos (".", ".." o vacíos)';

/**
 * true si algún segmento tras la barra inicial es vacío, `.` o `..`: una ruta así podría pasar el control de rol con un
 * destino y resolverse en otro. Recibe la ruta ya descodificada por `rutaDeUriTexto` (`%2E%2E` ya es `..`).
 */
export function tieneSegmentosRelativos(ruta: string): boolean {
  const sinBarraInicial = ruta.startsWith('/') ? ruta.slice(1) : ruta;
  return sinBarraInicial.split('/').some((segmento) => segmento === '' || segmento === '.' || segmento === '..');
}

function uriDeRuta(ruta: string): string {
  return ruta.startsWith(ESQUEMA) ? ruta : `${ESQUEMA}${ruta}`;
}

export function resultadoJson(valor: unknown): ResultadoHerramienta {
  return { texto: JSON.stringify(valor, null, 1) };
}

export function resultadoError(texto: string): ResultadoHerramienta {
  return { texto, esError: true };
}

export function argTexto(args: Record<string, unknown>, nombre: string): string | undefined {
  const valor = args[nombre];
  return typeof valor === 'string' ? valor : undefined;
}

function entero(args: Record<string, unknown>, nombre: string): number | undefined {
  const valor = args[nombre];
  return typeof valor === 'number' ? valor : undefined;
}

function esTipoAbrir(valor: string | undefined): valor is TipoAbrir {
  return valor !== undefined && Object.hasOwn(TIPOS_ABRIR, valor);
}

/** `ruta` es el path absoluto de un archivo fuera de la carpeta; `archivo`, un nombre dentro de la carpeta del objeto. */
function uriDeNodo(nodo: NodoObjeto, carpeta: string): string | undefined {
  if (nodo.ruta !== undefined) {
    return uriDeRuta(nodo.ruta);
  }
  return nodo.archivo === undefined ? undefined : uriDeRuta(`${carpeta}/${nodo.archivo}`);
}

function estructuraDe(nodo: NodoObjeto, carpeta: string): NodoEstructura {
  const salida: NodoEstructura = { etiqueta: nodo.etiqueta, clase: nodo.clase, hijos: [] };
  if (nodo.nombreKind !== undefined) {
    salida.nombreKind = nodo.nombreKind;
  }
  if (nodo.nombreInclude !== undefined) {
    salida.nombreInclude = nodo.nombreInclude;
  }
  const uri = uriDeNodo(nodo, carpeta);
  if (uri !== undefined) {
    salida.uri = uri;
  }
  if (nodo.rango !== undefined) {
    salida.rango = { desdeLinea: nodo.rango[0] + 1, hastaLinea: nodo.rango[2] + 1 };
  }
  salida.hijos = nodo.hijos.map((hijo) => estructuraDe(hijo, carpeta));
  return salida;
}

function carpetaDe(ruta: string): string {
  return ruta.slice(0, ruta.lastIndexOf('/'));
}

function mensajeNoAbierto(resultado: Exclude<ResultadoAbrir, 'abierto'>, nombre: string, destino: string): string {
  switch (resultado) {
    case 'noLocalizado':
      return `${nombre} existe en ${destino} pero la extensión oficial no lo localiza en su árbol abap:; pide al usuario que lo abra desde la búsqueda de Sextante`;
    case 'tipoNoSoportado':
      return `La extensión oficial no abre objetos como ${nombre}; no hay código que leer`;
    case 'paquete':
      return `${nombre} es un paquete; indica un objeto concreto con su tipo (PROG, CLAS…)`;
    case 'vista':
      return `${nombre} mantiene una vista; no hay código que abrir`;
    case 'transaccion':
      return `${nombre} es una transacción; usa abrir_transaccion`;
    case 'transaccionSinDestino':
      return `La transacción ${nombre} no ejecuta un programa ni una clase (o no existe)`;
  }
}

export function envolverConProteccion(nombre: string, ejecutar: (args: Record<string, unknown>) => Promise<ResultadoHerramienta>): HerramientaMcp['ejecutar'] {
  return async (args) => {
    try {
      return await ejecutar(args);
    } catch (e) {
      if (e instanceof ErrorHerramienta) {
        return resultadoError(e.message);
      }
      const detalle = e instanceof Error ? e.message : String(e);
      return resultadoError(`${nombre} falló: ${detalle}. Comprueba que el sistema esté conectado y vuelve a intentarlo`);
    }
  };
}

export function crearCatalogoLectura(deps: DependenciasHerramientas): HerramientaMcp[] {
  const ahora = deps.ahora ?? Date.now;
  /** Con `esperar` inyectado no hay nada que cancelar; el temporizador propio se limpia para no dejarlo vivo. */
  const esperaCancelable = (ms: number): Espera => {
    if (deps.esperar !== undefined) {
      return { promesa: deps.esperar(ms), cancelar: () => undefined };
    }
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const promesa = new Promise<void>((resolver) => {
      temporizador = setTimeout(resolver, ms);
    });
    return { promesa, cancelar: () => clearTimeout(temporizador) };
  };
  const esperar = (ms: number): Promise<void> => esperaCancelable(ms).promesa;

  const sistemaDe = (args: Record<string, unknown>): string | undefined => argTexto(args, 'sistema') ?? deps.sistemaPorDefecto();

  const sinSistema = (): ResultadoHerramienta =>
    resultadoError('No sé sobre qué sistema actuar: indica el sistema (destino) en el argumento sistema o pide al usuario que abra un objeto abap: en el editor');

  /** Devuelve el error que hay que dar al agente, o `undefined` si el destino ya está conectado. */
  const asegurarLogon = async (destino: string): Promise<ResultadoHerramienta | undefined> => {
    if ((await deps.estadoDe(destino)) === 'conectado') {
      return undefined;
    }
    const limite = ahora() + ESPERA_LOGON_MS;
    let terminado = false;
    const conexion = deps.conectar(destino).then(
      () => {
        terminado = true;
      },
      () => {
        terminado = true;
      },
    );
    const espera = esperaCancelable(ESPERA_LOGON_MS);
    try {
      await Promise.race([conexion, espera.promesa]);
    } finally {
      espera.cancelar();
    }
    // La oficial puede tardar un momento en dar el destino por conectado tras terminar el flujo.
    let estado = await deps.estadoDe(destino, true);
    while (estado === 'desconocido' && ahora() < limite) {
      await esperar(Math.min(INTERVALO_ESTADO_MS, limite - ahora()));
      estado = await deps.estadoDe(destino, true);
    }
    if (estado === 'conectado') {
      return undefined;
    }
    if (terminado) {
      return resultadoError(
        `El usuario canceló el logon de ${destino} o el logon falló; pídele que conecte el sistema desde la vista Sistemas de Sextante y vuelve a llamar cuando lo haya hecho`,
      );
    }
    return resultadoError(`El destino ${destino} está esperando el logon del usuario en VS Code; vuelve a llamar cuando lo haya hecho`);
  };

  const contextoActual = async (): Promise<ResultadoHerramienta> => resultadoJson(await deps.contexto());

  const editoresAbiertos = async (): Promise<ResultadoHerramienta> => resultadoJson((await deps.contexto()).editoresAbiertos);

  const abrirObjeto = async (args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    const nombre = (argTexto(args, 'nombre') ?? '').toUpperCase();
    const tipo = argTexto(args, 'tipo');
    const destino = sistemaDe(args);
    if (destino === undefined) {
      return sinSistema();
    }
    const fallo = await asegurarLogon(destino);
    if (fallo !== undefined) {
      return fallo;
    }
    const filtroId = esTipoAbrir(tipo) ? TIPOS_ABRIR[tipo] : undefined;
    const resultados = await deps.consultar(destino, nombre, filtroId);
    if (resultados.length === 0) {
      const etiqueta = FILTROS_TIPO.find((f) => f.id === filtroId)?.etiqueta.toLowerCase();
      return etiqueta === undefined
        ? resultadoError(`No hay ningún objeto ${nombre} en ${destino}; comprueba el nombre con el usuario`)
        : resultadoError(`No hay ${etiqueta} ${nombre} en ${destino}; comprueba el nombre o vuelve a llamar sin tipo`);
    }
    // La búsqueda añade `*`: solo se abre un resultado con el nombre exacto; uno parecido se ofrece, nunca se abre.
    const exactos = resultados.filter((r) => r.nombre.toUpperCase() === nombre);
    if (exactos.length !== 1) {
      const candidatos = exactos.length > 1 ? exactos : resultados;
      return resultadoJson({
        candidatos: candidatos.map((r) => ({ nombre: r.nombre, tipo: r.tipo, paquete: r.paquete, descripcion: r.descripcion })),
        indicacion:
          exactos.length > 1
            ? `Hay varios objetos llamados ${nombre} y no se ha abierto ninguno; vuelve a llamar indicando el tipo`
            : `Ningún objeto se llama exactamente ${nombre} y no se ha abierto ninguno; vuelve a llamar con el nombre exacto de un candidato`,
      });
    }
    const elegido = exactos[0];
    const { resultado, ruta } = await deps.abrirResultado(elegido, destino);
    if (resultado !== 'abierto') {
      return resultadoError(mensajeNoAbierto(resultado, elegido.nombre, destino));
    }
    const abierto = { tipo: elegido.tipo, paquete: elegido.paquete, nombre: elegido.nombre };
    return ruta === undefined
      ? resultadoJson({ ...abierto, indicacion: 'Abierto; llama a contexto_actual para obtener su uri' })
      : resultadoJson({ uri: uriDeRuta(ruta), ...abierto });
  };

  const abrirTransaccion = async (args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    const tcode = (argTexto(args, 'tcode') ?? '').toUpperCase();
    const destino = sistemaDe(args);
    if (destino === undefined) {
      return sinSistema();
    }
    const fallo = await asegurarLogon(destino);
    if (fallo !== undefined) {
      return fallo;
    }
    const via = deps.viaDe(destino);
    if (via !== 'rfc') {
      return resultadoError(`La transacción solo se resuelve por RFC; ${destino} va por ${via ?? 'ninguna vía propia'}. Pregunta al usuario qué programa ejecuta y usa abrir_objeto`);
    }
    const busqueda: ResultadoBusqueda = { nombre: tcode, tipo: 'TRAN/T', descripcion: '', paquete: '', uriAdt: '' };
    const { resultado, ruta } = await deps.abrirResultado(busqueda, destino);
    if (resultado !== 'abierto') {
      return resultadoError(mensajeNoAbierto(resultado, tcode, destino));
    }
    return ruta === undefined
      ? resultadoJson({ transaccion: tcode, indicacion: 'Abierto; llama a contexto_actual para obtener su uri' })
      : resultadoJson({ uri: uriDeRuta(ruta), transaccion: tcode });
  };

  const leerPrograma = async (args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    const uri = argTexto(args, 'uri') ?? '';
    const incluirIncludes = args.incluirIncludes !== false;
    const maxLineasPorArchivo = entero(args, 'maxLineasPorArchivo') ?? MAX_LINEAS_POR_DEFECTO;
    const archivos = await recopilarPrograma(rutaDeUriTexto(uri), (ruta) => deps.leerTexto(ruta), incluirIncludes);
    if (archivos[0]?.texto === undefined) {
      return resultadoError(`No se pudo leer ${uri}: ábrelo antes con abrir_objeto o comprueba con contexto_actual que el sistema esté conectado`);
    }
    return { texto: formatearPrograma(archivos, { maxLineasPorArchivo }) };
  };

  const leerArchivo = async (args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    const uri = argTexto(args, 'uri') ?? '';
    const ruta = rutaDeUriTexto(uri);
    const contenido = await deps.leerTexto(ruta);
    if (contenido === undefined) {
      return resultadoError(`No se pudo leer ${uri}: ábrelo antes con abrir_objeto o comprueba con contexto_actual que el sistema esté conectado`);
    }
    const total = contarLineas(contenido);
    if (total === 0) {
      return resultadoError(`No hay líneas que leer en ${uri}: el archivo está vacío`);
    }
    const rango = rangoValido(entero(args, 'desdeLinea') ?? 1, entero(args, 'hastaLinea') ?? total, total);
    if (!rango.ok) {
      return resultadoError(`Rango no válido: ${rango.motivo}; pide un rango entre 1 y ${total}`);
    }
    return { texto: `=== ${ruta} (líneas ${rango.desde}-${rango.hasta} de ${total}) ===\n${numerarLineas(contenido, rango.desde, rango.hasta)}` };
  };

  const estructuraObjeto = async (args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    const ruta = rutaDeUriTexto(argTexto(args, 'uri') ?? '');
    const arbol = await deps.arbolDe(ruta);
    if (arbol === undefined) {
      return resultadoError('El objeto no está cargado en la vista Objeto; ábrelo primero con abrir_objeto y vuelve a llamar');
    }
    return resultadoJson(estructuraDe(arbol, carpetaDe(ruta)));
  };

  const ejecutores: Record<keyof typeof DESCRIPCIONES, (args: Record<string, unknown>) => Promise<ResultadoHerramienta>> = {
    contexto_actual: contextoActual,
    abrir_objeto: abrirObjeto,
    abrir_transaccion: abrirTransaccion,
    leer_programa: leerPrograma,
    leer_archivo: leerArchivo,
    estructura_objeto: estructuraObjeto,
    editores_abiertos: editoresAbiertos,
  };

  return (Object.keys(ejecutores) as (keyof typeof ejecutores)[]).map((nombre) => ({
    nombre,
    descripcion: DESCRIPCIONES[nombre],
    inputSchema: ESQUEMAS[nombre],
    ejecutar: envolverConProteccion(nombre, ejecutores[nombre]),
  }));
}
