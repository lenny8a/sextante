import * as assert from 'assert';
import * as vscode from 'vscode';
import { ESQUEMA_FUENTE, type ClaveFuente } from '../../src/objeto/documento-fuente-modelo';
import { ProveedorFuente, uriFuente } from '../../src/objeto/documento-fuente';
import type { ResultadoFuente } from '../../src/objeto/servicio';

const CLAVE: ClaveFuente = {
  destino: 'DEV-X',
  ruta: '/sap/bc/adt/oo/classes/z_ejemplo_1/source/main',
  nombre: 'Z_EJEMPLO_1',
  extension: 'abap',
  etiqueta: 'clase',
};

async function abrirCon(resultado: ResultadoFuente, clave: ClaveFuente): Promise<vscode.TextDocument> {
  const proveedor = new ProveedorFuente({ fuente: async () => resultado });
  const registro = vscode.workspace.registerTextDocumentContentProvider(ESQUEMA_FUENTE, proveedor);
  try {
    return await vscode.workspace.openTextDocument(uriFuente(clave));
  } finally {
    registro.dispose();
    proveedor.dispose();
  }
}

suite('Documento de fuente de solo lectura', () => {
  test('muestra el texto y el nombre del archivo termina en .abap', async () => {
    const documento = await abrirCon({ estado: 'ok', texto: 'CLASS z_ejemplo_1 DEFINITION.' }, CLAVE);
    assert.strictEqual(documento.getText(), 'CLASS z_ejemplo_1 DEFINITION.');
    assert.ok(documento.fileName.endsWith('.abap'), documento.fileName);
  });

  test('un objeto que no existe muestra el aviso', async () => {
    const documento = await abrirCon({ estado: 'noExiste' }, { ...CLAVE, nombre: 'Z_EJEMPLO_2' });
    assert.ok(documento.getText().startsWith('* No se pudo leer'), documento.getText());
  });
});
