import { enlaceComando, escapar, linea } from '../diccionario/hover-modelo';
import type { ClaseParametro, ClaseResumen, Excepcion, FirmaFuncion, FirmaMetodo, MetodoResumen, Parametro } from './modelo';

export const COMANDO_INSERTAR_LLAMADA = 'abapNavigator.firmas.insertarLlamada';
export const COMANDO_ABRIR_FIRMA = 'abapNavigator.firmas.abrir';
export const MAX_METODOS_HOVER = 8;

/** Argumento del enlace "Insertar llamada" y del comando de la paleta cuando ya se sabe qué insertar. `fila` es la línea del editor (desde 0). */
export interface PeticionInsertar {
  destino: string;
  firma: { tipo: 'funcion'; nombre: string } | { tipo: 'metodo'; objeto: string; metodo: string; viaSuper?: boolean };
  receptor: string;
  fila: number;
}

/** El método tal como está en el código (`objeto`, `metodo` con `~`, `viaSuper`): la misma clave de caché que el hover. */
export interface DestinoLlamada {
  objeto: string;
  metodo: string;
  viaSuper?: boolean;
}

export interface PeticionAbrirFirma {
  destino: string;
  uriAdt: string;
  nombre: string;
  tipoAdt: string;
}

const SEPARADOR = ' · ';
const ORDEN_CLASES: readonly ClaseParametro[] = ['importing', 'exporting', 'changing', 'tables', 'returning'];
const ETIQUETA_VISIBILIDAD = { publico: 'público', protegido: 'protegido', privado: 'privado' } as const;

export function etiquetaTipo(p: Parametro): string {
  switch (p.formaTipo) {
    case 'ninguna':
      return 'genérico';
    case 'like':
      return `LIKE ${p.tipo}`;
    case 'refTo':
      return `REF TO ${p.tipo}`;
    case 'type':
      return p.tipo;
  }
}

export function etiquetaOpcional(p: Parametro): string {
  if (p.porDefecto !== undefined && p.porDefecto !== '') {
    return `opcional, por defecto ${p.porDefecto}`;
  }
  return p.opcional ? 'opcional' : '';
}

function filaParametro(p: Parametro): string {
  const celdas = [p.nombre.toLowerCase(), etiquetaTipo(p), etiquetaOpcional(p), p.texto ?? ''].map(escapar);
  return `| ${celdas.join(' | ')} |`;
}

function bloquesParametros(parametros: Parametro[]): string[] {
  const bloques: string[] = [];
  for (const clase of ORDEN_CLASES) {
    const delGrupo = parametros.filter((p) => p.clase === clase);
    if (delGrupo.length > 0) {
      bloques.push([clase.toUpperCase(), '', '| | | | |', '|---|---|---|---|', ...delGrupo.map(filaParametro)].join('\n'));
    }
  }
  return bloques;
}

function bloqueExcepciones(excepciones: Excepcion[], palabra: 'EXCEPTIONS' | 'RAISING'): string[] {
  if (excepciones.length === 0) {
    return [];
  }
  return [`${palabra}\n\n${excepciones.map((e) => escapar(e.nombre.toLowerCase())).join(SEPARADOR)}`];
}

function enlaceInsertar(peticion: PeticionInsertar): string {
  return `[$(symbol-method) Insertar llamada](${enlaceComando(COMANDO_INSERTAR_LLAMADA, peticion)})`;
}

function enlaceAbrir(peticion: PeticionAbrirFirma): string {
  return `[$(go-to-file) Abrir](${enlaceComando(COMANDO_ABRIR_FIRMA, peticion)})`;
}

function firmaDeLlamada({ objeto, metodo, viaSuper }: DestinoLlamada): PeticionInsertar['firma'] {
  return viaSuper ? { tipo: 'metodo', objeto, metodo, viaSuper } : { tipo: 'metodo', objeto, metodo };
}

export function markdownFuncion(f: FirmaFuncion, destino: string, fila: number): string {
  const cabecera = linea([
    `**${f.nombre}**`,
    'Módulo de funciones',
    `grupo ${f.grupo}`,
    f.rfc ? 'RFC' : undefined,
    escapar(f.descripcion),
  ]);
  const enlaces = [
    enlaceInsertar({ destino, firma: { tipo: 'funcion', nombre: f.nombre }, receptor: '', fila }),
    enlaceAbrir({ destino, uriAdt: f.uriAdt, nombre: f.nombre, tipoAdt: 'FUGR/FF' }),
  ];
  return [
    cabecera,
    ...bloquesParametros(f.parametros),
    ...bloqueExcepciones(f.excepciones, 'EXCEPTIONS'),
    enlaces.join('   '),
  ].join('\n\n');
}

export function markdownMetodo(f: FirmaMetodo, destino: string, receptor: string, fila: number, destinoLlamada: DestinoLlamada): string {
  const tipoMetodo = ['Método', f.estatico ? 'estático' : undefined, f.abstracto ? 'abstracto' : undefined, ETIQUETA_VISIBILIDAD[f.visibilidad]]
    .filter((p): p is string => p !== undefined)
    .join(' ');
  const cabecera = linea([
    `**${f.clase}${f.estatico ? '=>' : '->'}${f.nombre}**`,
    tipoMetodo,
    f.heredadoDe ? `heredado de ${f.heredadoDe}` : undefined,
    f.deInterfaz ? `de la interfaz ${f.deInterfaz}` : undefined,
    escapar(f.descripcion),
  ]);
  const tipoAdt = f.uriAdt.includes('/oo/interfaces/') ? 'INTF/OI' : 'CLAS/OC';
  const enlaces = [
    enlaceInsertar({ destino, firma: firmaDeLlamada(destinoLlamada), receptor, fila }),
    enlaceAbrir({ destino, uriAdt: f.uriAdt, nombre: f.clase, tipoAdt }),
  ];
  return [
    cabecera,
    ...bloquesParametros(f.parametros),
    ...bloqueExcepciones(f.excepciones, f.excepcionesDeClase ? 'RAISING' : 'EXCEPTIONS'),
    enlaces.join('   '),
  ].join('\n\n');
}

function listaMetodos(titulo: string, metodos: MetodoResumen[], conOrigen: boolean): string[] {
  if (metodos.length === 0) {
    return [];
  }
  const nombres = metodos
    .slice(0, MAX_METODOS_HOVER)
    .map((m) => escapar(conOrigen && m.origen ? `${m.nombre} (${m.origen})` : m.nombre));
  const restantes = metodos.length - MAX_METODOS_HOVER;
  if (restantes > 0) {
    nombres.push(`… y ${restantes} más`);
  }
  return [`${titulo}: ${nombres.join(SEPARADOR)}`];
}

export function markdownClase(c: ClaseResumen, destino: string): string {
  const cabecera = linea([
    `**${c.nombre}**`,
    c.esInterfaz ? 'Interfaz' : 'Clase',
    escapar(c.descripcion),
    c.paquete ? `paquete ${c.paquete}` : undefined,
    c.superclase ? `hereda de ${c.superclase}` : undefined,
    c.interfaces.length > 0 ? `implementa ${c.interfaces.join(', ')}` : undefined,
  ]);
  const listas = [
    ...listaMetodos('Métodos públicos', c.metodos, false),
    ...listaMetodos('Heredados y de interfaces', c.heredados, true),
  ];
  const tipoAdt = c.esInterfaz ? 'INTF/OI' : 'CLAS/OC';
  return [
    cabecera,
    ...(listas.length > 0 ? [listas.join('\n\n')] : []),
    enlaceAbrir({ destino, uriAdt: c.uriAdt, nombre: c.nombre, tipoAdt }),
  ].join('\n\n');
}
