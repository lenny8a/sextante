import { descodificarSegmento, leerAtributos } from '../adt/busqueda-modelo';

export const RUTA_USOS = '/sap/bc/adt/repository/informationsystem/usageReferences';
export const ACCEPT_USOS = 'application/vnd.sap.adt.repository.usagereferences.result.v1+xml';
export const CONTENT_TYPE_USOS = 'application/vnd.sap.adt.repository.usagereferences.request.v1+xml';
/** Un objeto estándar como MARA tarda casi un minuto en el sistema real. */
export const TIEMPO_USOS_MS = 120_000;

export interface Uso {
  nombre: string;
  tipoAdt: string;
  descripcion: string;
  uriAdt: string;
  paquete: string;
  /**
   * `isResult="true"` o con `usageInformation` (los CDS que usan el objeto llegan con `isResult="false"`,
   * `canHaveChildren="true"` y `gradeDirect`). Falso solo en los contenedores puros: el padre de un resultado
   * sin información de uso, como el grupo de funciones de un módulo que lo usa.
   */
  esUso: boolean;
}

export interface ResultadoUsos { total: number; usos: Uso[] }

/** `total` es el `numberOfResults` del servidor; `propios` y `namespaces` salen solo de los usos (`esUso`). */
export interface UsosPropios { total: number; propios: Uso[]; namespaces: string[] }

export interface GrupoPaqueteUsos { paquete: string; usos: Uso[] }

export interface GrupoTipoUsos { tipoAdt: string; paquetes: GrupoPaqueteUsos[] }

const NAMESPACE = /^(\/[A-Z0-9_]{1,10}\/)/;
const RAIZ = /<usageReferences:usageReferenceResult((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/;
const REFERENCIA = /<usageReferences:referencedObject((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(?:\/>|>([\s\S]*?)<\/usageReferences:referencedObject>)/g;
const OBJETO_ADT = /<usageReferences:adtObject((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/;
const REFERENCIA_PAQUETE = /<adtcore:packageRef((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/;
const SEGMENTO_PAQUETES = '/packages/';
const SEGMENTO_GRUPOS = '/functions/groups/';
const TIPOS_CON_NOMBRE_GENERADO = /^(PROG\/P|PROG\/I|FUGR\/.+)$/;
const PREFIJOS_GENERADOS = ['SAPL', 'SAPM', 'L', 'M'];

const CABECERA_PETICION = '<?xml version="1.0" encoding="UTF-8"?>';
const ABRIR_PETICION = '<usagereferences:usageReferenceRequest xmlns:usagereferences="http://www.sap.com/adt/ris/usageReferences">';
const CERRAR_PETICION = '</usagereferences:usageReferenceRequest>';

/**
 * El cuerpo exacto que respondió 200 en el sistema real (whereused-mara.xml). Sin acotar por paquete: un
 * `packageRef` en `affectedObjects` responde 200 con la lista completa (verificado 2026-10-31); los propios se
 * filtran solo en cliente (`filtrarUsos`).
 */
export function cuerpoUsos(): string {
  return `${CABECERA_PETICION}${ABRIR_PETICION}<usagereferences:affectedObjects/>${CERRAR_PETICION}`;
}

/** El paquete del `parentUri` si es un paquete; si no (módulo de función bajo su grupo), el del `packageRef`. */
function paqueteDe(parentUri: string | undefined, contenido: string): string {
  const indice = parentUri?.indexOf(SEGMENTO_PAQUETES) ?? -1;
  if (parentUri !== undefined && indice >= 0) {
    const segmento = parentUri.slice(indice + SEGMENTO_PAQUETES.length).split('/')[0];
    return descodificarSegmento(segmento).toUpperCase();
  }
  const referencia = REFERENCIA_PAQUETE.exec(contenido);
  return referencia ? (leerAtributos(referencia[1]).get('adtcore:name') ?? '').toUpperCase() : '';
}

export function analizarUsos(xml: string): ResultadoUsos {
  const limpio = xml.replace(/<!--[\s\S]*?-->/g, '');
  const raiz = RAIZ.exec(limpio);
  const total = Number(raiz ? leerAtributos(raiz[1]).get('numberOfResults') ?? '0' : '0');
  const usos = Array.from(limpio.matchAll(REFERENCIA), (m): Uso => {
    const referencia = leerAtributos(m[1]);
    const contenido = m[2] ?? '';
    const informacionUso = (referencia.get('usageInformation') ?? '').trim();
    const objeto = OBJETO_ADT.exec(contenido);
    const adt = objeto ? leerAtributos(objeto[1]) : new Map<string, string>();
    return {
      nombre: adt.get('adtcore:name') ?? '',
      tipoAdt: adt.get('adtcore:type') ?? '',
      descripcion: adt.get('adtcore:description') ?? '',
      uriAdt: referencia.get('uri') ?? '',
      paquete: paqueteDe(referencia.get('parentUri'), contenido),
      esUso: referencia.get('isResult') === 'true' || informacionUso !== '',
    };
  });
  return { total: Number.isFinite(total) ? total : 0, usos };
}

/** `Z`/`Y` o un namespace `/X/` de la lista: el nombre empieza por él. */
export function esPropio(nombre: string, prefijos: string[]): boolean {
  const mayusculas = nombre.toUpperCase();
  return prefijos.some((p) => p !== '' && mayusculas.startsWith(p.toUpperCase()));
}

/** El grupo de funciones de la uri de un include (`/functions/groups/<grupo>/…`); `undefined` si no lo trae. */
function grupoDeUri(uriAdt: string): string | undefined {
  const indice = uriAdt.indexOf(SEGMENTO_GRUPOS);
  if (indice < 0) {
    return undefined;
  }
  const segmento = uriAdt.slice(indice + SEGMENTO_GRUPOS.length).split('/')[0];
  return segmento === '' ? undefined : descodificarSegmento(segmento).toUpperCase();
}

/**
 * Como `esPropio`, pero sobre el uso: los includes de grupos de funciones (`LZ<grupo>TOP`), sus programas
 * principales (`SAPLZ…`) y los module pools (`SAPMZ…`, `MZ…I01`) tienen nombres generados que no empiezan
 * por el prefijo propio. Un `FUGR/I` lo decide el grupo de su uri; programas e includes aceptan además
 * `SAPL`/`SAPM`/`L`/`M` delante del prefijo.
 */
export function esUsoPropio(uso: Uso, prefijos: string[]): boolean {
  if (esPropio(uso.nombre, prefijos)) {
    return true;
  }
  const grupo = uso.tipoAdt === 'FUGR/I' ? grupoDeUri(uso.uriAdt) : undefined;
  if (grupo !== undefined) {
    return esPropio(grupo, prefijos);
  }
  if (!TIPOS_CON_NOMBRE_GENERADO.test(uso.tipoAdt)) {
    return false;
  }
  const nombre = uso.nombre.toUpperCase();
  return PREFIJOS_GENERADOS.some((g) => nombre.startsWith(g) && esPropio(nombre.slice(g.length), prefijos));
}

/** Los namespaces `/X/` de los usos no propios, para ofrecer «Añadir /X/ a propios…». */
export function namespacesNoPropios(usos: Uso[], prefijos: string[]): string[] {
  const namespaces = new Set<string>();
  for (const uso of usos) {
    const namespace = NAMESPACE.exec(uso.nombre.toUpperCase())?.[1];
    if (namespace !== undefined && !esUsoPropio(uso, prefijos)) {
      namespaces.add(namespace);
    }
  }
  return [...namespaces].sort();
}

/** Solo cuentan los usos (`esUso`): los contenedores puros no se listan. */
export function filtrarUsos(resultado: ResultadoUsos, prefijos: string[]): UsosPropios {
  const usos = resultado.usos.filter((u) => u.esUso);
  return {
    total: resultado.total,
    propios: usos.filter((u) => esUsoPropio(u, prefijos)),
    namespaces: namespacesNoPropios(usos, prefijos),
  };
}

function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Tipo → paquete → uso, por orden de tipo ADT, paquete y nombre; los contenedores puros (`esUso` falso) se descartan. */
export function agruparUsos(usos: Uso[]): GrupoTipoUsos[] {
  const ordenados = usos
    .filter((u) => u.esUso)
    .sort((a, b) => comparar(a.tipoAdt, b.tipoAdt) || comparar(a.paquete, b.paquete) || comparar(a.nombre, b.nombre));
  const grupos: GrupoTipoUsos[] = [];
  for (const uso of ordenados) {
    let tipo = grupos.at(-1);
    if (tipo?.tipoAdt !== uso.tipoAdt) {
      tipo = { tipoAdt: uso.tipoAdt, paquetes: [] };
      grupos.push(tipo);
    }
    let paquete = tipo.paquetes.at(-1);
    if (paquete?.paquete !== uso.paquete) {
      paquete = { paquete: uso.paquete, usos: [] };
      tipo.paquetes.push(paquete);
    }
    paquete.usos.push(uso);
  }
  return grupos;
}
