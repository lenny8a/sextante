import { analizarUriAbap, type UriMinimo } from '../bridge/adt-uri';
import type { RolSistema } from '../config/navegador-config';

export interface TextoIndicador {
  texto: string;
  tooltip: string;
  fondo?: 'warning' | 'error';
}

const SIN_ROL = 'rol sin definir';

export function textoIndicador(
  uri: UriMinimo | undefined,
  rolDe: (id: string) => RolSistema | undefined,
): TextoIndicador | undefined {
  const destino = uri === undefined ? undefined : analizarUriAbap(uri)?.destino;
  if (destino === undefined) {
    return undefined;
  }
  const rol = rolDe(destino);
  const etiqueta = rol ?? SIN_ROL;
  const indicador: TextoIndicador = {
    texto: `$(server) ${destino} · ${etiqueta}`,
    tooltip: `Sistema del editor activo: ${destino} (${etiqueta})`,
  };
  if (rol === 'QAS') {
    indicador.fondo = 'warning';
  } else if (rol === 'PRD') {
    indicador.fondo = 'error';
  }
  return indicador;
}
