import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { abrirResultado, type DependenciasAbrir } from '../../src/adt/abrir-resultado';
import { paqueteSinFiltro } from '../../src/adt/busqueda-cliente';
import type { ResultadoBusqueda } from '../../src/adt/busqueda-modelo';
import { ConexionAdt } from '../../src/adt/conexion-adt';
import type { PeticionAdt } from '../../src/adt/transporte';
import { TransporteHttp } from '../../src/adt/transporte-http';
import {
  ACCEPT_DATA_PREVIEW,
  analizarDataPreview,
  analizarDataPreviewConTotal,
  consultaTstc,
  consultaTstcp,
  interpretarTransaccion,
  resolverTransaccion,
  tcodeValido,
  type DestinoTransaccion,
  type FilaTstc,
  type FilaTstcp,
} from '../../src/adt/transaccion';

function fixture(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real', nombre), 'utf8');
}

function filasTstc(nombre: string): FilaTstc[] {
  return analizarDataPreview(fixture(nombre)).map((f) => ({
    tcode: f.TCODE ?? '',
    pgmna: f.PGMNA ?? '',
    dypno: f.DYPNO ?? '',
    cinfo: f.CINFO ?? '',
  }));
}

function filasTstcp(nombre: string): FilaTstcp[] {
  return analizarDataPreview(fixture(nombre)).map((f) => ({ tcode: f.TCODE ?? '', param: f.PARAM ?? '' }));
}

function xmlTabla(columnas: Record<string, string>): string {
  const bloques = Object.entries(columnas).map(
    ([nombre, valor]) =>
      `<dataPreview:columns><dataPreview:metadata dataPreview:name="${nombre}"/><dataPreview:dataSet>` +
      `${valor === '' ? '' : `<dataPreview:data>${valor}</dataPreview:data>`}</dataPreview:dataSet></dataPreview:columns>`,
  );
  return `<dataPreview:tableData xmlns:dataPreview="x">${bloques.join('')}</dataPreview:tableData>`;
}

const tstc = (pgmna: string, dypno = '1000') => ({ tcode: 'ZT', pgmna, dypno, cinfo: '' });
const tstcp = (param: string) => ({ tcode: 'ZT', param });

suite('transaccion', () => {
  test('tcodeValido acepta códigos con espacio de nombres y rechaza el resto', () => {
    assert.ok(tcodeValido('ZTRAN_EJEMPLO'));
    assert.ok(tcodeValido('/NS/TCODE'));
    assert.ok(!tcodeValido(''));
    assert.ok(!tcodeValido('ztran'));
    assert.ok(!tcodeValido("X'; DROP"));
    assert.ok(!tcodeValido('A'.repeat(21)));
  });

  test('las consultas rechazan un código no válido y generan el SQL esperado', () => {
    assert.throws(() => consultaTstc('X; DROP'));
    assert.throws(() => consultaTstcp("A'B"));
    assert.strictEqual(consultaTstc('ZT'), "SELECT TCODE, PGMNA, DYPNO, CINFO FROM TSTC WHERE TCODE = 'ZT'");
    assert.strictEqual(consultaTstcp('ZT'), "SELECT TCODE, PARAM FROM TSTCP WHERE TCODE = 'ZT'");
  });

  test('analizarDataPreview lee la respuesta real de TSTC (dp-tstc-se38.xml)', () => {
    assert.deepStrictEqual(analizarDataPreview(fixture('dp-tstc-se38.xml')), [
      { TCODE: 'SE38', PGMNA: 'RSABAPPROGRAM', DYPNO: '1000', CINFO: '84' },
    ]);
  });

  test('analizarDataPreview: sin filas, datos vacíos y espacios internos en respuestas reales', () => {
    assert.deepStrictEqual(analizarDataPreview(fixture('dp-sin-filas.xml')), []);
    const z = filasTstc('dp-tstc-z.xml');
    assert.strictEqual(z.length, 5);
    assert.deepStrictEqual(z.map((f) => f.pgmna), ['', '', 'Z_EJEMPLO_58', 'Z_EJEMPLO_56', 'Z_EJEMPLO_56']);
    assert.deepStrictEqual(z.map((f) => f.cinfo), ['02', '02', '80', '80', '80']);
    assert.strictEqual(
      filasTstcp('dp-tstcp-cualquiera.xml')[0].param,
      '/*START_REPORT D_SREPOVARI-REPORT=VALI_CRE    G;D_SREPOVARI-EXTDREPORT=VALI_CRE_QUERY;D_SREPOVARI-REPORTTYPE=AQ;',
    );
  });

  test('analizarDataPreview: cero filas, varias filas y entidades', () => {
    assert.deepStrictEqual(analizarDataPreview(xmlTabla({ TCODE: '' })), []);
    assert.deepStrictEqual(analizarDataPreview('<vacio/>'), []);
    const dos =
      '<dataPreview:columns><dataPreview:metadata dataPreview:name="a"/><dataPreview:dataSet>' +
      '<dataPreview:data>1 &amp; 2</dataPreview:data><dataPreview:data>3</dataPreview:data></dataPreview:dataSet></dataPreview:columns>';
    assert.deepStrictEqual(analizarDataPreview(dos), [{ A: '1 & 2' }, { A: '3' }]);
  });

  test('analizarDataPreviewConTotal: las mismas filas más totalRows de la respuesta real (e071-meth.xml)', () => {
    const xml = fixture('e071-meth.xml');
    const tabla = analizarDataPreviewConTotal(xml);
    assert.deepStrictEqual(tabla.filas, analizarDataPreview(xml));
    assert.strictEqual(tabla.filas.length, 5);
    assert.strictEqual(tabla.total, 9986);
  });

  test('analizarDataPreviewConTotal: sin totalRows no inventa el total; el de un comentario no cuenta', () => {
    assert.deepStrictEqual(analizarDataPreviewConTotal('<vacio/>'), { filas: [] });
    assert.deepStrictEqual(analizarDataPreviewConTotal('<!-- <dataPreview:totalRows>3</dataPreview:totalRows> --><vacio/>'), { filas: [] });
  });

  test('interpretarTransaccion: transacción OO (tstc-oo.xml + tstcp-method.xml) → clase y método', () => {
    const oo = filasTstc('tstc-oo.xml');
    const parametros = filasTstcp('tstcp-method.xml');
    assert.deepStrictEqual(interpretarTransaccion(oo[0], parametros[0]), {
      clase: 'metodo',
      claseAbap: '/BOBF/CL_CUST_MANAGER',
      metodo: 'INITIALIZE',
    });
    assert.deepStrictEqual(interpretarTransaccion(oo[4], parametros[4]), {
      clase: 'metodo',
      claseAbap: '/ISDFPS/CL_MPO_LAUNCH',
      metodo: 'LAUNCH',
    });
    assert.deepStrictEqual(
      oo.map((fila, i) => interpretarTransaccion(fila, parametros[i]).clase),
      ['metodo', 'metodo', 'metodo', 'metodo', 'metodo'],
    );
  });

  test('interpretarTransaccion: transacción de parámetros sobre SA38 (dp-tstcp-report.xml) → programa', () => {
    const [tstcParametro] = filasTstc('tstc-param-ej.xml');
    const [tstcpReport] = filasTstcp('dp-tstcp-report.xml');
    assert.deepStrictEqual(interpretarTransaccion(tstcParametro, tstcpReport), {
      clase: 'programa',
      programa: 'PFCG_TIME_DEPENDENCY',
    });
  });

  test('interpretarTransaccion: diálogo (tstc-dialogo.xml) → programa y dynpro', () => {
    const [dialogo] = filasTstc('tstc-dialogo.xml');
    assert.deepStrictEqual(interpretarTransaccion(dialogo, undefined), {
      clase: 'programa',
      programa: 'SAPLSEUK',
      dynpro: '0390',
    });
  });

  test('interpretarTransaccion: reports con CINFO 80 y 84 → programa sin dynpro', () => {
    assert.deepStrictEqual(interpretarTransaccion(filasTstc('dp-tstc-se38.xml')[0], undefined), {
      clase: 'programa',
      programa: 'RSABAPPROGRAM',
    });
    assert.deepStrictEqual(interpretarTransaccion(filasTstc('tstc-variante.xml')[0], undefined), {
      clase: 'programa',
      programa: 'RK_SE16N',
    });
    assert.deepStrictEqual(interpretarTransaccion(filasTstc('dp-tstc-z.xml')[2], undefined), {
      clase: 'programa',
      programa: 'Z_EJEMPLO_58',
    });
  });

  test('interpretarTransaccion: SM30 → vista; START_REPORT → query; otra transacción se sigue', () => {
    const [tstcParametro] = filasTstc('tstc-param-ej.xml');
    const destinos = filasTstcp('dp-tstcp-cualquiera.xml').map((p) => interpretarTransaccion(tstcParametro, p));
    assert.deepStrictEqual(destinos, [
      { clase: 'desconocido', detalle: 'query' },
      { clase: 'vista', vista: 'Z_EJEMPLO_48' },
      { clase: 'vista', vista: 'Z_EJEMPLO_49' },
      { clase: 'vista', vista: 'Z_EJEMPLO_52' },
      { clase: 'vista', vista: 'Z_EJEMPLO_51' },
    ]);
    assert.deepStrictEqual(interpretarTransaccion(tstcParametro, filasTstcp('dp-tstcp-object.xml')[0]), {
      clase: 'transaccion',
      tcode: 'SNUM',
    });
  });

  test('interpretarTransaccion: sin CINFO conocido aplica las reglas genéricas', () => {
    assert.deepStrictEqual(interpretarTransaccion(tstc('ZREP'), tstcp('/*ZT2 /Y')), { clase: 'transaccion', tcode: 'ZT2' });
    assert.deepStrictEqual(interpretarTransaccion(undefined, tstcp('\\CLASS=ZCL_EJEMPLO\\METHOD=EJECUTAR')), {
      clase: 'metodo',
      claseAbap: 'ZCL_EJEMPLO',
      metodo: 'EJECUTAR',
    });
    assert.deepStrictEqual(interpretarTransaccion(tstc('ZREP'), undefined), { clase: 'programa', programa: 'ZREP' });
    assert.deepStrictEqual(interpretarTransaccion(tstc('ZREP', ''), tstcp('')), { clase: 'programa', programa: 'ZREP' });
    assert.deepStrictEqual(interpretarTransaccion(tstc('ZDIALOGO', '0100'), undefined), {
      clase: 'programa',
      programa: 'ZDIALOGO',
      dynpro: '0100',
    });
    assert.deepStrictEqual(interpretarTransaccion(tstc(''), tstcp('PARAM=X')), { clase: 'desconocido' });
    assert.deepStrictEqual(interpretarTransaccion(undefined, undefined), { clase: 'desconocido' });
    const [tstcParametro] = filasTstc('tstc-param-ej.xml');
    assert.deepStrictEqual(interpretarTransaccion(tstcParametro, undefined), { clase: 'desconocido' });
  });

  test('ACCEPT_DATA_PREVIEW es el tipo que el servidor exige en su 406 (dp-tstc-sin-csrf.xml)', () => {
    assert.strictEqual(ACCEPT_DATA_PREVIEW, 'application/vnd.sap.adt.datapreview.table.v1+xml');
    assert.ok(fixture('dp-tstc-sin-csrf.xml').includes(`Accepted content types: ${ACCEPT_DATA_PREVIEW}`));
  });

  test('resolverTransaccion pide el Data Preview con ese Accept y abre el programa de un /*SA38 real', async () => {
    const peticiones: PeticionAdt[] = [];
    const conexion = new ConexionAdt({
      peticion: async (p) => {
        peticiones.push(p);
        const cuerpo = p.cuerpo?.includes('FROM TSTCP') ? fixture('dp-tstcp-report.xml') : fixture('tstc-param-ej.xml');
        return { estado: 200, cuerpo };
      },
    });
    assert.deepStrictEqual(await resolverTransaccion(conexion, 'SA38PARAMETER'), {
      clase: 'programa',
      programa: 'PFCG_TIME_DEPENDENCY',
    });
    assert.strictEqual(peticiones.length, 2);
    assert.ok(peticiones.every((p) => p.metodo === 'POST' && p.cabeceras['accept'] === ACCEPT_DATA_PREVIEW));
  });

  function conexionFalsa(
    filas: Record<string, { tstc?: Record<string, string>; tstcp?: Record<string, string> }>,
    consultas: string[],
  ): ConexionAdt {
    const fetchFn = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const cabeceras = { 'x-csrf-token': 'tok' };
      if (init?.method !== 'POST') {
        return new Response('', { status: 200, headers: cabeceras });
      }
      assert.ok(String(entrada).includes('/sap/bc/adt/datapreview/freestyle'));
      const sql = String(init.body);
      consultas.push(sql);
      const tcode = /TCODE = '([^']+)'/.exec(sql)?.[1] ?? '';
      const datos = filas[tcode]?.[sql.includes('FROM TSTCP') ? 'tstcp' : 'tstc'];
      return new Response(datos ? xmlTabla(datos) : xmlTabla({ TCODE: '' }), { status: 200, headers: cabeceras });
    }) as typeof fetch;
    return new ConexionAdt(new TransporteHttp({ url: 'https://h:44300', credenciales: { usuario: 'u', contrasena: 'p' }, fetchFn }));
  }

  test('resolverTransaccion encadena una transacción de parámetros hasta el programa', async () => {
    const consultas: string[] = [];
    const conexion = conexionFalsa(
      {
        ZT1: { tstc: { TCODE: 'ZT1', PGMNA: '', DYPNO: '', CINFO: '' }, tstcp: { TCODE: 'ZT1', PARAM: '/*ZT2 ' } },
        ZT2: { tstc: { TCODE: 'ZT2', PGMNA: 'ZREP_EJEMPLO', DYPNO: '1000', CINFO: '' } },
      },
      consultas,
    );
    assert.deepStrictEqual(await resolverTransaccion(conexion, 'ZT1'), { clase: 'programa', programa: 'ZREP_EJEMPLO' });
    assert.strictEqual(consultas.length, 4);
  });

  test('resolverTransaccion pide una fila con rowNumber como parámetro y el registro no lo lleva', async () => {
    const urls: URL[] = [];
    const registro: string[] = [];
    const fetchFn = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      urls.push(new URL(String(entrada)));
      const cuerpo = init?.method === 'POST' ? xmlTabla({ TCODE: 'ZT1', PGMNA: 'ZREP_EJEMPLO', DYPNO: '', CINFO: '' }) : '';
      return new Response(cuerpo, { status: 200, headers: { 'x-csrf-token': 'tok' } });
    }) as typeof fetch;
    const conexion = new ConexionAdt(new TransporteHttp({
      url: 'https://h:44300', credenciales: { usuario: 'u', contrasena: 'p' }, fetchFn, registrar: (m) => registro.push(m),
    }));
    assert.deepStrictEqual(await resolverTransaccion(conexion, 'ZT1'), { clase: 'programa', programa: 'ZREP_EJEMPLO' });
    const posts = urls.filter((u) => u.pathname === '/sap/bc/adt/datapreview/freestyle');
    assert.strictEqual(posts.length, 2);
    assert.ok(posts.every((u) => u.searchParams.get('rowNumber') === '1'));
    assert.ok(registro.every((linea) => !linea.includes('rowNumber')), registro.join('\n'));
  });

  test('resolverTransaccion corta a los 3 saltos y rechaza códigos no válidos sin consultar', async () => {
    const consultas: string[] = [];
    const conexion = conexionFalsa({ ZA: { tstcp: { TCODE: 'ZA', PARAM: '/*ZA' } } }, consultas);
    assert.deepStrictEqual(await resolverTransaccion(conexion, 'ZA'), { clase: 'desconocido' });
    assert.strictEqual(consultas.length, 8);
    consultas.length = 0;
    assert.deepStrictEqual(await resolverTransaccion(conexion, "X'; DROP"), { clase: 'desconocido' });
    assert.deepStrictEqual(consultas, []);
  });

  suite('abrir lo que ejecuta una transacción', () => {
    function armar(
      destino: DestinoTransaccion,
      paquete: string | undefined,
    ): { deps: DependenciasAbrir; abiertos: string[]; avisos: string[]; buscados: string[] } {
      const abiertos: string[] = [];
      const avisos: string[] = [];
      const buscados: string[] = [];
      const deps: DependenciasAbrir = {
        destino: 'DEST',
        usuario: 'U',
        listarCarpeta: async (ruta) => (ruta.endsWith('/ZPAQ1') ? ['Source Code Library'] : ['zrep_ejemplo.prog.abap']),
        mostrar: async (ruta) => {
          abiertos.push(ruta);
        },
        irAPaquete: async () => undefined,
        paqueteDe: async (nombre, tipo) => {
          buscados.push(`${tipo}:${nombre}`);
          return paquete;
        },
        transacciones: {
          resolver: async () => destino,
          avisar: (m) => avisos.push(m),
        },
      };
      return { deps, abiertos, avisos, buscados };
    }
    const tran: ResultadoBusqueda = { nombre: 'ZT', tipo: 'TRAN/T', descripcion: '', paquete: '', uriAdt: '' };

    test('un report abre el programa localizando su paquete por nombre exacto', async () => {
      const { deps, abiertos, buscados } = armar({ clase: 'programa', programa: 'ZREP_EJEMPLO' }, 'ZPAQ1');
      assert.strictEqual(await abrirResultado(tran, deps), 'abierto');
      assert.deepStrictEqual(buscados, ['PROG/P:ZREP_EJEMPLO']);
      assert.strictEqual(abiertos.length, 1);
    });

    test('un diálogo abre el programa y avisa del dynpro', async () => {
      const { deps, avisos, abiertos } = armar({ clase: 'programa', programa: 'ZREP_EJEMPLO', dynpro: '0100' }, 'ZPAQ1');
      assert.strictEqual(await abrirResultado(tran, deps), 'abierto');
      assert.strictEqual(abiertos.length, 1);
      assert.deepStrictEqual(avisos, ['Dynpro 0100: la extensión oficial no expone dynpros']);
    });

    test('un método OO abre su clase buscando CLAS/OC; sin paquete no se localiza; desconocido no abre nada', async () => {
      const metodo = armar({ clase: 'metodo', claseAbap: 'ZCL_EJEMPLO', metodo: 'EJECUTAR' }, 'ZPAQ1');
      assert.strictEqual(await abrirResultado(tran, metodo.deps), 'abierto');
      assert.deepStrictEqual(metodo.buscados, ['CLAS/OC:ZCL_EJEMPLO']);
      assert.strictEqual(metodo.abiertos.length, 1);
      const sinPaquete = armar({ clase: 'metodo', claseAbap: 'ZCL_EJEMPLO', metodo: 'EJECUTAR' }, undefined);
      assert.strictEqual(await abrirResultado(tran, sinPaquete.deps), 'noLocalizado');
      const desconocido = armar({ clase: 'desconocido' }, 'ZPAQ1');
      assert.strictEqual(await abrirResultado(tran, desconocido.deps), 'transaccionSinDestino');
      assert.deepStrictEqual(desconocido.abiertos, []);
    });

    test('una vista de actualización avisa con el nombre de la vista y no abre nada', async () => {
      const { deps, avisos, abiertos, buscados } = armar({ clase: 'vista', vista: 'Z_EJEMPLO_48' }, 'ZPAQ1');
      assert.strictEqual(await abrirResultado(tran, deps), 'vista');
      assert.strictEqual(avisos.length, 1);
      assert.ok(avisos[0].includes('Z_EJEMPLO_48'), avisos[0]);
      assert.deepStrictEqual(abiertos, []);
      assert.deepStrictEqual(buscados, []);
    });

    test('un report abre su programa con el paquete de la búsqueda real sin filtro (busq-xml.xml)', async () => {
      const peticiones: PeticionAdt[] = [];
      const conexion = new ConexionAdt({
        peticion: async (p) => {
          peticiones.push(p);
          return { estado: 200, cuerpo: fixture('busq-xml.xml') };
        },
      });
      const { deps, abiertos } = armar({ clase: 'programa', programa: 'Z_EJEMPLO_3' }, undefined);
      deps.paqueteDe = (nombre, tipo) => paqueteSinFiltro(conexion, nombre, tipo);
      deps.listarCarpeta = async (ruta) => (ruta.endsWith('/U') ? ['Source Code Library'] : ['z_ejemplo_3.prog.abap']);
      assert.strictEqual(await abrirResultado(tran, deps), 'abierto');
      assert.deepStrictEqual(abiertos, [
        '/repotree-v1/DEST/Local Objects ($TMP)/U/Source Code Library/Programs/Z_EJEMPLO_3/z_ejemplo_3.prog.abap',
      ]);
      assert.strictEqual(peticiones.length, 1);
      assert.strictEqual(peticiones[0].parametros?.objectType, undefined);
      assert.strictEqual(peticiones[0].parametros?.query, 'Z_EJEMPLO_3');
    });

    test('un fallo al resolver no lanza', async () => {
      const { deps } = armar({ clase: 'desconocido' }, 'ZPAQ1');
      deps.transacciones = {
        resolver: async () => {
          throw new Error('detalle sensible');
        },
        avisar: () => undefined,
      };
      assert.strictEqual(await abrirResultado(tran, deps), 'transaccionSinDestino');
    });
  });
});
