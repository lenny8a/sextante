export interface PropiedadEsquema {
  type: 'string' | 'integer' | 'boolean' | 'array';
  description: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  enum?: string[];
  /** Solo con type 'array': cada elemento es un objeto con estas propiedades de texto, todas obligatorias. */
  items?: { type: 'object'; properties: Record<string, PropiedadEsquema>; required: string[]; additionalProperties: false };
  minItems?: number;
  maxItems?: number;
}

export interface EsquemaEntrada {
  type: 'object';
  properties: Record<string, PropiedadEsquema>;
  required?: string[];
  additionalProperties: false;
}

/** Anclado y sin caracteres de control; los espacios valen porque la oficial usa `System Library`. */
export const PATRON_URI_ABAP = '^abap:/repotree-v1/[^\\r\\n\\t]{1,500}$';
export const PATRON_NOMBRE_OBJETO = '^[A-Za-z0-9_/]{1,40}$';
export const PATRON_TCODE = '^[A-Za-z0-9_/]{1,20}$';
export const PATRON_SISTEMA = '^[A-Za-z0-9_\\-]{1,60}$';
export const PATRON_ID_PROPUESTA = '^[a-z0-9]{1,16}$';
/** Nombre de un objeto nuevo (o de su programa principal): hasta 40 caracteres o namespace /NS/NOMBRE. */
const PATRON_NOMBRE_CREABLE = '^(?:/[A-Za-z0-9_]{1,10}/[A-Za-z0-9_]{1,28}|[A-Za-z][A-Za-z0-9_]{0,39})$';

export type Validacion = { ok: true; args: Record<string, unknown> } | { ok: false; motivo: string };

function validarElemento(nombre: string, valor: unknown, items: NonNullable<PropiedadEsquema['items']>): string | undefined {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return `"${nombre}" debe ser un objeto`;
  const objeto = valor as Record<string, unknown>;
  for (const clave of items.required) {
    if (objeto[clave] === undefined) return `falta "${nombre}.${clave}"`;
  }
  for (const [clave, v] of Object.entries(objeto)) {
    const propiedad = Object.hasOwn(items.properties, clave) ? items.properties[clave] : undefined;
    if (propiedad === undefined) return `propiedad desconocida "${nombre}.${clave}"`;
    const motivo = validarPropiedad(`${nombre}.${clave}`, v, propiedad);
    if (motivo !== undefined) return motivo;
  }
  return undefined;
}

function validarPropiedad(nombre: string, valor: unknown, p: PropiedadEsquema): string | undefined {
  if (p.type === 'array') {
    if (!Array.isArray(valor)) return `"${nombre}" debe ser una lista`;
    if (p.minItems !== undefined && valor.length < p.minItems) return `"${nombre}" debe tener al menos ${p.minItems} elemento(s)`;
    if (p.maxItems !== undefined && valor.length > p.maxItems) return `"${nombre}" debe tener como máximo ${p.maxItems} elemento(s)`;
    if (p.items === undefined) return undefined;
    for (const [i, elemento] of valor.entries()) {
      const motivo = validarElemento(`${nombre}[${i}]`, elemento, p.items);
      if (motivo !== undefined) return motivo;
    }
    return undefined;
  }
  if (p.type === 'string') {
    if (typeof valor !== 'string') return `"${nombre}" debe ser texto`;
    if (p.pattern !== undefined && !new RegExp(p.pattern).test(valor)) {
      return `"${nombre}" no cumple el formato esperado`;
    }
    if (p.enum !== undefined && !p.enum.includes(valor)) {
      return `"${nombre}" debe ser uno de: ${p.enum.join(', ')}`;
    }
    return undefined;
  }
  if (p.type === 'boolean') {
    return typeof valor === 'boolean' ? undefined : `"${nombre}" debe ser booleano`;
  }
  if (typeof valor !== 'number' || !Number.isInteger(valor)) return `"${nombre}" debe ser un entero`;
  if (p.minimum !== undefined && valor < p.minimum) return `"${nombre}" debe ser al menos ${p.minimum}`;
  if (p.maximum !== undefined && valor > p.maximum) return `"${nombre}" debe ser como máximo ${p.maximum}`;
  return undefined;
}

export function validarArgs(esquema: EsquemaEntrada, args: unknown): Validacion {
  const entrada = args === undefined ? {} : args;
  if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) {
    return { ok: false, motivo: 'los argumentos deben ser un objeto' };
  }
  const objeto = entrada as Record<string, unknown>;
  for (const nombre of esquema.required ?? []) {
    if (objeto[nombre] === undefined) return { ok: false, motivo: `falta el argumento obligatorio "${nombre}"` };
  }
  for (const [nombre, valor] of Object.entries(objeto)) {
    const propiedad = Object.hasOwn(esquema.properties, nombre) ? esquema.properties[nombre] : undefined;
    if (propiedad === undefined) return { ok: false, motivo: `argumento desconocido "${nombre}"` };
    const motivo = validarPropiedad(nombre, valor, propiedad);
    if (motivo !== undefined) return { ok: false, motivo };
  }
  return { ok: true, args: objeto };
}

const URI: PropiedadEsquema = {
  type: 'string',
  pattern: PATRON_URI_ABAP,
  description: 'URI abap: completa tal como la devuelve contexto_actual o abrir_objeto',
};

const SISTEMA: PropiedadEsquema = {
  type: 'string',
  pattern: PATRON_SISTEMA,
  description: 'Sistema (destino) sobre el que actuar; si lo omites se usa el del editor activo y, si no, el sistema activo de Sextante',
};

export const ESQUEMAS: Record<
  | 'contexto_actual'
  | 'editores_abiertos'
  | 'abrir_objeto'
  | 'abrir_transaccion'
  | 'leer_programa'
  | 'leer_archivo'
  | 'estructura_objeto'
  | 'proponer_cambio'
  | 'estado_propuesta'
  | 'verificar_sintaxis'
  | 'ejecutar_atc'
  | 'ejecutar_unit_tests'
  | 'activar'
  | 'diario_objeto'
  | 'anotar_diario'
  | 'info_sistema'
  | 'crear_objeto',
  EsquemaEntrada
> = {
  contexto_actual: { type: 'object', properties: {}, additionalProperties: false },
  editores_abiertos: { type: 'object', properties: {}, additionalProperties: false },
  abrir_objeto: {
    type: 'object',
    properties: {
      nombre: { type: 'string', pattern: PATRON_NOMBRE_OBJETO, description: 'Nombre exacto del objeto ABAP que quieres abrir, por ejemplo un programa o una clase' },
      tipo: {
        type: 'string',
        enum: ['PROG', 'CLAS', 'INTF', 'FUGR', 'TABL', 'DDLS', 'INCL'],
        description: 'Tipo del objeto, para acotar la búsqueda si el nombre es ambiguo; si lo omites se buscan todos los tipos',
      },
      sistema: SISTEMA,
    },
    required: ['nombre'],
    additionalProperties: false,
  },
  abrir_transaccion: {
    type: 'object',
    properties: {
      tcode: { type: 'string', pattern: PATRON_TCODE, description: 'Código de la transacción cuyo programa quieres abrir, por ejemplo SE38' },
      sistema: SISTEMA,
    },
    required: ['tcode'],
    additionalProperties: false,
  },
  leer_programa: {
    type: 'object',
    properties: {
      uri: URI,
      incluirIncludes: { type: 'boolean', description: 'Si es true (por defecto) lee también los includes alcanzables desde el programa principal' },
      maxLineasPorArchivo: { type: 'integer', minimum: 1, maximum: 20000, description: 'Tope de líneas por archivo (por defecto 2000); si un archivo se corta, sigue con leer_archivo desde la línea indicada' },
    },
    required: ['uri'],
    additionalProperties: false,
  },
  leer_archivo: {
    type: 'object',
    properties: {
      uri: URI,
      desdeLinea: { type: 'integer', minimum: 1, description: 'Primera línea a leer, contando desde 1' },
      hastaLinea: { type: 'integer', minimum: 1, description: 'Última línea a leer, contando desde 1' },
    },
    required: ['uri', 'desdeLinea', 'hastaLinea'],
    additionalProperties: false,
  },
  estructura_objeto: {
    type: 'object',
    properties: { uri: URI },
    required: ['uri'],
    additionalProperties: false,
  },
  proponer_cambio: {
    type: 'object',
    properties: {
      uri: URI,
      resumen: {
        type: 'string',
        pattern: '^[^\\r\\n]{1,200}$',
        description: 'Una línea (hasta 200 caracteres) que explica qué cambia y por qué; es lo que el usuario lee primero al revisar la propuesta',
      },
      cambios: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        description: 'Úsalo para ediciones puntuales: lista de reemplazos aplicados en orden sobre el texto actual del archivo. Cada "buscar" debe aparecer exactamente una vez; si no, la propuesta se rechaza. Da este campo o textoCompleto, nunca los dos',
        items: {
          type: 'object',
          properties: {
            buscar: { type: 'string', description: 'Fragmento exacto del texto actual, con saltos de línea y sangría, lo bastante largo para ser único en el archivo' },
            reemplazar: { type: 'string', description: 'Texto que sustituye al fragmento; vacío para borrarlo' },
          },
          required: ['buscar', 'reemplazar'],
          additionalProperties: false,
        },
      },
      textoCompleto: {
        type: 'string',
        description: 'Úsalo solo si reescribes el archivo entero: el contenido final completo. Antes lee el archivo con leer_archivo o leer_programa. Da este campo o cambios, nunca los dos',
      },
      porque: {
        type: 'string',
        pattern: '^[\\s\\S]{1,1000}$',
        description: 'Motivo del cambio en una o dos frases; queda en el diario del objeto cuando el usuario decide',
      },
    },
    required: ['uri', 'resumen'],
    additionalProperties: false,
  },
  estado_propuesta: {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: PATRON_ID_PROPUESTA, description: 'Identificador que devolvió proponer_cambio; consúltalo para saber si el usuario aceptó, rechazó o sigue revisando' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  verificar_sintaxis: {
    type: 'object',
    properties: { uri: URI },
    required: ['uri'],
    additionalProperties: false,
  },
  ejecutar_atc: {
    type: 'object',
    properties: { uri: URI },
    required: ['uri'],
    additionalProperties: false,
  },
  ejecutar_unit_tests: {
    type: 'object',
    properties: { uri: URI },
    required: ['uri'],
    additionalProperties: false,
  },
  activar: {
    type: 'object',
    properties: {
      uri: URI,
      todo: {
        type: 'boolean',
        description:
          'Ponlo a true para activar el objeto completo (el programa y todos sus includes, o cualquier conjunto de objetos ' +
          'inactivos): Sextante abre la lista «Activate All» de la extensión oficial y el usuario marca y confirma ahí. ' +
          'Úsalo siempre que hayas creado o cambiado includes.',
      },
    },
    required: ['uri'],
    additionalProperties: false,
  },
  info_sistema: { type: 'object', properties: { sistema: SISTEMA }, additionalProperties: false },
  crear_objeto: {
    type: 'object',
    properties: {
      sistema: SISTEMA,
      tipo: {
        type: 'string',
        enum: ['PROG', 'INCL', 'CLAS', 'INTF', 'FUGR', 'TABL', 'DDLS'],
        description: 'Tipo que pide el usuario, solo para el cuadro guía: el tipo real lo elige el usuario en el asistente de SAP',
      },
      nombre: { type: 'string', pattern: PATRON_NOMBRE_CREABLE, description: 'Nombre del objeto nuevo, normalmente en el espacio de clientes (Z o Y); admite namespace /ABC/NOMBRE. Sextante lo deja en el portapapeles' },
      descripcion: { type: 'string', pattern: '^[^\r\n]{1,60}$', description: 'Descripción corta del objeto, de 1 a 60 caracteres' },
      programaPrincipal: {
        type: 'string',
        pattern: PATRON_NOMBRE_CREABLE,
        description:
          'Solo para includes de un programa que ya existe: Sextante crea el include directamente en el paquete y la orden de ese programa, con una confirmación del usuario. Sin él, la creación va por el asistente de SAP.',
      },
      relanzar: {
        type: 'boolean',
        description:
          'Ponlo a true solo si el usuario dice que cerró el asistente de SAP y quiere repetirlo: vuelve a mostrar el cuadro y relanza el asistente',
      },
    },
    required: ['nombre', 'descripcion'],
    additionalProperties: false,
  },
  diario_objeto: {
    type: 'object',
    properties: { uri: URI },
    required: ['uri'],
    additionalProperties: false,
  },
  anotar_diario: {
    type: 'object',
    properties: {
      uri: URI,
      texto: {
        type: 'string',
        pattern: '^[\\s\\S]{1,4000}$',
        description: 'Qué revisaste, qué decidiste y por qué, para un desarrollador que no estuvo en esta conversación; sin código',
      },
    },
    required: ['uri', 'texto'],
    additionalProperties: false,
  },
};
