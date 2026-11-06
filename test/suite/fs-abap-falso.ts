import * as vscode from 'vscode';

const ESQUEMA = 'abap';

export class EsquemaAbapOcupado extends Error {
  constructor() {
    super('el esquema abap: ya tiene proveedor (¿la extensión oficial está instalada en la instancia de pruebas?)');
    this.name = 'EsquemaAbapOcupado';
  }
}

function carpetaDe(ruta: string): string {
  return ruta.slice(0, ruta.lastIndexOf('/'));
}

/** Todas las carpetas antecesoras de cada archivo, incluida la raíz `/`. */
function carpetasDe(rutas: string[]): Set<string> {
  const carpetas = new Set<string>(['/']);
  for (const ruta of rutas) {
    for (let carpeta = carpetaDe(ruta); carpeta !== ''; carpeta = carpetaDe(carpeta)) {
      carpetas.add(carpeta);
    }
  }
  return carpetas;
}

export interface OpcionesFsAbapFalso {
  /** `writeFile` sobre un archivo existente guarda el contenido en el mapa (sin ella, `NoPermissions`). */
  escribible?: boolean;
}

/** Contenidos del último FS falso registrado: los tests leen aquí lo que la extensión escribió. */
let contenidosActuales: Map<string, Uint8Array> | undefined;

export function contenidoFalso(ruta: string): string | undefined {
  const contenido = contenidosActuales?.get(ruta);
  return contenido === undefined ? undefined : Buffer.from(contenido).toString('utf8');
}

function proveedorDe(contenidos: Map<string, Uint8Array>, opciones: OpcionesFsAbapFalso): vscode.FileSystemProvider {
  const fechas = new Map<string, number>();
  const carpetas = carpetasDe([...contenidos.keys()]);
  const emisor = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  const soloLectura = (uri: vscode.Uri): never => {
    throw vscode.FileSystemError.NoPermissions(uri);
  };
  const escribir = (uri: vscode.Uri, contenido: Uint8Array): void => {
    if (!opciones.escribible) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }
    if (!contenidos.has(uri.path)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    contenidos.set(uri.path, Uint8Array.from(contenido));
    fechas.set(uri.path, Date.now());
    emisor.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  };
  return {
    onDidChangeFile: emisor.event,
    watch: () => new vscode.Disposable(() => undefined),
    stat: (uri) => {
      const contenido = contenidos.get(uri.path);
      if (contenido !== undefined) {
        return { type: vscode.FileType.File, ctime: 0, mtime: fechas.get(uri.path) ?? 0, size: contenido.byteLength };
      }
      if (carpetas.has(uri.path)) {
        return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
      }
      throw vscode.FileSystemError.FileNotFound(uri);
    },
    readFile: (uri) => {
      const contenido = contenidos.get(uri.path);
      if (contenido === undefined) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      return contenido;
    },
    readDirectory: (uri) => {
      if (!carpetas.has(uri.path)) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      const prefijo = uri.path === '/' ? '/' : `${uri.path}/`;
      const entradas = new Map<string, vscode.FileType>();
      for (const ruta of [...contenidos.keys(), ...carpetas]) {
        if (ruta.startsWith(prefijo) && ruta.length > prefijo.length) {
          const resto = ruta.slice(prefijo.length);
          const nombre = resto.split('/')[0];
          const esArchivo = nombre === resto && contenidos.has(ruta);
          entradas.set(nombre, esArchivo ? vscode.FileType.File : vscode.FileType.Directory);
        }
      }
      return [...entradas];
    },
    createDirectory: soloLectura,
    writeFile: escribir,
    delete: soloLectura,
    rename: soloLectura,
  };
}

/**
 * Tras dar de baja un proveedor, `isWritableFileSystem` sigue informando el esquema (VS Code no olvida sus
 * capacidades). Una vez registrado el FS falso, solo vale el error síncrono de `registerFileSystemProvider`.
 */
let registradoAntes = false;

/**
 * Registra un `FileSystemProvider` para `abap:` que sirve una copia del mapa `{ ruta → contenido }`; de solo
 * lectura salvo con `escribible`. Lanza `EsquemaAbapOcupado` si el esquema ya tiene proveedor (la oficial presente
 * en la instancia).
 */
export function registrarFsAbapFalso(archivos: Record<string, string>, opciones: OpcionesFsAbapFalso = {}): vscode.Disposable {
  if (!registradoAntes && vscode.workspace.fs.isWritableFileSystem(ESQUEMA) !== undefined) {
    throw new EsquemaAbapOcupado();
  }
  const contenidos = new Map<string, Uint8Array>(
    Object.entries(archivos).map(([ruta, texto]) => [ruta, Buffer.from(texto, 'utf8')]),
  );
  try {
    const registro = vscode.workspace.registerFileSystemProvider(ESQUEMA, proveedorDe(contenidos, opciones), {
      isCaseSensitive: true,
    });
    registradoAntes = true;
    contenidosActuales = contenidos;
    return registro;
  } catch {
    throw new EsquemaAbapOcupado();
  }
}
