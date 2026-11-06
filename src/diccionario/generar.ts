import type { CampoDiccionario, Dominio } from './modelo';
import type { NodoDiccionario } from './panel-modelo';

/** `nombre` por defecto: ty_<tabla> (TYPES) o lt_<tabla> (SELECT), en minúsculas. */
export interface OpcionesGenerar { tabla: string; campos: CampoDiccionario[]; nombre?: string }

/** La tabla o estructura que muestra el panel, con su catálogo de campos. */
export interface ObjetoConCampos { tabla: string; campos: CampoDiccionario[] }

const LONGITUD_MAXIMA_NOMBRE = 30;
const INICIO_TYPES = 'TYPES: ';
const SANGRIA = '  ';
const INICIO_SELECT = 'SELECT ';
const FILAS_SELECT = 100;
const CAMPO_MANDANTE = 'MANDT';
const TIPO_MANDANTE = 'CLNT';
/** Con más valores fijos, el CASE se genera solo tras confirmarlo. */
export const MAX_VALORES_CASE_SIN_PREGUNTAR = 50;
const SEPARACION_COMENTARIO = '  ';

/** `/BOBF/S_FRW_KEY` → `ls_bobf_s_frw_key`: un identificador ABAP no admite barras ni pasa de 30 caracteres. */
function identificador(prefijo: string, tabla: string): string {
  const base = tabla.toLowerCase().split('/').filter((p) => p !== '').join('_');
  return `${prefijo}_${base}`.slice(0, LONGITUD_MAXIMA_NOMBRE);
}

/** Los pseudocampos `.INCLUDE`/`.APPEND` no son columnas. */
function camposReales(campos: CampoDiccionario[]): string[] {
  return campos.filter((c) => !c.nombre.startsWith('.')).map((c) => c.nombre.toLowerCase());
}

export function generarTypes(o: OpcionesGenerar): string {
  const tabla = o.tabla.toLowerCase();
  const nombre = o.nombre ?? identificador('ty', o.tabla);
  const campos = camposReales(o.campos);
  const ancho = Math.max(0, ...campos.map((c) => c.length));
  const margenCampo = ' '.repeat(INICIO_TYPES.length) + SANGRIA;
  const lineas = campos.map((c) => `${margenCampo}${c.padEnd(ancho)} TYPE ${tabla}-${c},`);
  return [
    `${INICIO_TYPES}BEGIN OF ${nombre},`,
    ...lineas,
    `${' '.repeat(INICIO_TYPES.length)}END OF ${nombre}.`,
  ].join('\n');
}

export function generarSelect(o: OpcionesGenerar): string {
  const nombre = o.nombre ?? identificador('lt', o.tabla);
  const campos = camposReales(o.campos);
  const margen = ' '.repeat(INICIO_SELECT.length);
  const lista = campos.map((c, i) => `${i === 0 ? INICIO_SELECT : margen}${c}${i < campos.length - 1 ? ',' : ''}`);
  return [
    ...lista,
    `${SANGRIA}FROM ${o.tabla.toLowerCase()}`,
    `${SANGRIA}INTO TABLE @DATA(${nombre})`,
    `${SANGRIA}UP TO ${FILAS_SELECT} ROWS.`,
  ].join('\n');
}

export function generarData(tabla: string): string {
  return `DATA ${identificador('ls', tabla)} TYPE ${tabla.toLowerCase()}.`;
}

export function generarTablaInterna(tabla: string): string {
  return `DATA ${identificador('lt', tabla)} TYPE STANDARD TABLE OF ${tabla.toLowerCase()} WITH EMPTY KEY.`;
}

/** Texto literal dentro de un snippet de VS Code: `$`, `}` y `\` no deben leerse como tabulaciones ni variables. */
export function escaparSnippet(texto: string): string {
  return texto.replace(/[$}\\]/g, (c) => `\\${c}`);
}

/** `MTART` → `${1:lv_mtart}`: la tabulación que el usuario renombra al insertar. */
export function variableCase(nombre: string): string {
  return `\${1:${identificador('lv', nombre)}}`;
}

export function tieneValoresFijos(d: Dominio | undefined): boolean {
  return d !== undefined && d.valores.length > 0;
}

/** Literal ABAP entre comillas simples: las comillas internas se duplican. */
function literal(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

/**
 * Snippet `CASE <variable>.` con un `WHEN` por valor fijo y su texto como comentario alineado; un intervalo no genera
 * `WHEN` sino un comentario. `variable` entra tal cual (puede ser ya una tabulación); el texto del sistema se escapa.
 */
export function generarCase(dominio: Dominio, variable: string): string {
  const whens = dominio.valores.map((v) => `${SANGRIA}WHEN ${literal(v.valor)}.`);
  const ancho = Math.max(0, ...whens.filter((_, i) => dominio.valores[i].valorAlto === undefined).map((w) => w.length));
  const lineas = dominio.valores.map((v, i) => {
    if (v.valorAlto !== undefined) {
      return `${SANGRIA}" intervalo ${literal(v.valor)} - ${literal(v.valorAlto)} no generado`;
    }
    const texto = v.texto.trim();
    return texto === '' ? whens[i] : `${whens[i].padEnd(ancho)}${SEPARACION_COMENTARIO}" ${texto}`;
  });
  return [`CASE ${variable}.`, ...lineas.map(escaparSnippet), `${SANGRIA}WHEN OTHERS.`, 'ENDCASE.'].join('\n');
}

/** Indenta todas las líneas salvo la primera; las de comentario con `*` se quedan en la columna 1, como exige ABAP. */
export function conIndentacion(codigo: string, indentacion: string): string {
  return codigo
    .split('\n')
    .map((linea, i) => (i === 0 || linea.startsWith('*') ? linea : `${indentacion}${linea}`))
    .join('\n');
}

function esMandante(c: CampoDiccionario): boolean {
  return c.nombre.toUpperCase() === CAMPO_MANDANTE || c.tipo.toUpperCase() === TIPO_MANDANTE;
}

function claveCampo(c: CampoDiccionario): string {
  return `${c.posicion}|${c.nombre}`;
}

/** Los campos seleccionados, sin repetidos y en el orden del catálogo (la posición). */
function camposSeleccionados(nodo: Extract<NodoDiccionario, { clase: 'campo' }>, seleccion: NodoDiccionario[] | undefined): CampoDiccionario[] {
  const campos = (seleccion ?? []).flatMap((n) => (n.clase === 'campo' ? [n.campo] : []));
  const incluyeNodo = campos.some((c) => claveCampo(c) === claveCampo(nodo.campo));
  const unicos = new Map((incluyeNodo ? campos : [nodo.campo]).map((c) => [claveCampo(c), c]));
  return Array.from(unicos.values()).sort((a, b) => a.posicion - b.posicion);
}

/**
 * Desde un campo, la selección múltiple del árbol (si el campo pulsado está en ella); desde un include, sus campos;
 * desde la cabecera o el grupo de campos, todo el catálogo salvo el mandante. `undefined` desde otros nodos.
 */
export function camposParaGenerar(
  nodo: NodoDiccionario, seleccion: NodoDiccionario[] | undefined, mostrado: ObjetoConCampos | undefined,
): ObjetoConCampos | undefined {
  switch (nodo.clase) {
    case 'campo':
      return { tabla: nodo.tabla, campos: camposSeleccionados(nodo, seleccion) };
    case 'include':
      return mostrado ? { tabla: mostrado.tabla, campos: nodo.campos } : undefined;
    case 'cabecera':
    case 'grupoCampos':
      return mostrado ? { tabla: mostrado.tabla, campos: mostrado.campos.filter((c) => !esMandante(c)) } : undefined;
    default:
      return undefined;
  }
}
