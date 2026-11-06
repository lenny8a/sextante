import * as assert from 'assert';
import * as vscode from 'vscode';
import type { ApiDePrueba } from '../../src/extension';
import { uriFuente } from '../../src/objeto/documento-fuente';

const COMANDOS_CABLEADOS = [
  'abapNavigator.objeto.ordenes',
  'abapNavigator.ordenes.refrescar',
  'abapNavigator.versiones.compararSeleccion',
  'abapNavigator.objeto.compararConfigurar',
];
/** No está en destinations.json: la fuente no tiene sesión y el documento lo dice sin pedir nada. */
const DESTINO_INEXISTENTE = 'DEST_INEXISTENTE';

async function api(): Promise<ApiDePrueba> {
  const extension = vscode.extensions.getExtension<ApiDePrueba>('lenny.sextante');
  assert.ok(extension, 'extensión no encontrada');
  return (await extension.activate()) as ApiDePrueba;
}

suite('Cableado del objeto activo', () => {
  test('activate devuelve el objeto activo en modo de pruebas', async () => {
    const { objetoActivo } = await api();
    assert.ok(objetoActivo, 'sin objetoActivo');
    assert.ok(objetoActivo.servicio);
    assert.ok(objetoActivo.proveedorFuente);
    assert.ok(objetoActivo.ordenes);
    assert.ok(objetoActivo.versiones);
  });

  test('registra los comandos de Órdenes, Versiones y Orden del objeto', async () => {
    await api();
    const registrados = await vscode.commands.getCommands(true);
    for (const id of COMANDOS_CABLEADOS) {
      assert.ok(registrados.includes(id), `no registrado: ${id}`);
    }
  });

  test('el esquema abap-navigator-fuente resuelve un documento de solo lectura', async () => {
    await api();
    const uri = uriFuente({
      destino: DESTINO_INEXISTENTE,
      ruta: '/sap/bc/adt/programs/programs/z_ejemplo/source/main',
      nombre: 'Z_EJEMPLO',
      extension: 'abap',
      etiqueta: DESTINO_INEXISTENTE,
    });
    const documento = await vscode.workspace.openTextDocument(uri);
    assert.match(documento.getText(), /^\* No se pudo leer Z_EJEMPLO de DEST_INEXISTENTE/);
  });

  test('Comparar con otro sistema sin objeto abierto devuelve sinObjeto', async () => {
    const { objetoActivo } = await api();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    assert.strictEqual(await objetoActivo?.compararSistemas(), 'sinObjeto');
    assert.strictEqual(await vscode.commands.executeCommand('abapNavigator.objeto.compararOtroSistema'), 'sinObjeto');
  });

  test('Elegir sistemas con los que comparar sin objeto abierto devuelve sinObjeto', async () => {
    await api();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    assert.strictEqual(await vscode.commands.executeCommand('abapNavigator.objeto.compararConfigurar'), 'sinObjeto');
  });
});
