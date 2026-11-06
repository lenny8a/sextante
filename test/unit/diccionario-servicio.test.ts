import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ConexionAdt } from '../../src/adt/conexion-adt';
import { ACCEPT_USOS, CONTENT_TYPE_USOS, RUTA_USOS, TIEMPO_USOS_MS, cuerpoUsos } from '../../src/diccionario/donde-se-usa';
import { ACCEPT_DATA_PREVIEW, RUTA_DATA_PREVIEW, analizarDataPreview } from '../../src/adt/transaccion';
import { ErrorAdt, type PeticionAdt, type RespuestaAdt, type TransporteAdt } from '../../src/adt/transporte';
import {
  FILAS_POR_PAGINA,
  ServicioDiccionario,
  TIEMPO_DATOS_MS,
  TIEMPO_HOVER_MS,
  TTL_MENSAJES_MS,
  TTL_METADATOS_MS,
  type DependenciasServicio,
} from '../../src/diccionario/servicio';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

const RUTAS_FIXTURE: Readonly<Record<string, string>> = {
  '/sap/bc/adt/ddic/tables/mara': 'tabla-mara.xml',
  '/sap/bc/adt/ddic/structures/bapiret2': 'estructura-bapiret2.xml',
  '/sap/bc/adt/ddic/dataelements/matnr': 'dtel-matnr.xml',
  '/sap/bc/adt/ddic/domains/mtart': 'doma-mtart.xml',
};

const SIN_FILAS = fixture('dp-sin-filas.xml');

function escaparXml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Data Preview sintético con las columnas dadas, en el formato de las respuestas reales. */
function dataPreview(filas: Record<string, string>[]): string {
  const columnas = Object.keys(filas[0] ?? {});
  const bloques = columnas.map((c) =>
    `<dataPreview:columns><dataPreview:metadata dataPreview:name="${c}"/><dataPreview:dataSet>` +
    filas.map((f) => `<dataPreview:data>${escaparXml(f[c] ?? '')}</dataPreview:data>`).join('') +
    '</dataPreview:dataSet></dataPreview:columns>');
  return `<?xml version="1.0" encoding="utf-8"?><dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">${bloques.join('')}</dataPreview:tableData>`;
}

/**
 * dd03vt-mara.xml se grabó con `DDLANGUAGE = 'E'` en el WHERE y sin esa columna: se añade DDLANGUAGE = 'E' a cada fila
 * y, con `espanol`, filas en S para MANDT y MATNR (ERSDA y el resto solo en inglés).
 */
function dd03vtMara(espanol: boolean): string {
  const ingles = analizarDataPreview(fixture('dd03vt-mara.xml')).map((f): Record<string, string> => ({ ...f, DDLANGUAGE: 'E' }));
  const textoEs: Readonly<Record<string, string>> = { MANDT: 'Mandante', MATNR: 'Número de material' };
  const filas = espanol
    ? ingles.flatMap((f) => (textoEs[f.FIELDNAME] ? [f, { ...f, DDLANGUAGE: 'S', DDTEXT: textoEs[f.FIELDNAME] }] : [f]))
    : ingles;
  return dataPreview(filas);
}

type Respondedor = (p: PeticionAdt) => RespuestaAdt | undefined;

interface TransporteFalso extends TransporteAdt { peticiones: PeticionAdt[]; respondedores: Respondedor[] }

function respuestaPorDefecto(p: PeticionAdt): RespuestaAdt {
  if (p.metodo === 'GET') {
    const archivo = RUTAS_FIXTURE[p.ruta];
    return archivo ? { estado: 200, cuerpo: fixture(archivo) } : { estado: 404, cuerpo: '' };
  }
  const sql = p.cuerpo ?? '';
  if (sql.includes('FROM DD03VT') && sql.includes("TABNAME = 'MARA'")) {
    return { estado: 200, cuerpo: dd03vtMara(sql.includes("IN ('S','E')")) };
  }
  if (sql.includes('FROM DD03L') && sql.includes("TABNAME = 'MARA'")) {
    return { estado: 200, cuerpo: fixture('dd03l-mara.xml') };
  }
  if (sql.includes('FROM DD07V')) {
    return { estado: 200, cuerpo: fixture('dd07v-mtart.xml') };
  }
  if (sql.includes('FROM T100') && sql.includes("ARBGB = '00'") && sql.includes("MSGNR = '001'")) {
    return { estado: 200, cuerpo: fixture('t100-00-001.xml') };
  }
  return { estado: 200, cuerpo: SIN_FILAS };
}

function crearTransporte(): TransporteFalso {
  const peticiones: PeticionAdt[] = [];
  const respondedores: Respondedor[] = [];
  return {
    peticiones,
    respondedores,
    peticion: async (p) => {
      peticiones.push(p);
      for (const r of respondedores) {
        const respuesta = r(p);
        if (respuesta) { return respuesta; }
      }
      return respuestaPorDefecto(p);
    },
  };
}

interface Entorno {
  servicio: ServicioDiccionario;
  transporte: TransporteFalso;
  registros: string[];
  reloj: { ahora: number };
  llamadasConexion: string[];
}

function crearEntorno(opciones: { idioma?: string; sinConexion?: boolean } = {}): Entorno {
  const transporte = crearTransporte();
  const registros: string[] = [];
  const reloj = { ahora: 1_000 };
  const llamadasConexion: string[] = [];
  const conexion = new ConexionAdt(transporte);
  const deps: DependenciasServicio = {
    conexion: async (destino) => {
      llamadasConexion.push(destino);
      return opciones.sinConexion ? undefined : conexion;
    },
    idiomaDe: () => opciones.idioma ?? 'E',
    ahora: () => reloj.ahora,
    registrar: (m) => registros.push(m),
  };
  return { servicio: new ServicioDiccionario(deps), transporte, registros, reloj, llamadasConexion };
}

function rutas(transporte: TransporteFalso): string[] {
  return transporte.peticiones.map((p) => (p.metodo === 'GET' ? p.ruta : `POST ${/FROM (\w+)/.exec(p.cuerpo ?? '')?.[1] ?? '?'}`));
}

suite('diccionario-servicio', () => {
  suite('objeto', () => {
    test('MARA es una tabla con sus campos de DD03VT', async () => {
      const { servicio, transporte } = crearEntorno();
      const resuelto = await servicio.objeto('DEST', 'MARA');
      assert.equal(resuelto?.objeto.tipo, 'tabla');
      assert.equal(resuelto?.objeto.nombre, 'MARA');
      assert.equal(resuelto?.campos?.length, 50);
      assert.deepEqual(resuelto?.campos?.slice(0, 2).map((c) => [c.nombre, c.clave, c.elementoDatos]), [
        ['MANDT', true, 'MANDT'],
        ['MATNR', true, 'MATNR'],
      ]);
      assert.deepEqual(rutas(transporte), ['/sap/bc/adt/ddic/tables/mara', 'POST DD03VT', 'POST DD03L']);
      assert.equal(transporte.peticiones[0].cabeceras.accept, 'application/vnd.sap.adt.tables.v2+xml');
    });

    test('acepta el nombre en minúsculas y lo comparte en caché con el de mayúsculas', async () => {
      const { servicio, transporte } = crearEntorno();
      await servicio.objeto('DEST', 'mara');
      const antes = transporte.peticiones.length;
      assert.equal((await servicio.objeto('DEST', 'MARA'))?.objeto.nombre, 'MARA');
      assert.equal(transporte.peticiones.length, antes);
    });

    test('BAPIRET2: 404 en tables y 200 en structures', async () => {
      const { servicio, transporte } = crearEntorno();
      const resuelto = await servicio.objeto('DEST', 'BAPIRET2');
      assert.equal(resuelto?.objeto.tipo, 'estructura');
      assert.deepEqual(rutas(transporte).slice(0, 2), ['/sap/bc/adt/ddic/tables/bapiret2', '/sap/bc/adt/ddic/structures/bapiret2']);
      assert.equal(transporte.peticiones[1].cabeceras.accept, 'application/vnd.sap.adt.structures.v2+xml');
      assert.deepEqual(resuelto?.campos, []);
    });

    test('un elemento de datos se encuentra en el tercer intento y no lleva campos', async () => {
      const { servicio, transporte } = crearEntorno();
      const resuelto = await servicio.objeto('DEST', 'MATNR');
      assert.equal(resuelto?.objeto.tipo, 'elementoDatos');
      assert.equal(resuelto?.campos, undefined);
      assert.equal(transporte.peticiones.length, 3);
      assert.equal(transporte.peticiones[2].cabeceras.accept, 'application/vnd.sap.adt.dataelements.v2+xml');
    });

    test('NO_EXISTE: tres peticiones la primera vez y cero la segunda (404 cacheado)', async () => {
      const { servicio, transporte } = crearEntorno();
      assert.equal(await servicio.objeto('DEST', 'NO_EXISTE'), undefined);
      assert.equal(transporte.peticiones.length, 3);
      assert.equal(await servicio.objeto('DEST', 'NO_EXISTE'), undefined);
      assert.equal(transporte.peticiones.length, 3);
    });

    test('un nombre con namespace viaja con %2f', async () => {
      const { servicio, transporte } = crearEntorno();
      await servicio.objeto('DEST', '/BOBF/OBM_NODE');
      assert.equal(transporte.peticiones[0].ruta, '/sap/bc/adt/ddic/tables/%2fbobf%2fobm_node');
    });

    test('un nombre no válido resuelve undefined sin peticiones', async () => {
      const { servicio, transporte } = crearEntorno();
      assert.equal(await servicio.objeto('DEST', "MARA'; DROP"), undefined);
      assert.equal(transporte.peticiones.length, 0);
    });

    test('dos objeto() simultáneos comparten la misma promesa y las mismas peticiones', async () => {
      const { servicio, transporte } = crearEntorno();
      const [a, b] = await Promise.all([servicio.objeto('DEST', 'MARA'), servicio.objeto('DEST', 'MARA')]);
      assert.equal(a, b);
      assert.equal(transporte.peticiones.length, 3);
    });

    test('un error distinto de 404 rechaza, no se cachea y se reintenta en la siguiente llamada', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      let fallar = true;
      transporte.respondedores.push((p) => (fallar && p.metodo === 'GET' ? { estado: 500, cuerpo: '' } : undefined));
      await assert.rejects(servicio.objeto('DEST', 'MARA'), (e: unknown) => e instanceof ErrorAdt && e.estado === 500);
      assert.equal(transporte.peticiones.length, 1);
      assert.ok(registros.some((r) => r === 'Diccionario: objeto → error ErrorAdt'), registros.join('\n'));
      fallar = false;
      assert.equal((await servicio.objeto('DEST', 'MARA'))?.objeto.tipo, 'tabla');
      assert.equal(transporte.peticiones.length, 4);
    });

    test('un fallo de red (estado 0) también rechaza sin caché', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(() => { throw new ErrorAdt('red', 0, '/x'); });
      await assert.rejects(servicio.objeto('DEST', 'MARA'), (e: unknown) => e instanceof ErrorAdt && e.estado === 0);
      transporte.respondedores.length = 0;
      assert.ok(await servicio.objeto('DEST', 'MARA'));
    });

    test('la caché caduca a los TTL_METADATOS_MS', async () => {
      const { servicio, transporte, reloj } = crearEntorno();
      await servicio.objeto('DEST', 'NO_EXISTE');
      reloj.ahora += TTL_METADATOS_MS - 1;
      await servicio.objeto('DEST', 'NO_EXISTE');
      assert.equal(transporte.peticiones.length, 3);
      reloj.ahora += 2;
      await servicio.objeto('DEST', 'NO_EXISTE');
      assert.equal(transporte.peticiones.length, 6);
    });

    test('vaciar(destino) borra solo la caché de ese destino; vaciar() la de todos', async () => {
      const { servicio, transporte } = crearEntorno();
      await servicio.objeto('DEST', 'NO_EXISTE');
      await servicio.objeto('OTRO', 'NO_EXISTE');
      servicio.vaciar('DEST');
      await servicio.objeto('OTRO', 'NO_EXISTE');
      assert.equal(transporte.peticiones.length, 6);
      await servicio.objeto('DEST', 'NO_EXISTE');
      assert.equal(transporte.peticiones.length, 9);
      servicio.vaciar();
      await servicio.objeto('OTRO', 'NO_EXISTE');
      assert.equal(transporte.peticiones.length, 12);
    });

    test('todas las peticiones llevan tiempoMs = TIEMPO_HOVER_MS (12000)', async () => {
      const { servicio, transporte } = crearEntorno();
      await servicio.objeto('DEST', 'MARA');
      await servicio.mensaje('DEST', '00', '001');
      await servicio.dominio('DEST', 'MTART');
      assert.equal(TIEMPO_HOVER_MS, 12000);
      assert.ok(transporte.peticiones.length >= 6);
      for (const p of transporte.peticiones) {
        assert.equal(p.tiempoMs, 12000);
      }
    });

    test('destino en S: una sola consulta DD03VT con S y E; texto en S si existe y en inglés si no', async () => {
      const { servicio, transporte } = crearEntorno({ idioma: 'S' });
      const resuelto = await servicio.objeto('DEST', 'MARA');
      assert.equal(resuelto?.campos?.length, 50);
      const vt = transporte.peticiones.filter((p) => p.cuerpo?.includes('FROM DD03VT'));
      assert.equal(vt.length, 1);
      assert.ok(vt[0].cuerpo?.includes("DDLANGUAGE IN ('S','E')"), vt[0].cuerpo);
      const texto = (n: string): string | undefined => resuelto?.campos?.find((c) => c.nombre === n)?.texto;
      assert.equal(texto('MANDT'), 'Mandante');
      assert.equal(texto('MATNR'), 'Número de material');
      assert.equal(texto('ERSDA'), 'Created On');
    });

    test('destino en E: DD03VT pide solo E', async () => {
      const { servicio, transporte } = crearEntorno();
      await servicio.objeto('DEST', 'MARA');
      const vt = transporte.peticiones.find((p) => p.cuerpo?.includes('FROM DD03VT'));
      assert.ok(vt?.cuerpo?.includes("DDLANGUAGE IN ('E')"), vt?.cuerpo);
    });

    test('si DD03L falla los campos llegan planos y se registra la forma', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      transporte.respondedores.push((p) => (p.cuerpo?.includes('FROM DD03L') ? { estado: 400, cuerpo: '' } : undefined));
      const resuelto = await servicio.objeto('DEST', 'MARA');
      assert.equal(resuelto?.campos?.length, 50);
      assert.ok(resuelto?.campos?.every((c) => c.include === undefined));
      assert.ok(registros.includes('Diccionario: includes → error ErrorAdt'), registros.join('\n'));
    });

    test('DD03VT se pide sin DECIMALS y los decimales salen de DD03L por nombre de campo', async () => {
      const { servicio, transporte } = crearEntorno();
      const resuelto = await servicio.objeto('DEST', 'MARA');
      const vt = transporte.peticiones.find((p) => p.cuerpo?.includes('FROM DD03VT'));
      assert.ok(!vt?.cuerpo?.includes('DECIMALS'), vt?.cuerpo);
      assert.equal(resuelto?.campos?.find((c) => c.nombre === 'BRGEW')?.decimales, 3);
      assert.equal(resuelto?.campos?.find((c) => c.nombre === 'MTART')?.decimales, 0);
    });

    test('si DD03L falla los decimales quedan en 0', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push((p) => (p.cuerpo?.includes('FROM DD03L') ? { estado: 400, cuerpo: '' } : undefined));
      const resuelto = await servicio.objeto('DEST', 'MARA');
      assert.equal(resuelto?.campos?.find((c) => c.nombre === 'BRGEW')?.decimales, 0);
    });

    test('si DD03VT falla el objeto rechaza y no se cachea', async () => {
      const { servicio, transporte } = crearEntorno();
      let fallar = true;
      transporte.respondedores.push((p) => (fallar && p.cuerpo?.includes('FROM DD03VT') ? { estado: 400, cuerpo: '' } : undefined));
      await assert.rejects(servicio.objeto('DEST', 'MARA'));
      fallar = false;
      assert.equal((await servicio.objeto('DEST', 'MARA'))?.campos?.length, 50);
    });
  });

  suite('includes (heurística NO VERIFICADA)', () => {
    test('con las fixtures reales (sin PRECFIELD) MANDT y MATNR no llevan include y no lanza', async () => {
      const { servicio } = crearEntorno();
      const campos = (await servicio.objeto('DEST', 'MARA'))?.campos ?? [];
      const porNombre = new Map(campos.map((c) => [c.nombre, c]));
      assert.equal(porNombre.get('MANDT')?.include, undefined);
      assert.equal(porNombre.get('MATNR')?.include, undefined);
    });

    test('una fila .INCLUDE con PRECFIELD marca los campos siguientes hasta el siguiente .INCLUDE/.APPEND', async () => {
      const { servicio, transporte } = crearEntorno();
      const dd03l = dataPreview([
        { POSITION: '0001', FIELDNAME: 'MANDT', COMPTYPE: 'E', PRECFIELD: '' },
        { POSITION: '0002', FIELDNAME: 'MATNR', COMPTYPE: 'E', PRECFIELD: '' },
        { POSITION: '0003', FIELDNAME: '.INCLUDE', COMPTYPE: 'S', PRECFIELD: 'EMARA' },
        { POSITION: '0004', FIELDNAME: 'ERSDA', COMPTYPE: 'E', PRECFIELD: '' },
        { POSITION: '0005', FIELDNAME: 'ERNAM', COMPTYPE: 'E', PRECFIELD: '' },
        { POSITION: '0006', FIELDNAME: '.APPEND', COMPTYPE: 'S', PRECFIELD: '' },
        { POSITION: '0007', FIELDNAME: 'LAEDA', COMPTYPE: 'E', PRECFIELD: '' },
      ]);
      transporte.respondedores.push((p) => (p.cuerpo?.includes('FROM DD03L') ? { estado: 200, cuerpo: dd03l } : undefined));
      const campos = (await servicio.objeto('DEST', 'MARA'))?.campos ?? [];
      const include = (n: string): string | undefined => campos.find((c) => c.nombre === n)?.include;
      assert.equal(include('MANDT'), undefined);
      assert.equal(include('MATNR'), undefined);
      assert.equal(include('ERSDA'), 'EMARA');
      assert.equal(include('ERNAM'), 'EMARA');
      assert.equal(include('LAEDA'), undefined);
    });
  });

  suite('sin conexión', () => {
    test('conexion() undefined: todo resuelve undefined sin peticiones y una sola línea por destino', async () => {
      const { servicio, transporte, registros } = crearEntorno({ sinConexion: true });
      assert.equal(await servicio.objeto('DEST', 'MARA'), undefined);
      assert.equal(await servicio.objeto('DEST', 'MARA'), undefined);
      assert.equal(await servicio.mensaje('DEST', '00', '001'), undefined);
      assert.equal(await servicio.elementoDatos('DEST', 'MATNR'), undefined);
      assert.equal(await servicio.dominio('DEST', 'MTART'), undefined);
      assert.equal(await servicio.campo('DEST', 'MARA', 'MATNR'), undefined);
      assert.equal(transporte.peticiones.length, 0);
      assert.equal(registros.filter((r) => r === 'Diccionario: sin conexión RFC').length, 1);
      await servicio.objeto('OTRO', 'MARA');
      assert.equal(registros.filter((r) => r === 'Diccionario: sin conexión RFC').length, 2);
      servicio.vaciar();
      await servicio.objeto('DEST', 'MARA');
      assert.equal(registros.filter((r) => r === 'Diccionario: sin conexión RFC').length, 3);
    });

    test('sin conexión no se cachea: si luego hay conexión se consulta', async () => {
      const transporte = crearTransporte();
      let disponible = false;
      const servicio = new ServicioDiccionario({
        conexion: async () => (disponible ? new ConexionAdt(transporte) : undefined),
        idiomaDe: () => 'E',
      });
      assert.equal(await servicio.objeto('DEST', 'MARA'), undefined);
      disponible = true;
      assert.equal((await servicio.objeto('DEST', 'MARA'))?.objeto.tipo, 'tabla');
    });
  });

  suite('elementoDatos, dominio y campo', () => {
    test('elementoDatos MATNR desde el XML, con su dominio', async () => {
      const { servicio, transporte } = crearEntorno();
      const de = await servicio.elementoDatos('DEST', 'MATNR');
      assert.equal(de?.dominio, 'MATNR');
      assert.equal(de?.longitud, 40);
      assert.deepEqual(rutas(transporte), ['/sap/bc/adt/ddic/dataelements/matnr']);
      assert.equal(transporte.peticiones[0].cabeceras.accept, 'application/vnd.sap.adt.dataelements.v2+xml');
    });

    test('elementoDatos inexistente: undefined cacheado', async () => {
      const { servicio, transporte } = crearEntorno();
      assert.equal(await servicio.elementoDatos('DEST', 'NO_EXISTE'), undefined);
      assert.equal(await servicio.elementoDatos('DEST', 'NO_EXISTE'), undefined);
      assert.equal(transporte.peticiones.length, 1);
    });

    test('dominio MTART: sin valores fijos en el XML consulta DD07V (0 filas → valores [])', async () => {
      const { servicio, transporte } = crearEntorno();
      const dominio = await servicio.dominio('DEST', 'MTART');
      assert.equal(dominio?.tablaValores, 'T134');
      assert.deepEqual(dominio?.valores, []);
      assert.deepEqual(rutas(transporte), ['/sap/bc/adt/ddic/domains/mtart', 'POST DD07V']);
      assert.equal(transporte.peticiones[0].cabeceras.accept, 'application/vnd.sap.adt.domains.v2+xml');
    });

    test('dominio en un destino S: una sola consulta DD07V con S y E; texto en S si existe y en inglés si no', async () => {
      const { servicio, transporte } = crearEntorno({ idioma: 'S' });
      const filasDd07v = [
        { DOMVALUE_L: 'A', DDLANGUAGE: 'E', DDTEXT: 'One' },
        { DOMVALUE_L: 'A', DDLANGUAGE: 'S', DDTEXT: 'Uno' },
        { DOMVALUE_L: 'B', DDLANGUAGE: 'E', DDTEXT: 'Two' },
      ];
      transporte.respondedores.push((p) => (p.cuerpo?.includes('FROM DD07V') ? { estado: 200, cuerpo: dataPreview(filasDd07v) } : undefined));
      const dominio = await servicio.dominio('DEST', 'MTART');
      assert.deepEqual(dominio?.valores, [{ valor: 'A', texto: 'Uno' }, { valor: 'B', texto: 'Two' }]);
      const dd07v = transporte.peticiones.filter((p) => p.cuerpo?.includes('FROM DD07V'));
      assert.equal(dd07v.length, 1);
      assert.ok(dd07v[0].cuerpo?.includes("DDLANGUAGE IN ('S','E')"), dd07v[0].cuerpo);
    });

    test('dominio con tabla de valores en un destino S: DD07V vacío se consulta una sola vez', async () => {
      const { servicio, transporte } = crearEntorno({ idioma: 'S' });
      assert.deepEqual((await servicio.dominio('DEST', 'MTART'))?.valores, []);
      assert.deepEqual(rutas(transporte), ['/sap/bc/adt/ddic/domains/mtart', 'POST DD07V']);
    });

    test('campo MARA-MATNR trae el campo y su elemento; el dominio que no existe queda undefined', async () => {
      const { servicio } = crearEntorno();
      const r = await servicio.campo('DEST', 'MARA', 'matnr');
      assert.equal(r?.campo.nombre, 'MATNR');
      assert.equal(r?.elemento?.nombre, 'MATNR');
      assert.equal(r?.dominio, undefined);
    });

    test('campo desconocido o tabla inexistente → undefined', async () => {
      const { servicio } = crearEntorno();
      assert.equal(await servicio.campo('DEST', 'MARA', 'NO_EXISTE'), undefined);
      assert.equal(await servicio.campo('DEST', 'NO_EXISTE', 'MATNR'), undefined);
    });

    test('campo reutiliza el objeto cacheado', async () => {
      const { servicio, transporte } = crearEntorno();
      await servicio.objeto('DEST', 'MARA');
      const antes = transporte.peticiones.length;
      await servicio.campo('DEST', 'MARA', 'MANDT');
      assert.deepEqual(rutas(transporte).slice(antes), ['/sap/bc/adt/ddic/dataelements/mandt']);
    });
  });

  suite('mensaje', () => {
    test('usa los idiomas [S, E] para un destino con idioma S', async () => {
      const { servicio, transporte } = crearEntorno({ idioma: 'S' });
      const mensaje = await servicio.mensaje('DEST', '00', '001');
      assert.equal(mensaje?.idioma, 'S');
      assert.equal(mensaje?.texto, '&1&2&3&4&5&6&7&8');
      assert.equal(transporte.peticiones.length, 1);
      assert.ok(transporte.peticiones[0].cuerpo?.includes("SPRSL IN ('S','E')"), transporte.peticiones[0].cuerpo);
    });

    test('sin repetir el inglés cuando el destino ya está en E', async () => {
      const { servicio, transporte } = crearEntorno();
      await servicio.mensaje('DEST', '00', '001');
      assert.ok(transporte.peticiones[0].cuerpo?.includes("SPRSL IN ('E')"), transporte.peticiones[0].cuerpo);
    });

    test('se cachea TTL_MENSAJES_MS', async () => {
      const { servicio, transporte, reloj } = crearEntorno();
      await servicio.mensaje('DEST', '00', '001');
      reloj.ahora += TTL_MENSAJES_MS - 1;
      await servicio.mensaje('DEST', '00', '001');
      assert.equal(transporte.peticiones.length, 1);
      reloj.ahora += 2;
      await servicio.mensaje('DEST', '00', '001');
      assert.equal(transporte.peticiones.length, 2);
    });

    test('número de un dígito se completa a tres; número no válido → undefined sin peticiones', async () => {
      const { servicio, transporte } = crearEntorno();
      assert.equal((await servicio.mensaje('DEST', '00', '1'))?.numero, '001');
      const antes = transporte.peticiones.length;
      assert.equal(await servicio.mensaje('DEST', '00', "1' OR"), undefined);
      assert.equal(transporte.peticiones.length, antes);
    });

    test('mensaje sin filas → undefined', async () => {
      const { servicio } = crearEntorno();
      assert.equal(await servicio.mensaje('DEST', 'ZZ', '999'), undefined);
    });
  });

  suite('datos', () => {
    const DATOS_MARA = fixture('dp-mara-datos.xml');
    const responderMara: Respondedor = (p) => (p.metodo === 'POST' && (p.cuerpo ?? '').endsWith('FROM MARA') ? { estado: 200, cuerpo: DATOS_MARA } : undefined);

    test('constantes: 50 filas por página y 30 s de tiempo', () => {
      assert.equal(FILAS_POR_PAGINA, 50);
      assert.equal(TIEMPO_DATOS_MS, 30_000);
    });

    test('MARA: POST a Data Preview con rowNumber, el SELECT de los campos y el Accept de Data Preview', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(responderMara);
      const datos = await servicio.datos('DEST', 'MARA', ['MATNR', 'MTART'], 50);
      assert.equal(transporte.peticiones.length, 1);
      const [p] = transporte.peticiones;
      assert.equal(p.metodo, 'POST');
      assert.equal(p.ruta, RUTA_DATA_PREVIEW);
      assert.equal(p.ruta, '/sap/bc/adt/datapreview/freestyle');
      assert.deepEqual(p.parametros, { rowNumber: '50' });
      assert.equal(p.cuerpo, 'SELECT MATNR, MTART FROM MARA');
      assert.equal(p.cabeceras.accept, ACCEPT_DATA_PREVIEW);
      assert.equal(p.tiempoMs, TIEMPO_DATOS_MS);
      assert.equal(datos.filas.length, 5);
      assert.equal(datos.total, 43);
    });

    test('las columnas siguen el orden de la respuesta y cada fila trae sus valores en ese orden', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(responderMara);
      const datos = await servicio.datos('DEST', 'MARA', ['MATNR', 'MTART', 'MATKL', 'MEINS'], 5);
      assert.deepEqual(datos.columnas, ['MATNR', 'MTART', 'MATKL', 'MEINS']);
      assert.deepEqual(datos.filas[0], ['MAT00001', 'FERT', '01', 'UN']);
      assert.deepEqual(datos.filas[1], ['MAT00002', 'ROH', '01', 'UN']);
    });

    test('una tabla ancha con nombres largos envía líneas de 255 caracteres como máximo', async () => {
      const { servicio, transporte } = crearEntorno();
      const campos = Array.from({ length: 12 }, (_, i) => `ZCAMPO_MUY_LARGO_EJEMPLO_${String(i).padStart(4, '0')}`);
      await servicio.datos('DEST', 'ZT_EJEMPLO', campos, 50);
      const cuerpo = transporte.peticiones[0].cuerpo ?? '';
      assert.ok(cuerpo.split('\r\n').length > 1);
      for (const linea of cuerpo.split('\r\n')) {
        assert.ok(linea.length <= 255, `línea de ${linea.length} caracteres`);
      }
      assert.ok(!/(?<!\r)\n/.test(cuerpo));
      assert.equal(cuerpo.replace(/\s+/g, ''), `SELECT${campos.join(',')}FROMZT_EJEMPLO`);
    });

    test('nombres en minúsculas viajan en mayúsculas', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(responderMara);
      await servicio.datos('DEST', 'mara', ['matnr'], 5);
      assert.equal(transporte.peticiones[0].cuerpo, 'SELECT MATNR FROM MARA');
      assert.deepEqual(transporte.peticiones[0].parametros, { rowNumber: '5' });
    });

    test('sin filas: columnas en el orden de la respuesta, ninguna fila y total 0', async () => {
      const { servicio } = crearEntorno();
      const datos = await servicio.datos('DEST', 'TSTC', ['TCODE', 'PGMNA'], 50);
      assert.deepEqual(datos.columnas, ['TCODE', 'PGMNA']);
      assert.deepEqual(datos.filas, []);
      assert.equal(datos.total, 0);
    });

    test('sin totalRows: total undefined; sin metadatos: las columnas de la petición', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push((p) => (p.metodo === 'POST' && (p.cuerpo ?? '').endsWith('FROM ZT1_EJEMPLO')
        ? { estado: 200, cuerpo: dataPreview([{ B: '2', A: '1' }]) }
        : undefined));
      transporte.respondedores.push((p) => (p.metodo === 'POST' && (p.cuerpo ?? '').endsWith('FROM ZT2_EJEMPLO')
        ? { estado: 200, cuerpo: '<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview"/>' }
        : undefined));
      const con = await servicio.datos('DEST', 'ZT1_EJEMPLO', ['A', 'B'], 50);
      assert.equal(con.total, undefined);
      assert.deepEqual(con.columnas, ['B', 'A']);
      assert.deepEqual(con.filas, [['2', '1']]);
      const sin = await servicio.datos('DEST', 'ZT2_EJEMPLO', ['A', 'B'], 50);
      assert.deepEqual(sin.columnas, ['A', 'B']);
      assert.deepEqual(sin.filas, []);
    });

    test('sin caché: dos llamadas, dos peticiones', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(responderMara);
      await servicio.datos('DEST', 'MARA', ['MATNR'], 5);
      await servicio.datos('DEST', 'MARA', ['MATNR'], 5);
      assert.equal(transporte.peticiones.length, 2);
    });

    test('tabla o campo no válidos lanzan sin ninguna petición', async () => {
      const { servicio, transporte } = crearEntorno();
      await assert.rejects(servicio.datos('DEST', 'X Y', ['MATNR'], 50), /nombre no válido/);
      await assert.rejects(servicio.datos('DEST', 'MARA', ['MATNR', "X' OR '1"], 50), /nombre no válido/);
      await assert.rejects(servicio.datos('DEST', 'MARA', [], 50));
      assert.equal(transporte.peticiones.length, 0);
    });

    test('un error del servidor rechaza con ErrorAdt y registra solo la forma', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      transporte.respondedores.push(() => ({ estado: 400, cuerpo: '<exc:exception>MARA</exc:exception>' }));
      await assert.rejects(servicio.datos('DEST', 'MARA', ['MATNR'], 50), (e: unknown) => e instanceof ErrorAdt);
      assert.ok(registros.includes('Diccionario: datos → error ErrorAdt'), registros.join('\n'));
    });

    test('sin conexión rechaza sin peticiones', async () => {
      const { servicio, transporte } = crearEntorno({ sinConexion: true });
      await assert.rejects(servicio.datos('DEST', 'MARA', ['MATNR'], 50));
      assert.equal(transporte.peticiones.length, 0);
    });

    test('el registro da la forma (filas de total) y nunca la tabla, los campos, el SQL, el destino ni valores', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      transporte.respondedores.push(responderMara);
      await servicio.datos('DEST', 'MARA', ['MATNR', 'MTART', 'MATKL', 'MEINS'], 50);
      assert.ok(registros.includes('Diccionario: datos → ok (5 filas de 43)'), registros.join('\n'));
      const prohibido = /MARA|MATNR|MTART|MATKL|MEINS|SELECT|DEST|MAT0000|FERT|ROH|HALB/i;
      for (const linea of registros) {
        assert.doesNotMatch(linea, prohibido);
      }
    });
  });

  suite('usos', () => {
    const URI_MARA = '/sap/bc/adt/ddic/tables/mara';

    function responderUsos(p: PeticionAdt): RespuestaAdt | undefined {
      return p.metodo === 'POST' && p.ruta === RUTA_USOS ? { estado: 200, cuerpo: fixture('whereused-mara.xml') } : undefined;
    }

    test('POST con la uri en el parámetro, cuerpo, cabeceras exactas y tiempoMs 120000', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(responderUsos);
      await servicio.usos('DEST', URI_MARA, ['Z', 'Y']);
      assert.equal(transporte.peticiones.length, 1);
      const [p] = transporte.peticiones;
      assert.equal(p.metodo, 'POST');
      assert.equal(p.ruta, RUTA_USOS);
      assert.deepEqual(p.parametros, { uri: URI_MARA });
      assert.equal(p.cuerpo, cuerpoUsos());
      assert.equal(p.cabeceras['content-type'], CONTENT_TYPE_USOS);
      assert.equal(p.cabeceras.accept, ACCEPT_USOS);
      assert.equal(p.tiempoMs, TIEMPO_USOS_MS);
      assert.equal(p.tiempoMs, 120_000);
    });

    test('total, propios con Z/Y y namespaces no propios', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(responderUsos);
      const resultado = await servicio.usos('DEST', URI_MARA, ['Z', 'Y']);
      assert.equal(resultado.total, 6848);
      assert.deepEqual(resultado.propios.map((u) => u.nombre).sort(), [
        'Z_EJEMPLO_1', 'Z_EJEMPLO_2', 'Z_EJEMPLO_3', 'Z_EJEMPLO_4', 'Z_EJEMPLO_6', 'Z_EJEMPLO_7',
      ]);
      assert.deepEqual(resultado.namespaces, ['/ACCGO/']);
      assert.equal(resultado.completo.total, 6848);
      assert.equal(resultado.completo.usos.length, 10, 'la lista completa, sin filtrar, para volver a filtrar en el panel');
    });

    test('la segunda llamada con la misma uri no vuelve a pedir, aunque cambien los prefijos', async () => {
      const { servicio, transporte } = crearEntorno();
      transporte.respondedores.push(responderUsos);
      await servicio.usos('DEST', URI_MARA, ['Z', 'Y']);
      const conAccgo = await servicio.usos('DEST', URI_MARA, ['Z', 'Y', '/ACCGO/']);
      assert.equal(transporte.peticiones.length, 1);
      assert.equal(conAccgo.propios.length, 8);
      assert.deepEqual(conAccgo.namespaces, []);
    });

    test('caducada la caché (TTL de metadatos) o con otra uri vuelve a pedir', async () => {
      const { servicio, transporte, reloj } = crearEntorno();
      transporte.respondedores.push(responderUsos);
      await servicio.usos('DEST', URI_MARA, ['Z']);
      await servicio.usos('DEST', '/sap/bc/adt/ddic/tables/z_ejemplo_1', ['Z']);
      assert.equal(transporte.peticiones.length, 2);
      reloj.ahora += TTL_METADATOS_MS + 1;
      await servicio.usos('DEST', URI_MARA, ['Z']);
      assert.equal(transporte.peticiones.length, 3);
    });

    test('un error rechaza, se registra la forma y no se guarda en caché', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      let fallar = true;
      transporte.respondedores.push((p) => (fallar && p.ruta === RUTA_USOS ? { estado: 500, cuerpo: '' } : undefined));
      transporte.respondedores.push(responderUsos);
      await assert.rejects(servicio.usos('DEST', URI_MARA, ['Z']), (e: unknown) => e instanceof ErrorAdt);
      assert.ok(registros.includes('Diccionario: usos → error ErrorAdt'), registros.join('\n'));
      fallar = false;
      const resultado = await servicio.usos('DEST', URI_MARA, ['Z']);
      assert.equal(resultado.total, 6848);
      assert.equal(transporte.peticiones.length, 2);
    });

    test('sin conexión rechaza sin peticiones', async () => {
      const { servicio, transporte } = crearEntorno({ sinConexion: true });
      await assert.rejects(servicio.usos('DEST', URI_MARA, ['Z']));
      assert.equal(transporte.peticiones.length, 0);
    });

    test('una uri que no es de ADT rechaza sin peticiones', async () => {
      const { servicio, transporte } = crearEntorno();
      await assert.rejects(servicio.usos('DEST', 'https://otro/sap/bc/adt/ddic/tables/mara', ['Z']), /uri no válida/);
      assert.equal(transporte.peticiones.length, 0);
    });

    test('el registro da total, propios y tiempo; nunca nombres, paquetes, uris ni el destino', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      transporte.respondedores.push(responderUsos);
      await servicio.usos('DEST', URI_MARA, ['Z', 'Y']);
      assert.ok(registros.includes('Diccionario: usos → total 6848, propios 6 (0 ms)'), registros.join('\n'));
      const prohibido = /MARA|EJEMPLO|ZPAQ|ACCGO|\$TMP|\/sap\/|DEST/i;
      for (const linea of registros) {
        assert.doesNotMatch(linea, prohibido);
      }
    });
  });

  suite('registro', () => {
    test('formas de las líneas y nunca el nombre del objeto ni el destino', async () => {
      const { servicio, transporte, registros } = crearEntorno();
      await servicio.objeto('DEST', 'MARA');
      await servicio.objeto('DEST', 'BAPIRET2');
      await servicio.objeto('DEST', 'NO_EXISTE');
      await servicio.elementoDatos('DEST', 'MATNR');
      await servicio.dominio('DEST', 'MTART');
      await servicio.mensaje('DEST', '00', '001');
      await servicio.campo('DEST', 'MARA', 'MATNR');
      transporte.respondedores.push(() => ({ estado: 500, cuerpo: '' }));
      await assert.rejects(servicio.objeto('DEST', 'T000'));
      assert.ok(registros.includes('Diccionario: tabla → ok (50 campos)'), registros.join('\n'));
      assert.ok(registros.includes('Diccionario: estructura → ok (0 campos)'), registros.join('\n'));
      assert.ok(registros.includes('Diccionario: objeto → 404'), registros.join('\n'));
      assert.ok(registros.includes('Diccionario: elementoDatos → ok'), registros.join('\n'));
      assert.ok(registros.includes('Diccionario: dominio → ok'), registros.join('\n'));
      assert.ok(registros.includes('Diccionario: mensaje → ok'), registros.join('\n'));
      const prohibido = /MARA|BAPIRET2|NO_EXISTE|MATNR|MTART|T000|DEST|\b00\b|001/i;
      for (const linea of registros) {
        assert.doesNotMatch(linea, prohibido);
      }
    });
  });

  suite('idioma del destino', () => {
    test('un idioma no reconocido usa solo E, avisa una vez por destino sin el valor y no rechaza', async () => {
      const { servicio, transporte, registros } = crearEntorno({ idioma: 'XX' });
      const resuelto = await servicio.objeto('DEST', 'MARA');
      assert.equal(resuelto?.campos?.length, 50);
      const dd03vt = transporte.peticiones.find((p) => p.cuerpo?.includes('FROM DD03VT'));
      assert.ok(dd03vt?.cuerpo?.includes("IN ('E')"), dd03vt?.cuerpo);
      assert.equal((await servicio.mensaje('DEST', '00', '001'))?.idioma, 'E');
      const avisos = registros.filter((r) => r.includes('idioma no reconocido'));
      assert.deepEqual(avisos, ['Diccionario: idioma no reconocido; se usa E']);
      assert.ok(registros.every((r) => !r.includes('XX')), registros.join('\n'));
    });

    // Regresión del 2026-10-30: destinations.json guarda "language": "ES" (ISO 639-1). En producción el
    // cableado ya lo convierte a 'S'; aquí llega sin convertir para comprobar que el servicio no rechaza.
    test('un idioma ISO de dos letras (ES) que llega sin convertir no hace fallar objeto(), campo() ni mensaje()', async () => {
      const { servicio, transporte, registros } = crearEntorno({ idioma: 'ES' });
      const resuelto = await servicio.objeto('DEST', 'MARA');
      assert.equal(resuelto?.campos?.length, 50);
      assert.equal(resuelto?.campos?.find((c) => c.nombre === 'MATNR')?.texto, 'Número de material');
      const dd03vt = transporte.peticiones.find((p) => p.cuerpo?.includes('FROM DD03VT'));
      assert.ok(dd03vt?.cuerpo?.includes("IN ('S','E')"), dd03vt?.cuerpo);
      assert.ok(await servicio.campo('DEST', 'MARA', 'MATNR'));
      assert.equal((await servicio.mensaje('DEST', '00', '001'))?.idioma, 'S');
      assert.ok(registros.every((r) => !r.includes('error')), registros.join('\n'));
    });
  });
});
