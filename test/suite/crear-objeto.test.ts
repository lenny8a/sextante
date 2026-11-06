import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { EstadoDestino } from '../../src/bridge/logon-oficial';
import type { RolSistema } from '../../src/config/navegador-config';
import { crearObjeto, type DependenciasCrearObjeto } from '../../src/commands/crear-objeto';
import { MSG_SIN_SISTEMA_PARA_CREAR } from '../../src/commands/crear-objeto-modelo';

interface Opciones {
  objeto?: string;
  activo?: string;
  rol?: RolSistema;
  estado?: EstadoDestino;
  conectaBien?: boolean;
  oficial?: boolean;
}

interface Espias {
  deps: DependenciasCrearObjeto;
  contadores: { lanzadas: number; conexiones: number };
  destinosConsultados: string[];
  destinosLanzados: string[];
}

function armar(opciones: Opciones): Espias {
  const contadores = { lanzadas: 0, conexiones: 0 };
  const destinosConsultados: string[] = [];
  const destinosLanzados: string[] = [];
  let estado: EstadoDestino = opciones.estado ?? 'conectado';
  const deps: DependenciasCrearObjeto = {
    objetoAbierto: () => (opciones.objeto === undefined ? undefined : { destino: opciones.objeto }),
    sistemaActivo: () => opciones.activo,
    rolDe: (destino) => {
      destinosConsultados.push(destino);
      return opciones.rol;
    },
    estadoDe: async () => estado,
    conectar: async () => {
      contadores.conexiones += 1;
      if (opciones.conectaBien ?? true) {
        estado = 'conectado';
      }
    },
    oficialInstalada: () => opciones.oficial ?? true,
    ejecutarOficial: async (destino) => {
      contadores.lanzadas += 1;
      destinosLanzados.push(destino);
    },
  };
  return { deps, contadores, destinosConsultados, destinosLanzados };
}

suite('Nuevo objeto ABAP', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('lenny.sextante')?.activate();
  });

  test('el comando está registrado', async () => {
    const comandos = await vscode.commands.getCommands(true);
    assert.ok(comandos.includes('abapNavigator.crearObjeto'));
  });

  suite('avisos sin lanzar el asistente', () => {
    const ventana = vscode.window as { showWarningMessage: unknown };
    const original = ventana.showWarningMessage;
    const avisos: string[] = [];
    setup(() => {
      avisos.length = 0;
      ventana.showWarningMessage = async (mensaje: string) => {
        avisos.push(mensaje);
        return undefined;
      };
    });
    teardown(() => {
      ventana.showWarningMessage = original;
    });

    test('sin sistema devuelve sinSistema', async () => {
      const e = armar({});
      assert.strictEqual(await crearObjeto(e.deps), 'sinSistema');
      assert.strictEqual(e.contadores.lanzadas, 0);
      assert.deepStrictEqual(avisos, [MSG_SIN_SISTEMA_PARA_CREAR]);
    });

    test('rol QAS devuelve protegido', async () => {
      const e = armar({ activo: 'DEST', rol: 'QAS' });
      assert.strictEqual(await crearObjeto(e.deps), 'protegido');
      assert.strictEqual(e.contadores.lanzadas, 0);
      assert.strictEqual(avisos.length, 1);
    });

    test('rechazar la conexión avisa una sola vez', async () => {
      const e = armar({ activo: 'DEST', rol: 'DEV', estado: 'desconectado' });
      assert.strictEqual(await crearObjeto(e.deps), 'sinConexion');
      assert.strictEqual(e.contadores.conexiones, 0);
      assert.strictEqual(avisos.length, 1);
    });
  });

  test('conectado lanza sin volver a conectar', async () => {
    const e = armar({ activo: 'DEST', rol: 'DEV' });
    assert.strictEqual(await crearObjeto(e.deps), 'lanzado');
    assert.strictEqual(e.contadores.lanzadas, 1);
    assert.strictEqual(e.contadores.conexiones, 0);
    assert.deepStrictEqual(e.destinosLanzados, ['DEST']);
  });

  test('sin oficial devuelve sinOficial', async () => {
    const ventana = vscode.window as { showWarningMessage: unknown };
    const original = ventana.showWarningMessage;
    // El aviso de falta de la oficial espera una respuesta: se simula descartarlo.
    ventana.showWarningMessage = async () => undefined;
    try {
      const e = armar({ activo: 'DEST', oficial: false });
      assert.strictEqual(await crearObjeto(e.deps), 'sinOficial');
      assert.strictEqual(e.contadores.lanzadas, 0);
    } finally {
      ventana.showWarningMessage = original;
    }
  });

  test('un nodo de otro destino consulta el rol de ese destino', async () => {
    const e = armar({ objeto: 'DEST', activo: 'DEST' });
    await crearObjeto(e.deps, { ruta: '/repotree-v1/OTRO/System Library/ZPAQ1' });
    assert.deepStrictEqual(e.destinosConsultados, ['OTRO']);
  });

  suite('sin conexión previa', () => {
    const ventana = vscode.window as { showWarningMessage: unknown };
    const original = ventana.showWarningMessage;

    setup(() => {
      // asegurarConectado pide confirmación: se simula aceptar la primera acción ("Conectar").
      ventana.showWarningMessage = async (_mensaje: string, ...acciones: string[]) => acciones[0];
    });
    teardown(() => {
      ventana.showWarningMessage = original;
    });

    test('conecta una vez y lanza', async () => {
      const e = armar({ activo: 'DEST', estado: 'desconectado' });
      assert.strictEqual(await crearObjeto(e.deps), 'lanzado');
      assert.strictEqual(e.contadores.conexiones, 1);
      assert.strictEqual(e.contadores.lanzadas, 1);
    });

    test('si no llega a conectar devuelve sinConexion', async () => {
      const e = armar({ activo: 'DEST', estado: 'desconectado', conectaBien: false });
      assert.strictEqual(await crearObjeto(e.deps), 'sinConexion');
      assert.strictEqual(e.contadores.lanzadas, 0);
    });
  });
});
