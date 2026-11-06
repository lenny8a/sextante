import { analizarUriAbap, type UriMinimo } from '../bridge/adt-uri';
import { esProtegido, type RolSistema } from '../config/navegador-config';

export interface DecisionProteccion {
  proteger: boolean;
  destino?: string;
  rol?: RolSistema;
}

export function decidirProteccion(
  uri: UriMinimo | undefined,
  rolDe: (id: string) => RolSistema | undefined,
): DecisionProteccion {
  const analizada = uri === undefined ? undefined : analizarUriAbap(uri);
  if (analizada === undefined) {
    return { proteger: false };
  }
  const rol = rolDe(analizada.destino);
  return {
    proteger: esProtegido(rol),
    destino: analizada.destino,
    ...(rol !== undefined && { rol }),
  };
}
