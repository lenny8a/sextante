import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ResultadoAbrir } from '../../src/adt/abrir-resultado';
import type { Consulta, FiltroTipo, ResultadoBusqueda } from '../../src/adt/busqueda-modelo';
import { ConexionAdt, ErrorAdt } from '../../src/adt/conexion-adt';
import { TransporteHttp } from '../../src/adt/transporte-http';
import type { EstadoDestino } from '../../src/bridge/logon-oficial';
import { Credenciales } from '../../src/adt/credenciales';
import { Recientes, type MementoMinimo } from '../../src/adt/recientes';
import { SesionesAdt, type PuenteSesiones, type ResultadoSesion } from '../../src/adt/sesiones';
import {
  COMANDO_BUSCAR,
  COMANDO_OLVIDAR_BUSQUEDA,
  dependenciasTransaccion,
  ejecutarBuscar,
  ErrorContrasenaCaducada,
  MSG_CONTRASENA_CADUCADA,
  olvidarBusqueda,
  type ConsultarBusqueda,
  type DependenciasBuscar,
} from '../../src/commands/buscar';
import { leerDestinos } from '../../src/config/destinos';
import { SistemaActivo } from '../../src/config/sistema-activo';

interface EntradaMenu {
  command: string;
  when?: string;
}

interface Bienvenida {
  view: string;
  contents: string;
}

interface PaqueteJson {
  contributes: { commands: EntradaMenu[]; menus: Record<string, EntradaMenu[]>; viewsWelcome: Bienvenida[] };
}

const OFICIAL = 'abapNavigator.objeto.buscarOficial';
const COMANDO_MODO_RETIRADO = 'abapNavigator.buscar.modo';

function mementoEnMemoria(): MementoMinimo & vscode.Memento {
  const datos = new Map<string, unknown>();
  return {
    keys: () => [...datos.keys()],
    get: <T>(clave: string, porDefecto?: T) => (datos.has(clave) ? (datos.get(clave) as T) : porDefecto),
    update: async (clave: string, valor: unknown) => {
      if (valor === undefined) {
        datos.delete(clave);
      } else {
        datos.set(clave, valor);
      }
    },
  } as MementoMinimo & vscode.Memento;
}

function resultado(nombre: string): ResultadoBusqueda {
  return {
    nombre,
    tipo: 'CLAS/OC',
    descripcion: 'Clase de ejemplo',
    paquete: 'ZPAQ1',
    uriAdt: `/sap/bc/adt/oo/classes/${nombre.toLowerCase()}`,
  };
}

interface Registro {
  oficial: number;
  sesiones: string[];
  invalidadas: string[];
  olvidadas: string[];
  urlsOlvidadas: string[];
  consultas: Consulta[];
  abiertos: [string, string][];
  quickPicks: string[];
  conexiones: string[];
}

interface Opciones {
  activo?: string;
  sesion?: ResultadoSesion;
  abrir?: ResultadoAbrir;
  oficialInstalada?: boolean;
  estado?: EstadoDestino;
  conectaBien?: boolean;
  elegir?: (consultar: ConsultarBusqueda) => Promise<ResultadoBusqueda | undefined>;
  errorBuscar?: Error;
  /** Puente RFC de las sesiones reales; con él, la contraseña guardada es `contrasena`. */
  puente?: PuenteSesiones;
  contrasena?: string;
}

interface Entorno {
  deps: DependenciasBuscar;
  registro: Registro;
  recientes: Recientes;
}

/** Sesiones reales sobre el destinations.json de pruebas: QAS-X tiene SSO y no admite REST. */
function sesionesReales(opciones: Opciones = {}): SesionesAdt {
  return new SesionesAdt({
    destinoDe: (id) => leerDestinos(process.env.ABAP_NAVIGATOR_DESTINOS_PATH).find((d) => d.id === id),
    urlDe: () => undefined,
    guardarUrl: async () => undefined,
    credenciales: new Credenciales(
      { get: async () => opciones.contrasena, store: async () => undefined, delete: async () => undefined },
      async () => undefined,
    ),
    puente: opciones.puente,
    rolDe: () => undefined,
  });
}

async function crearEntorno(opciones: Opciones = {}): Promise<Entorno> {
  const registro: Registro = {
    oficial: 0,
    sesiones: [],
    invalidadas: [],
    olvidadas: [],
    urlsOlvidadas: [],
    consultas: [],
    abiertos: [],
    quickPicks: [],
    conexiones: [],
  };
  let estado: EstadoDestino = opciones.estado ?? 'conectado';
  const sistemaActivo = new SistemaActivo(mementoEnMemoria());
  await sistemaActivo.establecer(opciones.activo);
  const recientes = new Recientes(mementoEnMemoria());
  const reales = sesionesReales(opciones);
  const deps: DependenciasBuscar = {
    sistemaActivo,
    sesiones: {
      sesion: async (id) => {
        registro.sesiones.push(id);
        return opciones.sesion ?? reales.sesion(id);
      },
      invalidar: (id) => {
        registro.invalidadas.push(id);
      },
    },
    recientes,
    credenciales: {
      olvidar: async (id) => {
        registro.olvidadas.push(id);
      },
    },
    olvidarUrl: async (id) => {
      registro.urlsOlvidadas.push(id);
    },
    oficialInstalada: () => opciones.oficialInstalada ?? true,
    estadoDe: async () => estado,
    conectar: async (id) => {
      registro.conexiones.push(id);
      if (opciones.conectaBien ?? true) {
        estado = 'conectado';
      }
    },
    buscar: async (_conexion, consulta) => {
      registro.consultas.push(consulta);
      if (opciones.errorBuscar) {
        throw opciones.errorBuscar;
      }
      return [resultado('ZCL_UNO_EJEMPLO'), resultado('ZCL_DOS_EJEMPLO')];
    },
    abrir: async (r, destino) => {
      registro.abiertos.push([r.nombre, destino]);
      return opciones.abrir ?? 'abierto';
    },
    buscarOficial: async () => {
      registro.oficial++;
    },
    mostrarQuickPick: async (destino, consultar) => {
      registro.quickPicks.push(destino);
      return opciones.elegir ? opciones.elegir(consultar) : undefined;
    },
  };
  return { deps, registro, recientes };
}

const SESION_OK: ResultadoSesion = {
  estado: 'ok',
  via: 'http',
  conexion: new ConexionAdt(new TransporteHttp({ url: 'https://servidor.local:44300', credenciales: { usuario: 'U', contrasena: 'x' } })),
};

async function elegirPrimero(consultar: ConsultarBusqueda): Promise<ResultadoBusqueda | undefined> {
  const encontrados = await consultar('clas zcl_ej', new AbortController().signal);
  return encontrados[0];
}

function leerPaquete(): PaqueteJson {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as PaqueteJson;
}

suite('Buscar objeto', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('lenny.sextante')?.activate();
  });

  test('sin sistema activo avisa y no abre sesión', async () => {
    const { deps, registro } = await crearEntorno();
    assert.strictEqual(await ejecutarBuscar(deps), 'sinSistema');
    assert.deepStrictEqual(registro.sesiones, []);
    assert.strictEqual(registro.oficial, 0);
  });

  test('un destino con SSO usa la búsqueda de la oficial', async () => {
    const { deps, registro } = await crearEntorno({ activo: 'QAS-X' });
    assert.strictEqual(await ejecutarBuscar(deps), 'oficial');
    assert.deepStrictEqual(registro.sesiones, ['QAS-X']);
    assert.strictEqual(registro.oficial, 1);
    assert.deepStrictEqual(registro.quickPicks, []);
  });

  test('sin la oficial instalada avisa y no la llama', async () => {
    const { deps, registro } = await crearEntorno({ activo: 'QAS-X', oficialInstalada: false });
    assert.strictEqual(await ejecutarBuscar(deps), 'sinOficial');
    assert.strictEqual(registro.oficial, 0);
  });

  test('si el usuario cancela la contraseña se usa la búsqueda de la oficial', async () => {
    const { deps, registro } = await crearEntorno({ activo: 'DEV-X', sesion: { estado: 'sinContrasena' } });
    assert.strictEqual(await ejecutarBuscar(deps), 'oficial');
    assert.strictEqual(registro.oficial, 1);
  });

  test('sin vía (ni RFC ni HTTP) abre el buscador oficial directamente', async () => {
    const { deps, registro } = await crearEntorno({ activo: 'DEV-X', sesion: { estado: 'sinRest', motivo: 'sinVia' } });
    assert.strictEqual(await ejecutarBuscar(deps), 'oficial');
    assert.strictEqual(registro.oficial, 1);
    assert.deepStrictEqual(registro.quickPicks, []);
  });

  test('un error o una contraseña rechazada se muestran y cancelan sin recurrir a la oficial', async () => {
    for (const sesion of [{ estado: 'error', mensaje: 'fallo' }, { estado: 'noAutorizado' }] as const) {
      const { deps, registro } = await crearEntorno({ activo: 'DEV-X', sesion });
      assert.strictEqual(await ejecutarBuscar(deps), 'cancelado', sesion.estado);
      assert.strictEqual(registro.oficial, 0, sesion.estado);
      assert.deepStrictEqual(registro.quickPicks, [], sesion.estado);
    }
  });

  test('con sesión abre el elegido, interpreta el prefijo y lo anota en recientes', async () => {
    const { deps, registro, recientes } = await crearEntorno({
      activo: 'DEV-X',
      sesion: SESION_OK,
      elegir: elegirPrimero,
    });
    assert.strictEqual(await ejecutarBuscar(deps), 'quickPick');
    assert.deepStrictEqual(registro.quickPicks, ['DEV-X']);
    assert.deepStrictEqual(registro.conexiones, []);
    assert.strictEqual(registro.consultas.length, 1);
    assert.strictEqual(registro.consultas[0].patron, 'ZCL_EJ*');
    assert.strictEqual(registro.consultas[0].filtro?.id, 'clase');
    assert.deepStrictEqual(registro.abiertos, [['ZCL_UNO_EJEMPLO', 'DEV-X']]);
    assert.deepStrictEqual(
      recientes.listar('DEV-X').map((r) => r.nombre),
      ['ZCL_UNO_EJEMPLO'],
    );
    assert.deepStrictEqual(recientes.listar('QAS-X'), []);
  });

  test('el filtro activo del QuickPick llega a la consulta si el texto no lleva prefijo', async () => {
    const programa: FiltroTipo = {
      id: 'programa',
      etiqueta: 'Programa',
      tipoAdt: 'PROG/P',
      prefijos: ['prog'],
      icono: '$(symbol-file)',
    };
    const { deps, registro } = await crearEntorno({
      activo: 'DEV-X',
      sesion: SESION_OK,
      elegir: async (consultar) => (await consultar('zprog', new AbortController().signal, programa))[0],
    });
    await ejecutarBuscar(deps);
    assert.strictEqual(registro.consultas[0].patron, 'ZPROG*');
    assert.strictEqual(registro.consultas[0].filtro?.id, 'programa');
  });

  test('si no se localiza en el árbol no se anota en recientes', async () => {
    const { deps, registro, recientes } = await crearEntorno({
      activo: 'DEV-X',
      sesion: SESION_OK,
      abrir: 'noLocalizado',
      elegir: elegirPrimero,
    });
    assert.strictEqual(await ejecutarBuscar(deps), 'quickPick');
    assert.strictEqual(registro.abiertos.length, 1);
    assert.deepStrictEqual(recientes.listar('DEV-X'), []);
  });

  test('con el puente RFC disponible abre la sesión por RFC sin preguntar nada', async () => {
    const llamadas: string[] = [];
    const puente: PuenteSesiones = {
      disponible: () => ({ ok: true }),
      preparar: async () => {
        llamadas.push('preparar');
      },
      logon: async (destino, conexion, usuario) => {
        llamadas.push(`logon ${destino} ${conexion.ashost ?? '?'} ${usuario}`);
        return { sistema: 'DEV', release: '758' };
      },
      peticion: async () => ({ estado: 200, razon: 'OK', cabeceras: {}, cuerpo: Buffer.from('') }),
      olvidar: async () => undefined,
    };
    const { deps, registro } = await crearEntorno({ activo: 'DEV-X', puente, contrasena: 'secreto', elegir: elegirPrimero });
    assert.strictEqual(await ejecutarBuscar(deps), 'quickPick');
    assert.deepStrictEqual(llamadas, ['preparar', 'logon DEV-X host.local USUARIO']);
    assert.deepStrictEqual(registro.quickPicks, ['DEV-X']);
    assert.strictEqual(registro.oficial, 0);
    assert.deepStrictEqual(registro.abiertos, [['ZCL_UNO_EJEMPLO', 'DEV-X']]);
  });

  test('cerrar el QuickPick sin elegir cancela sin abrir', async () => {
    const { deps, registro } = await crearEntorno({ activo: 'DEV-X', sesion: SESION_OK });
    assert.strictEqual(await ejecutarBuscar(deps), 'cancelado');
    assert.deepStrictEqual(registro.abiertos, []);
  });

  suite('sin conexión de la oficial al abrir', () => {
    const ventana = vscode.window as { showWarningMessage: unknown };
    const original = ventana.showWarningMessage;
    let responder: (acciones: string[]) => string | undefined = () => undefined;

    setup(() => {
      ventana.showWarningMessage = async (_mensaje: string, ...acciones: string[]) => responder(acciones);
    });
    teardown(() => {
      ventana.showWarningMessage = original;
    });

    test('si no se acepta conectar no llega a abrir ni avisa de no encontrado', async () => {
      responder = () => undefined;
      const { deps, registro, recientes } = await crearEntorno({
        activo: 'DEV-X',
        sesion: SESION_OK,
        estado: 'desconectado',
        elegir: elegirPrimero,
      });
      assert.strictEqual(await ejecutarBuscar(deps), 'sinConexion');
      assert.deepStrictEqual(registro.conexiones, []);
      assert.deepStrictEqual(registro.abiertos, []);
      assert.deepStrictEqual(recientes.listar('DEV-X'), []);
    });

    test('si la conexión no llega no abre', async () => {
      responder = (acciones) => acciones[0];
      const { deps, registro } = await crearEntorno({
        activo: 'DEV-X',
        sesion: SESION_OK,
        estado: 'desconectado',
        conectaBien: false,
        elegir: elegirPrimero,
      });
      assert.strictEqual(await ejecutarBuscar(deps), 'sinConexion');
      assert.deepStrictEqual(registro.conexiones, ['DEV-X']);
      assert.deepStrictEqual(registro.abiertos, []);
    });

    test('aceptar conectar conecta el destino activo y abre', async () => {
      responder = (acciones) => acciones[0];
      const { deps, registro } = await crearEntorno({
        activo: 'DEV-X',
        sesion: SESION_OK,
        estado: 'desconectado',
        elegir: elegirPrimero,
      });
      assert.strictEqual(await ejecutarBuscar(deps), 'quickPick');
      assert.deepStrictEqual(registro.conexiones, ['DEV-X']);
      assert.deepStrictEqual(registro.abiertos, [['ZCL_UNO_EJEMPLO', 'DEV-X']]);
    });
  });

  suite('401 con la sesión abierta', () => {
    const ventana = vscode.window as { showWarningMessage: unknown };
    const original = ventana.showWarningMessage;
    let avisos: string[] = [];

    setup(() => {
      avisos = [];
      ventana.showWarningMessage = async (mensaje: string) => {
        avisos.push(mensaje);
        return undefined;
      };
    });
    teardown(() => {
      ventana.showWarningMessage = original;
    });

    test('olvida la contraseña, invalida la sesión, no lanza más consultas y avisa', async () => {
      const fallos: unknown[] = [];
      const { deps, registro } = await crearEntorno({
        activo: 'DEV-X',
        sesion: SESION_OK,
        errorBuscar: new ErrorAdt('ADT /sap/bc/adt/repository/informationsystem/search: respuesta 401', 401, '/search'),
        elegir: async (consultar) => {
          for (const texto of ['zcl', 'zcl_ej']) {
            await consultar(texto, new AbortController().signal).catch((err: unknown) => fallos.push(err));
          }
          return undefined;
        },
      });
      assert.strictEqual(await ejecutarBuscar(deps), 'cancelado');
      assert.strictEqual(registro.consultas.length, 1);
      assert.deepStrictEqual(registro.olvidadas, ['DEV-X']);
      assert.deepStrictEqual(registro.invalidadas, ['DEV-X']);
      assert.strictEqual(fallos.length, 2);
      assert.ok(fallos.every((err) => err instanceof ErrorContrasenaCaducada));
      assert.deepStrictEqual(avisos, [MSG_CONTRASENA_CADUCADA]);
      assert.deepStrictEqual(registro.abiertos, []);
    });

    test('otro error de la consulta no olvida la contraseña ni invalida la sesión', async () => {
      const fallos: unknown[] = [];
      const error = new ErrorAdt('ADT /search: respuesta 500', 500, '/search');
      const { deps, registro } = await crearEntorno({
        activo: 'DEV-X',
        sesion: SESION_OK,
        errorBuscar: error,
        elegir: async (consultar) => {
          await consultar('zcl', new AbortController().signal).catch((err: unknown) => fallos.push(err));
          return undefined;
        },
      });
      assert.strictEqual(await ejecutarBuscar(deps), 'cancelado');
      assert.deepStrictEqual(fallos, [error]);
      assert.deepStrictEqual(registro.olvidadas, []);
      assert.deepStrictEqual(registro.invalidadas, []);
      assert.deepStrictEqual(avisos, []);
    });

    test('un 401 al resolver una transacción olvida la contraseña e invalida la sesión una sola vez', async () => {
      const olvidadas: string[] = [];
      const invalidadas: string[] = [];
      const conexion = new ConexionAdt(new TransporteHttp({
        url: 'https://servidor.local:44300',
        credenciales: { usuario: 'U', contrasena: 'x' },
        fetchFn: (async () => new Response('', { status: 401 })) as typeof fetch,
      }));
      const transacciones = dependenciasTransaccion(
        {
          sesiones: {
            sesion: async () => ({ estado: 'ok', via: 'http', conexion }),
            invalidar: (id) => {
              invalidadas.push(id);
            },
          },
          credenciales: {
            olvidar: async (id) => {
              olvidadas.push(id);
            },
          },
        },
        'DEV-X',
      );
      await assert.rejects(transacciones.resolver('SE38'), (err: unknown) => err instanceof ErrorAdt && err.estado === 401);
      await new Promise((resolver) => setImmediate(resolver));
      assert.deepStrictEqual(olvidadas, ['DEV-X']);
      assert.deepStrictEqual(invalidadas, ['DEV-X']);
      assert.deepStrictEqual(avisos, [MSG_CONTRASENA_CADUCADA]);
    });

    test('un error SQL del Data Preview muestra el texto del servidor, no el XML, y no olvida la contraseña', async () => {
      const ventanaErrores = vscode.window as { showErrorMessage: unknown };
      const originalErrores = ventanaErrores.showErrorMessage;
      const errores: string[] = [];
      ventanaErrores.showErrorMessage = async (mensaje: string) => {
        errores.push(mensaje);
        return undefined;
      };
      try {
        const cuerpo = fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real/dp-sql-malo.xml'), 'utf8');
        const conexion = new ConexionAdt({ peticion: async () => ({ estado: 400, cuerpo }) });
        const olvidadas: string[] = [];
        const transacciones = dependenciasTransaccion(
          {
            sesiones: { sesion: async () => ({ estado: 'ok', via: 'rfc', conexion }), invalidar: () => undefined },
            credenciales: {
              olvidar: async (id) => {
                olvidadas.push(id);
              },
            },
          },
          'DEV-X',
        );
        await assert.rejects(transacciones.resolver('SE38'), (err: unknown) => err instanceof ErrorAdt && err.estado === 400);
        assert.deepStrictEqual(errores, [
          'Nombre de columna desconocido "NOCOLUMNA" until runtime, you cannot specify a field list.',
        ]);
        assert.deepStrictEqual(olvidadas, []);
        assert.deepStrictEqual(avisos, []);
      } finally {
        ventanaErrores.showErrorMessage = originalErrores;
      }
    });
  });

  test('olvidar borra contraseña y url e invalida la sesión del destino', async () => {
    const { deps, registro } = await crearEntorno({ activo: 'DEV-X' });
    await olvidarBusqueda('QAS-X', deps);
    assert.deepStrictEqual(registro.olvidadas, ['QAS-X']);
    assert.deepStrictEqual(registro.urlsOlvidadas, ['QAS-X']);
    assert.deepStrictEqual(registro.invalidadas, ['QAS-X']);
  });

  test('olvidar quita la vía recordada de un sistema sin ADT propio y avisa al árbol', async () => {
    const { deps } = await crearEntorno({ activo: 'QAS-X' });
    const reales = sesionesReales();
    const avisos: string[] = [];
    reales.alCambiarVia((id) => avisos.push(id));
    deps.sesiones = reales;
    assert.strictEqual(await ejecutarBuscar(deps), 'oficial');
    assert.strictEqual(reales.viaDe('QAS-X'), 'oficial');
    await olvidarBusqueda('QAS-X', deps);
    assert.strictEqual(reales.viaDe('QAS-X'), undefined);
    assert.deepStrictEqual(avisos, ['QAS-X', 'QAS-X']);
  });

  test('olvidar también cierra la sesión del puente RFC, y si falla sigue con el resto', async () => {
    const { deps, registro } = await crearEntorno({ activo: 'DEV-X' });
    const olvidadosPuente: string[] = [];
    deps.puente = {
      olvidar: async (id) => {
        olvidadosPuente.push(id);
        throw new Error('el puente no está en marcha');
      },
    };
    await olvidarBusqueda('DEV-X', deps);
    assert.deepStrictEqual(olvidadosPuente, ['DEV-X']);
    assert.deepStrictEqual(registro.olvidadas, ['DEV-X']);
    assert.deepStrictEqual(registro.urlsOlvidadas, ['DEV-X']);
    assert.deepStrictEqual(registro.invalidadas, ['DEV-X']);
  });

  test('los comandos de búsqueda están registrados y el de la oficial sigue registrado', async () => {
    assert.strictEqual(COMANDO_BUSCAR, 'abapNavigator.buscar');
    assert.strictEqual(COMANDO_OLVIDAR_BUSQUEDA, 'abapNavigator.buscar.olvidar');
    const comandos = await vscode.commands.getCommands(true);
    for (const id of [COMANDO_BUSCAR, COMANDO_OLVIDAR_BUSQUEDA, OFICIAL]) {
      assert.ok(comandos.includes(id), id);
    }
    assert.ok(!comandos.includes(COMANDO_MODO_RETIRADO));
  });

  test('package.json: buscar sustituye a buscarOficial en view/title y viewsWelcome', () => {
    const { menus, viewsWelcome } = leerPaquete().contributes;
    const condiciones = menus['view/title'].filter((e) => e.command === COMANDO_BUSCAR).map((e) => e.when);
    assert.ok(condiciones.includes('view == abapNavigator.objeto'));
    assert.ok(condiciones.includes('view == abapNavigator.paquetes'));
    assert.deepStrictEqual(
      menus['view/title'].filter((e) => e.command === OFICIAL),
      [],
    );
    const bienvenidaObjeto = viewsWelcome.find((b) => b.view === 'abapNavigator.objeto');
    assert.ok(bienvenidaObjeto?.contents.includes(`(command:${COMANDO_BUSCAR})`));
    assert.ok(viewsWelcome.every((b) => !b.contents.includes(OFICIAL)));
    assert.ok(menus.commandPalette.some((e) => e.command === OFICIAL && e.when === 'false'));
  });

  test('package.json: olvidar está en el menú contextual de Sistemas', () => {
    const entradas = leerPaquete().contributes.menus['view/item/context'].filter((e) => e.command === COMANDO_OLVIDAR_BUSQUEDA);
    assert.strictEqual(entradas.length, 1);
    assert.ok(entradas[0].when?.startsWith('view == abapNavigator.sistemas'));
  });

  test('package.json: el comando de modo de búsqueda ya no se declara ni aparece en menús', () => {
    const { commands, menus } = leerPaquete().contributes;
    assert.ok(commands.every((c) => c.command !== COMANDO_MODO_RETIRADO));
    for (const [menu, entradas] of Object.entries(menus)) {
      assert.ok(entradas.every((e) => e.command !== COMANDO_MODO_RETIRADO && !e.when?.includes(COMANDO_MODO_RETIRADO)), menu);
    }
  });
});
