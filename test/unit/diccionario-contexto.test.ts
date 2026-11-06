import * as assert from 'node:assert/strict';
import { LINEAS_ATRAS, contextoEn, type ContextoDiccionario } from '../../src/diccionario/contexto';

interface Caso {
  nombre: string;
  codigo: string;
  esperado: ContextoDiccionario | undefined;
}

/** El cursor se marca con `|` (se quita antes de llamar). */
function evaluar(codigo: string): ContextoDiccionario | undefined {
  const lineas = codigo.split('\n');
  const fila = lineas.findIndex((l) => l.includes('|'));
  assert.ok(fila >= 0, 'el caso no marca el cursor');
  const columna = lineas[fila].indexOf('|');
  lineas[fila] = lineas[fila].slice(0, columna) + lineas[fila].slice(columna + 1);
  return sinExpresion(contextoEn(lineas, fila, columna));
}

/** Los casos comparan la resolución; `expresion` (el texto original del campo) tiene sus propias pruebas. */
function sinExpresion(contexto: ContextoDiccionario | undefined): ContextoDiccionario | undefined {
  if (contexto?.clase !== 'campo') {
    return contexto;
  }
  const { clase, tabla, campo: nombreCampo } = contexto;
  return { clase, tabla, campo: nombreCampo };
}

const objeto = (nombre: string): ContextoDiccionario => ({ clase: 'objeto', nombre });
const campo = (tabla: string, nombreCampo: string): ContextoDiccionario => ({ clase: 'campo', tabla, campo: nombreCampo });
const mensaje = (claseMensaje: string, numero: string, tipo?: string): ContextoDiccionario =>
  tipo === undefined ? { clase: 'mensaje', claseMensaje, numero } : { clase: 'mensaje', claseMensaje, numero, tipo };

const relleno = (n: number): string => Array.from({ length: n }, () => '  lv_n = lv_n + 1.').join('\n');

function ejecutar(casos: Caso[]): void {
  for (const c of casos) {
    test(c.nombre, () => assert.deepEqual(evaluar(c.codigo), c.esperado));
  }
}

suite('diccionario-contexto', () => {
  suite('casos del brief', () => {
    ejecutar([
      { nombre: 'SELECT FROM tabla', codigo: 'SELECT * FROM ma|ra.', esperado: objeto('MARA') },
      { nombre: 'TYPE STANDARD TABLE OF', codigo: 'DATA lt TYPE STANDARD TABLE OF ma|ra.', esperado: objeto('MARA') },
      { nombre: 'TYPE REF TO es una clase', codigo: 'DATA lo TYPE REF TO zcl_x|.', esperado: undefined },
      { nombre: 'tabla-campo', codigo: "SELECT * FROM mara\n  WHERE mara-mt|art = 'FERT'.", esperado: campo('MARA', 'MTART') },
      {
        nombre: 'alias~campo con FROM … AS',
        codigo: "SELECT m~matnr FROM mara AS m\n  WHERE m~mt|art = 'FERT'.",
        esperado: campo('MARA', 'MTART'),
      },
      {
        nombre: 'variable declarada con TYPE tabla',
        codigo: "DATA ls_mara TYPE mara.\n\n\nls_mara-ma|tnr = '1'.",
        esperado: campo('MARA', 'MATNR'),
      },
      { nombre: 'variable sin declarar', codigo: 'ls_x-ca|mpo = 1.', esperado: undefined },
      { nombre: 'MESSAGE con clase entre paréntesis', codigo: 'MESSAGE e0|01(zmsg).', esperado: mensaje('ZMSG', '001', 'E') },
      {
        nombre: 'MESSAGE ID … TYPE … NUMBER',
        codigo: "MESSAGE ID 'ZMSG' TYPE 'E' NUMBER 00|2.",
        esperado: mensaje('ZMSG', '002', 'E'),
      },
      {
        nombre: 'MESSAGE sin paréntesis con MESSAGE-ID arriba',
        codigo: 'REPORT z MESSAGE-ID zmsg.\n\nSTART-OF-SELECTION.\n  MESSAGE e0|03 WITH lv_x.',
        esperado: mensaje('ZMSG', '003', 'E'),
      },
      { nombre: 'namespace tras TYPE', codigo: 'DATA ls TYPE /bobf/s_frw_ke|y.', esperado: objeto('/BOBF/S_FRW_KEY') },
      { nombre: 'palabra clave', codigo: 'SEL|ECT * FROM mara.', esperado: undefined },
    ]);
  });

  suite('objetos por palabra clave', () => {
    ejecutar([
      { nombre: 'JOIN', codigo: 'SELECT * FROM mara INNER JOIN ma|rc ON marc~matnr = mara~matnr.', esperado: objeto('MARC') },
      { nombre: 'UPDATE', codigo: 'UPDATE zt_ejem|plo SET campo = 1.', esperado: objeto('ZT_EJEMPLO') },
      { nombre: 'INSERT', codigo: 'INSERT zt_ejem|plo FROM ls_x.', esperado: objeto('ZT_EJEMPLO') },
      { nombre: 'INSERT INTO', codigo: 'INSERT INTO zt_ejem|plo VALUES ls_x.', esperado: objeto('ZT_EJEMPLO') },
      { nombre: 'MODIFY', codigo: 'MODIFY zt_ejem|plo FROM ls_x.', esperado: objeto('ZT_EJEMPLO') },
      { nombre: 'DELETE FROM', codigo: 'DELETE FROM zt_ejem|plo WHERE campo = 1.', esperado: objeto('ZT_EJEMPLO') },
      { nombre: 'TYPE simple', codigo: 'DATA lv TYPE mat|nr.', esperado: objeto('MATNR') },
      { nombre: 'LIKE tabla', codigo: 'DATA ls LIKE ma|ra.', esperado: objeto('MARA') },
      { nombre: 'TYPE TABLE OF', codigo: 'DATA lt TYPE TABLE OF ma|ra.', esperado: objeto('MARA') },
      { nombre: 'TYPE SORTED TABLE OF', codigo: 'DATA lt TYPE SORTED TABLE OF ma|ra WITH UNIQUE KEY matnr.', esperado: objeto('MARA') },
      { nombre: 'TYPE HASHED TABLE OF', codigo: 'DATA lt TYPE HASHED TABLE OF ma|ra WITH UNIQUE KEY matnr.', esperado: objeto('MARA') },
      { nombre: 'TYPE LINE OF', codigo: 'DATA ls TYPE LINE OF zt|t_ejemplo.', esperado: objeto('ZTT_EJEMPLO') },
      { nombre: 'INCLUDE STRUCTURE', codigo: '  INCLUDE STRUCTURE ma|ra.', esperado: objeto('MARA') },
      { nombre: 'INCLUDE TYPE', codigo: '  INCLUDE TYPE ma|ra.', esperado: objeto('MARA') },
      { nombre: 'TABLES', codigo: 'TABLES ma|ra.', esperado: objeto('MARA') },
      { nombre: 'TABLES encadenado', codigo: 'TABLES: mara, ma|rc.', esperado: objeto('MARC') },
      { nombre: 'minúsculas y espacios múltiples', codigo: 'data lt type   standard   table  of Ma|Ra.', esperado: objeto('MARA') },
      { nombre: 'cursor al final de la palabra', codigo: 'SELECT * FROM mara|.', esperado: objeto('MARA') },
      { nombre: 'TYPE LINE OF en la palabra LINE', codigo: 'DATA ls TYPE LI|NE OF ztt_ejemplo.', esperado: undefined },
      { nombre: 'palabra clave tras TYPE', codigo: 'DATA lt TYPE STANDARD TA|BLE OF mara.', esperado: undefined },
      { nombre: 'palabra clave tras DELETE', codigo: 'DELETE FR|OM zt_ejemplo.', esperado: undefined },
      { nombre: 'palabra clave tras INSERT', codigo: 'INSERT IN|TO zt_ejemplo VALUES ls.', esperado: undefined },
      { nombre: 'tipo predefinido', codigo: 'DATA lv TYPE stri|ng.', esperado: undefined },
      { nombre: 'TYPE RANGE OF', codigo: 'DATA lr TYPE RANGE OF mat|nr.', esperado: undefined },
      { nombre: 'TYPE REF TO tras TABLE OF', codigo: 'DATA lt TYPE TABLE OF REF TO zcl_|x.', esperado: undefined },
      { nombre: 'CREATE OBJECT … TYPE', codigo: 'CREATE OBJECT lo TYPE zcl_|x.', esperado: undefined },
      { nombre: 'RAISE EXCEPTION TYPE', codigo: 'RAISE EXCEPTION TYPE zcx_|x.', esperado: undefined },
      { nombre: 'TYPE clase=>tipo', codigo: 'DATA lv TYPE zcl_|x=>ty_y.', esperado: undefined },
      { nombre: 'CLASS', codigo: 'CLASS zcl_|x DEFINITION PUBLIC.', esperado: undefined },
      { nombre: 'INTERFACE', codigo: 'INTERFACE zif_|x PUBLIC.', esperado: undefined },
      { nombre: 'METHOD', codigo: 'METHOD me|th.', esperado: undefined },
      { nombre: 'FORM con TABLES', codigo: 'FORM f TABLES p|t_x STRUCTURE mara.', esperado: undefined },
      { nombre: 'PERFORM', codigo: 'PERFORM fo|rm_x TABLES lt.', esperado: undefined },
      { nombre: 'CALL FUNCTION', codigo: "CALL FUNCTION 'Z_EJEM|PLO'.", esperado: undefined },
      { nombre: 'INCLUDE sin STRUCTURE', codigo: 'INCLUDE zin|cl_ejemplo.', esperado: undefined },
      { nombre: 'INTO TABLE @DATA(lt)', codigo: 'SELECT * FROM mara INTO TABLE @DATA(l|t).', esperado: undefined },
      { nombre: 'INTO TABLE con variable', codigo: 'SELECT * FROM mara INTO TABLE lt_ma|ra.', esperado: undefined },
      { nombre: 'FROM @variable', codigo: 'SELECT * FROM @lt_ma|ra AS x INTO TABLE @DATA(lt).', esperado: undefined },
      { nombre: 'MODIFY de tabla interna', codigo: 'MODIFY lt_|x FROM ls_x INDEX 1.', esperado: undefined },
      { nombre: 'MODIFY de variable declarada', codigo: 'DATA wa TYPE mara.\nMODIFY w|a.', esperado: undefined },
      { nombre: 'TYPE de tipo local', codigo: 'TYPES ty_x TYPE mara.\nDATA ls TYPE ty|_x.', esperado: undefined },
      { nombre: 'número', codigo: 'DELETE lt FROM 1|0.', esperado: undefined },
      { nombre: 'cursor en espacios', codigo: 'SELECT * FROM  |  mara.', esperado: undefined },
    ]);
  });

  suite('comentarios y literales', () => {
    ejecutar([
      { nombre: 'línea de comentario', codigo: '* SELECT * FROM ma|ra.', esperado: undefined },
      { nombre: 'comentario de fin de línea', codigo: 'lv = 1. " FROM ma|ra', esperado: undefined },
      { nombre: 'literal con comillas simples', codigo: "WRITE 'FROM ma|ra'.", esperado: undefined },
      { nombre: 'literal con acentos graves', codigo: 'lv = `FROM ma|ra`.', esperado: undefined },
      { nombre: 'FROM dentro de un literal no cuenta', codigo: "WRITE: 'FROM', ma|ra.", esperado: undefined },
      { nombre: 'literal con comilla escapada', codigo: "WRITE 'it''s FROM', ma|ra.", esperado: undefined },
      { nombre: 'código tras un literal', codigo: "SELECT * FROM ma|ra WHERE mtart = 'FERT'.", esperado: objeto('MARA') },
      { nombre: 'comentario de fin de línea no tapa el código', codigo: 'SELECT * FROM ma|ra. " lectura', esperado: objeto('MARA') },
      { nombre: 'mensaje en comentario', codigo: '* MESSAGE e0|01(zmsg).', esperado: undefined },
    ]);

    test('plantilla de cadena', () => {
      const linea = 'lv = |FROM mara|.';
      assert.equal(contextoEn([linea], 0, linea.indexOf('mara') + 1), undefined);
    });
  });

  suite('campos', () => {
    ejecutar([
      { nombre: 'cursor en la parte de la tabla', codigo: 'mara-matnr = 1.\nma|ra-matnr = 1.', esperado: campo('MARA', 'MATNR') },
      { nombre: 'tabla-campo en estilo antiguo', codigo: 'IF mara-ma|tnr IS INITIAL.', esperado: campo('MARA', 'MATNR') },
      { nombre: 'TYPE tabla-campo', codigo: 'DATA lv TYPE mara-ma|tnr.', esperado: campo('MARA', 'MATNR') },
      { nombre: 'sy-*', codigo: 'IF sy-sub|rc <> 0.', esperado: undefined },
      { nombre: 'me->atributo-campo', codigo: 'lv = me->attr-ca|mpo.', esperado: undefined },
      { nombre: 'clase=>constante-campo', codigo: 'lv = zcl_x=>const-ca|mpo.', esperado: undefined },
      { nombre: 'componente anidado', codigo: 'DATA wa TYPE mara.\nlv = wa-sub-ca|mpo.', esperado: undefined },
      { nombre: 'símbolo de campo', codigo: 'lv = <fs>-ca|mpo.', esperado: undefined },
      { nombre: 'resta con espacios', codigo: 'lv = ma|ra - matnr.', esperado: undefined },
      { nombre: 'FIELD-SYMBOLS', codigo: 'FIELD-SYM|BOLS <fs> TYPE mara.', esperado: undefined },
      { nombre: 'END-OF-SELECTION', codigo: 'END-OF-SELEC|TION.', esperado: undefined },
      { nombre: 'MESSAGE-ID', codigo: 'REPORT z MESSAGE-|ID zmsg.', esperado: undefined },
      { nombre: 'convención gt_', codigo: 'gt_x-ca|mpo = 1.', esperado: undefined },
      { nombre: 'convención iv_', codigo: 'lv = iv_x-ca|mpo.', esperado: undefined },
      { nombre: 'convención cs_', codigo: 'cs_x-ca|mpo = 1.', esperado: undefined },
      { nombre: 'convención er_', codigo: 'er_x-ca|mpo = 1.', esperado: undefined },
      { nombre: 'TABLES', codigo: 'TABLES mara.\nmara-ma|tnr = 1.', esperado: campo('MARA', 'MATNR') },
      { nombre: 'variable sin prefijo con TYPE tabla', codigo: 'DATA wa TYPE mara.\nwa-ma|tnr = 1.', esperado: campo('MARA', 'MATNR') },
      { nombre: 'variable con TYPE no tabla', codigo: 'DATA wa TYPE string.\nwa-ca|mpo = 1.', esperado: undefined },
      { nombre: 'DATA encadenado', codigo: 'DATA: lt TYPE i,\n      wa TYPE marc.\nwa-we|rks = 1.', esperado: campo('MARC', 'WERKS') },
      { nombre: 'LIKE tabla', codigo: 'DATA ls_a LIKE mara.\nls_a-ma|tnr = 1.', esperado: campo('MARA', 'MATNR') },
      {
        nombre: 'LIKE LINE OF tabla interna',
        codigo: 'DATA lt_mara TYPE SORTED TABLE OF mara WITH UNIQUE KEY matnr.\nDATA ls_m LIKE LINE OF lt_mara.\nls_m-ma|tnr = 1.',
        esperado: campo('MARA', 'MATNR'),
      },
      { nombre: 'TYPE REF TO', codigo: 'DATA lo TYPE REF TO zcl_x.\nlo-at|tr = 1.', esperado: undefined },
      { nombre: 'TYPE RANGE OF', codigo: 'DATA lr TYPE RANGE OF matnr.\nlr-lo|w = 1.', esperado: undefined },
      { nombre: 'parámetro de método', codigo: 'METHODS m IMPORTING is_x TYPE mara.\nlv = is_x-ma|tnr.', esperado: campo('MARA', 'MATNR') },
      { nombre: 'VALUE(parámetro)', codigo: 'METHODS m IMPORTING VALUE(is_x) TYPE mara.\nlv = is_x-ma|tnr.', esperado: campo('MARA', 'MATNR') },
      { nombre: 'misma línea que la declaración', codigo: 'DATA ls_m TYPE mara. ls_m-ma|tnr = 1.', esperado: campo('MARA', 'MATNR') },
      { nombre: 'PARAMETERS', codigo: 'PARAMETERS p_x TYPE mara-matnr.\nlv = p_x-ca|mpo.', esperado: undefined },
      { nombre: 'SELECT-OPTIONS', codigo: 'SELECT-OPTIONS s_matnr FOR mara-matnr.\nlv = s_matnr-lo|w.', esperado: undefined },
      { nombre: 'BEGIN OF', codigo: 'DATA: BEGIN OF wa,\n  campo TYPE i,\n END OF wa.\nwa-ca|mpo = 1.', esperado: undefined },
      { nombre: 'DATA(x) en línea', codigo: 'DATA(wa) = VALUE mara( ).\nwa-ma|tnr = 1.', esperado: undefined },
      {
        nombre: '@DATA(x) de un SELECT … FROM',
        codigo: "SELECT SINGLE * FROM mara INTO @DATA(ls_m) WHERE matnr = '1'.\nls_m-mt|art = 1.",
        esperado: campo('MARA', 'MTART'),
      },
      {
        nombre: '@DATA(x) de un SELECT en varias líneas',
        codigo: "SELECT SINGLE *\n  FROM mara\n  WHERE matnr = '1'\n  INTO @DATA(ls_m).\nls_m-mt|art = 1.",
        esperado: campo('MARA', 'MTART'),
      },
      {
        nombre: '@DATA(x) de un SELECT con JOIN',
        codigo: 'SELECT SINGLE * FROM mara INNER JOIN marc ON marc~matnr = mara~matnr INTO @DATA(ls_m).\nls_m-we|rks = 1.',
        esperado: undefined,
      },
      { nombre: 'LOOP … INTO DATA(x)', codigo: 'LOOP AT lt INTO DATA(ls).\n  ls-we|rks = 1.', esperado: undefined },
    ]);
  });

  suite('alias', () => {
    ejecutar([
      {
        nombre: 'alias de JOIN',
        codigo: "SELECT * FROM mara AS m\n  INNER JOIN marc AS c ON c~matnr = m~matnr\n  WHERE c~we|rks = '1000'.",
        esperado: campo('MARC', 'WERKS'),
      },
      {
        nombre: 'alias declarado después en la misma sentencia',
        codigo: 'SELECT m~ma|tnr, m~mtart\n  FROM mara AS m\n  INTO TABLE @DATA(lt).',
        esperado: campo('MARA', 'MATNR'),
      },
      { nombre: 'cursor en el alias', codigo: 'SELECT * FROM mara AS m WHERE |m~mtart = 1.', esperado: campo('MARA', 'MTART') },
      { nombre: 'tabla sin alias', codigo: 'SELECT * FROM mara WHERE mara~ma|tnr = 1.', esperado: campo('MARA', 'MATNR') },
      { nombre: 'alias desconocido', codigo: 'lv = x~ca|mpo.', esperado: undefined },
      { nombre: 'componente de interfaz', codigo: 'zif_x~me|th( ).', esperado: undefined },
      { nombre: 'interfaz tras ->', codigo: 'lo->zif_x~at|tr = 1.', esperado: undefined },
    ]);
  });

  suite('mensajes', () => {
    ejecutar([
      { nombre: 'tipo S con DISPLAY LIKE', codigo: "MESSAGE s0|10(zmsg) DISPLAY LIKE 'E'.", esperado: mensaje('ZMSG', '010', 'S') },
      { nombre: 'cursor en la clase', codigo: 'MESSAGE e001(zm|sg).', esperado: mensaje('ZMSG', '001', 'E') },
      { nombre: 'cursor en MESSAGE', codigo: 'MESS|AGE i002(zmsg) WITH lv.', esperado: mensaje('ZMSG', '002', 'I') },
      { nombre: 'clase con namespace', codigo: 'MESSAGE w004(/ns/m|sg).', esperado: mensaje('/NS/MSG', '004', 'W') },
      {
        nombre: 'NUMBER entre comillas',
        codigo: "MESSAGE ID 'ZMSG' TYPE 'W' NUMBER '0|05' WITH lv.",
        esperado: mensaje('ZMSG', '005', 'W'),
      },
      {
        nombre: 'MESSAGE ID con variables',
        codigo: 'MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msg|no.',
        esperado: undefined,
      },
      { nombre: 'sin MESSAGE-ID', codigo: 'MESSAGE e0|03 WITH lv_x.', esperado: undefined },
      {
        nombre: 'MESSAGE-ID en la línea siguiente al REPORT',
        codigo: 'REPORT z_ejemplo\n  MESSAGE-ID zmsg.\nMESSAGE e0|07.',
        esperado: mensaje('ZMSG', '007', 'E'),
      },
      { nombre: 'MESSAGE con texto', codigo: "MESSAGE lv_|text TYPE 'I'.", esperado: undefined },
    ]);
  });

  suite('ventana de búsqueda hacia atrás', () => {
    test('LINEAS_ATRAS es 200', () => assert.equal(LINEAS_ATRAS, 200));

    ejecutar([
      {
        nombre: 'declaración a 200 líneas',
        codigo: `DATA ls_m TYPE mara.\n${relleno(199)}\nls_m-ma|tnr = 1.`,
        esperado: campo('MARA', 'MATNR'),
      },
      { nombre: 'declaración a 201 líneas', codigo: `DATA ls_m TYPE mara.\n${relleno(200)}\nls_m-ma|tnr = 1.`, esperado: undefined },
      {
        nombre: 'alias a 201 líneas',
        codigo: `SELECT * FROM mara AS m.\n${relleno(200)}\nlv = m~ma|tnr.`,
        esperado: undefined,
      },
      {
        nombre: 'MESSAGE-ID a 201 líneas',
        codigo: `REPORT z MESSAGE-ID zmsg.\n${relleno(200)}\nMESSAGE e0|01.`,
        esperado: undefined,
      },
    ]);
  });

  suite('revisión 1', () => {
    ejecutar([
      {
        nombre: 'componente de TYPES con el mismo nombre que su elemento',
        codigo: 'TYPES: BEGIN OF ty_x,\n  matnr TYPE mat|nr,',
        esperado: objeto('MATNR'),
      },
      {
        nombre: 'TYPE tras una estructura con un componente del mismo nombre',
        codigo: 'TYPES: BEGIN OF ty_x,\n  matnr TYPE matnr,\n END OF ty_x.\nDATA lv TYPE mat|nr.',
        esperado: objeto('MATNR'),
      },
      { nombre: 'parámetro con el mismo nombre que su tipo', codigo: 'METHODS m IMPORTING matnr TYPE mat|nr.', esperado: objeto('MATNR') },
      { nombre: 'DATA con el mismo nombre que su tipo', codigo: 'DATA matnr TYPE matnr.\nDATA lv TYPE mat|nr.', esperado: objeto('MATNR') },
      { nombre: 'READ TABLE … FROM', codigo: 'READ TABLE lt INTO ls FROM w|a.', esperado: undefined },
      { nombre: 'MODIFY tabla FROM área', codigo: 'MODIFY zt_x FROM w|a.', esperado: undefined },
      { nombre: 'INSERT tabla FROM área', codigo: 'INSERT zt_x FROM w|a.', esperado: undefined },
      { nombre: 'UPDATE tabla FROM área', codigo: 'UPDATE zt_x FROM w|a.', esperado: undefined },
      { nombre: 'DELETE tabla FROM área', codigo: 'DELETE zt_x FROM w|a.', esperado: undefined },
      { nombre: 'DELETE ADJACENT DUPLICATES FROM', codigo: 'DELETE ADJACENT DUPLICATES FROM i|tab.', esperado: undefined },
      { nombre: 'APPEND LINES OF … FROM', codigo: 'APPEND LINES OF itab FROM i|dx TO itab2.', esperado: undefined },
      { nombre: 'DELETE FROM tabla', codigo: 'DELETE FROM ma|ra WHERE matnr = lv.', esperado: objeto('MARA') },
      { nombre: 'FROM en la línea siguiente al SELECT', codigo: 'SELECT *\n  FROM ma|ra\n  INTO TABLE @DATA(lt).', esperado: objeto('MARA') },
      {
        nombre: 'FROM de una subconsulta',
        codigo: 'SELECT * FROM mara WHERE matnr IN ( SELECT matnr FROM ma|rc ) INTO TABLE @DATA(lt).',
        esperado: objeto('MARC'),
      },
      { nombre: 'SELECT tras otra sentencia en la misma línea', codigo: 'CLEAR lv. SELECT * FROM ma|ra.', esperado: objeto('MARA') },
      { nombre: 'MODIFY tras un SELECT en la misma línea', codigo: 'SELECT * FROM mara. MODIFY zt_x FROM w|a.', esperado: undefined },
      { nombre: 'WITH', codigo: 'WITH +cte AS ( SELECT matnr FROM ma|ra )\n  SELECT * FROM +cte INTO TABLE @DATA(lt).', esperado: objeto('MARA') },
      { nombre: 'INHERITING FROM', codigo: 'CLASS lcl DEFINITION INHERITING FROM zcl_ba|se.', esperado: undefined },
      { nombre: 'convención mt_', codigo: 'lv = mt_data-ma|tnr.', esperado: undefined },
      { nombre: 'convención rs_', codigo: 'lv = rs_result-ma|tnr.', esperado: undefined },
      { nombre: 'convención ps_', codigo: 'lv = ps_x-ma|tnr.', esperado: undefined },
      { nombre: 'separador tabulador', codigo: 'SELECT *\tFROM\tma|ra.', esperado: objeto('MARA') },
      {
        nombre: 'cuerpo de método sangrado en varias líneas',
        codigo:
          'METHOD leer.\n    DATA ls_m TYPE mara.\n    SELECT SINGLE *\n      FROM mara\n      INTO @ls_m.\n' +
          "    IF ls_m-mt|art = 'FERT'.\n    ENDIF.\nENDMETHOD.",
        esperado: campo('MARA', 'MTART'),
      },
    ]);
  });

  suite('límites', () => {
    test('campo: expresion es el texto original de la base al campo, con el cursor en el campo o en la base', () => {
      const lineas = ['DATA ls_mara TYPE mara.', "IF ls_Mara-mtart = 'FERT'."];
      const enCampo = contextoEn(lineas, 1, lineas[1].indexOf('mtart') + 2);
      const enBase = contextoEn(lineas, 1, lineas[1].indexOf('ls_Mara') + 1);
      assert.deepEqual(enCampo, { clase: 'campo', tabla: 'MARA', campo: 'MTART', expresion: 'ls_Mara-mtart' });
      assert.deepEqual(enBase, enCampo);
    });

    test('campo con alias: expresion conserva la tilde', () => {
      const linea = 'SELECT * FROM mara AS m WHERE m~mtart = 1.';
      assert.deepEqual(contextoEn([linea], 0, linea.indexOf('m~mtart') + 3), {
        clase: 'campo', tabla: 'MARA', campo: 'MTART', expresion: 'm~mtart',
      });
    });

    test('fila fuera de rango', () => assert.equal(contextoEn(['SELECT * FROM mara.'], 3, 0), undefined));
    test('columna fuera de rango', () => assert.equal(contextoEn(['SELECT * FROM mara.'], 0, 99), undefined));
    test('línea larga sin estructura responde rápido', () => {
      const linea = `SELECT ${'a-'.repeat(5000)}x ${'FROM '.repeat(2000)}mara`;
      const inicio = Date.now();
      assert.deepEqual(contextoEn([linea], 0, linea.length - 1), objeto('MARA'));
      assert.ok(Date.now() - inicio < 500);
    });
  });
});
