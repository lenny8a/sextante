import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConexionAdt } from '../../src/adt/conexion-adt';
import { RUTA_DATA_PREVIEW } from '../../src/adt/transaccion';
import type { PeticionAdt, RespuestaAdt, TransporteAdt } from '../../src/adt/transporte';
import { analizarOrdenes } from '../../src/adt/transportes-modelo';
import {
  ACCEPT_TRANSPORTES,
  FILAS_E071,
  FILAS_ORDENES,
  RUTA_TRANSPORTES,
  ServicioObjeto,
  TIEMPO_FUENTE_MS,
  TTL_OBJETO_MS,
} from '../../src/objeto/servicio';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function escaparXml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Data Preview sintético con las columnas dadas, en el formato de las respuestas reales; `totalRows`
 * (como en e071-meth.xml) solo si se da: SINTÉTICO, para probar el aviso de truncado.
 */
function dataPreview(filas: Record<string, string>[], totalRows?: number): string {
  const columnas = Object.keys(filas[0] ?? {});
  const bloques = columnas.map((c) =>
    `<dataPreview:columns><dataPreview:metadata dataPreview:name="${c}"/><dataPreview:dataSet>` +
    filas.map((f) => `<dataPreview:data>${escaparXml(f[c] ?? '')}</dataPreview:data>`).join('') +
    '</dataPreview:dataSet></dataPreview:columns>');
  const total = totalRows === undefined ? '' : `<dataPreview:totalRows>${totalRows}</dataPreview:totalRows>`;
  return `<?xml version="1.0" encoding="utf-8"?><dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">${total}${bloques.join('')}</dataPreview:tableData>`;
}

const RUTA_VERSIONES = '/sap/bc/adt/oo/classes/z_ejemplo_2/includes/main/versions';
const RUTA_FUENTE = '/sap/bc/adt/oo/classes/z_ejemplo_2/source/main';
const RUTA_VERSION = '/sap/bc/adt/oo/classes/z_ejemplo_2/includes/main/versions/19700101161123/00000/content';
const SIN_FILAS = dataPreview([]);

function fila(objeto: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    TRKORR: 'DEVK900002', PGMID: 'R3TR', OBJECT: 'CLAS', OBJ_NAME: objeto, LOCKFLAG: '', TRFUNCTION: 'S', TRSTATUS: 'D',
    TARSYSTEM: '', AS4USER: 'USUARIO_1', AS4DATE: '20261030', AS4TIME: '112745', STRKORR: 'DEVK900001', ...extra,
  };
}

type Respondedor = (p: PeticionAdt) => RespuestaAdt | undefined;

interface Entorno {
  servicio: ServicioObjeto;
  peticiones: PeticionAdt[];
  respondedores: Respondedor[];
  registros: string[];
  advertencias: string[];
  reloj: { ahora: number };
  sinConexion: { activo: boolean };
}

function crearEntorno(): Entorno {
  const peticiones: PeticionAdt[] = [];
  const respondedores: Respondedor[] = [];
  const registros: string[] = [];
  const advertencias: string[] = [];
  const reloj = { ahora: 1_000 };
  const sinConexion = { activo: false };
  const transporte: TransporteAdt = {
    peticion: async (p) => {
      peticiones.push(p);
      for (const r of respondedores) {
        const respuesta = r(p);
        if (respuesta) { return respuesta; }
      }
      return { estado: p.metodo === 'GET' ? 404 : 200, cuerpo: p.metodo === 'GET' ? '' : SIN_FILAS };
    },
  };
  const conexion = new ConexionAdt(transporte);
  const servicio = new ServicioObjeto({
    conexion: async () => (sinConexion.activo ? undefined : conexion),
    idiomaDe: () => 'S',
    ahora: () => reloj.ahora,
    registrar: (m) => registros.push(m),
    advertir: (m) => advertencias.push(m),
  });
  return { servicio, peticiones, respondedores, registros, advertencias, reloj, sinConexion };
}

function posts(e: Entorno): PeticionAdt[] {
  return e.peticiones.filter((p) => p.metodo === 'POST');
}

suite('ServicioObjeto', () => {
  suite('ordenes', () => {
    test('una sola petición GET con el Accept de transportes aunque se pida dos veces; forzar repite', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => (p.ruta === RUTA_TRANSPORTES ? { estado: 200, cuerpo: fixture('ordenes-lista.xml') } : undefined));
      const esperadas = analizarOrdenes(fixture('ordenes-lista.xml'));
      assert.deepEqual(await e.servicio.ordenes('DEV-A'), esperadas);
      await e.servicio.ordenes('DEV-A');
      assert.equal(e.peticiones.length, 1);
      assert.equal(e.peticiones[0].metodo, 'GET');
      assert.equal(e.peticiones[0].ruta, RUTA_TRANSPORTES);
      assert.equal(e.peticiones[0].cabeceras['accept'], ACCEPT_TRANSPORTES);
      assert.equal(e.peticiones[0].tiempoMs, TIEMPO_FUENTE_MS);
      await e.servicio.ordenes('DEV-A', true);
      assert.equal(e.peticiones.length, 2);
      assert.match(e.registros[0], /^Órdenes: lista → \d+ órdenes? \(\d+ modificables?, \d+ liberadas?\)$/);
    });

    test('caduca con el TTL', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => (p.ruta === RUTA_TRANSPORTES ? { estado: 200, cuerpo: fixture('ordenes-lista.xml') } : undefined));
      await e.servicio.ordenes('DEV-A');
      e.reloj.ahora += TTL_OBJETO_MS + 1;
      await e.servicio.ordenes('DEV-A');
      assert.equal(e.peticiones.length, 2);
    });
  });

  suite('ordenesDeObjeto', () => {
    test('ningún SQL enviado al Data Preview tiene una línea de más de 255 caracteres', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => {
        const sql = p.cuerpo ?? '';
        if (sql.includes('FROM E071 INNER JOIN E070')) { return { estado: 200, cuerpo: dataPreview([fila('Z_EJEMPLO_1')]) }; }
        if (sql.includes('FROM E070 WHERE STRKORR')) { return { estado: 200, cuerpo: dataPreview([{ TRKORR: 'DEVK900002' }]) }; }
        return undefined;
      });
      await e.servicio.ordenesDeObjeto('DEV-A', 'z_ejemplo_1', 'clase');
      await e.servicio.objetosDeOrden('DEV-A', 'DEVK900001');
      const enviados = posts(e);
      assert.ok(enviados.length >= 4);
      for (const p of enviados) {
        for (const linea of (p.cuerpo ?? '').split('\r\n')) {
          assert.ok(linea.length <= 255, `línea de ${linea.length} caracteres`);
        }
      }
      assert.ok(enviados.some((p) => (p.cuerpo ?? '').includes('\r\n')));
      assert.ok(enviados.every((p) => !/(?<!\r)\n/.test(p.cuerpo ?? '')));
    });

    test('hace dos POST a Data Preview (join y textos) y devuelve la orden con su descripción', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => {
        const sql = p.cuerpo ?? '';
        if (sql.includes('FROM E071 INNER JOIN E070')) { return { estado: 200, cuerpo: dataPreview([fila('Z_EJEMPLO_1')]) }; }
        if (sql.includes('FROM E07T')) {
          return { estado: 200, cuerpo: dataPreview([{ TRKORR: 'DEVK900001', LANGU: 'E', AS4TEXT: 'Descripción de ejemplo 1' }]) };
        }
        return undefined;
      });
      const resultado = await e.servicio.ordenesDeObjeto('DEV-A', 'z_ejemplo_1', 'clase');
      const ordenes = resultado?.ordenes;
      assert.equal(resultado?.truncado, undefined);
      assert.equal(ordenes?.length, 1);
      assert.equal(ordenes?.[0].numero, 'DEVK900001');
      assert.equal(ordenes?.[0].descripcion, 'Descripción de ejemplo 1');
      const enviados = posts(e);
      assert.equal(enviados.length, 2);
      assert.equal(enviados[0].ruta, RUTA_DATA_PREVIEW);
      assert.ok((enviados[0].cuerpo ?? '').includes("'CLAS','METH'"));
      assert.ok((enviados[0].cuerpo ?? '').includes("'Z_EJEMPLO_1'"));
      assert.ok((enviados[0].cuerpo ?? '').includes("LIKE 'Z_EJEMPLO_1=%'"));
      assert.equal(enviados[0].parametros?.['rowNumber'], String(FILAS_E071));
      assert.equal(enviados[1].parametros?.['rowNumber'], String(FILAS_ORDENES));
      assert.ok((enviados[1].cuerpo ?? '').includes("LANGU IN ('S','E')"));
      assert.ok((enviados[1].cuerpo ?? '').includes("'DEVK900001'"));
      assert.match(e.registros.join('\n'), /Órdenes: objeto → 1 orden \(0 liberadas\)/);
      await e.servicio.ordenesDeObjeto('DEV-A', 'Z_EJEMPLO_1', 'clase');
      assert.equal(posts(e).length, 2);
    });

    test('descarta en cliente las filas cuyo nombre solo se parece (el _ del LIKE es comodín)', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => {
        const sql = p.cuerpo ?? '';
        if (sql.includes('FROM E071 INNER JOIN E070')) {
          return {
            estado: 200,
            cuerpo: dataPreview([
              fila('ZAEJEMPLO_1', { STRKORR: 'DEVK900007', TRKORR: 'DEVK900008' }),
              fila('Z_EJEMPLO_1  ABC', { STRKORR: 'DEVK900001' }),
            ]),
          };
        }
        return undefined;
      });
      const ordenes = (await e.servicio.ordenesDeObjeto('DEV-A', 'Z_EJEMPLO_1', 'clase'))?.ordenes;
      assert.deepEqual(ordenes?.map((o) => o.numero), ['DEVK900001']);
      const textos = posts(e)[1].cuerpo ?? '';
      assert.ok(textos.includes("'DEVK900001'"));
      assert.ok(!textos.includes('DEVK900007'));
    });

    test('un nombre no válido o un tipo sin órdenes no consulta ni lanza', async () => {
      const e = crearEntorno();
      assert.deepEqual(await e.servicio.ordenesDeObjeto('DEV-A', "Z'; DROP", 'clase'), { ordenes: [], alcance: 'objeto' });
      assert.deepEqual(await e.servicio.ordenesDeObjeto('DEV-A', 'Z_EJEMPLO_1', 'desconocido'), { ordenes: [], alcance: 'objeto' });
      assert.equal(e.peticiones.length, 0);
    });

    test('la fila CINC de un include local de la clase (relleno con =) cuenta como de la clase', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => {
        const sql = p.cuerpo ?? '';
        if (sql.includes('FROM E071 INNER JOIN E070')) {
          return {
            estado: 200,
            cuerpo: dataPreview([
              fila('Z_EJEMPLO_1===================CCAU', { PGMID: 'LIMU', OBJECT: 'CINC', STRKORR: 'DEVK900003', TRKORR: 'DEVK900004' }),
              fila('ZAEJEMPLO_1===================CCAU', { PGMID: 'LIMU', OBJECT: 'CINC', STRKORR: 'DEVK900007', TRKORR: 'DEVK900008' }),
            ]),
          };
        }
        return undefined;
      });
      const ordenes = (await e.servicio.ordenesDeObjeto('DEV-A', 'Z_EJEMPLO_1', 'clase'))?.ordenes;
      assert.deepEqual(ordenes?.map((o) => o.numero), ['DEVK900003']);
    });

    test('grupo de funciones: consulta los includes y módulos de la carpeta y casa la fila FUNC', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => {
        const sql = p.cuerpo ?? '';
        if (sql.includes('FROM E071 INNER JOIN E070')) {
          return {
            estado: 200,
            cuerpo: dataPreview([
              fila('Z_EJEMPLO_1', { PGMID: 'LIMU', OBJECT: 'FUNC', STRKORR: 'DEVK900005', TRKORR: 'DEVK900006' }),
              fila('Z_EJEMPLO_9', { PGMID: 'LIMU', OBJECT: 'FUNC', STRKORR: 'DEVK900007', TRKORR: 'DEVK900008' }),
            ]),
          };
        }
        return undefined;
      });
      const archivos = ['zfg_ejemplo.fugr.saplzfg_ejemplo.reps.abap', 'zfg_ejemplo.fugr.z_ejemplo_1.func.abap'];
      const resultado = await e.servicio.ordenesDeObjeto('DEV-A', 'zfg_ejemplo', 'grupoFunciones', { archivos });
      assert.deepEqual(resultado?.ordenes.map((o) => o.numero), ['DEVK900005']);
      assert.equal(resultado?.alcance, 'grupo');
      const sql = posts(e)[0].cuerpo ?? '';
      assert.ok(sql.includes("'Z_EJEMPLO_1'") && sql.includes("'LZFG_EJEMPLOTOP'"), sql);
    });

    test('forzar repite la consulta aunque esté en caché', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) =>
        (p.cuerpo ?? '').includes('FROM E071 INNER JOIN E070') ? { estado: 200, cuerpo: dataPreview([fila('Z_EJEMPLO_1')]) } : undefined,
      );
      await e.servicio.ordenesDeObjeto('DEV-A', 'Z_EJEMPLO_1', 'clase');
      await e.servicio.ordenesDeObjeto('DEV-A', 'Z_EJEMPLO_1', 'clase');
      assert.equal(posts(e).length, 2);
      await e.servicio.ordenesDeObjeto('DEV-A', 'Z_EJEMPLO_1', 'clase', { forzar: true });
      assert.equal(posts(e).length, 4);
    });

    test('totalRows mayor que las filas recibidas: truncado con los dos conteos y aviso sin nombres', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) =>
        (p.cuerpo ?? '').includes('FROM E071 INNER JOIN E070')
          ? { estado: 200, cuerpo: dataPreview([fila('Z_EJEMPLO_1'), fila('Z_EJEMPLO_1', { TRKORR: 'DEVK900009' })], 7_500) }
          : undefined,
      );
      const resultado = await e.servicio.ordenesDeObjeto('DEV-A', 'Z_EJEMPLO_1', 'clase');
      assert.deepEqual(resultado?.truncado, { recibidas: 2, total: 7_500 });
      assert.deepEqual(e.advertencias, ['Órdenes: objeto → truncado, 2 de 7500 filas']);
    });

    test('totalRows igual a las filas: sin truncado ni aviso', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) =>
        (p.cuerpo ?? '').includes('FROM E071 INNER JOIN E070') ? { estado: 200, cuerpo: dataPreview([fila('Z_EJEMPLO_1')], 1) } : undefined,
      );
      const resultado = await e.servicio.ordenesDeObjeto('DEV-A', 'Z_EJEMPLO_1', 'clase');
      assert.equal(resultado?.truncado, undefined);
      assert.deepEqual(e.advertencias, []);
    });
  });

  suite('objetosDeOrden', () => {
    test('con la lista cacheada no hace peticiones', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => (p.ruta === RUTA_TRANSPORTES ? { estado: 200, cuerpo: fixture('ordenes-lista.xml') } : undefined));
      const ordenes = (await e.servicio.ordenes('DEV-A')) ?? [];
      assert.ok(ordenes.length > 0);
      const antes = e.peticiones.length;
      const contenido = await e.servicio.objetosDeOrden('DEV-A', ordenes[0].numero);
      assert.ok(contenido);
      assert.equal(contenido.truncado, undefined);
      assert.equal(e.peticiones.length, antes);
    });

    test('sin la lista hace dos POST: tareas y objetos de la orden y sus tareas', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => {
        const sql = p.cuerpo ?? '';
        if (sql.includes('FROM E070 WHERE STRKORR')) {
          return { estado: 200, cuerpo: dataPreview([{ TRKORR: 'DEVK900002' }]) };
        }
        if (sql.includes('FROM E071 WHERE TRKORR IN')) {
          return {
            estado: 200,
            cuerpo: dataPreview([{ TRKORR: 'DEVK900002', AS4POS: '000001', PGMID: 'R3TR', OBJECT: 'CLAS', OBJ_NAME: 'Z_EJEMPLO_1', OBJFUNC: '', LOCKFLAG: 'X' }]),
          };
        }
        return undefined;
      });
      const objetos = (await e.servicio.objetosDeOrden('DEV-A', 'DEVK900001'))?.objetos;
      assert.equal(objetos?.length, 1);
      assert.equal(objetos?.[0].nombre, 'Z_EJEMPLO_1');
      const enviados = posts(e);
      assert.equal(enviados.length, 2);
      assert.ok((enviados[1].cuerpo ?? '').includes("IN ('DEVK900001','DEVK900002')"));
      assert.equal(enviados[1].parametros?.['rowNumber'], String(FILAS_E071));
    });

    test('el contenido de la orden también avisa si viene truncado', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) =>
        (p.cuerpo ?? '').includes('FROM E071 WHERE TRKORR IN')
          ? {
              estado: 200,
              cuerpo: dataPreview(
                [{ TRKORR: 'DEVK900001', AS4POS: '000001', PGMID: 'R3TR', OBJECT: 'CLAS', OBJ_NAME: 'Z_EJEMPLO_1', OBJFUNC: '', LOCKFLAG: 'X' }],
                9_000,
              ),
            }
          : undefined,
      );
      const contenido = await e.servicio.objetosDeOrden('DEV-A', 'DEVK900001');
      assert.deepEqual(contenido?.truncado, { recibidas: 1, total: 9_000 });
      assert.deepEqual(e.advertencias, ['Órdenes: contenido → truncado, 1 de 9000 filas']);
    });

    test('un número no válido no consulta', async () => {
      const e = crearEntorno();
      assert.deepEqual(await e.servicio.objetosDeOrden('DEV-A', "X') OR ('1"), { objetos: [] });
      assert.equal(e.peticiones.length, 0);
    });
  });

  suite('versiones', () => {
    test('ok con las versiones; un 404 es noExiste y queda cacheado', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => (p.ruta === RUTA_VERSIONES ? { estado: 200, cuerpo: fixture('versiones-prog.xml') } : undefined));
      const ok = await e.servicio.versiones('DEV-A', RUTA_VERSIONES, 'clase/main');
      assert.equal(ok.estado, 'ok');
      assert.equal(ok.estado === 'ok' ? ok.versiones.length : -1, 2);
      assert.equal(e.peticiones[0].tiempoMs, TIEMPO_FUENTE_MS);
      assert.match(e.registros.join('\n'), /^Versiones: clase\/main → 2 versiones$/m);

      const ruta404 = '/sap/bc/adt/oo/classes/z_ejemplo_2/includes/testclasses/versions';
      assert.deepEqual(await e.servicio.versiones('DEV-A', ruta404, 'clase/testclasses'), { estado: 'noExiste' });
      const antes = e.peticiones.length;
      assert.deepEqual(await e.servicio.versiones('DEV-A', ruta404, 'clase/testclasses'), { estado: 'noExiste' });
      assert.equal(e.peticiones.length, antes);
      assert.match(e.registros.join('\n'), /^Versiones: clase\/testclasses → 404$/m);
    });

    test('forzar salta la caché y vuelve a pedir', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => (p.ruta === RUTA_VERSIONES ? { estado: 200, cuerpo: fixture('versiones-prog.xml') } : undefined));
      await e.servicio.versiones('DEV-A', RUTA_VERSIONES);
      await e.servicio.versiones('DEV-A', RUTA_VERSIONES);
      assert.equal(e.peticiones.length, 1);
      await e.servicio.versiones('DEV-A', RUTA_VERSIONES, 'versiones', true);
      assert.equal(e.peticiones.length, 2);
    });
  });

  suite('fuente', () => {
    test('manda version=active como parámetro y registra bytes sin nombres', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => (p.ruta === RUTA_FUENTE ? { estado: 200, cuerpo: 'CLASS z_ejemplo_2.' } : undefined));
      assert.deepEqual(await e.servicio.fuente('DEV-A', RUTA_FUENTE, 'active', 'clase'), { estado: 'ok', texto: 'CLASS z_ejemplo_2.' });
      assert.equal(e.peticiones[0].parametros?.['version'], 'active');
      assert.equal(e.peticiones[0].cabeceras['accept'], 'text/plain');
      assert.deepEqual(e.registros, ['Fuente: clase → 200 (18 bytes)']);
    });

    test('sin versión no manda el parámetro; un 404 es noExiste', async () => {
      const e = crearEntorno();
      assert.deepEqual(await e.servicio.fuente('DEV-A', RUTA_FUENTE), { estado: 'noExiste' });
      assert.equal(e.peticiones[0].parametros, undefined);
      assert.deepEqual(e.registros, ['Fuente: fuente → 404']);
    });

    test('source/main y ?version=active no se cachean: cada lectura es fresca', async () => {
      const e = crearEntorno();
      let texto = 'v1';
      e.respondedores.push((p) => (p.ruta === RUTA_FUENTE ? { estado: 200, cuerpo: texto } : undefined));
      assert.deepEqual(await e.servicio.fuente('DEV-A', RUTA_FUENTE), { estado: 'ok', texto: 'v1' });
      texto = 'v2';
      assert.deepEqual(await e.servicio.fuente('DEV-A', RUTA_FUENTE), { estado: 'ok', texto: 'v2' });
      assert.deepEqual(await e.servicio.fuente('DEV-A', RUTA_FUENTE, 'active'), { estado: 'ok', texto: 'v2' });
      await e.servicio.fuente('DEV-A', RUTA_FUENTE, 'active');
      assert.equal(e.peticiones.length, 4);
    });

    test('dos lecturas simultáneas de source/main comparten la petición en vuelo', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => (p.ruta === RUTA_FUENTE ? { estado: 200, cuerpo: 'x' } : undefined));
      await Promise.all([e.servicio.fuente('DEV-A', RUTA_FUENTE), e.servicio.fuente('DEV-A', RUTA_FUENTE)]);
      assert.equal(e.peticiones.length, 1);
    });

    test('el contenido de una versión (ruta con /versions/) sí se cachea; vaciarFuentes lo tira', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => (p.ruta === RUTA_VERSION ? { estado: 200, cuerpo: 'antigua' } : undefined));
      await e.servicio.fuente('DEV-A', RUTA_VERSION);
      await e.servicio.fuente('DEV-A', RUTA_VERSION);
      assert.equal(e.peticiones.length, 1);
      e.servicio.vaciarFuentes('DEV-B');
      await e.servicio.fuente('DEV-A', RUTA_VERSION);
      assert.equal(e.peticiones.length, 1);
      e.servicio.vaciarFuentes('DEV-A');
      await e.servicio.fuente('DEV-A', RUTA_VERSION);
      assert.equal(e.peticiones.length, 2);
    });

    test('un 500 es error y no se cachea', async () => {
      const e = crearEntorno();
      e.respondedores.push(() => ({ estado: 500, cuerpo: 'boom' }));
      const resultado = await e.servicio.fuente('DEV-A', RUTA_VERSION);
      assert.equal(resultado.estado, 'error');
      await e.servicio.fuente('DEV-A', RUTA_VERSION);
      assert.equal(e.peticiones.length, 2);
    });
  });

  suite('sin conexión y vaciar', () => {
    test('devuelve sinConexion/undefined y registra una sola línea por destino', async () => {
      const e = crearEntorno();
      e.sinConexion.activo = true;
      assert.equal(await e.servicio.ordenes('DEV-A'), undefined);
      assert.deepEqual(await e.servicio.fuente('DEV-A', RUTA_FUENTE), { estado: 'sinConexion' });
      assert.deepEqual(await e.servicio.versiones('DEV-A', RUTA_VERSIONES), { estado: 'sinConexion' });
      assert.deepEqual(e.registros, ['Objeto: sin conexión RFC']);
      assert.equal(e.peticiones.length, 0);
    });

    test('vaciar(destino) obliga a repetir la petición', async () => {
      const e = crearEntorno();
      e.respondedores.push((p) => (p.ruta === RUTA_VERSION ? { estado: 200, cuerpo: 'x' } : undefined));
      await e.servicio.fuente('DEV-A', RUTA_VERSION);
      await e.servicio.fuente('DEV-B', RUTA_VERSION);
      await e.servicio.fuente('DEV-A', RUTA_VERSION);
      assert.equal(e.peticiones.length, 2);
      e.servicio.vaciar('DEV-A');
      await e.servicio.fuente('DEV-A', RUTA_VERSION);
      await e.servicio.fuente('DEV-B', RUTA_VERSION);
      assert.equal(e.peticiones.length, 3);
    });
  });
});
