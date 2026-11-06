import * as vscode from 'vscode';
import { archivoPrincipal } from '../bridge/adt-uri';
import { uriDeRuta } from '../bridge/repotree-oficial';
import type { SistemaActivo } from '../config/sistema-activo';
import { log } from '../log';
import { nombreAbapDePaquete, type NodoPaquete } from '../tree/paquete-modelo';
import type { ProveedorPaquetes } from '../tree/paquete-proveedor';
import { mensajeDe, nombreDeError } from '../util/errores';

export interface DependenciasComandosPaquetes {
  proveedor: ProveedorPaquetes;
  vista: vscode.TreeView<NodoPaquete>;
  conectar(id: string): Promise<void>;
  sistemaActivo: SistemaActivo;
}

export const MSG_SIN_ARCHIVO_ABRIBLE = 'Este objeto no tiene archivo abrible';
const MSG_SIN_PAQUETES = 'No hay paquetes que mostrar: marca un sistema activo y conéctalo';
export const MSG_PAQUETE_NO_ENCONTRADO = 'No se encontró el paquete';
const MSG_SIN_SISTEMA_ACTIVO = 'No hay sistema activo';
const PLACEHOLDER_PAQUETE = 'Paquete';

export function registrarComandosPaquetes(context: vscode.ExtensionContext, deps: DependenciasComandosPaquetes): void {
  const { proveedor, vista } = deps;

  const registrar = <T>(nombre: string, accion: (arg?: T) => Promise<void>): void => {
    const comando = vscode.commands.registerCommand(`abapNavigator.paquetes.${nombre}`, async (arg?: T) => {
      try {
        await accion(arg);
      } catch (err) {
        log.error(`Falló el comando de paquetes ${nombre} (${nombreDeError(err)})`);
        await vscode.window.showErrorMessage(mensajeDe(err));
      }
    });
    context.subscriptions.push(comando);
  };

  const abrirRuta = async (ruta: string): Promise<void> => {
    await vscode.commands.executeCommand('vscode.open', uriDeRuta(ruta));
    log.info('Paquetes: archivo abierto');
  };

  registrar('refrescar', async () => {
    proveedor.refrescar();
  });

  registrar<NodoPaquete>('abrir', async (nodo) => {
    if (nodo?.clase === 'archivo') {
      await abrirRuta(nodo.ruta);
      return;
    }
    if (nodo?.clase !== 'objeto') {
      return;
    }
    const archivos = await proveedor.getChildren(nodo);
    const principal = archivoPrincipal(archivos.map((n) => n.etiqueta));
    const elegido = archivos.find((n) => n.etiqueta === principal);
    if (elegido === undefined) {
      log.warn(`Paquetes: objeto sin archivo abrible (${archivos.length} archivos)`);
      void vscode.window.showWarningMessage(MSG_SIN_ARCHIVO_ABRIBLE);
      return;
    }
    await abrirRuta(elegido.ruta);
  });

  registrar<NodoPaquete>('verDatos', async (nodo) => {
    if (nodo?.clase !== 'objeto') {
      return;
    }
    await vscode.commands.executeCommand('abapNavigator.sql.verDatos', nodo.etiqueta);
  });

  registrar<string>('ir', async (nombre) => {
    const paquetes = await proveedor.paquetes();
    if (paquetes.length === 0) {
      void vscode.window.showInformationMessage(MSG_SIN_PAQUETES);
      return;
    }
    if (typeof nombre === 'string') {
      const buscado = nombre.toUpperCase();
      const encontrado = paquetes.find(
        (p) => p.etiqueta.toUpperCase() === buscado || nombreAbapDePaquete(p.etiqueta).toUpperCase() === buscado,
      );
      if (encontrado === undefined) {
        void vscode.window.showWarningMessage(`${MSG_PAQUETE_NO_ENCONTRADO} ${nombre}`);
        return;
      }
      await vista.reveal(encontrado, { expand: true, focus: true });
      return;
    }
    const elegido = await vscode.window.showQuickPick(
      paquetes.map((nodo) => {
        const nombreAbap = nombreAbapDePaquete(nodo.etiqueta);
        return { label: nodo.etiqueta, ...(nombreAbap !== nodo.etiqueta && { description: nombreAbap }), nodo };
      }),
      { placeHolder: PLACEHOLDER_PAQUETE, matchOnDescription: true },
    );
    if (elegido !== undefined) {
      await vista.reveal(elegido.nodo, { expand: true, focus: true });
    }
  });

  registrar('conectar', async () => {
    const id = deps.sistemaActivo.id;
    if (id === undefined) {
      void vscode.window.showWarningMessage(MSG_SIN_SISTEMA_ACTIVO);
      return;
    }
    await deps.conectar(id);
    proveedor.refrescar();
  });
}
