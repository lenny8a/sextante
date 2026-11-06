import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CONTENT_TYPE_INCLUDE,
  ESPERA_CREACION_MS,
  RUTA_INCLUDES,
  TIPOS_CREABLES,
  TIPO_ADT_PROGRAMA,
  VIGENCIA_CREACION_MS,
  claveCreacion,
  claveObjeto,
  cuerpoInclude,
  escaparXml,
  indicacionAsistenteInclude,
  indicacionIncludeCreado,
  mensajeRechazoCreacion,
  necesitaOrden,
  objetoPedidoEn,
  ordenUnicaModificable,
  paqueteDeObjeto,
  parametrosInclude,
  resultadoBusquedaInclude,
  textoConfirmacionInclude,
  textoGuiaCreacion,
  validarCreacion,
  type PeticionInclude,
} from '../../src/ia/creacion-modelo';
import { BIBLIOTECA_LOCAL, BIBLIOTECA_SISTEMA, type ObjetoRepotree } from '../../src/bridge/adt-uri';

const BASE = { tipo: 'prog', nombre: 'ztest_nuevo', descripcion: 'Informe de prueba' };
const PROGRAMA: ObjetoRepotree = {
  biblioteca: BIBLIOTECA_SISTEMA,
  paquete: 'ZPAQ1',
  categoria: 'Source Code Library',
  tipoCarpeta: 'Programs',
  nombre: 'ZTEST_NUEVO',
};
const RUTA_PROGRAMA = '/repotree-v1/DEV/System Library/ZPAQ1/Source Code Library/Programs/ZTEST_NUEVO/ztest_nuevo.prog.abap';

function motivo(args: Record<string, unknown>): string {
  const v = validarCreacion(args);
  assert.ok(!v.ok, 'se esperaba error');
  return v.motivo;
}

suite('IA: modelo de creación de objetos', () => {
  test('pasa a mayúsculas nombre y tipo y recorta la descripción', () => {
    const v = validarCreacion({ ...BASE, descripcion: '  Informe de prueba ' });
    assert.ok(v.ok);
    assert.deepEqual(v.peticion, { tipo: 'PROG', nombre: 'ZTEST_NUEVO', descripcion: 'Informe de prueba' });
  });
  test('el tipo es opcional y admite los siete del enum', () => {
    const sin = validarCreacion({ nombre: 'zx', descripcion: 'd' });
    assert.ok(sin.ok);
    assert.deepEqual(sin.peticion, { nombre: 'ZX', descripcion: 'd' });
    assert.deepEqual([...TIPOS_CREABLES], ['PROG', 'INCL', 'CLAS', 'INTF', 'FUGR', 'TABL', 'DDLS']);
    for (const tipo of TIPOS_CREABLES) {
      assert.ok(validarCreacion({ ...BASE, tipo }).ok, tipo);
    }
  });
  test('tipo desconocido → error con la lista', () => {
    assert.equal(motivo({ ...BASE, tipo: 'XSLT' }), 'el tipo debe ser uno de PROG, INCL, CLAS, INTF, FUGR, TABL, DDLS');
  });
  test('nombre de 41 caracteres → error', () => {
    assert.match(motivo({ ...BASE, nombre: 'z'.repeat(41) }), /nombre/);
  });
  test('nombre de 40 caracteres vale y con namespace también', () => {
    assert.ok(validarCreacion({ ...BASE, nombre: 'z'.repeat(40) }).ok);
    const ns = validarCreacion({ ...BASE, nombre: '/abc/x_top' });
    assert.ok(ns.ok);
    assert.equal(ns.peticion.nombre, '/ABC/X_TOP');
  });
  test('nombre que no empieza por letra → error que explica el namespace', () => {
    assert.equal(
      motivo({ ...BASE, nombre: '1abc' }),
      'el nombre debe tener hasta 40 caracteres, empezar por letra (o por un namespace /NS/) y usar solo A-Z, 0-9 y _',
    );
    assert.match(motivo({ ...BASE, nombre: 'Z/X' }), /nombre/);
  });
  test('descripción de 61 caracteres, vacía o con salto → error', () => {
    assert.match(motivo({ ...BASE, descripcion: 'x'.repeat(61) }), /descripci/);
    assert.match(motivo({ ...BASE, descripcion: '' }), /descripci/);
    assert.match(motivo({ ...BASE, descripcion: 'a\nb' }), /descripci/);
  });
  test('descripción de 60 caracteres vale', () => {
    assert.ok(validarCreacion({ ...BASE, descripcion: 'x'.repeat(60) }).ok);
  });
  test('textoGuiaCreacion: mensaje y detalle exactos con cada tipo y sin tipo', () => {
    const etiquetas: Record<string, string> = {
      PROG: 'programa',
      INCL: 'include',
      CLAS: 'clase',
      INTF: 'interfaz',
      FUGR: 'grupo de funciones',
      TABL: 'tabla',
      DDLS: 'vista CDS',
    };
    const detalle = (sufijo: string): string =>
      'Se abrirá el asistente de SAP y te pedirá, en este orden:\n' +
      `1. Tipo de objeto: elige el que corresponde${sufijo}.\n` +
      '2. Datos del objeto: nombre (ya está en el portapapeles: pégalo con Ctrl+V), descripción y paquete (escribe para buscar; $TMP es local).\n' +
      '3. Orden de transporte: elige una tuya o «Create New Transport Request…». Los objetos locales no la piden.';
    for (const tipo of TIPOS_CREABLES) {
      assert.deepEqual(textoGuiaCreacion({ tipo, nombre: 'ZTEST_NUEVO', descripcion: 'Informe de prueba' }, 'DEV'), {
        mensaje: `El agente pide crear ${etiquetas[tipo]} ZTEST_NUEVO «Informe de prueba» en DEV.`,
        detalle: detalle(` (aquí: ${etiquetas[tipo]})`),
      });
    }
    assert.deepEqual(textoGuiaCreacion({ nombre: 'ZTEST_NUEVO', descripcion: 'Informe de prueba' }, 'DEV'), {
      mensaje: 'El agente pide crear el objeto ZTEST_NUEVO «Informe de prueba» en DEV.',
      detalle: detalle(''),
    });
  });
  test('paqueteDeObjeto: $TMP bajo Local Objects, el paquete en otro caso y el namespace deshecho', () => {
    assert.equal(paqueteDeObjeto(PROGRAMA), 'ZPAQ1');
    assert.equal(paqueteDeObjeto({ ...PROGRAMA, biblioteca: BIBLIOTECA_LOCAL, paquete: 'LENNIN' }), '$TMP');
    assert.equal(paqueteDeObjeto({ ...PROGRAMA, paquete: '(ABC)PAQ' }), '/ABC/PAQ');
  });
  test('objetoPedidoEn: el objeto de ese destino y nombre, sin distinguir mayúsculas', () => {
    assert.deepEqual(objetoPedidoEn({ scheme: 'abap', path: RUTA_PROGRAMA }, 'DEV', 'ztest_nuevo'), PROGRAMA);
    assert.equal(objetoPedidoEn({ scheme: 'abap', path: RUTA_PROGRAMA }, 'QAS', 'ZTEST_NUEVO'), undefined);
    assert.equal(objetoPedidoEn({ scheme: 'abap', path: RUTA_PROGRAMA }, 'DEV', 'ZOTRO'), undefined);
    assert.equal(objetoPedidoEn({ scheme: 'file', path: RUTA_PROGRAMA }, 'DEV', 'ZTEST_NUEVO'), undefined);
    assert.equal(objetoPedidoEn({ scheme: 'abap', path: '/repotree-v1/DEV/System Library/ZPAQ1' }, 'DEV', 'ZPAQ1'), undefined);
    const conNamespace = '/repotree-v1/DEV/System Library/(ABC)PAQ/Source Code Library/Includes/(ABC)X_TOP/x.prog.abap';
    assert.equal(objetoPedidoEn({ scheme: 'abap', path: conNamespace }, 'DEV', '/ABC/X_TOP')?.nombre, '(ABC)X_TOP');
  });
  test('claveObjeto: el mismo objeto por .abap y .json da la misma clave; otro destino u objeto, otra', () => {
    const abap = claveObjeto({ scheme: 'abap', path: RUTA_PROGRAMA });
    assert.ok(abap !== undefined);
    assert.equal(claveObjeto({ scheme: 'abap', path: RUTA_PROGRAMA.replace('.prog.abap', '.prog.json') }), abap);
    assert.notEqual(claveObjeto({ scheme: 'abap', path: RUTA_PROGRAMA.replace('/DEV/', '/QAS/') }), abap);
    assert.notEqual(claveObjeto({ scheme: 'abap', path: RUTA_PROGRAMA.replace(/ZTEST_NUEVO\/ztest_nuevo/, 'ZOTRO/zotro') }), abap);
    assert.equal(claveObjeto({ scheme: 'abap', path: '/repotree-v1/DEV/System Library/ZPAQ1' }), undefined);
    assert.equal(claveObjeto({ scheme: 'file', path: RUTA_PROGRAMA }), undefined);
  });
  test('claveCreacion: destino y nombre en mayúsculas', () => {
    assert.equal(claveCreacion('dev', 'ztest_nuevo'), 'DEV|ZTEST_NUEVO');
    assert.notEqual(claveCreacion('DEV', 'ZA'), claveCreacion('DEV2', 'ZA'));
    assert.equal(VIGENCIA_CREACION_MS, 600_000);
  });
  test('la espera del objeto creado es de 60 s', () => {
    assert.equal(ESPERA_CREACION_MS, 60_000);
  });
});

function fixtureCreacion(nombre: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real/creacion', nombre), 'utf8');
}

// El modelo emite el XML con saltos de línea e indentación; la petición real fue en una sola línea. Se compara con el
// espacio en blanco colapsado a un espacio y sin espacio entre etiquetas.
function normalizarXml(xml: string): string {
  return xml.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
}

const INCLUDE: PeticionInclude = {
  nombre: 'ZTEST_TOP',
  descripcion: 'Datos globales',
  programaPrincipal: 'ZTEST',
  paquete: '$TMP',
};

suite('IA: modelo de creación directa de includes', () => {
  const INCL = { tipo: 'INCL', nombre: 'ztest_top', descripcion: 'Datos globales' };
  test('programaPrincipal con tipo INCL: en mayúsculas en la petición', () => {
    const v = validarCreacion({ ...INCL, programaPrincipal: ' ztest ' });
    assert.ok(v.ok);
    assert.deepEqual(v.peticion, { tipo: 'INCL', nombre: 'ZTEST_TOP', descripcion: 'Datos globales', programaPrincipal: 'ZTEST' });
    const ns = validarCreacion({ ...INCL, programaPrincipal: '/abc/prog' });
    assert.ok(ns.ok && ns.peticion.programaPrincipal === '/ABC/PROG');
  });
  test('programaPrincipal con otro tipo → error', () => {
    for (const tipo of ['PROG', 'CLAS', 'FUGR']) {
      assert.equal(motivo({ ...INCL, tipo, programaPrincipal: 'ztest' }), 'programaPrincipal solo vale para includes', tipo);
    }
  });
  test('programaPrincipal sin tipo → error que pide tipo INCL', () => {
    assert.equal(
      motivo({ nombre: 'ztest_top', descripcion: 'd', programaPrincipal: 'ztest' }),
      'programaPrincipal solo vale para includes: indica tipo INCL',
    );
  });
  test('programaPrincipal mal formado → error', () => {
    for (const programaPrincipal of ['1abc', 'a b', 'z'.repeat(41), 'Z/X']) {
      assert.equal(motivo({ ...INCL, programaPrincipal }), 'el programa principal no tiene un nombre válido', programaPrincipal);
    }
  });
  test('programaPrincipal vacío o no texto: se ignora (modo asistente)', () => {
    for (const programaPrincipal of ['', '   ', 7]) {
      const v = validarCreacion({ ...INCL, programaPrincipal });
      assert.ok(v.ok);
      assert.equal('programaPrincipal' in v.peticion, false);
    }
  });
  test('necesitaOrden: los paquetes que empiezan por $ son locales', () => {
    assert.equal(necesitaOrden('$TMP'), false);
    assert.equal(necesitaOrden('$ZDEMO'), false);
    assert.equal(necesitaOrden('ZPAQ'), true);
    assert.equal(necesitaOrden('/ABC/PAQ'), true);
  });
  test('ordenUnicaModificable: solo si hay exactamente una orden modificable y la lista está completa', () => {
    const modificable = { numero: 'DEVK900001', estado: 'modificable' as const };
    const liberada = { numero: 'DEVK900002', estado: 'liberada' as const };
    assert.equal(ordenUnicaModificable({ ordenes: [modificable, liberada] }), 'DEVK900001');
    assert.equal(ordenUnicaModificable({ ordenes: [modificable, modificable] }), 'DEVK900001', 'la misma orden repetida cuenta una vez');
    assert.equal(ordenUnicaModificable({ ordenes: [liberada] }), undefined);
    assert.equal(ordenUnicaModificable({ ordenes: [] }), undefined);
    assert.equal(ordenUnicaModificable({ ordenes: [modificable, { numero: 'DEVK900003', estado: 'modificable' }] }), undefined);
    assert.equal(ordenUnicaModificable({ ordenes: [modificable], truncado: { recibidas: 5000, total: 5001 } }), undefined);
    assert.equal(ordenUnicaModificable(undefined), undefined);
  });
  test('ruta, content type y tipo ADT del programa', () => {
    assert.equal(RUTA_INCLUDES, '/sap/bc/adt/programs/includes');
    assert.equal(CONTENT_TYPE_INCLUDE, 'application/vnd.sap.adt.programs.includes.v2+xml');
    assert.equal(TIPO_ADT_PROGRAMA, 'PROG/P');
  });
  test('escaparXml', () => {
    assert.equal(escaparXml('a<b>&"c"\''), 'a&lt;b&gt;&amp;&quot;c&quot;&apos;');
  });
  test('cuerpo idéntico al enviado en la petición real (include, paquete local)', () => {
    const p: PeticionInclude = {
      nombre: 'ZPROG_EJEMPLO_TOP',
      descripcion: 'Ejemplo Sextante: include sin contexto',
      programaPrincipal: 'ZPROG_EJEMPLO',
      paquete: '$TMP',
    };
    assert.equal(normalizarXml(cuerpoInclude(p, 'USUARIO')), normalizarXml(fixtureCreacion('crear-incl.enviado.xml')));
  });
  test('el cuerpo no lleva contextRef ni la orden, y escapa los textos', () => {
    const x = cuerpoInclude({ ...INCLUDE, paquete: 'ZPAQ', orden: 'DEVK900001', descripcion: 'A & "B"' }, 'U<1>');
    assert.ok(!x.includes('contextRef'));
    assert.ok(!x.includes('DEVK900001'));
    assert.ok(x.includes('adtcore:description="A &amp; &quot;B&quot;"'));
    assert.ok(x.includes('adtcore:responsible="U&lt;1&gt;"'));
    assert.ok(x.includes('<adtcore:packageRef adtcore:name="ZPAQ"/>'));
  });
  test('parametrosInclude: corrNr solo con orden', () => {
    assert.equal(parametrosInclude(INCLUDE), undefined);
    assert.deepEqual(parametrosInclude({ ...INCLUDE, paquete: 'ZPAQ', orden: 'DEVK900001' }), { corrNr: 'DEVK900001' });
  });
  test('textoConfirmacionInclude: paquete local y paquete con orden', () => {
    assert.deepEqual(textoConfirmacionInclude(INCLUDE, 'DEV'), {
      mensaje: 'El agente pide crear el include ZTEST_TOP «Datos globales» en DEV.',
      detalle: 'Paquete: $TMP (el del programa ZTEST).\nObjeto local: sin orden de transporte.',
    });
    assert.deepEqual(textoConfirmacionInclude({ ...INCLUDE, paquete: 'ZPAQ', orden: 'DEVK900001' }, 'DEV'), {
      mensaje: 'El agente pide crear el include ZTEST_TOP «Datos globales» en DEV.',
      detalle: 'Paquete: ZPAQ (el del programa ZTEST).\nOrden de transporte: DEVK900001 (la del programa).',
    });
  });
  test('resultadoBusquedaInclude: lo que abre el include por el camino de abrir_objeto', () => {
    assert.deepEqual(resultadoBusquedaInclude(INCLUDE), {
      nombre: 'ZTEST_TOP',
      tipo: 'PROG/I',
      descripcion: 'Datos globales',
      paquete: '$TMP',
      uriAdt: '/sap/bc/adt/programs/includes/ztest_top',
    });
    assert.equal(resultadoBusquedaInclude({ ...INCLUDE, nombre: '/ABC/X_TOP' }).uriAdt, '/sap/bc/adt/programs/includes/%2fabc%2fx_top');
  });
  test('mensajeRechazoCreacion: HTTP solo con estado mayor que 0', () => {
    assert.equal(mensajeRechazoCreacion(400, 'Nombre no válido'), 'SAP rechazó la creación (HTTP 400): Nombre no válido');
    assert.equal(mensajeRechazoCreacion(0, 'sin red'), 'SAP rechazó la creación: sin red');
  });
  test('indicaciones exactas', () => {
    assert.equal(
      indicacionIncludeCreado('ZTEST', true),
      'escribe el código con proponer_cambio y textoCompleto; recuerda añadir la sentencia INCLUDE en ZTEST si falta',
    );
    assert.equal(
      indicacionIncludeCreado('ZTEST', false),
      'ábrelo con abrir_objeto en unos segundos; recuerda añadir la sentencia INCLUDE en ZTEST si falta',
    );
    assert.equal(
      indicacionAsistenteInclude('ZTEST'),
      'el programa ZTEST no está en una única orden abierta: crea el include con crear_objeto sin programaPrincipal para que el usuario elija la orden en el asistente de SAP',
    );
  });
});
