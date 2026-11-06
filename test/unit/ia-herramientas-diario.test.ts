import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AlmacenDiario } from '../../src/ia/diario';
import { identidadDeUri, type IdentidadDiario } from '../../src/ia/diario-modelo';
import { ESQUEMAS } from '../../src/ia/esquemas';
import { MSG_SEGMENTOS_RELATIVOS } from '../../src/ia/herramientas';
import { ORDEN_DIARIO, crearCatalogoDiario, type DependenciasDiario } from '../../src/ia/herramientas-diario';
import type { HerramientaMcp } from '../../src/ia/mcp-modelo';

const BASE = 'abap:/repotree-v1/DEST/System Library/ZPAQ1/Source Code Library';
const URI = `${BASE}/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap`;
const URI_INCLUDE = `${BASE}/Includes/ZPROG_EJEMPLO_F01/zprog_ejemplo_f01.prog.abap`;
const URI_FUGR = `${BASE}/Function Groups/ZGRP_EJEMPLO/zgrp_ejemplo.fugr.z_fm_ejemplo.func.abap`;
const ID_PROG: IdentidadDiario = { destino: 'DEST', codigo: 'PROG', nombre: 'ZPROG_EJEMPLO' };

function dependenciasDe(
  almacen: AlmacenDiario,
  identidadDe: (uri: string) => IdentidadDiario | undefined = identidadDeUri,
): DependenciasDiario {
  return {
    leer: (id) => almacen.leer(id),
    anotar: (id, entrada) => almacen.anotar(id, entrada),
    rutaDe: (id) => almacen.rutaDe(id),
    identidadDe,
  };
}

suite('IA: herramientas del diario', () => {
  let dir: string;
  let catalogo: HerramientaMcp[];

  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sextante-herr-diario-'));
    catalogo = crearCatalogoDiario(dependenciasDe(new AlmacenDiario({ carpetaBase: dir })));
  });

  teardown(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function herramienta(nombre: string): HerramientaMcp {
    const h = catalogo.find((x) => x.nombre === nombre);
    assert.ok(h, `falta ${nombre}`);
    return h;
  }

  test('uri con destino que escapa de la carpeta: error y no se crea nada', async () => {
    const uri = 'abap:/repotree-v1/..\\..\\evil/System Library/ZPAQ1/Source Code Library/Programs/ZPROG_EJEMPLO/zprog_ejemplo.prog.abap';
    for (const nombre of ['anotar_diario', 'diario_objeto']) {
      const r = await herramienta(nombre).ejecutar({ uri, texto: 'x' });
      assert.equal(r.esError, true, nombre);
    }
    assert.equal(fs.existsSync(path.join(path.dirname(dir), 'evil')), false);
    assert.equal(fs.readdirSync(dir).length, 0);
  });

  test('diario_objeto convierte un fallo de rutaDe en error de herramienta', async () => {
    const roto = crearCatalogoDiario({
      leer: async () => undefined,
      anotar: async () => ({ ruta: 'x', entradas: 1 }),
      rutaDe: () => {
        throw new Error('ruta del diario fuera de la carpeta base');
      },
      identidadDe: identidadDeUri,
    });
    const h = roto.find((x) => x.nombre === 'diario_objeto');
    assert.ok(h);
    const r = await h.ejecutar({ uri: URI });
    assert.equal(r.esError, true);
    assert.equal(r.texto, 'no se pudo leer el diario: ruta del diario fuera de la carpeta base');
  });

  test('ORDEN_DIARIO coincide con el catálogo y cada herramienta tiene su esquema', () => {
    assert.deepEqual(
      catalogo.map((h) => h.nombre),
      [...ORDEN_DIARIO],
    );
    for (const h of catalogo) {
      assert.equal(h.inputSchema, ESQUEMAS[h.nombre as keyof typeof ESQUEMAS]);
    }
  });

  test('diario_objeto sin diario devuelve entradas 0 con indicación y no es error', async () => {
    const r = await herramienta('diario_objeto').ejecutar({ uri: URI });
    assert.equal(r.esError, undefined);
    const j = JSON.parse(r.texto) as Record<string, unknown>;
    assert.equal(j.entradas, 0);
    assert.equal(j.texto, '');
    assert.equal(j.recortado, false);
    assert.equal(j.objeto, 'ZPROG_EJEMPLO');
    assert.equal(j.tipo, 'PROG');
    assert.equal(j.sistema, 'DEST');
    assert.equal(j.indicacion, 'este objeto no tiene diario todavía');
  });

  test('tras anotar_diario, diario_objeto devuelve la nota', async () => {
    const a = await herramienta('anotar_diario').ejecutar({ uri: URI, texto: 'Revisé la validación\ny quedó bien' });
    assert.equal(a.esError, undefined);
    assert.equal((JSON.parse(a.texto) as { entradas: number }).entradas, 1);
    const r = await herramienta('diario_objeto').ejecutar({ uri: URI });
    const j = JSON.parse(r.texto) as { entradas: number; texto: string; recortado: boolean; indicacion?: string };
    assert.equal(j.entradas, 1);
    assert.ok(j.texto.includes('Revisé la validación'));
    assert.equal(j.recortado, false);
    assert.equal(j.indicacion, undefined);
  });

  test('anotar_diario con uri de include escribe en el diario del include', async () => {
    const r = await herramienta('anotar_diario').ejecutar({ uri: URI_INCLUDE, texto: 'nota' });
    const { archivo } = JSON.parse(r.texto) as { archivo: string };
    assert.equal(archivo, path.join(dir, 'DEST', 'INCL-ZPROG_EJEMPLO_F01.md'));
    assert.ok(fs.existsSync(archivo));
  });

  test('con identidadDe inyectado, el include del programa mostrado anota y lee en el diario del programa', async () => {
    const conVista = crearCatalogoDiario(
      dependenciasDe(new AlmacenDiario({ carpetaBase: dir }), (uri) => (uri === URI_INCLUDE ? ID_PROG : identidadDeUri(uri))),
    );
    const anotar = conVista.find((x) => x.nombre === 'anotar_diario');
    const leer = conVista.find((x) => x.nombre === 'diario_objeto');
    assert.ok(anotar && leer);
    const a = await anotar.ejecutar({ uri: URI_INCLUDE, texto: 'nota del F01' });
    assert.equal(a.esError, undefined, a.texto);
    assert.equal((JSON.parse(a.texto) as { archivo: string }).archivo, path.join(dir, 'DEST', 'PROG-ZPROG_EJEMPLO.md'));
    const j = JSON.parse((await leer.ejecutar({ uri: URI_INCLUDE })).texto) as { objeto: string; tipo: string; texto: string };
    assert.equal(j.objeto, 'ZPROG_EJEMPLO');
    assert.equal(j.tipo, 'PROG');
    assert.ok(j.texto.includes('nota del F01'));
    assert.equal(fs.existsSync(path.join(dir, 'DEST', 'INCL-ZPROG_EJEMPLO_F01.md')), false);
  });

  test('anotar_diario con texto solo de espacios es error y no escribe nada', async () => {
    const r = await herramienta('anotar_diario').ejecutar({ uri: URI, texto: '  \n\t ' });
    assert.equal(r.esError, true);
    assert.equal(r.texto, 'el texto de la nota está vacío');
    assert.equal(fs.readdirSync(dir).length, 0);
  });

  test('anotar_diario con uri de archivo de grupo de funciones escribe en el diario del grupo', async () => {
    const r = await herramienta('anotar_diario').ejecutar({ uri: URI_FUGR, texto: 'nota' });
    const { archivo } = JSON.parse(r.texto) as { archivo: string };
    assert.equal(archivo, path.join(dir, 'DEST', 'FUGR-ZGRP_EJEMPLO.md'));
  });

  test('uri con segmentos relativos se rechaza en ambas', async () => {
    const mala = `${BASE}/Programs/../ZPROG_EJEMPLO/zprog_ejemplo.prog.abap`;
    for (const nombre of ORDEN_DIARIO) {
      const r = await herramienta(nombre).ejecutar({ uri: mala, texto: 'x' });
      assert.equal(r.esError, true);
      assert.equal(r.texto, MSG_SEGMENTOS_RELATIVOS);
    }
  });

  test('uri sin objeto abap es error en ambas', async () => {
    for (const nombre of ORDEN_DIARIO) {
      const r = await herramienta(nombre).ejecutar({ uri: 'abap:/repotree-v1/DEST', texto: 'x' });
      assert.equal(r.esError, true);
      assert.equal(r.texto, 'la uri no es de un objeto abap: del árbol de la oficial');
    }
  });

  test('un fallo del almacén en anotar_diario se devuelve como error', async () => {
    const roto = crearCatalogoDiario({
      leer: async () => undefined,
      rutaDe: () => 'x',
      anotar: async () => {
        throw new Error('disco lleno');
      },
      identidadDe: identidadDeUri,
    });
    const h = roto.find((x) => x.nombre === 'anotar_diario');
    assert.ok(h);
    const r = await h.ejecutar({ uri: URI, texto: 'x' });
    assert.equal(r.esError, true);
    assert.equal(r.texto, 'no se pudo escribir el diario: disco lleno');
  });
});
