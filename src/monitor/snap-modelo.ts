import { ConsultaTabla, ResultadoTabla } from '../adt/tablas-legibles';

export interface ClaveSnap {
  fecha: string;
  hora: string;
  host: string;
  usuario: string;
  mandante: string;
  modno: string;
}

export const COLUMNAS_SNAP = ['FLIST', 'FLIST02', 'FLIST03', 'FLIST04', 'FLIST05', 'FLIST06', 'FLIST07', 'FLIST08'] as const;
export const ANCHO_COLUMNA_SNAP = 200;

const MARCA_DUMPS = '/dumps/';
const CABECERA_ID = /^(\d{8})(\d{6})(.*)$/;
const HOST = /^[A-Za-z0-9_.-]{1,32}$/;
const USUARIO = /^[A-Z0-9_.\-@#$]{1,12}$/;
const MANDANTE = /^\d{3}$/;
const MODNO = /^\d{1,10}$/;

function segmentoDecodificado(id: string): string | undefined {
  const posicion = id.lastIndexOf(MARCA_DUMPS);
  if (posicion < 0) {
    return undefined;
  }
  try {
    return decodeURIComponent(id.slice(posicion + MARCA_DUMPS.length));
  } catch {
    return undefined;
  }
}

function clavePorPartes(fecha: string, hora: string, resto: string): ClaveSnap | undefined {
  const partes = resto.split(/\s+/).filter((parte) => parte !== '');
  if (partes.length !== 4) {
    return undefined;
  }
  const [host, usuario, mandante, modno] = partes;
  if (!HOST.test(host) || !USUARIO.test(usuario) || !MANDANTE.test(mandante) || !MODNO.test(modno)) {
    return undefined;
  }
  return { fecha, hora, host, usuario, mandante, modno };
}

/** Clave del dump a partir del `atom:id` del feed de ST22; `undefined` si el id no es válido. */
export function claveDeDump(id: string): ClaveSnap | undefined {
  const texto = segmentoDecodificado(id);
  const cabecera = texto === undefined ? undefined : CABECERA_ID.exec(texto);
  if (cabecera === null || cabecera === undefined) {
    return undefined;
  }
  return clavePorPartes(cabecera[1], cabecera[2], cabecera[3]);
}

/**
 * Condiciones de `RFC_READ_TABLE` que identifican la fila de `SNAP` del dump. Las cuatro filas de `OPTIONS` se
 * verificaron contra un sistema real el 2026-11-03 (16 filas con la clave completa; 0 si `AHOST` no coincide).
 * Observado: el `MODNO` de un dump cambió entre dos lecturas (17 → 15) y el feed lo reflejó: la clave vale en el
 * momento de leer el feed (spec §9). */
export function condicionesSnap(clave: ClaveSnap): string[] {
  return [
    `DATUM EQ '${clave.fecha}' AND UZEIT EQ '${clave.hora}'`,
    `AND MODNO EQ ${clave.modno} AND MANDT EQ '${clave.mandante}'`,
    `AND AHOST EQ '${clave.host}'`,
    `AND UNAME EQ '${clave.usuario}'`,
  ];
}

/** Una consulta por columna de `SNAP` que guarda el texto del dump, con su número de secuencia. */
export function consultasSnap(clave: ClaveSnap): ConsultaTabla[] {
  const condiciones = condicionesSnap(clave);
  return COLUMNAS_SNAP.map((columna) => ({
    tabla: 'SNAP',
    campos: ['SEQNO', columna],
    condiciones,
  }));
}

export interface RegistroSnap { id: string; valor: string }
export interface NivelPila { nr: string; tipo: string; programa: string; include: string; linea: number; nombre: string; clase?: string }
export interface VariableDump { nombre: string; valor?: string; tabla?: { cabecera: string; filas: string[] } }
export interface GrupoVariables { titulo: string; variables: VariableDump[] }
export interface CampoSistema { nombre: string; valor: string }
export interface DumpCompleto {
  excepcion?: string; programa: string; include: string; linea: number; evento?: string; tipoEvento?: string;
  pila: NivelPila[]; variables: GrupoVariables[]; camposSistema: CampoSistema[]; parametros: string[]; parametrosConId: { id: string; valor: string }[];
  usuario: string; mandante: string; idioma: string; terminal: string; transaccion?: string;
  programaPantalla?: string; dynpro?: string;
  rfc?: { funcion: string; destino: string; desde: string; usuario: string; programa: string };
  entorno: { release: string; so: string; arquitectura: string; servidor: string; baseDatos: string; kernel: string; parche: string; archivo: string; funcion: string; generado: string };
  conteos: { opcodes: number; programasCargados: number; pilaKernel: number };
  incompleto: boolean;
}

const ANCHO_FILA_SNAP = ANCHO_COLUMNA_SNAP * COLUMNAS_SNAP.length;
const GRUPO_SENTENCIA = 'De la sentencia que falló';

/** Una cadena de 1600 caracteres por `SEQNO`: las ocho columnas rellenadas a su ancho y concatenadas. */
export function reensamblarFilas(respuestas: ResultadoTabla[]): string[] {
  const porSeqno = new Map<string, string[]>();
  respuestas.forEach((respuesta, columna) => {
    for (const [seqno, trozo] of respuesta.filas) {
      const columnas = porSeqno.get(seqno) ?? [];
      columnas[columna] = (trozo ?? '').padEnd(ANCHO_COLUMNA_SNAP);
      porSeqno.set(seqno, columnas);
    }
  });
  const blanco = ' '.repeat(ANCHO_COLUMNA_SNAP);
  return [...porSeqno.keys()].sort().map((seqno) => {
    const columnas = porSeqno.get(seqno) ?? [];
    return COLUMNAS_SNAP.map((_, indice) => columnas[indice] ?? blanco).join('');
  });
}

/** Registros `ID(2) LEN(3) VALOR` de las filas; `incompleto` si el dump no termina limpio en `%E`. */
export function registrosDe(filas: string[]): { registros: RegistroSnap[]; incompleto: boolean } {
  const registros: RegistroSnap[] = [];
  for (const fila of filas) {
    const texto = fila.padEnd(ANCHO_FILA_SNAP);
    let posicion = 0;
    while (posicion + 2 <= texto.length) {
      const id = texto.slice(posicion, posicion + 2);
      if (id === '%M' || texto.slice(posicion).trim() === '') {
        break;
      }
      if (id === '%E') {
        return { registros, incompleto: false };
      }
      if (id === '%A') {
        return { registros, incompleto: true };
      }
      const longitudTexto = texto.slice(posicion + 2, posicion + 5);
      const longitud = /^\d{3}$/.test(longitudTexto) ? Number(longitudTexto) : 0;
      if (longitud === 0 || posicion + 5 + longitud > texto.length) {
        return { registros, incompleto: true };
      }
      registros.push({ id, valor: texto.slice(posicion + 5, posicion + 5 + longitud) });
      posicion += 5 + longitud;
    }
  }
  return { registros, incompleto: true };
}

function nivelDe(valor: string): NivelPila {
  // NO VERIFICADO: ningún dump real con nivel METHOD; la clase se descodifica por posición
  const clase = valor.slice(169, 199).trim();
  const nivel: NivelPila = {
    nr: valor.slice(1, 6).trim(),
    programa: valor.slice(6, 46).trim(),
    include: valor.slice(46, 86).trim(),
    linea: Number(valor.slice(91, 96)) || 0,
    tipo: valor.slice(96, 108).trim(),
    nombre: valor.slice(108, 169).trim(),
  };
  if (clase !== '') {
    nivel.clase = clase;
  }
  return nivel;
}

function tituloDeNivel(nivel: NivelPila): string {
  return `Nivel ${nivel.nr} · ${nivel.tipo} ${nivel.nombre} · ${nivel.programa}`;
}

interface VariableEnCurso { nombre: string; valores: string[]; cabecera?: string }

function variableTerminada(enCurso: VariableEnCurso): VariableDump {
  if (enCurso.cabecera !== undefined) {
    return {
      nombre: enCurso.nombre,
      tabla: { cabecera: enCurso.cabecera, filas: enCurso.valores.map((valor) => valor.trimEnd()) },
    };
  }
  return { nombre: enCurso.nombre, valor: enCurso.valores.join('').trimEnd() };
}

// NO VERIFICADO: el dígito de N<d>/V<d> no tiene significado conocido; se tratan todos igual.
function pilaYVariables(registros: RegistroSnap[]): { pila: NivelPila[]; variables: GrupoVariables[] } {
  const pila: NivelPila[] = [];
  const grupos: GrupoVariables[] = [{ titulo: GRUPO_SENTENCIA, variables: [] }];
  let enCurso: VariableEnCurso | undefined;
  const cerrarVariable = (): void => {
    if (enCurso !== undefined && !enCurso.nombre.startsWith('%_')) {
      grupos[grupos.length - 1].variables.push(variableTerminada(enCurso));
    }
    enCurso = undefined;
  };
  for (const { id, valor } of registros) {
    if (id === 'ES') {
      cerrarVariable();
      const nivel = nivelDe(valor);
      pila.push(nivel);
      grupos.push({ titulo: tituloDeNivel(nivel), variables: [] });
    } else if (/^N\d$/.test(id)) {
      cerrarVariable();
      enCurso = { nombre: valor.trim(), valores: [] };
    } else if (enCurso !== undefined && /^V\d$/.test(id)) {
      enCurso.valores.push(valor);
    } else if (enCurso !== undefined && id === 'TH' && enCurso.cabecera === undefined) {
      enCurso.cabecera = valor.trim();
    }
  }
  cerrarVariable();
  return { pila, variables: grupos.filter((grupo) => grupo.variables.length > 0) };
}

function archivoDeKernel(ruta: string): string {
  const sinMarca = ruta.split('#')[0];
  return sinMarca.slice(sinMarca.lastIndexOf('/') + 1).trim();
}

function parametrosConIdDe(registros: RegistroSnap[]): { id: string; valor: string }[] {
  return registros
    .filter((registro) => /^P[1-9]$/.test(registro.id))
    .map((registro) => ({ id: registro.id, valor: registro.valor.trim() }))
    .filter((parametro) => parametro.valor !== '' && parametro.valor !== '(not used)');
}

function parametrosDe(registros: RegistroSnap[]): string[] {
  return parametrosConIdDe(registros).map((parametro) => parametro.valor);
}

function camposSistemaDe(registros: RegistroSnap[]): CampoSistema[] {
  return registros
    .filter((registro) => registro.id === 'SY')
    .map((registro) => ({ nombre: registro.valor.slice(0, 8).trim(), valor: registro.valor.slice(8).trimEnd() }));
}

/** Reúne los registros de `SNAP` en el modelo del dump; todo valor sale de un registro o queda vacío. */
export function dumpCompletoDe(registros: RegistroSnap[]): DumpCompleto {
  const todos = (id: string): RegistroSnap[] => registros.filter((registro) => registro.id === id);
  const uno = (id: string): string | undefined => todos(id)[0]?.valor.trimEnd();
  const texto = (id: string): string => uno(id)?.trim() ?? '';
  const opcional = (id: string): string | undefined => {
    const valor = texto(id);
    return valor === '' ? undefined : valor;
  };
  const usuario = uno('US') ?? '';
  const pantalla = (uno('AD') ?? '').padEnd(44);
  const entorno = texto('EN').split(/\s+/);
  const funcionRfc = texto('R5');
  const { pila, variables } = pilaYVariables(registros);
  return {
    excepcion: opcional('XC'),
    programa: texto('AP'),
    include: texto('AI'),
    linea: Number(texto('AL')) || 0,
    evento: opcional('EV'),
    tipoEvento: opcional('ET'),
    pila,
    variables,
    camposSistema: camposSistemaDe(registros),
    parametros: parametrosDe(registros),
    parametrosConId: parametrosConIdDe(registros),
    usuario: usuario.slice(3, 15).trim(),
    mandante: usuario.slice(0, 3).trim(),
    idioma: usuario.slice(15, 16).trim(),
    terminal: texto('TR'),
    transaccion: opcional('TC'),
    programaPantalla: pantalla.slice(0, 40).trim() || undefined,
    dynpro: pantalla.slice(40, 44).trim() || undefined,
    rfc:
      funcionRfc === ''
        ? undefined
        : { funcion: funcionRfc, destino: texto('R6'), desde: texto('R7'), usuario: texto('R8'), programa: texto('S8') },
    entorno: {
      release: entorno[0] ?? '',
      so: entorno[1] ?? '',
      arquitectura: entorno[2] ?? '',
      servidor: entorno[3] ?? '',
      baseDatos: entorno[4] ?? '',
      kernel: texto('ER'),
      parche: texto('AF'),
      archivo: archivoDeKernel(texto('CM')),
      funcion: texto('CF'),
      generado: texto('AT'),
    },
    conteos: { opcodes: todos('CO').length, programasCargados: todos('PG').length, pilaKernel: todos('ZS').length },
    incompleto: false,
  };
}
