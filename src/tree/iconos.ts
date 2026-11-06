import type { TipoObjeto } from '../bridge/adt-uri';

const ICONO_TIPO: Record<TipoObjeto, string> = {
  clase: 'symbol-class',
  interfaz: 'symbol-interface',
  programa: 'file-code',
  include: 'file-submodule',
  cds: 'database',
  tabla: 'database',
  estructura: 'symbol-structure',
  grupoFunciones: 'symbol-module',
  desconocido: 'file',
};

const ICONO_KIND: Record<string, string> = {
  Method: 'symbol-method',
  Property: 'symbol-property',
  Constant: 'symbol-constant',
  Variable: 'symbol-variable',
  Function: 'symbol-function',
  Event: 'symbol-event',
  Field: 'symbol-field',
  Class: 'symbol-class',
  Interface: 'symbol-interface',
  Object: 'symbol-object',
};

export function iconoDeTipo(tipo: TipoObjeto): string {
  return ICONO_TIPO[tipo];
}

export function iconoDeKind(nombreKind: string): string {
  return ICONO_KIND[nombreKind] ?? 'symbol-misc';
}
