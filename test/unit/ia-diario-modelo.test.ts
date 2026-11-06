import assert from 'node:assert/strict';
import {
  anadirEntrada,
  cabeceraDiario,
  etiquetaArchivo,
  formatearEntrada,
  formatearFecha,
  identidadDeUri,
  identidadSegunVista,
  partirEntradas,
  recortarParaAgente,
  resumenDe,
  rutaRelativaDiario,
  sanearTexto,
  type IdentidadDiario,
} from '../../src/ia/diario-modelo';

const BASE = 'abap:/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library';
const ID: IdentidadDiario = { destino: 'DEST', codigo: 'PROG', nombre: 'ZPROG_EJEMPLO' };

const EJEMPLO =
  `${cabeceraDiario(ID)}\n` +
  '## 2026-11-04 10:32 · aplicado · Añade validación\nArchivo: principal\nPor qué: evita dump\n\n' +
  '## 2026-11-04 10:40 · rechazado · Cambia el select\nArchivo: principal\nMotivo del usuario: no\n\n' +
  '## 2026-11-04 10:45 · nota\nPendiente revisar el FORM.\n';

suite('diario-modelo', () => {
  suite('identidadSegunVista', () => {
    const PROG = `${BASE}/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap`;
    const F01 = `${BASE}/Includes/ZPROG_EJEMPLO_F01/zprog_ejemplo_f01.prog.abap`;
    const FUGR = `${BASE}/Function Groups/ZGRP_EJEMPLO/zgrp_ejemplo.fugr.z_fm_ejemplo.func.abap`;
    const INCL_F01: IdentidadDiario = { destino: 'DEST', codigo: 'INCL', nombre: 'ZPROG_EJEMPLO_F01' };
    const vista = (pertenece: boolean, programa: string | undefined) => ({
      pertenece: () => pertenece,
      programaMostrado: () => programa,
    });

    test('include que pertenece al programa mostrado: diario del programa', () => {
      assert.deepEqual(identidadSegunVista(F01, vista(true, PROG)), ID);
    });
    test('include que no pertenece al objeto mostrado: su diario INCL', () => {
      assert.deepEqual(identidadSegunVista(F01, vista(false, PROG)), INCL_F01);
    });
    test('include sin programa en la vista (la vista muestra el include u otro tipo): su diario INCL', () => {
      assert.deepEqual(identidadSegunVista(F01, vista(true, undefined)), INCL_F01);
    });
    test('lo que no es include no consulta la vista', () => {
      const sinVista = {
        pertenece: () => assert.fail('no debe consultar pertenece'),
        programaMostrado: () => assert.fail('no debe consultar el programa'),
      };
      assert.deepEqual(identidadSegunVista(PROG, sinVista), ID);
      assert.equal(identidadSegunVista(FUGR, sinVista)?.codigo, 'FUGR');
      assert.equal(identidadSegunVista('file:///x', sinVista), undefined);
    });
  });

  suite('identidadDeUri', () => {
    test('include', () => {
      assert.deepEqual(identidadDeUri(`${BASE}/Includes/ZPROG_EJEMPLO_F01/zprog_ejemplo_f01.prog.abap`), {
        destino: 'DEST',
        codigo: 'INCL',
        nombre: 'ZPROG_EJEMPLO_F01',
      });
    });
    test('programa', () => {
      assert.deepEqual(identidadDeUri(`${BASE}/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap`), ID);
    });
    test('grupo de funciones', () => {
      assert.deepEqual(
        identidadDeUri(`${BASE}/Function Groups/ZGRP_EJEMPLO/zgrp_ejemplo.fugr.z_fm_ejemplo.func.abap`),
        { destino: 'DEST', codigo: 'FUGR', nombre: 'ZGRP_EJEMPLO' },
      );
    });
    test('tabla', () => {
      assert.equal(identidadDeUri(`${BASE}/Database Tables/ZTAB_EJEMPLO/ztab_ejemplo.tabl.ddic`)?.codigo, 'TABL');
    });
    test('estructura', () => {
      assert.equal(identidadDeUri(`${BASE}/Structures/ZEST_EJEMPLO/zest_ejemplo.tabl.ddic`)?.codigo, 'TABL');
    });
    test('uri codificada', () => {
      assert.equal(
        identidadDeUri(
          'abap:/repotree-v1/DEST/System%20Library/ZPAQ1/Source%20Code%20Library/Programs/ZP/zp.prog.abap',
        )?.nombre,
        'ZP',
      );
    });
    test('destino con barras invertidas, espacios o % no es válido', () => {
      const resto = 'System Library/ZPAQ1/Source Code Library/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap';
      assert.equal(identidadDeUri(`abap:/repotree-v1/..\\..\\evil/${resto}`), undefined);
      assert.equal(identidadDeUri(`abap:/repotree-v1/MI%20DEST/${resto}`), undefined);
      assert.equal(identidadDeUri(`abap:/repotree-v1/MI DEST/${resto}`), undefined);
      assert.equal(identidadDeUri(`abap:/repotree-v1/DE%ST/${resto}`), undefined);
      assert.equal(identidadDeUri(`abap:/repotree-v1/DEV_100-A/${resto}`)?.destino, 'DEV_100-A');
    });
    test('sin objeto', () => {
      assert.equal(identidadDeUri('abap:/repotree-v1/DEST/System Library/ZPAQ1'), undefined);
    });
    test('otro esquema', () => {
      assert.equal(identidadDeUri('file:///x'), undefined);
    });
  });

  test('rutaRelativaDiario codifica el nombre', () => {
    assert.equal(
      rutaRelativaDiario({ destino: 'DEST', codigo: 'CLAS', nombre: '/ABC/CL_EJEMPLO' }),
      'DEST/CLAS-%2FABC%2FCL_EJEMPLO.md',
    );
  });

  suite('etiquetaArchivo', () => {
    test('principal', () => assert.equal(etiquetaArchivo('ZCL_EJEMPLO', 'zcl_ejemplo.clas.abap'), 'principal'));
    test('locals', () =>
      assert.equal(etiquetaArchivo('ZCL_EJEMPLO', 'zcl_ejemplo.clas.locals_imp.abap'), 'locals_imp'));
    test('otro objeto', () =>
      assert.equal(etiquetaArchivo('ZGRP_EJEMPLO', 'zgrp_ejemplo.fugr.z_fm_ejemplo.func.abap'), 'z_fm_ejemplo'));
    test('otro nombre AFF en mayúsculas', () =>
      assert.equal(etiquetaArchivo('ZPROG', 'zprog_f01.prog.abap'), 'ZPROG_F01'));
    test('ddic', () => assert.equal(etiquetaArchivo('ZTAB_EJEMPLO', 'ztab_ejemplo.tabl.ddic'), 'principal'));
    test('sin archivo', () => assert.equal(etiquetaArchivo('ZPROG_EJEMPLO', undefined), 'principal'));
    test('no AFF', () => assert.equal(etiquetaArchivo('X', 'raro'), 'raro'));
  });

  test('formatearFecha usa hora local', () => {
    assert.equal(formatearFecha(new Date(2026, 10, 4, 10, 32).getTime()), '2026-11-04 10:32');
    assert.equal(formatearFecha(new Date(2026, 0, 5, 3, 7).getTime()), '2026-01-05 03:07');
  });

  test('sanearTexto', () => {
    assert.equal(sanearTexto('a\r\n## b\n\n'), 'a\n### b');
  });

  test('sanearTexto conserva la sangría inicial', () => {
    assert.equal(sanearTexto('  a  \n'), '  a');
  });

  suite('formatearEntrada', () => {
    const f = '2026-11-04 10:32';
    test('aplicado', () => {
      assert.equal(
        formatearEntrada(
          {
            tipo: 'aplicado',
            resumen: 'Añade\nvalidación',
            archivo: 'principal',
            porque: 'evita dump',
            sinGuardar: true,
          },
          f,
        ),
        '## 2026-11-04 10:32 · aplicado · Añade validación\nArchivo: principal\nPor qué: evita dump\n' +
          'Aviso: quedó aplicado en el editor pero la oficial no guardó en SAP\n',
      );
    });
    test('aplicado mínimo', () => {
      assert.equal(
        formatearEntrada({ tipo: 'aplicado', resumen: 'R', archivo: 'principal' }, f),
        '## 2026-11-04 10:32 · aplicado · R\nArchivo: principal\n',
      );
    });
    test('rechazado', () => {
      assert.equal(
        formatearEntrada({ tipo: 'rechazado', resumen: 'R', archivo: 'locals_imp', motivo: 'no lo quiero' }, f),
        '## 2026-11-04 10:32 · rechazado · R\nArchivo: locals_imp\nMotivo del usuario: no lo quiero\n',
      );
    });
    test('creado con su paquete', () => {
      assert.equal(
        formatearEntrada({ tipo: 'creado', descripcion: 'Datos\nglobales', paquete: 'ZPAQ1' }, f),
        '## 2026-11-04 10:32 · creado · Datos globales\nPaquete: ZPAQ1\n',
      );
      assert.equal(
        formatearEntrada({ tipo: 'creado', descripcion: 'D', paquete: '$TMP' }, f),
        '## 2026-11-04 10:32 · creado · D\nPaquete: $TMP\n',
      );
    });
    test('partirEntradas reconoce creado', () => {
      const bloque = formatearEntrada({ tipo: 'creado', descripcion: 'D', paquete: '$TMP' }, f);
      const { entradas } = partirEntradas(`# x\n\n${bloque}`);
      assert.deepEqual(entradas.map((e) => [e.tipo, e.fecha, e.resumen]), [['creado', '2026-11-04 10:32', 'D']]);
    });
    test('nota', () => {
      assert.equal(
        formatearEntrada({ tipo: 'nota', texto: 'uno\n## dos\r\n' }, f),
        '## 2026-11-04 10:32 · nota\nuno\n### dos\n',
      );
    });
  });

  suite('anadirEntrada', () => {
    const bloque = '## 2026-11-04 10:32 · nota\nx\n';
    test('sin contenido crea cabecera', () => {
      const r = anadirEntrada(undefined, ID, bloque);
      assert.ok(r.startsWith('# Diario de ZPROG_EJEMPLO (PROG) en DEST\n'));
      assert.ok(r.endsWith(bloque));
    });
    test('archivo vaciado', () => assert.equal(anadirEntrada('', ID, bloque), bloque));
    test('con contenido', () => assert.equal(anadirEntrada('# x\n\n## a\n', ID, bloque), `# x\n\n## a\n\n${bloque}`));
  });

  suite('partirEntradas', () => {
    test('ejemplo completo', () => {
      const { cabecera, entradas } = partirEntradas(EJEMPLO);
      assert.ok(cabecera.startsWith('# Diario de'));
      assert.deepEqual(
        entradas.map((e) => [e.tipo, e.fecha, e.resumen]),
        [
          ['aplicado', '2026-11-04 10:32', 'Añade validación'],
          ['rechazado', '2026-11-04 10:40', 'Cambia el select'],
          ['nota', '2026-11-04 10:45', undefined],
        ],
      );
      assert.ok(entradas[0].texto.startsWith('## 2026-11-04 10:32'));
    });
    test('sin patrón', () => {
      const { entradas } = partirEntradas('## sin patrón\ntexto\n');
      assert.equal(entradas.length, 1);
      assert.equal(entradas[0].tipo, 'otro');
      assert.equal(entradas[0].fecha, undefined);
    });
    test('vacío', () => assert.equal(partirEntradas('').entradas.length, 0));
  });

  suite('resumenDe', () => {
    test('ejemplo', () => assert.deepEqual(resumenDe(EJEMPLO), { entradas: 3, ultima: '2026-11-04 10:45' }));
    test('vacío', () => {
      assert.deepEqual(resumenDe(undefined), { entradas: 0 });
      assert.deepEqual(resumenDe(''), { entradas: 0 });
    });
  });

  suite('recortarParaAgente', () => {
    test('recorta conservando cabecera y última entrada', () => {
      const entrada = (i: number): string =>
        formatearEntrada({ tipo: 'nota', texto: `n${i} ${'x'.repeat(450)}` }, '2026-11-04 10:32');
      let contenido = cabeceraDiario(ID);
      for (let i = 0; i < 100; i++) {
        contenido = anadirEntrada(contenido, ID, entrada(i));
      }
      const r = recortarParaAgente(contenido, 'DEST/PROG-ZPROG_EJEMPLO.md', 30_000);
      assert.equal(r.recortado, true);
      assert.ok(r.texto.startsWith('# Diario de'));
      assert.ok(r.texto.includes('(se omiten '));
      assert.ok(r.texto.includes('n99 '));
      assert.ok(!r.texto.includes('n0 '));
      assert.ok(r.texto.length <= 30_000 + entrada(99).length);
    });
    test('con max pequeño respeta el tope y conserva solo las últimas que caben', () => {
      const entrada = (i: number): string =>
        formatearEntrada({ tipo: 'nota', texto: `n${i} ${'x'.repeat(60)}` }, '2026-11-04 10:32');
      let contenido = cabeceraDiario(ID);
      for (let i = 0; i < 10; i++) {
        contenido = anadirEntrada(contenido, ID, entrada(i));
      }
      const r = recortarParaAgente(contenido, 'r.md', 600);
      assert.equal(r.recortado, true);
      assert.ok(r.texto.length <= 600);
      const conservadas = [...Array(10).keys()].filter((i) => r.texto.includes(`n${i} `));
      assert.ok(conservadas.length > 0 && conservadas.length < 10);
      assert.deepEqual(conservadas, [...Array(conservadas.length).keys()].map((k) => 10 - conservadas.length + k));
      assert.ok(r.texto.includes(`se omiten ${10 - conservadas.length} entradas`));
    });
    test('una entrada mayor que max se devuelve entera', () => {
      const grande = formatearEntrada({ tipo: 'nota', texto: 'y'.repeat(800) }, '2026-11-04 10:32');
      const contenido = anadirEntrada(anadirEntrada(undefined, ID, grande), ID, grande.replace('10:32', '10:50'));
      const r = recortarParaAgente(contenido, 'r.md', 400);
      assert.equal(r.recortado, true);
      assert.ok(r.texto.includes(grande.replace('10:32', '10:50').trimEnd()));
      assert.ok(!r.texto.includes('10:32'));
    });
    test('cabecera enorme sin entradas se recorta', () => {
      const r = recortarParaAgente(`# Diario\n${'z'.repeat(1000)}`, 'r.md', 400);
      assert.equal(r.recortado, true);
      assert.ok(r.texto.includes('(cabecera recortada)'));
      assert.ok(!r.texto.includes('se omiten'));
      assert.ok(r.texto.length <= 400 + 30);
    });
    test('pequeño queda igual', () => {
      assert.deepEqual(recortarParaAgente(EJEMPLO, 'r'), { texto: EJEMPLO, recortado: false });
    });
  });
});
