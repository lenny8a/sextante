import { tieneValoresFijos, variableCase } from './generar';
import type { CampoDiccionario, Dominio, ElementoDatos, Mensaje, TipoDiccionario } from './modelo';
import type { Resuelto } from './servicio';

export const MAX_CAMPOS_HOVER = 15;
/** Argumento `{ destino, nombre }`; el comando se registra en el panel Diccionario. */
export const COMANDO_ABRIR_PANEL = 'abapNavigator.diccionario.abrir';
/** Argumento `{ destino }`. */
export const COMANDO_CONECTAR = 'abapNavigator.diccionario.conectar';
/** Argumento `{ destino, dominio, variable }`; el comando se registra en el panel Diccionario. */
export const COMANDO_GENERAR_CASE = 'abapNavigator.diccionario.generarCase';

const MAX_VALORES_HOVER = 10;
const SEPARADOR = ' · ';

export const ETIQUETA_TIPO: Readonly<Record<TipoDiccionario, string>> = {
  tabla: 'Tabla transparente',
  estructura: 'Estructura',
  elementoDatos: 'Elemento de datos',
  dominio: 'Dominio',
};

/** Texto libre del sistema dentro de una línea o celda: sin saltos de línea y sin sintaxis Markdown. */
export function escapar(texto: string): string {
  return texto
    .replace(/\r?\n|\r/g, ' ')
    .replace(/[\\`*[\]<>|#]/g, (c) => `\\${c}`)
    .replace(/\$\(/g, '\\$(')
    .trim();
}

/** `encodeURIComponent` deja `(` y `)`: un `)` del argumento (receptor, expresión del cursor) cerraría el enlace Markdown. */
export function enlaceComando(comando: string, argumento: object): string {
  const codificado = encodeURIComponent(JSON.stringify(argumento)).replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));
  return `command:${comando}?${codificado}`;
}

/** `CHAR 40`, `DEC 13,3`; sin longitud solo el tipo. */
export function tipoTecnico(tipo: string, longitud: number, decimales: number): string {
  if (longitud <= 0) {
    return tipo;
  }
  return decimales > 0 ? `${tipo} ${longitud},${decimales}` : `${tipo} ${longitud}`;
}

export function linea(partes: Array<string | undefined>): string {
  return partes.filter((p): p is string => p !== undefined && p !== '').join(SEPARADOR);
}

function filaCampo(c: CampoDiccionario): string {
  const celdas = [c.clave ? '🔑' : '', c.nombre, c.elementoDatos, tipoTecnico(c.tipo, c.longitud, c.decimales), escapar(c.texto)];
  return `| ${celdas.join(' | ')} |`;
}

function tablaCampos(campos: CampoDiccionario[]): string[] {
  return [
    '| 🔑 | Campo | Elem. datos | Tipo | Texto |',
    '|---|---|---|---|---|',
    ...campos.slice(0, MAX_CAMPOS_HOVER).map(filaCampo),
  ];
}

export function markdownObjeto(r: Resuelto, destino: string): string {
  const { objeto, campos } = r;
  const cabecera = linea([
    `**${objeto.nombre}**`,
    ETIQUETA_TIPO[objeto.tipo],
    escapar(objeto.descripcion),
    objeto.paquete ? `paquete ${objeto.paquete}` : undefined,
  ]);
  const bloques = [cabecera];
  if (campos && campos.length > 0) {
    bloques.push(tablaCampos(campos).join('\n'));
  }
  const enlace = enlaceComando(COMANDO_ABRIR_PANEL, { destino, nombre: objeto.nombre });
  const restantes = (campos?.length ?? 0) - MAX_CAMPOS_HOVER;
  bloques.push(restantes > 0
    ? `[… y ${restantes} campos más en el panel Diccionario](${enlace})`
    : `[$(book) Abrir en el panel Diccionario](${enlace})`);
  return bloques.join('\n\n');
}

function bloqueDominio(d: Dominio): string[] {
  const bloques = [linea([
    `Dominio **${d.nombre}**`,
    escapar(d.descripcion),
    d.tablaValores ? `tabla de valores ${d.tablaValores}` : undefined,
  ])];
  if (d.valores.length > 0) {
    const valores = d.valores.slice(0, MAX_VALORES_HOVER).map((v) => `- \`${v.valor.replace(/`/g, "'")}\` ${escapar(v.texto)}`);
    const restantes = d.valores.length - MAX_VALORES_HOVER;
    if (restantes > 0) {
      valores.push(`- … y ${restantes} valores más`);
    }
    bloques.push(valores.join('\n'));
  }
  return bloques;
}

/** Enlace «Generar CASE» solo si el dominio tiene valores fijos y se sabe el destino; sin `variable`, `${1:lv_<nombre>}`. */
function enlaceCase(d: Dominio | undefined, destino: string | undefined, nombre: string, variable: string | undefined): string | undefined {
  if (d === undefined || destino === undefined || !tieneValoresFijos(d)) {
    return undefined;
  }
  const argumento = { destino, dominio: d.nombre, variable: variable ?? variableCase(nombre) };
  return `[$(list-unordered) Generar CASE](${enlaceComando(COMANDO_GENERAR_CASE, argumento)})`;
}

/** `variable`: la expresión bajo el cursor (`ls_mara-mtart`) para el enlace «Generar CASE». */
export function markdownCampo(
  tabla: string, c: CampoDiccionario, e?: ElementoDatos, d?: Dominio, destino?: string, variable?: string,
): string {
  const bloques = [linea([
    `**${tabla}-${c.nombre}**`,
    c.elementoDatos,
    tipoTecnico(c.tipo, c.longitud, c.decimales),
    escapar(c.texto),
  ])];
  if (e) {
    bloques.push(linea([`Elemento de datos **${e.nombre}**`, escapar(e.descripcion)]));
  }
  if (d) {
    bloques.push(...bloqueDominio(d));
  }
  const enlace = enlaceCase(d, destino, c.nombre, variable);
  if (enlace) {
    bloques.push(enlace);
  }
  return bloques.join('\n\n');
}

/** Con el dominio del elemento y el destino, enlace «Generar CASE» si tiene valores fijos. */
export function markdownElemento(e: ElementoDatos, d?: Dominio, destino?: string, variable?: string): string {
  const { corta, media, larga } = e.etiquetas;
  const etiquetas = [corta, media, larga].map(escapar).filter((t) => t !== '');
  const bloques = [
    linea([`**${e.nombre}**`, ETIQUETA_TIPO.elementoDatos, escapar(e.descripcion)]),
    linea([tipoTecnico(e.tipo, e.longitud, e.decimales), e.dominio ? `dominio ${e.dominio}` : undefined]),
  ];
  if (etiquetas.length > 0) {
    bloques.push(`Etiquetas: ${etiquetas.join(SEPARADOR)}`);
  }
  if (e.ayudaBusqueda) {
    bloques.push(`Ayuda de búsqueda: ${e.ayudaBusqueda}`);
  }
  const enlace = enlaceCase(d, destino, e.nombre, variable);
  if (enlace) {
    bloques.push(enlace);
  }
  return bloques.join('\n\n');
}

/** `tipo` solo cuando viene en el código (`MESSAGE e001(zmsg)`). */
export function markdownMensaje(m: Mensaje, tipo?: string): string {
  const titulo = tipo ? `${m.clase} ${m.numero} (${tipo})` : `${m.clase} ${m.numero}`;
  return linea([`**${titulo}**`, escapar(m.texto)]);
}

export function markdownConectar(destino: string): string {
  return `$(plug) [Conéctate al sistema para ver el diccionario](${enlaceComando(COMANDO_CONECTAR, { destino })})`;
}
