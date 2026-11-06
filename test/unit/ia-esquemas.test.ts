import assert from 'node:assert/strict';
import { ESQUEMAS, validarArgs } from '../../src/ia/esquemas';

suite('IA: esquemas de entrada', () => {
  test('acepta argumentos correctos y aplica los tipos', () => {
    const v = validarArgs(ESQUEMAS.leer_programa, { uri: 'abap:/repotree-v1/DEST/x', incluirIncludes: false });
    assert.ok(v.ok && v.args.incluirIncludes === false);
  });
  test('falta un requerido → motivo con el nombre', () => {
    const v = validarArgs(ESQUEMAS.abrir_transaccion, {});
    assert.ok(!v.ok && v.motivo.includes('tcode'));
  });
  test('tipo equivocado, patrón, enum y rango se rechazan con el nombre del campo', () => {
    assert.ok(!validarArgs(ESQUEMAS.abrir_transaccion, { tcode: 123 }).ok);
    assert.ok(!validarArgs(ESQUEMAS.leer_programa, { uri: 'file:///x' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.abrir_objeto, { nombre: 'Z', tipo: 'XXXX' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.leer_programa, { uri: 'abap:/repotree-v1/D/x', maxLineasPorArchivo: 0 }).ok);
  });
  test('propiedades desconocidas se rechazan; args no objeto → motivo', () => {
    assert.ok(!validarArgs(ESQUEMAS.contexto_actual, { extra: 1 }).ok);
    assert.ok(!validarArgs(ESQUEMAS.contexto_actual, 'x').ok);
    assert.ok(validarArgs(ESQUEMAS.contexto_actual, undefined).ok);
  });
  test('nombres heredados del prototipo se rechazan como desconocidos', () => {
    assert.ok(!validarArgs(ESQUEMAS.contexto_actual, { constructor: 1 }).ok);
    assert.ok(!validarArgs(ESQUEMAS.contexto_actual, { toString: 1 }).ok);
  });
  test('rangos enteros: desdeLinea 0, maxLineasPorArchivo 1.5 y 20001 se rechazan', () => {
    const uri = 'abap:/repotree-v1/D/x';
    assert.ok(!validarArgs(ESQUEMAS.leer_archivo, { uri, desdeLinea: 0, hastaLinea: 1 }).ok);
    assert.ok(!validarArgs(ESQUEMAS.leer_programa, { uri, maxLineasPorArchivo: 1.5 }).ok);
    assert.ok(!validarArgs(ESQUEMAS.leer_programa, { uri, maxLineasPorArchivo: 20001 }).ok);
  });
  test('la uri abap: rechaza caracteres de control y admite espacios', () => {
    assert.ok(!validarArgs(ESQUEMAS.leer_programa, { uri: 'abap:/repotree-v1/DEST/x\ny' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.leer_programa, { uri: 'abap:/repotree-v1/DEST/x\ty' }).ok);
    assert.ok(validarArgs(ESQUEMAS.leer_programa, { uri: 'abap:/repotree-v1/DEST/System Library/x' }).ok);
  });
  test('proponer_cambio: cambios es un array de {buscar, reemplazar}; elementos mal formados se rechazan con el campo', () => {
    const uri = 'abap:/repotree-v1/D/x';
    assert.ok(validarArgs(ESQUEMAS.proponer_cambio, { uri, resumen: 'r', cambios: [{ buscar: 'a', reemplazar: 'b' }] }).ok);
    assert.ok(validarArgs(ESQUEMAS.proponer_cambio, { uri, resumen: 'r', textoCompleto: 'x' }).ok);
    const sinReemplazar = validarArgs(ESQUEMAS.proponer_cambio, { uri, resumen: 'r', cambios: [{ buscar: 'a' }] });
    assert.ok(!sinReemplazar.ok && sinReemplazar.motivo.includes('cambios[0]') && sinReemplazar.motivo.includes('reemplazar'));
    assert.ok(!validarArgs(ESQUEMAS.proponer_cambio, { uri, resumen: 'r', cambios: [] }).ok);
    assert.ok(!validarArgs(ESQUEMAS.proponer_cambio, { uri, resumen: 'r', cambios: 'a' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.proponer_cambio, { uri, resumen: 'r', cambios: [{ buscar: 'a', reemplazar: 'b', extra: 1 }] }).ok);
    assert.ok(!validarArgs(ESQUEMAS.proponer_cambio, { uri, resumen: 'con\nsalto', textoCompleto: 'x' }).ok);
  });
  test('estado_propuesta exige un id corto en minúsculas y las de uri solo la uri', () => {
    assert.ok(validarArgs(ESQUEMAS.estado_propuesta, { id: 'a1b2c3d4' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.estado_propuesta, { id: 'A/1' }).ok);
    for (const nombre of ['verificar_sintaxis', 'ejecutar_atc', 'ejecutar_unit_tests', 'activar'] as const) {
      assert.ok(validarArgs(ESQUEMAS[nombre], { uri: 'abap:/repotree-v1/D/x' }).ok);
      assert.ok(!validarArgs(ESQUEMAS[nombre], {}).ok);
    }
  });
  test('activar admite todo booleano opcional y rechaza otro tipo', () => {
    const uri = 'abap:/repotree-v1/D/x';
    assert.equal(ESQUEMAS.activar.properties.todo?.type, 'boolean');
    assert.ok(!(ESQUEMAS.activar.required ?? []).includes('todo'));
    assert.ok(validarArgs(ESQUEMAS.activar, { uri, todo: true }).ok);
    assert.ok(validarArgs(ESQUEMAS.activar, { uri, todo: false }).ok);
    const x = validarArgs(ESQUEMAS.activar, { uri, todo: 'x' });
    assert.ok(!x.ok && x.motivo.includes('todo'));
  });
  test('info_sistema acepta {} y un sistema válido y rechaza uno con espacios', () => {
    assert.ok(validarArgs(ESQUEMAS.info_sistema, {}).ok);
    assert.ok(validarArgs(ESQUEMAS.info_sistema, { sistema: 'DEST' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.info_sistema, { sistema: 'a b' }).ok);
  });

  test('anotar_diario acota texto a 4000 caracteres y admite saltos de línea', () => {
    const uri = 'abap:/repotree-v1/D/x';
    assert.ok(!validarArgs(ESQUEMAS.anotar_diario, { uri, texto: 'x'.repeat(4001) }).ok);
    assert.ok(validarArgs(ESQUEMAS.anotar_diario, { uri, texto: 'a\nb' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.anotar_diario, { uri, texto: '' }).ok);
    assert.ok(validarArgs(ESQUEMAS.diario_objeto, { uri }).ok);
  });
  test('proponer_cambio: porque es opcional y se acota a 1000 caracteres', () => {
    const uri = 'abap:/repotree-v1/D/x';
    const base = { uri, resumen: 'r', cambios: [{ buscar: 'a', reemplazar: 'b' }] };
    assert.ok(validarArgs(ESQUEMAS.proponer_cambio, base).ok);
    assert.ok(validarArgs(ESQUEMAS.proponer_cambio, { ...base, porque: 'p' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.proponer_cambio, { ...base, porque: 'p'.repeat(1001) }).ok);
  });
  test('crear_objeto: casos válidos y límites', () => {
    const base = { tipo: 'INCL', nombre: 'ZTEST_TOP', descripcion: 'Datos globales' };
    assert.deepEqual(ESQUEMAS.crear_objeto.required, ['nombre', 'descripcion']);
    assert.match(ESQUEMAS.crear_objeto.properties.tipo.description, /solo para el cuadro guía/);
    assert.deepEqual(Object.keys(ESQUEMAS.crear_objeto.properties), [
      'sistema',
      'tipo',
      'nombre',
      'descripcion',
      'programaPrincipal',
      'relanzar',
    ]);
    assert.equal(ESQUEMAS.crear_objeto.properties.programaPrincipal.pattern, ESQUEMAS.crear_objeto.properties.nombre.pattern);
    assert.equal(
      ESQUEMAS.crear_objeto.properties.programaPrincipal.description,
      'Solo para includes de un programa que ya existe: Sextante crea el include directamente en el paquete y la orden de ese programa, con una confirmación del usuario. Sin él, la creación va por el asistente de SAP.',
    );
    assert.ok(validarArgs(ESQUEMAS.crear_objeto, { ...base, programaPrincipal: 'ztest' }).ok);
    assert.ok(validarArgs(ESQUEMAS.crear_objeto, { ...base, programaPrincipal: '/abc/prog' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { ...base, programaPrincipal: '1ABC' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { ...base, programaPrincipal: 'Z'.repeat(41) }).ok);
    assert.ok(validarArgs(ESQUEMAS.crear_objeto, base).ok);
    assert.ok(validarArgs(ESQUEMAS.crear_objeto, { ...base, nombre: '/abc/x_1', sistema: 'DEV' }).ok);
    for (const tipo of ['PROG', 'INCL', 'CLAS', 'INTF', 'FUGR', 'TABL', 'DDLS']) {
      assert.ok(validarArgs(ESQUEMAS.crear_objeto, { ...base, tipo }).ok, tipo);
    }
    assert.ok(validarArgs(ESQUEMAS.crear_objeto, { nombre: 'ZX', descripcion: 'd' }).ok, 'el tipo es opcional');
    assert.ok(validarArgs(ESQUEMAS.crear_objeto, { ...base, nombre: 'Z'.repeat(40) }).ok);
    assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { ...base, nombre: 'Z'.repeat(41) }).ok);
    assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { ...base, tipo: 'XSLT' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { ...base, nombre: '1ABC' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { ...base, nombre: 'Z/X' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { ...base, descripcion: 'a\nb' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { ...base, descripcion: '' }).ok);
    assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { ...base, descripcion: 'x'.repeat(61) }).ok);
    assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { tipo: 'INCL', nombre: 'ZX' }).ok);
    assert.ok(validarArgs(ESQUEMAS.crear_objeto, { ...base, relanzar: true }).ok);
    assert.ok(validarArgs(ESQUEMAS.crear_objeto, { ...base, relanzar: false }).ok);
    assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { ...base, relanzar: 'x' }).ok);
    for (const retirado of [{ paquete: '$TMP' }, { orden: 'DEVK900123' }]) {
      assert.ok(!validarArgs(ESQUEMAS.crear_objeto, { ...base, ...retirado }).ok, Object.keys(retirado)[0]);
    }
  });
  test('todos los esquemas son objetos sin additionalProperties', () => {
    for (const e of Object.values(ESQUEMAS)) {
      assert.equal(e.type, 'object');
      assert.equal(e.additionalProperties, false);
    }
  });
});
