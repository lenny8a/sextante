import { NOMBRE_PRODUCTO } from '../producto';

export interface DecisionTema {
  nuevoValor: boolean | undefined;
  mensaje: string;
}

export function decidirColoresPropios(valorActual: boolean | undefined): DecisionTema {
  if (valorActual === false) {
    return {
      nuevoValor: undefined,
      mensaje:
        'Colores propios para ABAP desactivados: vuelve el coloreado de la extensión oficial. Recarga la ventana si no cambia.',
    };
  }
  return {
    nuevoValor: false,
    mensaje: 'Colores propios para ABAP activados en tus ajustes de usuario. Recarga la ventana si no cambia.',
  };
}

export const NOMBRE_TEMA_OSCURO = `${NOMBRE_PRODUCTO} Oscuro`;

/** Avisar solo con el tema propio activo, sin los colores propios ya puestos y sin «No volver a preguntar». */
export function decidirAviso(
  temaActivo: string | undefined,
  overrideGlobal: boolean | undefined,
  yaAvisado: boolean,
): boolean {
  return temaActivo === NOMBRE_TEMA_OSCURO && overrideGlobal !== false && !yaAvisado;
}
