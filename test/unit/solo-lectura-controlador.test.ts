import assert from 'node:assert/strict';
import { ESQUEMA_BLOQUE } from '../../src/bloques/bloque-modelo';
import type { RolSistema } from '../../src/config/navegador-config';
import {
  COMANDO_RESET_SOLO_LECTURA_SESION,
  COMANDO_SOLO_LECTURA_SESION,
} from '../../src/proteccion/comandos-solo-lectura';
import { ControladorSoloLectura } from '../../src/proteccion/solo-lectura-controlador';

const QAS = { scheme: 'abap', path: '/repotree-v1/QAS-X/ZPAQ1/x.clas.abap' };
const DEV = { scheme: 'abap', path: '/repotree-v1/DEV-X/ZPAQ1/x.clas.abap' };
const ARCHIVO = { scheme: 'file', path: '/tmp/x.ts' };
const SIN_TITULO = { scheme: 'untitled', path: 'Untitled-1' };
const BLOQUE_QAS = { scheme: ESQUEMA_BLOQUE, path: `${QAS.path}/METODO_2.method.abap` };
const BLOQUE_DEV = { scheme: ESQUEMA_BLOQUE, path: `${DEV.path}/FORM_1.form.abap` };

interface Entorno {
  comandos: string[];
  barra: string[];
  mensajes: string[];
  roles: Record<string, RolSistema>;
  controlador: ControladorSoloLectura;
}

function crear(falla = false): Entorno {
  const comandos: string[] = [];
  const barra: string[] = [];
  const mensajes: string[] = [];
  const roles: Record<string, RolSistema> = { 'QAS-X': 'QAS', 'DEV-X': 'DEV' };
  const controlador = new ControladorSoloLectura({
    ejecutar: async (comando) => {
      comandos.push(comando);
      if (falla) {
        throw new Error('detalle sensible');
      }
    },
    barra: {
      mostrar: (texto) => barra.push(`mostrar:${texto}`),
      ocultar: () => barra.push('ocultar'),
    },
    rolDe: (id) => roles[id],
    registrar: (mensaje) => mensajes.push(mensaje),
  });
  return { comandos, barra, mensajes, roles, controlador };
}

suite('ControladorSoloLectura', () => {
  test('abap QAS, archivo, abap QAS: el comando se ejecuta una sola vez', async () => {
    const e = crear();
    await e.controlador.evaluar(QAS);
    await e.controlador.evaluar(ARCHIVO);
    await e.controlador.evaluar(QAS);
    assert.deepEqual(e.comandos, [COMANDO_SOLO_LECTURA_SESION]);
    assert.deepEqual(e.barra, [
      'mostrar:$(lock) Solo lectura: sistema QAS',
      'ocultar',
      'mostrar:$(lock) Solo lectura: sistema QAS',
    ]);
  });

  test('abap DEV: sin comando y barra oculta', async () => {
    const e = crear();
    await e.controlador.evaluar(DEV);
    assert.deepEqual(e.comandos, []);
    assert.deepEqual(e.barra, ['ocultar']);
  });

  test('untitled y sin editor: sin comando', async () => {
    const e = crear();
    await e.controlador.evaluar(SIN_TITULO);
    await e.controlador.evaluar(undefined);
    assert.deepEqual(e.comandos, []);
  });

  test('si el comando falla no se muestra la barra, se permite reintentar y no se filtra el mensaje', async () => {
    const e = crear(true);
    await e.controlador.evaluar(QAS);
    await e.controlador.evaluar(QAS);
    assert.deepEqual(e.comandos, [COMANDO_SOLO_LECTURA_SESION, COMANDO_SOLO_LECTURA_SESION]);
    assert.ok(!e.barra.some((b) => b.startsWith('mostrar')));
    assert.ok(e.mensajes.every((m) => !m.includes('detalle sensible')));
  });

  test('reevaluar: QAS pasa a DEV, ejecuta el reset una vez y retira el uri', async () => {
    const e = crear();
    await e.controlador.evaluar(QAS);
    e.roles['QAS-X'] = 'DEV';
    assert.equal(await e.controlador.reevaluar(QAS), true);
    assert.equal(await e.controlador.reevaluar(QAS), false);
    assert.deepEqual(e.comandos, [COMANDO_SOLO_LECTURA_SESION, COMANDO_RESET_SOLO_LECTURA_SESION]);
    assert.equal(e.barra[e.barra.length - 1], 'ocultar');
  });

  test('reevaluarTodos: retira todos, resetea solo el activo y registra el resto', async () => {
    const e = crear();
    const otro = { scheme: 'abap', path: '/repotree-v1/QAS-X/ZPAQ1/y.clas.abap' };
    await e.controlador.evaluar(QAS);
    await e.controlador.evaluar(otro);
    e.roles['QAS-X'] = 'DEV';
    await e.controlador.reevaluarTodos([QAS, otro], QAS);
    assert.deepEqual(e.comandos, [
      COMANDO_SOLO_LECTURA_SESION,
      COMANDO_SOLO_LECTURA_SESION,
      COMANDO_RESET_SOLO_LECTURA_SESION,
    ]);
    assert.ok(e.mensajes.includes('Solo lectura: 1 editor sigue bloqueado hasta reabrirlos'));
    e.roles['QAS-X'] = 'QAS';
    await e.controlador.evaluar(otro);
    assert.equal(e.comandos.filter((c) => c === COMANDO_SOLO_LECTURA_SESION).length, 3);
  });

  test('reevaluar: DEV pasa a QAS protege el documento abierto', async () => {
    const e = crear();
    await e.controlador.evaluar(DEV);
    e.roles['DEV-X'] = 'QAS';
    assert.equal(await e.controlador.reevaluar(DEV), false);
    assert.deepEqual(e.comandos, [COMANDO_SOLO_LECTURA_SESION]);
  });

  test('editor de bloque: se protege según el sistema de su archivo origen', async () => {
    const e = crear();
    await e.controlador.evaluar(BLOQUE_DEV);
    assert.deepEqual(e.comandos, []);
    await e.controlador.evaluar(BLOQUE_QAS);
    assert.deepEqual(e.comandos, [COMANDO_SOLO_LECTURA_SESION]);
    assert.deepEqual(e.barra, ['ocultar', 'mostrar:$(lock) Solo lectura: sistema QAS']);
    e.roles['QAS-X'] = 'DEV';
    assert.equal(await e.controlador.reevaluar(BLOQUE_QAS), true);
  });
});
