import { type Dump, fechaHoraLocal, type MarcoPilaFeed, marcosDe, textoDeResumen } from './dumps-modelo';
import type { DumpCompleto, GrupoVariables, NivelPila, VariableDump } from './snap-modelo';

export type EstadoDumpCompleto =
  | { clase: 'cargando' }
  | { clase: 'ok'; completo: DumpCompleto }
  | { clase: 'error'; motivo: string };

export interface EnlaceDocumento {
  linea: number;
  inicio: number;
  fin: number;
  uriAdt: string;
  lineaDestino: number;
}

export interface DocumentoDump {
  texto: string;
  enlaces: EnlaceDocumento[];
}

export const TEXTO_CARGANDO = 'Cargando variables y campos de sistema…';

const LIMITE_FILA = 120;
const ANCHO_NOMBRE = 15;
const ANCHO_CAMPO = 22;
const CAMPOS_POR_LINEA = 3;
const S = '  ';

const CABECERAS_FEED = [
  'WHAT HAPPENED',
  'ERROR ANALYSIS',
  'INFORMATION ON WHERE TERMINATED',
  'SOURCE CODE EXTRACT',
  'ACTIVE CALLS/EVENTS',
  'HEADER INFORMATION',
] as const;

function recortar(texto: string): string {
  return texto.length > LIMITE_FILA ? `${texto.slice(0, LIMITE_FILA - 1)}…` : texto;
}

function seccion(lineas: string[], titulo: string): void {
  lineas.push('', titulo);
}

function seccionesDelFeed(resumenHtml: string): Map<string, string[]> {
  const secciones = new Map<string, string[]>();
  let actual: string[] | undefined;
  for (const linea of textoDeResumen(resumenHtml).split('\n')) {
    const cabecera = CABECERAS_FEED.find((c) => linea.startsWith(c) && linea === linea.toUpperCase());
    if (cabecera) {
      actual = [];
      secciones.set(cabecera, actual);
    } else if (actual) {
      actual.push(linea);
    }
  }
  for (const cuerpo of secciones.values()) {
    while (cuerpo.length > 0 && cuerpo[cuerpo.length - 1] === '') {
      cuerpo.pop();
    }
  }
  return secciones;
}

function fechaDeAt(aaaammddhhmmss: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(aaaammddhhmmss);
  if (!m) {
    return aaaammddhhmmss;
  }
  const [a, mes, d, h, mi, s] = m.slice(1).map(Number);
  return fechaHoraLocal(new Date(a, mes - 1, d, h, mi, s).toISOString());
}

function enUnaLinea(texto: string): string {
  return texto.replace(/\s*\n\s*/g, ' ');
}

function cabeceraDe(dump: Dump, destino: string, completo?: DumpCompleto): string {
  const partes = [enUnaLinea(dump.errorEjecucion)];
  if (completo?.excepcion) {
    partes.push(completo.excepcion);
  }
  partes.push(completo ? `${completo.programa} línea ${completo.linea}` : dump.programa);
  partes.push(fechaHoraLocal(dump.publicado));
  if (dump.usuario !== '') {
    partes.push(dump.usuario);
  }
  if (destino !== '') {
    partes.push(destino);
  }
  return partes.join(' · ');
}

function queFallo(lineas: string[], dump: Dump, feed: Map<string, string[]>): void {
  seccion(lineas, 'QUÉ FALLÓ');
  lineas.push(`${S}${enUnaLinea(dump.textoCorto)}`);
  for (const nombre of ['WHAT HAPPENED', 'ERROR ANALYSIS']) {
    const cuerpo = feed.get(nombre);
    if (cuerpo && cuerpo.length > 0) {
      lineas.push('', ...cuerpo.map((l) => (l === '' ? l : `${S}${l}`)));
    }
  }
}

function posicionTexto(dump: Dump, completo?: DumpCompleto): string | undefined {
  if (completo) {
    const base = `Programa ${completo.programa} · include ${completo.include} · línea ${completo.linea}`;
    return completo.evento ? `${base} · ${completo.evento}` : base;
  }
  const marco = marcosDe(dump.resumenHtml)[0];
  return marco
    ? `Programa ${marco.programa} · include ${marco.include} · línea ${marco.linea} · ${marco.evento}`
    : undefined;
}

function dondeFallo(lineas: string[], dump: Dump, feed: Map<string, string[]>, completo?: DumpCompleto): void {
  seccion(lineas, 'DÓNDE FALLÓ');
  const posicion = posicionTexto(dump, completo);
  if (posicion) {
    lineas.push(`${S}${posicion}`);
  }
  const extracto = (feed.get('SOURCE CODE EXTRACT') ?? []).filter((l) => l !== '');
  lineas.push(...extracto.map((l) => `${S}${l}`));
}

function filaPila(nr: string, tipo: string | undefined, programa: string, include: string, linea: number | string, nombre: string): string {
  const tipoTexto = tipo === undefined ? '' : `${tipo.padEnd(13)} `;
  return recortar(
    `${S}${nr.padStart(3)}  ${tipoTexto}${programa.padEnd(12)} ${include.padEnd(12)} ${String(linea).padStart(5)}  ${nombre}`,
  );
}

function coincide(nivel: NivelPila, marco: MarcoPilaFeed | undefined): marco is MarcoPilaFeed {
  return (
    marco?.uriAdt !== undefined &&
    marco.programa.toUpperCase() === nivel.programa.toUpperCase() &&
    marco.include.toUpperCase() === nivel.include.toUpperCase() &&
    marco.linea === nivel.linea
  );
}

function pila(lineas: string[], enlaces: EnlaceDocumento[], dump: Dump, completo?: DumpCompleto): void {
  seccion(lineas, 'LLAMADAS ACTIVAS / EVENTOS');
  const marcos = marcosDe(dump.resumenHtml);
  const emitir = (texto: string, marco: MarcoPilaFeed | undefined): void => {
    if (marco?.uriAdt !== undefined) {
      enlaces.push({ linea: lineas.length, inicio: 0, fin: texto.length, uriAdt: marco.uriAdt, lineaDestino: marco.linea });
    }
    lineas.push(texto);
  };
  if (completo) {
    lineas.push(filaPila('Nr', 'Tipo', 'Programa', 'Include', 'Línea', 'Nombre'));
    completo.pila.forEach((nivel, indice) => {
      const nombre = nivel.clase ? `${nivel.clase}=>${nivel.nombre}` : nivel.nombre;
      const marco = marcos[indice];
      emitir(
        filaPila(nivel.nr, nivel.tipo, nivel.programa, nivel.include, nivel.linea, nombre),
        coincide(nivel, marco) ? marco : undefined,
      );
    });
    return;
  }
  lineas.push(filaPila('Nr', undefined, 'Programa', 'Include', 'Línea', 'Evento'));
  for (const marco of marcos) {
    emitir(filaPila(marco.nr, undefined, marco.programa, marco.include, marco.linea, marco.evento), marco);
  }
}

function lineasVariable(variable: VariableDump): string[] {
  const nombre = `${S}${S}${variable.nombre.padEnd(ANCHO_NOMBRE)}`;
  if (variable.tabla) {
    return [
      `${nombre}${variable.tabla.cabecera}`,
      ...variable.tabla.filas.map((fila, i) => `${S}${S}${S}fila ${i + 1}: ${recortar(fila.trimEnd())}`),
    ];
  }
  return [`${nombre}= '${variable.valor ?? ''}'`];
}

function variables(lineas: string[], grupos: GrupoVariables[]): void {
  const conDatos = grupos.filter((g) => g.variables.length > 0);
  if (conDatos.length === 0) {
    return;
  }
  seccion(lineas, 'VARIABLES SELECCIONADAS');
  for (const grupo of conDatos) {
    lineas.push(`${S}${grupo.titulo}`, ...grupo.variables.flatMap(lineasVariable));
  }
}

function camposDeSistema(lineas: string[], completo: DumpCompleto): void {
  if (completo.camposSistema.length === 0) {
    return;
  }
  seccion(lineas, 'CAMPOS DE SISTEMA');
  const celdas = completo.camposSistema.map((c) => `${c.nombre} = ${c.valor}`);
  for (let i = 0; i < celdas.length; i += CAMPOS_POR_LINEA) {
    const grupo = celdas.slice(i, i + CAMPOS_POR_LINEA);
    const fila = grupo.map((c, j) => (j === grupo.length - 1 ? c : c.padEnd(Math.max(ANCHO_CAMPO, c.length + 2)))).join('');
    lineas.push(`${S}${fila.trimEnd()}`);
  }
}

function parametros(lineas: string[], completo: DumpCompleto): void {
  if (completo.parametrosConId.length === 0) {
    return;
  }
  seccion(lineas, 'PARÁMETROS DEL ERROR');
  lineas.push(`${S}${completo.parametrosConId.map((p) => `${p.id} = ${p.valor}`).join(' · ')}`);
}

function usuarioYTransaccion(lineas: string[], c: DumpCompleto): void {
  seccion(lineas, 'USUARIO Y TRANSACCIÓN');
  lineas.push(
    `${S}Usuario ${c.usuario} · mandante ${c.mandante} · idioma ${c.idioma} · terminal ${c.terminal} · transacción ${c.transaccion ?? '—'}`,
  );
  if (c.programaPantalla) {
    lineas.push(`${S}Programa de pantalla ${c.programaPantalla} · dynpro ${c.dynpro ?? '—'}`);
  }
  if (c.rfc) {
    lineas.push(
      `${S}Llamada RFC entrante: función ${c.rfc.funcion} · destino ${c.rfc.destino} · desde ${c.rfc.desde} (${c.rfc.usuario}, ${c.rfc.programa})`,
    );
  }
}

function entorno(lineas: string[], c: DumpCompleto): void {
  const e = c.entorno;
  seccion(lineas, 'ENTORNO');
  lineas.push(
    `${S}Release ${e.release} · ${e.so} ${e.arquitectura} · servidor ${e.servidor} · BD ${e.baseDatos} · kernel ${e.kernel} parche ${e.parche}`,
    `${S}${e.archivo} ${e.funcion} · programa generado ${fechaDeAt(e.generado)}`,
    `${S}Opcodes alrededor del error: ${c.conteos.opcodes} · programas cargados: ${c.conteos.programasCargados} · pila del kernel: ${c.conteos.pilaKernel} líneas`,
  );
}

export function documentoDump(dump: Dump, destino: string, estado: EstadoDumpCompleto): DocumentoDump {
  const completo = estado.clase === 'ok' ? estado.completo : undefined;
  const feed = seccionesDelFeed(dump.resumenHtml);
  const lineas: string[] = [cabeceraDe(dump, destino, completo)];
  const enlaces: EnlaceDocumento[] = [];
  queFallo(lineas, dump, feed);
  dondeFallo(lineas, dump, feed, completo);
  pila(lineas, enlaces, dump, completo);
  if (estado.clase === 'cargando') {
    lineas.push('', TEXTO_CARGANDO);
  } else if (estado.clase === 'error') {
    lineas.push('', `Variables y campos de sistema no disponibles: ${estado.motivo}`);
  } else {
    if (estado.completo.incompleto) {
      lineas.push('', 'Dump incompleto (SAP no terminó de grabarlo)');
    }
    variables(lineas, estado.completo.variables);
    camposDeSistema(lineas, estado.completo);
    parametros(lineas, estado.completo);
    usuarioYTransaccion(lineas, estado.completo);
    entorno(lineas, estado.completo);
  }
  return { texto: `${lineas.join('\n')}\n`, enlaces };
}

export function textoDocumento(dump: Dump, destino: string, estado: EstadoDumpCompleto): string {
  return documentoDump(dump, destino, estado).texto;
}
