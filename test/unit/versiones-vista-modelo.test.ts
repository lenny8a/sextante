import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { analizarVersiones, formatearFechaIso, type Version } from '../../src/adt/versiones-modelo';
import { piezasDe } from '../../src/adt/fuente-adt';
import {
  documentoDe,
  etiquetaVersion,
  hijosDe,
  paresParaDiff,
  raicesDe,
  tituloDiffVersion,
  type EstadoVersiones,
  type NodoVersiones,
  type PiezaVersiones,
} from '../../src/objeto/versiones-modelo';

const fecha = (iso: string): string => formatearFechaIso(iso, true);

const versiones = analizarVersiones(
  fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/adt/real/versiones-prog.xml'), 'utf8'),
);

function uriFalsa(scheme: string, ruta: string): vscode.Uri {
  return { scheme, path: ruta, query: '' } as vscode.Uri;
}

const uriClase = uriFalsa('abap', '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.abap');

function pieza(parcial: Partial<PiezaVersiones> = {}, nombre = 'ZCL_EJEMPLO'): PiezaVersiones {
  const [base] = piezasDe({ tipo: 'clase', nombre });
  return { pieza: base, estado: 'ok', versiones: versiones.slice(0, 2), ...parcial };
}

function estado(piezas: PiezaVersiones[]): EstadoVersiones {
  return {
    documento: { uri: uriClase, destino: 'DEST', nombre: 'ZCL_EJEMPLO', tipo: 'clase', extension: 'abap' },
    piezas,
  };
}

function nodo(p: PiezaVersiones, v: Version): NodoVersiones {
  return { clase: 'version', pieza: p, version: v };
}

function version(id: string, fechaIso: string, parcial: Partial<Version> = {}): Version {
  return { id, activa: id === '00000', autor: 'USUARIO_1', fecha: fechaIso, src: `/v/${id}`, ...parcial };
}

suite('Versiones: modelo de la vista', () => {
  test('sin documento, un aviso sinDocumento', () => {
    const [aviso] = raicesDe({ piezas: [], motivoVacio: 'sinDocumento' });
    assert.equal(aviso.clase === 'aviso' && aviso.motivo, 'sinDocumento');
  });

  test('una pieza ok muestra sus versiones sin nodo pieza', () => {
    const raices = raicesDe(estado([pieza()]));
    assert.equal(raices.length, 2);
    assert.ok(raices.every((n) => n.clase === 'version'));
  });

  test('varias piezas: la primera expandida y la noExiste omitida', () => {
    const piezas = piezasDe({ tipo: 'clase', nombre: 'ZCL_EJEMPLO' }).map((p, i): PiezaVersiones => ({
      pieza: p,
      estado: i === 4 ? 'noExiste' : i === 0 ? 'ok' : 'pendiente',
      versiones: i === 0 ? versiones.slice(0, 2) : [],
    }));
    assert.equal(piezas.length, 5);
    const raices = raicesDe(estado(piezas));
    assert.equal(raices.length, 4);
    assert.deepEqual(raices.map((n) => n.clase === 'pieza' && n.expandida), [true, false, false, false]);
    assert.equal(hijosDe(raices[0]).length, 2);
    assert.equal((hijosDe(raices[1])[0] as { motivo: string }).motivo, 'cargando');
  });

  test('la única pieza noExiste da un aviso noExiste', () => {
    const [aviso] = raicesDe(estado([pieza({ estado: 'noExiste', versiones: [] })]));
    assert.equal(aviso.clase === 'aviso' && aviso.motivo, 'noExiste');
  });

  test('pieza con error o sin conexión muestra un aviso', () => {
    const e = hijosDe({ clase: 'pieza', pieza: pieza({ estado: 'error', mensaje: 'HTTP 500' }), expandida: true });
    assert.deepEqual(e, [{ clase: 'aviso', texto: 'HTTP 500', motivo: 'error' }]);
    const c = hijosDe({ clase: 'pieza', pieza: pieza({ estado: 'sinConexion' }), expandida: true });
    assert.equal(c[0].clase === 'aviso' && c[0].motivo, 'conectar');
  });

  test('etiquetaVersion de la activa con orden', () => {
    const v = version('00000', '2026-10-01T10:00:00Z', { orden: 'DEVK900001', textoOrden: 'Descripción de ejemplo 1' });
    const e = etiquetaVersion(v, fecha);
    assert.equal(e.label, 'Activa');
    assert.equal(e.icono, 'circle-filled');
    assert.equal(e.contextValue, 'versionConOrden');
    assert.equal(e.description, '2026-10-01 10:00 · USUARIO_1 · DEVK900001  Descripción de ejemplo 1');
    assert.ok(e.tooltip.includes('\n'));
  });

  test('etiquetaVersion de una antigua sin orden', () => {
    const e = etiquetaVersion(version('00003', '2026-10-01T10:00:00Z'), fecha);
    assert.deepEqual([e.label, e.icono, e.contextValue, e.description], ['00003', 'history', 'version', '2026-10-01 10:00 · USUARIO_1']);
  });

  test('paresParaDiff', () => {
    const a = pieza();
    const b = pieza({}, 'ZCL_OTRO');
    const v1 = version('00001', '2026-10-01T10:00:00Z');
    const v2 = version('00002', '2026-10-02T10:00:00Z');
    const v3 = version('00003', '2026-10-03T10:00:00Z');
    assert.equal(paresParaDiff([nodo(a, v1)]), undefined);
    assert.equal(paresParaDiff([nodo(a, v1), nodo(a, v2), nodo(a, v3)]), undefined);
    assert.equal(paresParaDiff([nodo(a, v1), nodo(b, v2)]), undefined);
    assert.equal(paresParaDiff([nodo(a, v1), { clase: 'pieza', pieza: a, expandida: true }]), undefined);
    const par = paresParaDiff([nodo(a, v3), nodo(a, v1)]);
    assert.equal(par?.antigua.id, '00001');
    assert.equal(par?.nueva.id, '00003');
  });

  test('paresParaDiff con fecha igual desempata por id', () => {
    const a = pieza();
    const par = paresParaDiff([nodo(a, version('00005', '2026-10-01T10:00:00Z')), nodo(a, version('00004', '2026-10-01T10:00:00Z'))]);
    assert.equal(par?.antigua.id, '00004');
  });

  test('tituloDiffVersion', () => {
    const v3 = version('00003', '2026-10-01T10:00:00Z');
    const v0 = version('00000', '2026-10-05T10:00:00Z');
    assert.equal(tituloDiffVersion('Z', v3, 'editor', fecha), 'Z: 00003 (2026-10-01) ↔ editor');
    assert.equal(tituloDiffVersion('Z', v3, v0, fecha), 'Z: 00003 (2026-10-01) ↔ Activa (2026-10-05)');
    assert.equal(tituloDiffVersion('Z', v0, 'editor', fecha), 'Z: Activa (2026-10-05) ↔ editor');
  });

  test('documentoDe', () => {
    const include = uriFalsa('abap', '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Programs/ZPRG_EJEMPLO/zprg_ejemplo.prog.abap');
    assert.equal(documentoDe(include)?.tipo, 'programa');
    const inc = uriFalsa('abap', '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Includes/ZINC_EJEMPLO/zinc_ejemplo.prog.abap');
    assert.equal(documentoDe(inc)?.tipo, 'include');
    assert.equal(documentoDe(uriClase)?.destino, 'DEST');
    assert.equal(documentoDe(uriClase)?.nombre, 'ZCL_EJEMPLO');
    const json = uriFalsa('abap', '/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library/Classes/ZCL_EJEMPLO/zcl_ejemplo.clas.json');
    assert.equal(documentoDe(json), undefined);
    assert.equal(documentoDe(uriFalsa('file', '/tmp/a.abap')), undefined);
    assert.equal(documentoDe(undefined), undefined);
  });
});
