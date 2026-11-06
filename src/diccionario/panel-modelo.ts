import { FILTROS_TIPO, type ResultadoBusqueda } from '../adt/busqueda-modelo';
import { agruparUsos, type GrupoPaqueteUsos, type Uso, type UsosPropios } from './donde-se-usa';
import { tieneValoresFijos, variableCase } from './generar';
import { ETIQUETA_TIPO, linea, markdownCampo, markdownElemento, tipoTecnico } from './hover-modelo';
import type { CampoDiccionario, Dominio, ElementoDatos, ObjetoDiccionario, TipoDiccionario } from './modelo';
import type { CampoResuelto, DatosTabla, Resuelto } from './servicio';

export interface ErrorDatos { nombre: string; mensaje: string }

/** Las filas pedidas de la tabla mostrada; mientras llega una página nueva se conservan las anteriores. */
export interface EstadoDatos { pedidas: number; cargando: boolean; datos?: DatosTabla; error?: ErrorDatos }

/** «Dónde se usa» del objeto mostrado; vive solo mientras se muestra ese objeto. */
export interface EstadoUsos { cargando: boolean; resultado?: UsosPropios; error?: ErrorDatos }

export type NodoDiccionario =
  | { clase: 'vacio'; etiqueta: string }
  | { clase: 'cabecera'; objeto: ObjetoDiccionario; fijado: boolean }
  | { clase: 'grupoCampos'; total: number }
  | { clase: 'include'; nombre: string; campos: CampoDiccionario[] }
  | { clase: 'campo'; tabla: string; campo: CampoDiccionario }
  | { clase: 'elemento'; elemento: ElementoDatos }
  | { clase: 'dominio'; dominio: Dominio }
  | { clase: 'valor'; valor: string; texto: string }
  | { clase: 'grupoDatos'; datos: DatosTabla; cargadas: number; pedidas: number; cargando: boolean; error?: ErrorDatos }
  | { clase: 'errorDatos'; mensaje: string }
  | { clase: 'fila'; indice: number; claves: string; valores: Record<string, string> }
  | { clase: 'celda'; fila: number; campo: string; valor: string }
  | { clase: 'grupoUsos'; cargando: boolean; resultado?: UsosPropios; error?: ErrorDatos }
  | { clase: 'errorUsos'; mensaje: string }
  | { clase: 'tipoUso'; tipoAdt: string; paquetes: GrupoPaqueteUsos[] }
  | { clase: 'paqueteUso'; tipoAdt: string; paquete: string; usos: Uso[] }
  | { clase: 'uso'; uso: Uso }
  | { clase: 'anadirPrefijo'; prefijo: string };

export type MotivoVacio = 'sinCursor' | 'conectar' | 'sinVia' | 'cargando';

export interface EstadoPanel {
  destino?: string;
  resuelto?: Resuelto;
  elemento?: ElementoDatos;
  dominio?: Dominio;
  fijado: boolean;
  motivoVacio?: MotivoVacio;
  datos?: EstadoDatos;
  usos?: EstadoUsos;
  /** El campo seleccionado en el árbol con su elemento y dominio; solo mientras se muestra su tabla. */
  campoSeleccionado?: CampoSeleccionado;
}

export interface CampoSeleccionado { tabla: string; resuelto: CampoResuelto }

export type NodoCampo = Extract<NodoDiccionario, { clase: 'campo' }>;

/** Lo que «Generar CASE» inserta, o el aviso de por qué no. */
export interface ObjetivoCase { dominio: Dominio; variable: string }
export type ResultadoCase = ObjetivoCase | { aviso: string };

export interface EtiquetaNodo {
  label: string;
  description?: string;
  tooltip?: string;
  /** El tooltip es Markdown (el mismo que el hover). */
  tooltipMarkdown?: boolean;
  contextValue: string;
  colapsable: 'no' | 'abierto' | 'cerrado';
}

const TEXTO_VACIO: Readonly<Record<MotivoVacio, string>> = {
  sinCursor: 'Pon el cursor sobre una tabla, estructura o elemento de datos',
  conectar: 'Conéctate al sistema para ver el diccionario',
  sinVia: 'Sin vía RFC en este sistema',
  cargando: 'Cargando…',
};

const ICONO_CABECERA: Readonly<Record<TipoDiccionario, string>> = {
  tabla: 'symbol-structure',
  estructura: 'symbol-structure',
  elementoDatos: 'symbol-field',
  dominio: 'symbol-enum',
};

const SEPARADOR_CLAVES = ' · ';
const COLUMNAS_SIN_CLAVE = 2;
const SIN_DATOS: DatosTabla = { columnas: [], filas: [] };
const SIN_PAQUETE = '(sin paquete)';
const SEPARADOR_MILES = /\B(?=(\d{3})+(?!\d))/g;

function vacio(motivo: MotivoVacio): NodoDiccionario {
  return { clase: 'vacio', etiqueta: TEXTO_VACIO[motivo] };
}

/** Solo las tablas tienen filas que ver: Data Preview no admite estructuras (verificado 2026-10-31). */
export function admiteDatos(tipo: TipoDiccionario | undefined): boolean {
  return tipo === 'tabla';
}

/** Tablas y estructuras tienen catálogo de campos: de él salen TYPES, DATA y la tabla interna. */
export function tieneCampos(tipo: TipoDiccionario | undefined): boolean {
  return tipo === 'tabla' || tipo === 'estructura';
}

function grupoDatos(estado: EstadoDatos): NodoDiccionario {
  const datos = estado.datos ?? SIN_DATOS;
  const recibidas = datos.filas.length;
  return {
    clase: 'grupoDatos',
    datos,
    cargadas: datos.total === undefined ? recibidas : Math.min(recibidas, datos.total),
    pedidas: estado.pedidas,
    cargando: estado.cargando,
    ...(estado.error ? { error: estado.error } : {}),
  };
}

/** Los valores de los campos clave del catálogo; sin campos clave, los de las primeras columnas. */
function columnasClave(columnas: string[], campos: CampoDiccionario[]): number[] {
  const claves = new Set(campos.filter((c) => c.clave).map((c) => c.nombre.toUpperCase()));
  const indices = columnas.flatMap((c, i) => (claves.has(c.toUpperCase()) ? [i] : []));
  return indices.length > 0 ? indices : columnas.slice(0, COLUMNAS_SIN_CLAVE).map((_, i) => i);
}

function filasDe(datos: DatosTabla, campos: CampoDiccionario[]): NodoDiccionario[] {
  const indicesClave = columnasClave(datos.columnas, campos);
  return datos.filas.map((fila, i) => ({
    clase: 'fila',
    indice: i + 1,
    claves: indicesClave.map((j) => fila[j] ?? '').join(SEPARADOR_CLAVES),
    valores: Object.fromEntries(datos.columnas.map((c, j) => [c, fila[j] ?? ''])),
  }));
}

function etiquetaGrupoDatos(nodo: Extract<NodoDiccionario, { clase: 'grupoDatos' }>): string {
  if (nodo.cargando) {
    return 'Datos (cargando…)';
  }
  if (nodo.error) {
    return `Datos (error: ${nodo.error.nombre})`;
  }
  const { datos, cargadas, pedidas } = nodo;
  if (datos.total !== undefined) {
    return `Datos (${cargadas} de ${datos.total})`;
  }
  return datos.filas.length === pedidas ? `Datos (${cargadas}, hay más)` : `Datos (${cargadas})`;
}

function grupoUsos(estado: EstadoUsos): NodoDiccionario {
  return {
    clase: 'grupoUsos',
    cargando: estado.cargando,
    ...(estado.resultado ? { resultado: estado.resultado } : {}),
    ...(estado.error ? { error: estado.error } : {}),
  };
}

/** 6848 → «6.848» (Intl en español no agrupa los números de cuatro cifras). */
function miles(n: number): string {
  return String(n).replace(SEPARADOR_MILES, '.');
}

function etiquetaTipoAdt(tipoAdt: string): string {
  return FILTROS_TIPO.find((f) => f.tipoAdt === tipoAdt)?.etiqueta ?? tipoAdt;
}

function contarUsos(paquetes: GrupoPaqueteUsos[]): number {
  return paquetes.reduce((total, p) => total + p.usos.length, 0);
}

function etiquetaGrupoUsos(nodo: Extract<NodoDiccionario, { clase: 'grupoUsos' }>): string {
  if (nodo.cargando) {
    return 'Dónde se usa (buscando…)';
  }
  if (nodo.error) {
    return `Dónde se usa (error: ${nodo.error.nombre})`;
  }
  const propios = nodo.resultado?.propios.length ?? 0;
  return `Dónde se usa (${plural(propios, 'propio', 'propios')} de ${miles(nodo.resultado?.total ?? 0)})`;
}

function hijosUsos(nodo: Extract<NodoDiccionario, { clase: 'grupoUsos' }>): NodoDiccionario[] {
  if (nodo.cargando) {
    return [];
  }
  if (nodo.error) {
    return [{ clase: 'errorUsos', mensaje: nodo.error.mensaje }];
  }
  const resultado = nodo.resultado;
  if (resultado === undefined) {
    return [];
  }
  const tipos: NodoDiccionario[] = agruparUsos(resultado.propios).map((g) => ({ clase: 'tipoUso', tipoAdt: g.tipoAdt, paquetes: g.paquetes }));
  const anadir: NodoDiccionario[] = resultado.namespaces.map((prefijo) => ({ clase: 'anadirPrefijo', prefijo }));
  return [...tipos, ...anadir];
}

function conUsos(nodos: NodoDiccionario[], estado: EstadoPanel): NodoDiccionario[] {
  return estado.usos ? [...nodos, grupoUsos(estado.usos)] : nodos;
}

export function nodosRaiz(estado: EstadoPanel): NodoDiccionario[] {
  if (estado.motivoVacio !== undefined) {
    return [vacio(estado.motivoVacio)];
  }
  if (estado.resuelto === undefined) {
    return [vacio('sinCursor')];
  }
  const { objeto, campos } = estado.resuelto;
  const cabecera: NodoDiccionario = { clase: 'cabecera', objeto, fijado: estado.fijado };
  switch (objeto.tipo) {
    case 'tabla':
    case 'estructura': {
      const nodos: NodoDiccionario[] = [cabecera, { clase: 'grupoCampos', total: campos?.length ?? 0 }];
      return conUsos(estado.datos ? [...nodos, grupoDatos(estado.datos)] : nodos, estado);
    }
    case 'elementoDatos':
      return conUsos(estado.elemento ? [cabecera, { clase: 'elemento', elemento: estado.elemento }] : [cabecera], estado);
    case 'dominio':
      return conUsos(estado.dominio ? [cabecera, { clase: 'dominio', dominio: estado.dominio }] : [cabecera], estado);
  }
}

/** Los campos de un mismo include van juntos en un nodo, en la posición de su primer campo. */
function agruparCampos(tabla: string, campos: CampoDiccionario[]): NodoDiccionario[] {
  const nodos: NodoDiccionario[] = [];
  const includes = new Map<string, CampoDiccionario[]>();
  for (const campo of campos) {
    if (campo.include === undefined) {
      nodos.push({ clase: 'campo', tabla, campo });
      continue;
    }
    const existentes = includes.get(campo.include);
    if (existentes) {
      existentes.push(campo);
    } else {
      const nuevos = [campo];
      includes.set(campo.include, nuevos);
      nodos.push({ clase: 'include', nombre: campo.include, campos: nuevos });
    }
  }
  return nodos;
}

export function hijosDe(nodo: NodoDiccionario, estado: EstadoPanel): NodoDiccionario[] {
  const tabla = estado.resuelto?.objeto.nombre ?? '';
  switch (nodo.clase) {
    case 'grupoCampos':
      return agruparCampos(tabla, estado.resuelto?.campos ?? []);
    case 'include':
      return nodo.campos.map((campo) => ({ clase: 'campo', tabla, campo }));
    case 'elemento':
      return estado.dominio && estado.dominio.nombre === nodo.elemento.dominio ? [{ clase: 'dominio', dominio: estado.dominio }] : [];
    case 'dominio':
      return nodo.dominio.valores.map((v) => ({ clase: 'valor', valor: v.valor, texto: v.texto }));
    case 'grupoDatos':
      if (nodo.error && !nodo.cargando) {
        return [{ clase: 'errorDatos', mensaje: nodo.error.mensaje }];
      }
      return filasDe(nodo.datos, estado.resuelto?.campos ?? []);
    case 'fila':
      return Object.entries(nodo.valores).map(([campo, valor]) => ({ clase: 'celda', fila: nodo.indice, campo, valor }));
    case 'grupoUsos':
      return hijosUsos(nodo);
    case 'tipoUso':
      return nodo.paquetes.map((p) => ({ clase: 'paqueteUso', tipoAdt: nodo.tipoAdt, paquete: p.paquete, usos: p.usos }));
    case 'paqueteUso':
      return nodo.usos.map((uso) => ({ clase: 'uso', uso }));
    default:
      return [];
  }
}

/** Con un solo nodo seleccionado y que sea un campo, ese campo: el panel carga su elemento y su dominio. */
export function campoParaCargar(seleccion: readonly NodoDiccionario[]): NodoCampo | undefined {
  const [nodo] = seleccion;
  return seleccion.length === 1 && nodo.clase === 'campo' ? nodo : undefined;
}

/** El estado con el campo seleccionado ya resuelto; si el estado ya no muestra su tabla, sin cambios. */
export function conCampoSeleccionado(estado: EstadoPanel, seleccionado: CampoSeleccionado): EstadoPanel {
  return estado.resuelto?.objeto.nombre === seleccionado.tabla ? { ...estado, campoSeleccionado: seleccionado } : estado;
}

/** El elemento y el dominio cargados de ese campo, si es el seleccionado. */
export function resueltoDelCampo(nodo: NodoCampo, estado?: EstadoPanel): CampoResuelto | undefined {
  const seleccionado = estado?.campoSeleccionado;
  const esElMismo = seleccionado?.tabla === nodo.tabla && seleccionado.resuelto.campo.nombre === nodo.campo.nombre;
  return esElMismo ? seleccionado.resuelto : undefined;
}

export function avisoSinValoresFijos(nombre: string): string {
  return `El dominio ${nombre} no tiene valores fijos`;
}

/** Desde un dominio: el CASE con `variable` (por defecto `${1:lv_<dominio>}`) o el aviso si no tiene valores fijos. */
export function caseDeDominio(dominio: Dominio, variable?: string): ResultadoCase {
  return tieneValoresFijos(dominio)
    ? { dominio, variable: variable ?? variableCase(dominio.nombre) }
    : { aviso: avisoSinValoresFijos(dominio.nombre) };
}

/** Lo que dio leer el dominio pedido por el enlace del hover: el dominio (o nada, si no existe) o un fallo de la lectura. */
export type LecturaDominio = { dominio: Dominio | undefined } | { error: true };

/** Un fallo de red al leer no es «sin valores fijos»: el aviso dice que no se pudo leer. */
export function caseDeLectura(nombre: string, lectura: LecturaDominio, variable?: string): ResultadoCase {
  if ('error' in lectura) {
    return { aviso: `No se pudo leer el dominio ${nombre}` };
  }
  return lectura.dominio ? caseDeDominio(lectura.dominio, variable) : { aviso: avisoSinValoresFijos(nombre) };
}

/** Desde un campo resuelto: el CASE con `${1:lv_<campo>}`; sin elemento o dominio, el aviso lleva el nombre del campo. */
export function caseDeCampo(nodo: NodoCampo, resuelto: CampoResuelto | undefined): ResultadoCase {
  const dominio = resuelto?.dominio;
  return dominio === undefined
    ? { aviso: avisoSinValoresFijos(nodo.campo.nombre) }
    : caseDeDominio(dominio, variableCase(nodo.campo.nombre));
}

function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** `estado` solo cambia el `contextValue` del campo seleccionado cuyo dominio tiene valores fijos. */
export function etiquetaDe(nodo: NodoDiccionario, estado?: EstadoPanel): EtiquetaNodo {
  switch (nodo.clase) {
    case 'vacio':
      return { label: nodo.etiqueta, contextValue: 'vacio', colapsable: 'no' };
    case 'cabecera': {
      const { objeto } = nodo;
      const description = linea([ETIQUETA_TIPO[objeto.tipo], objeto.descripcion, objeto.paquete]);
      return {
        label: objeto.nombre,
        description,
        tooltip: linea([objeto.nombre, description]),
        contextValue: 'cabecera',
        colapsable: 'no',
      };
    }
    case 'grupoCampos':
      return { label: `Campos (${nodo.total})`, contextValue: 'grupoCampos', colapsable: nodo.total > 0 ? 'abierto' : 'no' };
    case 'include':
      return {
        label: `.INCLUDE ${nodo.nombre} · ${plural(nodo.campos.length, 'campo', 'campos')}`,
        contextValue: 'include',
        colapsable: 'cerrado',
      };
    case 'campo': {
      const { campo, tabla } = nodo;
      return {
        label: campo.clave ? `🔑 ${campo.nombre}` : campo.nombre,
        description: linea([campo.elementoDatos, tipoTecnico(campo.tipo, campo.longitud, campo.decimales), campo.texto]),
        tooltip: markdownCampo(tabla, campo),
        tooltipMarkdown: true,
        contextValue: tieneValoresFijos(resueltoDelCampo(nodo, estado)?.dominio) ? 'campoConValores' : 'campo',
        colapsable: 'no',
      };
    }
    case 'elemento': {
      const { elemento } = nodo;
      return {
        label: elemento.nombre,
        description: linea([
          ETIQUETA_TIPO.elementoDatos,
          tipoTecnico(elemento.tipo, elemento.longitud, elemento.decimales),
          elemento.dominio ? `dominio ${elemento.dominio}` : undefined,
        ]),
        tooltip: markdownElemento(elemento),
        tooltipMarkdown: true,
        contextValue: 'elemento',
        colapsable: elemento.dominio ? 'abierto' : 'no',
      };
    }
    case 'dominio': {
      const { dominio } = nodo;
      return {
        label: dominio.nombre,
        description: linea([
          ETIQUETA_TIPO.dominio,
          tipoTecnico(dominio.tipo, dominio.longitud, 0),
          dominio.descripcion,
          dominio.tablaValores ? `tabla de valores ${dominio.tablaValores}` : undefined,
        ]),
        contextValue: tieneValoresFijos(dominio) ? 'dominioConValores' : 'dominio',
        colapsable: dominio.valores.length > 0 ? 'abierto' : 'no',
      };
    }
    case 'valor':
      return { label: nodo.valor, description: nodo.texto, contextValue: 'valor', colapsable: 'no' };
    case 'grupoDatos': {
      const conHijos = (nodo.error !== undefined && !nodo.cargando) || nodo.datos.filas.length > 0;
      return { label: etiquetaGrupoDatos(nodo), contextValue: 'grupoDatos', colapsable: conHijos ? 'abierto' : 'no' };
    }
    case 'errorDatos':
      return { label: nodo.mensaje, tooltip: nodo.mensaje, contextValue: 'errorDatos', colapsable: 'no' };
    case 'fila':
      return { label: String(nodo.indice), description: nodo.claves, contextValue: 'fila', colapsable: 'cerrado' };
    case 'celda': {
      const valor = nodo.valor === '' ? '(vacío)' : nodo.valor;
      return { label: nodo.campo, description: valor, tooltip: `${nodo.campo}: ${valor}`, contextValue: 'celda', colapsable: 'no' };
    }
    case 'grupoUsos':
      return { label: etiquetaGrupoUsos(nodo), contextValue: 'grupoUsos', colapsable: hijosUsos(nodo).length > 0 ? 'abierto' : 'no' };
    case 'errorUsos':
      return { label: nodo.mensaje, tooltip: nodo.mensaje, contextValue: 'errorUsos', colapsable: 'no' };
    case 'tipoUso':
      return {
        label: etiquetaTipoAdt(nodo.tipoAdt),
        description: String(contarUsos(nodo.paquetes)),
        tooltip: nodo.tipoAdt,
        contextValue: 'tipoUso',
        colapsable: 'abierto',
      };
    case 'paqueteUso':
      return {
        label: nodo.paquete === '' ? SIN_PAQUETE : nodo.paquete,
        description: String(nodo.usos.length),
        contextValue: 'paqueteUso',
        colapsable: 'abierto',
      };
    case 'uso': {
      const { uso } = nodo;
      return {
        label: uso.nombre,
        ...(uso.descripcion === '' ? {} : { description: uso.descripcion }),
        tooltip: linea([uso.nombre, etiquetaTipoAdt(uso.tipoAdt), uso.paquete, uso.descripcion]),
        contextValue: 'uso',
        colapsable: 'no',
      };
    }
    case 'anadirPrefijo':
      return { label: `Añadir ${nodo.prefijo} a propios…`, contextValue: 'anadirPrefijo', colapsable: 'no' };
  }
}

/** Codicon del nodo; los campos no llevan (la 🔑 va en la etiqueta). */
export function iconoDe(nodo: NodoDiccionario): string | undefined {
  switch (nodo.clase) {
    case 'vacio':
      return 'info';
    case 'cabecera':
      return ICONO_CABECERA[nodo.objeto.tipo];
    case 'grupoCampos':
      return 'list-tree';
    case 'include':
      return 'symbol-namespace';
    case 'campo':
      return undefined;
    case 'elemento':
      return 'symbol-field';
    case 'dominio':
      return 'symbol-enum';
    case 'valor':
      return 'symbol-enum-member';
    case 'grupoDatos':
      return 'table';
    case 'errorDatos':
      return 'error';
    case 'fila':
    case 'celda':
      return undefined;
    case 'grupoUsos':
      return 'references';
    case 'errorUsos':
      return 'error';
    case 'tipoUso':
      return 'symbol-folder';
    case 'paqueteUso':
      return 'package';
    case 'uso':
      return 'go-to-file';
    case 'anadirPrefijo':
      return 'add';
  }
}

/** Id estable mientras se muestra el mismo objeto: el árbol conserva lo plegado al refrescar. */
export function idDe(nodo: NodoDiccionario): string {
  switch (nodo.clase) {
    case 'vacio':
      return `vacio|${nodo.etiqueta}`;
    case 'cabecera':
      return `cabecera|${nodo.objeto.nombre}`;
    case 'grupoCampos':
      return 'grupoCampos';
    case 'include':
      return `include|${nodo.nombre}`;
    case 'campo':
      return `campo|${nodo.tabla}|${nodo.campo.posicion}|${nodo.campo.nombre}`;
    case 'elemento':
      return `elemento|${nodo.elemento.nombre}`;
    case 'dominio':
      return `dominio|${nodo.dominio.nombre}`;
    case 'valor':
      return `valor|${nodo.valor}`;
    case 'grupoDatos':
      return 'grupoDatos';
    case 'errorDatos':
      return 'errorDatos';
    case 'fila':
      return `fila|${nodo.indice}`;
    case 'celda':
      return `celda|${nodo.fila}|${nodo.campo}`;
    case 'grupoUsos':
      return 'grupoUsos';
    case 'errorUsos':
      return 'errorUsos';
    case 'tipoUso':
      return `tipoUso|${nodo.tipoAdt}`;
    case 'paqueteUso':
      return `paqueteUso|${nodo.tipoAdt}|${nodo.paquete}`;
    case 'uso':
      return `uso|${nodo.uso.tipoAdt}|${nodo.uso.paquete}|${nodo.uso.uriAdt}`;
    case 'anadirPrefijo':
      return `anadirPrefijo|${nodo.prefijo}`;
  }
}

/** `MARA` o `MARA-MTART`; `undefined` en los nodos que no nombran nada. */
export function nombreACopiar(nodo: NodoDiccionario): string | undefined {
  switch (nodo.clase) {
    case 'cabecera':
      return nodo.objeto.nombre;
    case 'campo':
      return `${nodo.tabla}-${nodo.campo.nombre}`;
    case 'include':
      return nodo.nombre;
    case 'elemento':
      return nodo.elemento.nombre;
    case 'dominio':
      return nodo.dominio.nombre;
    case 'valor':
      return nodo.valor;
    default:
      return undefined;
  }
}

export function resultadoDdl(objeto: ObjetoDiccionario): ResultadoBusqueda {
  return {
    nombre: objeto.nombre,
    tipo: objeto.tipoAdt,
    uriAdt: objeto.uriAdt,
    paquete: objeto.paquete ?? '',
    descripcion: objeto.descripcion,
  };
}

/** Lo que `abrirResultado` necesita para abrir un uso en la extensión oficial. */
export function resultadoUso(uso: Uso): ResultadoBusqueda {
  return { nombre: uso.nombre, tipo: uso.tipoAdt, uriAdt: uso.uriAdt, paquete: uso.paquete, descripcion: uso.descripcion };
}
