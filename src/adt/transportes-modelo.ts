import type { TipoObjeto } from '../bridge/adt-uri';
import { nombreValido } from '../diccionario/modelo';
import { leerAtributos } from './busqueda-modelo';

export type EstadoOrden = 'modificable' | 'liberada' | 'otro';
export type CategoriaOrden = 'workbench' | 'customizing';

export interface ObjetoOrden {
  pgmid: string;
  tipo: string;
  nombre: string;
  tipoWb?: string;
  info?: string;
  descripcion?: string;
}

export interface Tarea {
  numero: string;
  propietario: string;
  descripcion: string;
  estado: EstadoOrden;
  estadoCrudo: string;
  objetos: ObjetoOrden[];
}

export interface Orden {
  numero: string;
  propietario: string;
  descripcion: string;
  estado: EstadoOrden;
  estadoCrudo: string;
  categoria: CategoriaOrden;
  destino?: string;
  tareas: Tarea[];
  objetos: ObjetoOrden[];
}

export interface OrdenDeObjeto {
  numero: string;
  estado: EstadoOrden;
  estadoCrudo: string;
  tarea?: string;
  propietario: string;
  fecha: string;
  hora: string;
  destino?: string;
  descripcion?: string;
  partes: string[];
}

export type Fila = Record<string, string>;

const PATRON_NUMERO_ORDEN = /^[A-Z0-9_/]{1,20}$/;
const PATRON_TIPO_E071 = /^[A-Z0-9]{1,4}$/;
const PATRON_IDIOMA = /^[A-Z0-9]$/;

/** Tipos de la tabla E071 en los que puede aparecer un objeto de cada clase (NO VERIFICADO contra el sistema salvo CLAS, METH y REPS). */
export const TIPOS_E071_POR_TIPO: Readonly<Record<TipoObjeto, readonly string[]>> = {
  clase: ['CLAS', 'METH', 'CPUB', 'CPRO', 'CPRI', 'CLSD', 'CINC'],
  interfaz: ['INTF'],
  programa: ['PROG', 'REPS', 'REPT'],
  include: ['REPS'],
  grupoFunciones: ['FUGR', 'FUNC', 'REPS'],
  tabla: ['TABL', 'TABD', 'TABT', 'TABU'],
  estructura: ['TABL', 'TABD'],
  cds: ['DDLS'],
  desconocido: [],
};

/** Tipo del Workbench según `PGMID OBJECT` de E071; solo los pares observados. */
const TIPO_WB_POR_OBJECT: Readonly<Record<string, string>> = {
  'R3TR CLAS': 'CLAS/OC',
  'R3TR INTF': 'INTF/OI',
  'R3TR PROG': 'PROG/P',
  'R3TR FUGR': 'FUGR/F',
  'R3TR TABL': 'TABL/DT',
  'R3TR DDLS': 'DDLS/DF',
  'LIMU REPS': 'PROG/I',
};

const ETIQUETA_ORDENES =
  /<(\/?)tm:(workbench|customizing|target|request|task|abap_object)\b((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;

function estadoDe(crudo: string): EstadoOrden {
  if (crudo === 'D') {
    return 'modificable';
  }
  return crudo === 'R' ? 'liberada' : 'otro';
}

function objetoDeAtributos(atributos: Map<string, string>): ObjetoOrden {
  const objeto: ObjetoOrden = {
    pgmid: atributos.get('tm:pgmid') ?? '',
    tipo: atributos.get('tm:type') ?? '',
    nombre: atributos.get('tm:name') ?? '',
  };
  const tipoWb = atributos.get('tm:wbtype');
  const info = atributos.get('tm:obj_info');
  const descripcion = atributos.get('tm:obj_desc');
  if (tipoWb) {
    objeto.tipoWb = tipoWb;
  }
  if (info) {
    objeto.info = info;
  }
  if (descripcion) {
    objeto.descripcion = descripcion;
  }
  return objeto;
}

/**
 * Respuesta de `GET /sap/bc/adt/cts/transportrequests` (con o sin `?targets=true`).
 * Los objetos van dentro de la tarea o, a veces, directamente bajo la orden.
 */
export function analizarOrdenes(xml: string): Orden[] {
  const ordenes: Orden[] = [];
  let categoria: CategoriaOrden = 'workbench';
  let destino: string | undefined;
  let orden: Orden | undefined;
  let tarea: Tarea | undefined;
  for (const m of xml.matchAll(ETIQUETA_ORDENES)) {
    const cierre = m[1] === '/';
    const autocerrada = m[4] === '/';
    switch (m[2]) {
      case 'workbench':
      case 'customizing':
        if (!cierre) {
          categoria = m[2];
        }
        break;
      case 'target':
        destino = cierre ? undefined : leerAtributos(m[3]).get('tm:name');
        break;
      case 'request':
        if (cierre) {
          orden = undefined;
          tarea = undefined;
        } else {
          const atributos = leerAtributos(m[3]);
          const estadoCrudo = atributos.get('tm:status') ?? '';
          orden = {
            numero: atributos.get('tm:number') ?? '',
            propietario: atributos.get('tm:owner') ?? '',
            descripcion: atributos.get('tm:desc') ?? '',
            estado: estadoDe(estadoCrudo),
            estadoCrudo,
            categoria,
            tareas: [],
            objetos: [],
          };
          if (destino) {
            orden.destino = destino;
          }
          ordenes.push(orden);
          if (autocerrada) {
            orden = undefined;
          }
        }
        break;
      case 'task':
        if (cierre) {
          tarea = undefined;
        } else if (orden) {
          const atributos = leerAtributos(m[3]);
          const estadoCrudo = atributos.get('tm:status') ?? '';
          tarea = {
            numero: atributos.get('tm:number') ?? '',
            propietario: atributos.get('tm:owner') ?? '',
            descripcion: atributos.get('tm:desc') ?? '',
            estado: estadoDe(estadoCrudo),
            estadoCrudo,
            objetos: [],
          };
          orden.tareas.push(tarea);
          if (autocerrada) {
            tarea = undefined;
          }
        }
        break;
      case 'abap_object':
        if (!cierre) {
          (tarea?.objetos ?? orden?.objetos)?.push(objetoDeAtributos(leerAtributos(m[3])));
        }
        break;
    }
  }
  return ordenes;
}

/** Objetos directos de la orden y de sus tareas, sin repetir (pgmid + tipo + nombre). */
export function objetosDeOrden(orden: Orden): ObjetoOrden[] {
  const vistos = new Set<string>();
  const resultado: ObjetoOrden[] = [];
  for (const objeto of [...orden.objetos, ...orden.tareas.flatMap((t) => t.objetos)]) {
    const clave = `${objeto.pgmid}|${objeto.tipo}|${objeto.nombre}`;
    if (!vistos.has(clave)) {
      vistos.add(clave);
      resultado.push(objeto);
    }
  }
  return resultado;
}

export function esModificable(orden: Orden): boolean {
  return orden.estado === 'modificable';
}

export function esNumeroOrden(texto: string): boolean {
  return PATRON_NUMERO_ORDEN.test(texto);
}

function exigirNumeros(numeros: readonly string[]): string {
  if (numeros.length === 0 || !numeros.every(esNumeroOrden)) {
    throw new Error('número de orden no válido');
  }
  return numeros.map((n) => `'${n}'`).join(',');
}

function exigirIdiomas(idiomas: readonly string[]): string {
  if (idiomas.length === 0 || !idiomas.every((i) => PATRON_IDIOMA.test(i))) {
    throw new Error('idioma no válido');
  }
  return idiomas.map((i) => `'${i}'`).join(',');
}

/** Todas las filas de E071 que nombran al objeto (o a un miembro suyo: `NOMBRE  MIEMBRO`) con los datos de su orden o tarea. Sin ORDER BY: se ordena en cliente. */
export function consultaOrdenesDeObjeto(nombre: string, tipos: readonly string[]): string {
  if (!nombreValido(nombre) || tipos.length === 0) {
    throw new Error('nombre no válido');
  }
  if (!tipos.every((t) => PATRON_TIPO_E071.test(t))) {
    throw new Error('tipo no válido');
  }
  const n = nombre.toUpperCase();
  const lista = tipos.map((t) => `'${t}'`).join(',');
  return (
    'SELECT E071~TRKORR, E071~PGMID, E071~OBJECT, E071~OBJ_NAME, E071~LOCKFLAG, E070~TRFUNCTION, E070~TRSTATUS, E070~TARSYSTEM, E070~AS4USER, E070~AS4DATE, E070~AS4TIME, E070~STRKORR ' +
    'FROM E071 INNER JOIN E070 ON E070~TRKORR = E071~TRKORR ' +
    `WHERE ( E071~OBJ_NAME = '${n}' OR E071~OBJ_NAME LIKE '${n} %' ) AND E071~OBJECT IN (${lista})`
  );
}

export function consultaTareas(orden: string): string {
  const numero = exigirNumeros([orden]);
  return `SELECT TRKORR, TRFUNCTION, TRSTATUS, AS4USER, AS4DATE, AS4TIME, STRKORR FROM E070 WHERE STRKORR = ${numero}`;
}

export function consultaTextos(numeros: readonly string[], idiomas: readonly string[]): string {
  const listaNumeros = exigirNumeros(numeros);
  return `SELECT TRKORR, LANGU, AS4TEXT FROM E07T WHERE TRKORR IN (${listaNumeros}) AND LANGU IN (${exigirIdiomas(idiomas)})`;
}

export function consultaObjetosDeOrden(numeros: readonly string[]): string {
  return `SELECT TRKORR, AS4POS, PGMID, OBJECT, OBJ_NAME, OBJFUNC, LOCKFLAG FROM E071 WHERE TRKORR IN (${exigirNumeros(numeros)}) ORDER BY TRKORR, AS4POS`;
}

/** `20261030` y `112745` → `2026-10-30` y `11:27`; un valor vacío o a cero queda en blanco. */
export function formatearFechaSap(as4date: string, as4time: string): { fecha: string; hora: string } {
  const fecha = /^(\d{4})(\d{2})(\d{2})$/.exec(as4date);
  const hora = /^(\d{2})(\d{2})\d{0,2}$/.exec(as4time);
  return {
    fecha: fecha && as4date !== '00000000' ? `${fecha[1]}-${fecha[2]}-${fecha[3]}` : '',
    hora: hora && as4time !== '000000' ? `${hora[1]}:${hora[2]}` : '',
  };
}

export function textoOrdenDe(numero: string, textos: Fila[], idiomas: readonly string[]): string | undefined {
  for (const idioma of idiomas) {
    const fila = textos.find((f) => f.TRKORR === numero && f.LANGU === idioma);
    if (fila) {
      return fila.AS4TEXT ?? '';
    }
  }
  return undefined;
}

function parteDe(fila: Fila): string {
  const resto = (fila.OBJ_NAME ?? '').trim().split(/\s+/).slice(1).join(' ');
  return resto ? `${fila.OBJECT ?? ''} ${resto}` : (fila.OBJECT ?? '');
}

/** Agrupa las filas de E071 ⋈ E070 por orden (la orden padre si la fila es de una tarea); la más reciente primero. */
export function ordenesDeObjetoDe(filas: Fila[], textos: Fila[], idiomas: readonly string[]): OrdenDeObjeto[] {
  const grupos = new Map<string, Fila[]>();
  for (const fila of filas) {
    const numero = fila.STRKORR || fila.TRKORR || '';
    grupos.set(numero, [...(grupos.get(numero) ?? []), fila]);
  }
  const resultado = Array.from(grupos, ([numero, miembros]) => {
    const filaOrden = miembros.find((f) => !f.STRKORR);
    const filaTarea = miembros.find((f) => f.STRKORR);
    const fuente = filaOrden ?? filaTarea ?? miembros[0];
    const estadoCrudo = fuente.TRSTATUS ?? '';
    const orden: OrdenDeObjeto = {
      numero,
      estado: estadoDe(estadoCrudo),
      estadoCrudo,
      propietario: fuente.AS4USER ?? '',
      ...formatearFechaSap(fuente.AS4DATE ?? '', fuente.AS4TIME ?? ''),
      partes: Array.from(new Set(miembros.map(parteDe))),
    };
    if (filaTarea) {
      orden.tarea = filaTarea.TRKORR;
    }
    if (filaOrden?.TARSYSTEM) {
      orden.destino = filaOrden.TARSYSTEM;
    }
    const descripcion = textoOrdenDe(numero, textos, idiomas);
    if (descripcion !== undefined) {
      orden.descripcion = descripcion;
    }
    return { orden, instante: `${fuente.AS4DATE ?? ''}${fuente.AS4TIME ?? ''}` };
  });
  return resultado.sort((a, b) => b.instante.localeCompare(a.instante)).map((r) => r.orden);
}

/** Objetos de una orden a partir de E071; `LIMU METH` trae la clase y el método separados por espacios. */
export function objetosDeOrdenDe(filas: Fila[]): ObjetoOrden[] {
  return filas.map((fila) => {
    const pgmid = fila.PGMID ?? '';
    const tipo = fila.OBJECT ?? '';
    const tokens = (fila.OBJ_NAME ?? '').trim().split(/\s+/);
    const objeto: ObjetoOrden = { pgmid, tipo, nombre: tokens.join(' ') };
    if (pgmid === 'LIMU' && tipo === 'METH') {
      objeto.nombre = tokens[0];
      objeto.tipoWb = 'CLAS/OC';
      if (tokens[1]) {
        objeto.info = `método ${tokens[1]}`;
      }
      return objeto;
    }
    const tipoWb = TIPO_WB_POR_OBJECT[`${pgmid} ${tipo}`];
    if (tipoWb) {
      objeto.tipoWb = tipoWb;
    }
    return objeto;
  });
}
