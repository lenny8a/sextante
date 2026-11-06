/**
 * Patrón de llamada tipo SE37/SE24: texto de una `vscode.SnippetString` que escribe la llamada
 * completa a un módulo de funciones o a un método (mejoras 1, área C). Módulo puro, sin `vscode`.
 */
import { escaparSnippet } from '../diccionario/generar';
import type { ClaseParametro, Excepcion, Firma, FirmaFuncion, FirmaMetodo, Parametro } from './modelo';

export const ANCHO_LINEA = 80;

export interface OpcionesPatron {
  /** Texto del receptor tal como está en el código (`lo_alv`, `me`, `super`, `cl_x=>`); vacío = decidir por la firma. */
  receptor?: string;
}

interface Linea {
  texto: string;
  comentario: boolean;
}

interface Contador {
  n: number;
}

const SANGRIA_TRY = 4;

const BLOQUE_SUBRC = [
  'IF sy-subrc <> 0.',
  '* MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno',
  '*   WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4.',
  'ENDIF.',
];

export function nombreReceptorPorDefecto(clase: string): string {
  const base = clase
    .toLowerCase()
    .replace(/^\/[^/]+\//, '')
    .replace(/^(?:cl_|zcl_|ycl_|if_|zif_|yif_)/, '');
  return 'lo_' + base;
}

export function patronLlamada(firma: Firma, opciones: OpcionesPatron = {}): string {
  return firma.tipo === 'funcion' ? patronFuncion(firma) : patronMetodo(firma, opciones.receptor ?? '');
}

function siguiente(contador: Contador): string {
  contador.n += 1;
  return String(contador.n);
}

function minusculas(texto: string): string {
  return escaparSnippet(texto.toLowerCase());
}

function minusculasFueraDeLiterales(texto: string): string {
  return texto
    .split(/('[^']*'|`[^`]*`)/)
    .map((trozo, i) => (i % 2 === 1 ? trozo : trozo.toLowerCase()))
    .join('');
}

function activa(texto: string): Linea {
  return { texto, comentario: false };
}

function comentada(texto: string): Linea {
  return { texto, comentario: true };
}

function anchoDe(parametros: Parametro[], excepciones: Excepcion[], conOthers: boolean): number {
  const nombres = [...parametros.map((p) => p.nombre), ...excepciones.map((e) => e.nombre)];
  if (conOthers) nombres.push('OTHERS');
  return Math.max(0, ...nombres.map((n) => n.length));
}

function lineaParametro(p: Parametro, ancho: number, contador: Contador): Linea {
  const nombre = minusculas(p.nombre).padEnd(ancho);
  if (p.opcional) return comentada(`*   ${nombre} = ${escaparSnippet(minusculasFueraDeLiterales(p.porDefecto ?? ''))}`);
  return activa(`    ${nombre} = \${${siguiente(contador)}}`);
}

/** Un bloque del llamador; si todos sus parámetros son opcionales, también la palabra clave va comentada. */
function lineasBloque(palabra: string, parametros: Parametro[], ancho: number, contador: Contador): Linea[] {
  if (parametros.length === 0) return [];
  const lineas = parametros.map((p) => lineaParametro(p, ancho, contador));
  const cabecera = lineas.some((l) => !l.comentario) ? activa(`  ${palabra}`) : comentada(`*  ${palabra}`);
  return [cabecera, ...lineas];
}

function lineasExcepciones(excepciones: Excepcion[], ancho: number): Linea[] {
  if (excepciones.length === 0) return [];
  const lineas = excepciones.map((e, i) => activa(`    ${minusculas(e.nombre).padEnd(ancho)} = ${i + 1}`));
  lineas.push(activa(`    ${'OTHERS'.padEnd(ancho)} = ${excepciones.length + 1}`));
  return [activa('  EXCEPTIONS'), ...lineas];
}

function cerrar(lineas: Linea[], cierre: string): Linea[] {
  let ultima = -1;
  lineas.forEach((l, i) => {
    if (!l.comentario) ultima = i;
  });
  return lineas.map((l, i) => (i === ultima ? { ...l, texto: l.texto + cierre } : l));
}

function unir(lineas: Linea[], sangria = 0): string {
  const relleno = ' '.repeat(sangria);
  return lineas
    .map((l) => (l.comentario ? '*' + relleno + l.texto.slice(1) : relleno + l.texto))
    .join('\n');
}

function delLlamador(parametros: Parametro[], clase: ClaseParametro): Parametro[] {
  return parametros.filter((p) => p.clase === clase);
}

function patronFuncion(firma: FirmaFuncion): string {
  const contador: Contador = { n: 0 };
  const ancho = anchoDe(firma.parametros, firma.excepciones, firma.excepciones.length > 0);
  const lineas: Linea[] = [
    activa(`CALL FUNCTION '${escaparSnippet(firma.nombre.toUpperCase())}'`),
    ...lineasBloque('EXPORTING', delLlamador(firma.parametros, 'importing'), ancho, contador),
    ...lineasBloque('IMPORTING', delLlamador(firma.parametros, 'exporting'), ancho, contador),
    ...lineasBloque('CHANGING', delLlamador(firma.parametros, 'changing'), ancho, contador),
    ...lineasBloque('TABLES', delLlamador(firma.parametros, 'tables'), ancho, contador),
    ...lineasExcepciones(firma.excepciones, ancho),
  ];
  const texto = unir(cerrar(lineas, '.'));
  return firma.excepciones.length > 0 ? [texto, ...BLOQUE_SUBRC].join('\n') : texto;
}

function receptorDe(firma: FirmaMetodo, indicado: string, contador: Contador): string {
  const dado = indicado.trim();
  if (dado === '') {
    if (firma.estatico) return escaparSnippet(firma.clase.toLowerCase()) + '=>';
    return '${' + siguiente(contador) + ':' + escaparSnippet(nombreReceptorPorDefecto(firma.clase)) + '}->';
  }
  if (dado === 'me' || dado === 'super') return dado + '->';
  if (dado.endsWith('=>') || dado.endsWith('->')) return escaparSnippet(dado);
  return escaparSnippet(dado) + '->';
}

function patronMetodo(firma: FirmaMetodo, receptor: string): string {
  const esConstructor = firma.nombre.toUpperCase() === 'CONSTRUCTOR';
  const clasica = !esConstructor && !firma.excepcionesDeClase && firma.excepciones.length > 0;
  const contador: Contador = { n: 0 };
  if (clasica) return patronMetodoClasico(firma, receptor, contador);

  const resultado = firma.parametros.find((p) => p.clase === 'returning');
  let cabecera: string;
  if (esConstructor) {
    const variable = escaparSnippet(nombreReceptorPorDefecto(firma.clase));
    cabecera = 'DATA(${' + siguiente(contador) + ':' + variable + '}) = NEW ' + escaparSnippet(firma.clase.toLowerCase()) + '(';
  } else {
    const asignacion = resultado
      ? 'DATA(${' + siguiente(contador) + ':lv_' + minusculas(resultado.nombre) + '}) = '
      : '';
    cabecera = asignacion + receptorDe(firma, receptor, contador) + minusculas(firma.nombre) + '(';
  }

  const parametros = firma.parametros.filter((p) => p.clase !== 'returning');
  const conTry = firma.excepcionesDeClase && firma.excepciones.length > 0;
  const sangria = conTry ? SANGRIA_TRY : 0;
  const cuerpo = lineasMetodoFuncional(cabecera, parametros, esConstructor, sangria, contador);
  return conTry ? envolverEnTry(cuerpo, firma.excepciones) : unir(cuerpo);
}

function lineasMetodoFuncional(
  cabecera: string,
  parametros: Parametro[],
  esConstructor: boolean,
  sangria: number,
  contador: Contador,
): Linea[] {
  const utiles = esConstructor ? parametros.filter((p) => p.clase === 'importing') : parametros;
  const soloImporting = utiles.every((p) => p.clase === 'importing' && !p.opcional);
  if (soloImporting) {
    const inicio = contador.n;
    const enLinea = utiles.map((p) => `${minusculas(p.nombre)} = \${${siguiente(contador)}}`);
    const texto = [cabecera, ...enLinea].join(' ') + ' ).';
    if (texto.length + sangria <= ANCHO_LINEA) return [activa(texto)];
    contador.n = inicio;
  }
  const ancho = anchoDe(utiles, [], false);
  if (esConstructor) {
    const directas = utiles.map((p) => lineaParametro(p, ancho, contador));
    return cerrar([activa(cabecera), ...directas], ' ).');
  }
  const lineas: Linea[] = [
    activa(cabecera),
    ...lineasBloque('EXPORTING', delLlamador(utiles, 'importing'), ancho, contador),
    ...lineasBloque('IMPORTING', delLlamador(utiles, 'exporting'), ancho, contador),
    ...lineasBloque('CHANGING', delLlamador(utiles, 'changing'), ancho, contador),
  ];
  return cerrar(lineas, ' ).');
}

function envolverEnTry(cuerpo: Linea[], excepciones: Excepcion[]): string {
  const capturas = excepciones.map((e, i) => {
    const variable = i === 0 ? 'lx_error' : `lx_error_${i + 1}`;
    return `  CATCH ${minusculas(e.nombre)} INTO DATA(${variable}).`;
  });
  return ['TRY.', unir(cuerpo, SANGRIA_TRY), ...capturas, 'ENDTRY.'].join('\n');
}

function patronMetodoClasico(firma: FirmaMetodo, receptor: string, contador: Contador): string {
  const ancho = anchoDe(firma.parametros, firma.excepciones, true);
  const cabecera = 'CALL METHOD ' + receptorDe(firma, receptor, contador) + minusculas(firma.nombre);
  const lineas: Linea[] = [
    activa(cabecera),
    ...lineasBloque('EXPORTING', delLlamador(firma.parametros, 'importing'), ancho, contador),
    ...lineasBloque('IMPORTING', delLlamador(firma.parametros, 'exporting'), ancho, contador),
    ...lineasBloque('CHANGING', delLlamador(firma.parametros, 'changing'), ancho, contador),
    ...lineasBloque('RECEIVING', delLlamador(firma.parametros, 'returning'), ancho, contador),
    ...lineasExcepciones(firma.excepciones, ancho),
  ];
  return [unir(cerrar(lineas, '.')), ...BLOQUE_SUBRC].join('\n');
}
