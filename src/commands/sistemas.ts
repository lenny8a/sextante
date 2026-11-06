import * as vscode from 'vscode';
import {
  COMANDO_EDITAR_DESTINOS,
  COMANDO_NUEVO_DESTINO,
  avisarFaltaOficial,
  ejecutarComandoOficial,
  extensionOficialInstalada,
} from '../bridge/extension-oficial';
import { conectarDestino, type ResultadoLogon } from '../bridge/logon-oficial';
import { ROLES, sugerirRol, type RolSistema } from '../config/navegador-config';
import type { SistemaActivo } from '../config/sistema-activo';
import { log } from '../log';
import { opcionesConectar, type NodoSistema } from '../tree/sistemas-modelo';
import type { ProveedorSistemas } from '../tree/sistemas-proveedor';
import { mensajeDe, nombreDeError } from '../util/errores';
import { NOMBRE_PRODUCTO } from '../producto';

const PLACEHOLDER_ROL = 'Rol del sistema (DEV no protege; QAS y PRD abren en solo lectura)';
const PLACEHOLDER_SISTEMA = 'Seleccione un sistema';

export function registrarComandosSistemas(
  context: vscode.ExtensionContext,
  proveedor: ProveedorSistemas,
  sistemaActivo: SistemaActivo,
): void {
  const registrar = (nombre: string, accion: (nodo?: NodoSistema, extra?: unknown) => Promise<void>): void => {
    const comando = vscode.commands.registerCommand(
      `abapNavigator.sistemas.${nombre}`,
      async (nodo?: NodoSistema, extra?: unknown) => {
        try {
          await accion(nodo, extra);
        } catch (err) {
          log.error(`Falló el comando de sistemas ${nombre} (${nombreDeError(err)})`);
          await vscode.window.showErrorMessage(mensajeDe(err));
        }
      },
    );
    context.subscriptions.push(comando);
  };

  const elegirNodo = async (nodo?: NodoSistema): Promise<NodoSistema | undefined> => {
    if (nodo?.id) {
      return nodo;
    }
    const nodos = (await proveedor.getChildren()).filter((n) => n.id !== '');
    if (nodos.length === 0) {
      void vscode.window.showInformationMessage('No hay sistemas configurados');
      return undefined;
    }
    const elegido = await vscode.window.showQuickPick(
      nodos.map((n) => ({ label: n.etiqueta, description: n.descripcion, nodo: n })),
      { placeHolder: PLACEHOLDER_SISTEMA },
    );
    return elegido?.nodo;
  };

  const elegirRol = async (actual?: RolSistema): Promise<RolSistema | undefined> => {
    const elegido = await vscode.window.showQuickPick(
      ROLES.map((rol) => ({ label: rol, rol, ...(rol === actual && { description: 'actual' }) })),
      { placeHolder: PLACEHOLDER_ROL, ignoreFocusOut: true },
    );
    return elegido?.rol;
  };

  const resolverRol = async (nodo: NodoSistema): Promise<void> => {
    const sugerido = sugerirRol(nodo.systemId, nodo.id);
    if (sugerido) {
      await proveedor.fijarRol(nodo.id, sugerido);
      void vscode.window.showInformationMessage(
        `Rol ${sugerido} asignado por el id del sistema. Cámbialo desde el menú contextual si no es correcto`,
      );
      return;
    }
    const rol = await elegirRol();
    if (rol) {
      await proveedor.fijarRol(nodo.id, rol);
    }
  };

  registrar('refrescar', () => proveedor.actualizarEstados());

  registrar('conectar', async (arg, extra) => {
    const { marcarActivo } = opcionesConectar(extra);
    if (!extensionOficialInstalada()) {
      await avisarFaltaOficial();
      return;
    }
    const nodo = await elegirNodo(arg);
    if (!nodo) {
      return;
    }
    if (proveedor.estaConectando(nodo.id)) {
      void vscode.window.showInformationMessage('Ya se está conectando a este sistema');
      return;
    }
    proveedor.marcarConectando(nodo.id);
    let resultado: ResultadoLogon;
    try {
      if (!nodo.rol) {
        await resolverRol(nodo);
      }
      const id = nodo.id;
      resultado = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `${NOMBRE_PRODUCTO}: conectando…`, cancellable: true },
        (_, token) => conectarDestino(id, { token }),
      );
      if (resultado.estado === 'ok' && marcarActivo) {
        await sistemaActivo.establecer(id);
      }
    } finally {
      proveedor.terminarConexion(nodo.id);
      await proveedor.actualizarEstados();
    }
    if (resultado.estado === 'ok') {
      void vscode.window.showInformationMessage(`Conectado en ${resultado.segundos} s`);
    } else if (resultado.estado === 'cancelado') {
      void vscode.window.showWarningMessage('Conexión cancelada');
    } else {
      const detalle = resultado.error ? `: ${resultado.error}` : '';
      void vscode.window.showWarningMessage(`No se pudo conectar (${resultado.estado})${detalle}`);
    }
  });

  registrar('marcarActivo', async (arg) => {
    const nodo = await elegirNodo(arg);
    if (nodo) {
      await sistemaActivo.establecer(nodo.id);
    }
  });

  registrar('cambiarRol', async (arg) => {
    const nodo = await elegirNodo(arg);
    if (!nodo) {
      return;
    }
    const rol = await elegirRol(nodo.rol);
    if (rol) {
      await proveedor.fijarRol(nodo.id, rol);
    }
  });

  registrar('copiarId', async (arg) => {
    const nodo = await elegirNodo(arg);
    if (nodo) {
      await vscode.env.clipboard.writeText(nodo.id);
    }
  });

  registrar('nuevo', async () => {
    if (!extensionOficialInstalada()) {
      await avisarFaltaOficial();
      return;
    }
    await ejecutarComandoOficial(COMANDO_NUEVO_DESTINO);
  });

  registrar('editarDestinos', async () => {
    if (!extensionOficialInstalada()) {
      await avisarFaltaOficial();
      return;
    }
    await ejecutarComandoOficial(COMANDO_EDITAR_DESTINOS);
  });
}
