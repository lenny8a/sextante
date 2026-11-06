import * as assert from 'node:assert/strict';
import type { UriMinimo } from '../../src/bridge/adt-uri';
import {
  FILTROS_FIRMAS,
  destinoParaPaleta,
  mensajeSistemaSinRfc,
  posicionDeInsercion,
  receptorPara,
  reintentoComoInterfaz,
} from '../../src/firmas/cableado-modelo';
import { lectorDeLineas } from '../../src/firmas/contexto-llamada';
import type { PeticionInsertar } from '../../src/firmas/hover-modelo';
import type { FirmaMetodo } from '../../src/firmas/modelo';

function firmaMetodo(parcial: Partial<FirmaMetodo> = {}): FirmaMetodo {
  return {
    tipo: 'metodo',
    clase: 'CL_SALV_TABLE',
    nombre: 'DISPLAY',
    descripcion: '',
    estatico: false,
    visibilidad: 'publico',
    abstracto: false,
    excepcionesDeClase: false,
    parametros: [],
    excepciones: [],
    uriAdt: '/sap/bc/adt/oo/classes/cl_salv_table',
    ...parcial,
  };
}

function peticion(receptor: string): PeticionInsertar {
  return { destino: 'DEST', firma: { tipo: 'metodo', objeto: 'CL_SALV_TABLE', metodo: 'DISPLAY' }, receptor, fila: 3 };
}

suite('firmas cableado-modelo', () => {
  suite('posicionDeInsercion', () => {
    test('llamada de 3 líneas → la fila siguiente al punto, en una línea nueva', () => {
      const doc = lectorDeLineas([
        'REPORT zejemplo.',
        "CALL FUNCTION 'DDIF_FIELDINFO_GET'",
        '  EXPORTING',
        "    tabname = 'MARA'.",
        'WRITE lv_x.',
      ]);
      assert.deepEqual(posicionDeInsercion(doc, 1), { fila: 4, nuevaLinea: true });
    });

    test('línea en blanco → la misma fila, sin línea nueva', () => {
      const doc = lectorDeLineas(['REPORT zejemplo.', '  ', 'WRITE lv_x.']);
      assert.deepEqual(posicionDeInsercion(doc, 1), { fila: 1, nuevaLinea: false });
    });

    test('última línea del documento → la fila siguiente aunque no exista todavía', () => {
      const doc = lectorDeLineas(['REPORT zejemplo.', "CALL FUNCTION 'DDIF_FIELDINFO_GET'."]);
      assert.deepEqual(posicionDeInsercion(doc, 1), { fila: 2, nuevaLinea: true });
    });

    test('sentencia sin punto → la fila del cursor, marcada sin fin', () => {
      const doc = lectorDeLineas(['REPORT zejemplo.', "CALL FUNCTION 'DDIF_FIELDINFO_GET'"]);
      assert.deepEqual(posicionDeInsercion(doc, 1), { fila: 1, nuevaLinea: false, sinFin: true });
    });
  });

  suite('FILTROS_FIRMAS', () => {
    test('solo módulo de funciones (el primero, el inicial), clase e interfaz', () => {
      assert.deepEqual(FILTROS_FIRMAS.map((f) => [f.id, f.tipoAdt]), [
        ['funcion', 'FUGR/FF'],
        ['clase', 'CLAS/OC'],
        ['interfaz', 'INTF/OI'],
      ]);
    });
  });

  suite('destinoParaPaleta', () => {
    const uriAbap = (destino: string): UriMinimo => ({
      scheme: 'abap',
      path: `/repotree-v1/${destino}/System Library/ZPAQ1/Programas/Programas/ZR_EJEMPLO/zr_ejemplo.prog.abap`,
    });
    const conDiccionario = (uri: UriMinimo): string | undefined => (uri.path.includes('/DEST/') ? 'DEST' : undefined);

    test('editor abap: con diccionario → su propio sistema, aunque el activo sea otro', () => {
      assert.deepEqual(destinoParaPaleta(uriAbap('DEST'), conDiccionario, () => 'OTRO'), { destino: 'DEST' });
    });

    test('editor abap: sin diccionario (SSO, SNC, sin RFC) → aviso, nunca el sistema activo', () => {
      assert.deepEqual(destinoParaPaleta(uriAbap('DEST_SSO'), conDiccionario, () => 'DEST'), { motivo: 'editorSinRfc' });
    });

    test('editor que no es abap: → el sistema activo; sin activo, aviso', () => {
      const borrador: UriMinimo = { scheme: 'untitled', path: 'Untitled-1' };
      assert.deepEqual(destinoParaPaleta(borrador, conDiccionario, () => 'DEST'), { destino: 'DEST' });
      assert.deepEqual(destinoParaPaleta(borrador, conDiccionario, () => undefined), { motivo: 'sinSistema' });
    });
  });

  suite('receptorPara', () => {
    test('el receptor del hover se conserva', () => {
      assert.equal(receptorPara(peticion('lo_alv'), firmaMetodo()), 'lo_alv');
    });

    test('una clase con => se conserva en un método estático', () => {
      assert.equal(receptorPara(peticion('cl_x=>'), firmaMetodo({ estatico: true })), 'cl_x=>');
    });

    test('sin receptor queda vacío para que decida el patrón', () => {
      assert.equal(receptorPara(peticion(''), firmaMetodo()), '');
    });

    test('=> sobre un método de instancia se descarta: decide el patrón', () => {
      assert.equal(receptorPara(peticion('cl_x=>'), firmaMetodo({ estatico: false })), '');
    });

    test('una petición de función no lleva receptor', () => {
      const deFuncion: PeticionInsertar = { destino: 'DEST', firma: { tipo: 'funcion', nombre: 'Z_EJEMPLO' }, receptor: 'lo_x', fila: 0 };
      assert.equal(receptorPara(deFuncion, firmaMetodo()), '');
    });
  });

  suite('reintentoComoInterfaz', () => {
    const comoClase = { destino: 'DEST', uriAdt: '/sap/bc/adt/oo/classes/zif_ejemplo', nombre: 'ZIF_EJEMPLO', tipoAdt: 'CLAS/OC' };

    test('una clase no localizada se reintenta como interfaz', () => {
      assert.deepEqual(reintentoComoInterfaz(comoClase, 'noLocalizado'), {
        destino: 'DEST', uriAdt: '/sap/bc/adt/oo/interfaces/zif_ejemplo', nombre: 'ZIF_EJEMPLO', tipoAdt: 'INTF/OI',
      });
    });

    test('una clase abierta, una función o una interfaz no se reintentan', () => {
      assert.equal(reintentoComoInterfaz(comoClase, 'abierto'), undefined);
      assert.equal(reintentoComoInterfaz({ ...comoClase, tipoAdt: 'FUGR/FF' }, 'noLocalizado'), undefined);
      assert.equal(reintentoComoInterfaz({ ...comoClase, tipoAdt: 'INTF/OI' }, 'noLocalizado'), undefined);
    });
  });

  suite('mensajeSistemaSinRfc', () => {
    test('nombra el sistema y dice por qué no hay firma', () => {
      assert.equal(mensajeSistemaSinRfc('DEST'), 'El sistema DEST no tiene conexión RFC; no se puede leer la firma');
    });
  });
});
