import * as vscode from 'vscode';
import type { ObjetoOrden } from '../adt/transportes-modelo';
import { log } from '../log';
import { MSG_CONECTA_PRIMERO, MSG_SIN_OBJETO_ABIERTO } from '../commands/objeto-acciones';
import type { ObjetoAbierto } from '../tree/objeto-proveedor';
import { mensajeDe, nombreDeError } from '../util/errores';
import { tipoConOrdenes } from './consulta-ordenes-objeto';
import {
  MSG_TIPO_NO_SOPORTADO,
  TITULO_ORDENES,
  avisoDe,
  avisoTruncado,
  etiquetaItemObjeto,
  itemsObjetos,
  itemsOrdenes,
  type ItemObjeto,
  type ItemOrden,
} from './orden-objeto-modelo';
import type { ServicioObjeto } from './servicio';

export interface DependenciasOrdenObjeto {
  objeto(): ObjetoAbierto | undefined;
  servicio: Pick<ServicioObjeto, 'ordenesDeObjeto' | 'objetosDeOrden'>;
  /** Sesión RFC del destino (pide la contraseña una vez); `false` si no hay conexión. */
  asegurarSesion(destino: string): Promise<boolean>;
  elegirOrden(items: ItemOrden[], titulo: string): Promise<ItemOrden | undefined>;
  elegirObjeto(items: ItemObjeto[], titulo: string): Promise<ItemObjeto | undefined>;
  abrirObjeto(objeto: ObjetoOrden, destino: string): Promise<void>;
  copiar(texto: string): Promise<void>;
  organizadorOficial(): Promise<void>;
  avisar(mensaje: string): void;
  informar(mensaje: string): void;
}

export type ResultadoOrdenObjeto =
  | 'sinObjeto'
  | 'tipoNoSoportado'
  | 'sinConexion'
  | 'sinOrdenes'
  | 'cancelado'
  | 'abierto'
  | 'copiado'
  | 'organizador';

export async function mostrarOrdenesDelObjeto(deps: DependenciasOrdenObjeto): Promise<ResultadoOrdenObjeto> {
  const abierto = deps.objeto();
  if (abierto === undefined) {
    deps.avisar(MSG_SIN_OBJETO_ABIERTO);
    return 'sinObjeto';
  }
  if (!tipoConOrdenes(abierto.tipo)) {
    deps.avisar(MSG_TIPO_NO_SOPORTADO);
    return 'tipoNoSoportado';
  }
  const destino = abierto.analisis.destino;
  if (!(await deps.asegurarSesion(destino))) {
    deps.avisar(MSG_CONECTA_PRIMERO);
    return 'sinConexion';
  }
  // Siempre fresco: el usuario la pide justo después de crear o liberar una orden.
  const resultado = await deps.servicio.ordenesDeObjeto(destino, abierto.nombre, abierto.tipo, { archivos: abierto.archivos, forzar: true });
  if (resultado === undefined) {
    deps.avisar(MSG_CONECTA_PRIMERO);
    return 'sinConexion';
  }
  if (resultado.truncado !== undefined) {
    deps.informar(avisoTruncado(resultado.truncado));
  }
  const { ordenes } = resultado;
  const aviso = avisoDe(ordenes, abierto.nombre);
  if (ordenes.length === 0) {
    deps.informar(aviso ?? '');
    return 'sinOrdenes';
  }
  if (aviso !== undefined) {
    deps.informar(aviso);
  }
  const orden = await deps.elegirOrden(itemsOrdenes(ordenes), TITULO_ORDENES(abierto.nombre, resultado.alcance));
  if (orden === undefined) {
    return 'cancelado';
  }
  const numero = orden.orden.numero;
  const contenido = await deps.servicio.objetosDeOrden(destino, numero);
  if (contenido?.truncado !== undefined) {
    deps.informar(avisoTruncado(contenido.truncado));
  }
  const elegido = await deps.elegirObjeto(itemsObjetos(contenido?.objetos ?? [], abierto.nombre), `${numero} · objetos`);
  if (elegido === undefined) {
    return 'cancelado';
  }
  switch (elegido.clase) {
    case 'copiar':
      await deps.copiar(numero);
      return 'copiado';
    case 'organizador':
      await deps.organizadorOficial();
      return 'organizador';
    case 'objeto':
      await deps.abrirObjeto(elegido.objeto, destino);
      return 'abierto';
  }
}

export const elegirOrdenConQuickPick: DependenciasOrdenObjeto['elegirOrden'] = async (items, titulo) =>
  vscode.window.showQuickPick(items, { title: titulo, matchOnDescription: true });

export const elegirObjetoConQuickPick: DependenciasOrdenObjeto['elegirObjeto'] = async (items, titulo) => {
  const elegido = await vscode.window.showQuickPick(
    items.map((item) => ({ ...etiquetaItemObjeto(item), item })),
    { title: titulo, matchOnDescription: true },
  );
  return elegido?.item;
};

export function registrarOrdenObjeto(context: vscode.ExtensionContext, deps: DependenciasOrdenObjeto): void {
  const comando = vscode.commands.registerCommand('abapNavigator.objeto.ordenes', async () => {
    try {
      const resultado = await mostrarOrdenesDelObjeto(deps);
      log.info(`Orden del objeto → ${resultado}`);
      return resultado;
    } catch (err) {
      log.warn(`Falló Orden del objeto (${nombreDeError(err)})`);
      await vscode.window.showErrorMessage(mensajeDe(err));
      return undefined;
    }
  });
  context.subscriptions.push(comando);
}
