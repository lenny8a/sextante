import { carpetaTipoDe } from '../adt/abrir-resultado';
import { FILTROS_TIPO, leerAtributos, ResultadoBusqueda } from '../adt/busqueda-modelo';

export interface ObjetoInactivo {
  nombre: string;
  tipo: string;
  uriAdt: string;
  usuario: string;
  borrado: boolean;
  uriPadre?: string;
}

export interface GrupoInactivo {
  objeto: ObjetoInactivo;
  hijos: ObjetoInactivo[];
  /** Nombre del padre que no está en la lista. */
  padreAusente?: string;
}

export const RUTA_INACTIVOS = '/sap/bc/adt/activation/inactiveobjects';
export const ACCEPT_INACTIVOS = 'application/vnd.sap.adt.inactivectsobjects.v1+xml';

const TIPO_CLASE = 'CLAS/OC';
const PREFIJO_INCLUDE_CLASE = 'CLAS/OCN/';

const ENTRADA = /<ioc:entry\b[^>]*>([\s\S]*?)<\/ioc:entry>/g;
const OBJETO = /<ioc:object\b([^>]*?)\/?>/;
const REFERENCIA = /<ioc:ref\b([^>]*?)\/?>/;

export function analizarInactivos(xml: string): ObjetoInactivo[] {
  const objetos: ObjetoInactivo[] = [];
  for (const entrada of xml.matchAll(ENTRADA)) {
    const objeto = OBJETO.exec(entrada[1]);
    const referencia = REFERENCIA.exec(entrada[1]);
    if (objeto === null || referencia === null) {
      continue;
    }
    const datos = leerAtributos(objeto[1]);
    const ref = leerAtributos(referencia[1]);
    const uriAdt = ref.get('adtcore:uri');
    const tipo = ref.get('adtcore:type');
    const nombre = ref.get('adtcore:name');
    if (uriAdt === undefined || tipo === undefined || nombre === undefined) {
      continue;
    }
    const inactivo: ObjetoInactivo = {
      nombre,
      tipo,
      uriAdt,
      usuario: datos.get('ioc:user') ?? '',
      borrado: datos.get('ioc:deleted') === 'true',
    };
    const uriPadre = ref.get('adtcore:parentUri');
    if (uriPadre !== undefined) {
      inactivo.uriPadre = uriPadre;
    }
    objetos.push(inactivo);
  }
  return objetos;
}

export function filtrarMios(objetos: ObjetoInactivo[], usuario: string | undefined): ObjetoInactivo[] {
  if (usuario === undefined) {
    return objetos;
  }
  return objetos.filter((o) => o.usuario === usuario);
}

function esIncludeDeClase(objeto: ObjetoInactivo): boolean {
  return objeto.tipo.startsWith(PREFIJO_INCLUDE_CLASE);
}

export function agruparPorPadre(objetos: ObjetoInactivo[]): GrupoInactivo[] {
  const porUri = new Map<string, GrupoInactivo>();
  for (const objeto of objetos) {
    if (objeto.uriPadre === undefined) {
      porUri.set(objeto.uriAdt, { objeto, hijos: [] });
    }
  }
  const grupos: GrupoInactivo[] = [];
  for (const objeto of objetos) {
    if (objeto.uriPadre === undefined) {
      grupos.push(porUri.get(objeto.uriAdt) as GrupoInactivo);
      continue;
    }
    const padre = porUri.get(objeto.uriPadre);
    if (padre !== undefined) {
      padre.hijos.push(objeto);
    } else {
      const ultimo = objeto.uriPadre.split('/').filter((s) => s !== '').pop() ?? '';
      grupos.push({ objeto, hijos: [], padreAusente: ultimo.toUpperCase() });
    }
  }
  return grupos;
}

export function etiquetaTipo(tipoAdt: string): string {
  if (tipoAdt.startsWith(PREFIJO_INCLUDE_CLASE)) {
    return 'Include';
  }
  if (tipoAdt === 'TABL/DS') {
    return 'Estructura';
  }
  if (tipoAdt === 'INTF/OI') {
    return 'Interfaz';
  }
  return FILTROS_TIPO.find((f) => f.tipoAdt === tipoAdt)?.etiqueta ?? tipoAdt;
}

function tipoEfectivo(objeto: ObjetoInactivo): string {
  return esIncludeDeClase(objeto) ? TIPO_CLASE : objeto.tipo;
}

export function esAbrible(objeto: ObjetoInactivo): boolean {
  return !objeto.borrado && carpetaTipoDe(tipoEfectivo(objeto)) !== undefined;
}

export function resultadoBusquedaDe(objeto: ObjetoInactivo, padre?: ObjetoInactivo): ResultadoBusqueda {
  if (esIncludeDeClase(objeto)) {
    const uriAdt = padre?.uriAdt ?? objeto.uriPadre ?? objeto.uriAdt;
    return { nombre: padre?.nombre ?? objeto.nombre, tipo: TIPO_CLASE, descripcion: '', paquete: '', uriAdt };
  }
  return { nombre: objeto.nombre, tipo: objeto.tipo, descripcion: '', paquete: '', uriAdt: objeto.uriAdt };
}
