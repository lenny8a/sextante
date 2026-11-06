import * as vscode from 'vscode';
import type { ResultadoBusqueda } from '../adt/busqueda-modelo';
import { mensajeLegibleDe } from '../adt/excepcion-adt';
import { PREFIJOS_PROPIOS_POR_DEFECTO } from '../config/navegador-config';
import { log } from '../log';
import { nombreDeError } from '../util/errores';
import { contextoEn } from './contexto';
import { esPropio, filtrarUsos, type ResultadoUsos } from './donde-se-usa';
import {
  camposParaGenerar,
  generarCase,
  generarData,
  generarSelect,
  generarTablaInterna,
  generarTypes,
  MAX_VALORES_CASE_SIN_PREGUNTAR,
  tieneValoresFijos,
  type ObjetoConCampos,
} from './generar';
import { ventanaDe, type DependenciasHover } from './hover';
import { COMANDO_ABRIR_PANEL, COMANDO_CONECTAR, COMANDO_GENERAR_CASE } from './hover-modelo';
import { insertarEnCursor, insertarSnippetEnCursor } from './insertar';
import {
  admiteDatos,
  campoParaCargar,
  caseDeCampo,
  caseDeDominio,
  caseDeLectura,
  conCampoSeleccionado,
  etiquetaDe,
  hijosDe,
  iconoDe,
  idDe,
  nodosRaiz,
  nombreACopiar,
  resueltoDelCampo,
  resultadoDdl,
  resultadoUso,
  tieneCampos,
  type CampoSeleccionado,
  type EstadoDatos,
  type EstadoPanel,
  type EstadoUsos,
  type LecturaDominio,
  type NodoCampo,
  type NodoDiccionario,
  type ResultadoCase,
} from './panel-modelo';
import { FILAS_POR_PAGINA, type CampoResuelto } from './servicio';

export const RETARDO_CURSOR_MS = 250;
/** Si la respuesta llega antes (caché), el panel no pasa por «Cargando…». */
export const RETARDO_CARGANDO_MS = 150;
export const VISTA_DICCIONARIO = 'abapNavigator.diccionario';
export const CONTEXTO_FIJADO = 'abapNavigator.diccionario.fijado';
/** Verdadero mientras el panel muestra una tabla o estructura: habilita los generadores TYPES, DATA y tabla interna. */
export const CONTEXTO_CON_CAMPOS = 'abapNavigator.diccionario.conCampos';
/** Verdadero mientras el panel muestra una tabla: habilita «Ver datos» y «Generar SELECT». */
export const CONTEXTO_ES_TABLA = 'abapNavigator.diccionario.esTabla';

const COMANDO_FIJAR = 'abapNavigator.diccionario.fijar';
const COMANDO_SOLTAR = 'abapNavigator.diccionario.soltar';
const COMANDO_REFRESCAR = 'abapNavigator.diccionario.refrescar';
const COMANDO_COPIAR = 'abapNavigator.diccionario.copiarNombre';
const COMANDO_ABRIR_DDL = 'abapNavigator.diccionario.abrirDdl';
const COMANDO_VER_DATOS = 'abapNavigator.diccionario.verDatos';
const COMANDO_MAS_DATOS = 'abapNavigator.diccionario.masDatos';
const COMANDO_OCULTAR_DATOS = 'abapNavigator.diccionario.ocultarDatos';
const COMANDO_DONDE_SE_USA = 'abapNavigator.diccionario.dondeSeUsa';
const COMANDO_OCULTAR_USOS = 'abapNavigator.diccionario.ocultarUsos';
const COMANDO_ANADIR_PREFIJO = 'abapNavigator.diccionario.anadirPrefijoPropio';
const COMANDO_ABRIR_USO = 'abapNavigator.diccionario.abrirUso';
const AVISO_SIN_CONECTAR = 'Conéctate al sistema desde la vista Sistemas';
const AVISO_SIN_CAMPOS = 'No hay campos para generar el código';
const AVISO_SIN_EDITOR = 'Abre un editor para insertar el código';
const AVISO_ESTANDAR = 'Objeto estándar: puede tardar hasta un minuto';
const AVISO_SOLO_TABLAS_DATOS = 'Ver datos solo está disponible para tablas';
const AVISO_SOLO_TABLAS_SELECT = 'El SELECT solo se genera para tablas';
const OPCION_CONTINUAR = 'Continuar';
const AVISO_SIN_VALORES = 'El dominio no tiene valores fijos';
const OPCION_GENERAR = 'Generar';

export interface DependenciasPanel extends Omit<DependenciasHover, 'firmas'> {
  registrar?: (m: string) => void;
  /** Abre la sesión RFC del destino (Tarea 9: `sesiones.sesion`). */
  conectar?(destino: string): Promise<void>;
  /** Abre el objeto en la extensión oficial (Tarea 9: `abrirResultado`). */
  abrir?(r: ResultadoBusqueda): Promise<void>;
  /** Pregunta antes de buscar dónde se usa un objeto estándar; por defecto, un aviso con «Continuar». */
  confirmar?(mensaje: string): Promise<boolean>;
  /** Prefijos propios del destino (abap-navigator.json); por defecto Z e Y. */
  prefijosDe?(destino: string): string[];
  /** Guarda un prefijo propio más para el destino. */
  anadirPrefijo?(destino: string, prefijo: string): Promise<void>;
  /** Pregunta antes de generar un CASE de muchos valores; por defecto, un aviso con la acción. */
  preguntar?: (mensaje: string, accion: string) => Thenable<string | undefined>;
}

interface Peticion { destino: string; nombre: string }

/** Argumento del enlace «Generar CASE» del hover. */
interface PeticionCase { destino: string; dominio: string; variable?: string }

const TIPOS_GENERAR = ['types', 'select', 'data', 'tablaInterna'] as const;
type TipoGenerar = typeof TIPOS_GENERAR[number];

const COMANDOS_GENERAR: Readonly<Record<TipoGenerar, string>> = {
  types: 'abapNavigator.diccionario.generarTypes',
  select: 'abapNavigator.diccionario.generarSelect',
  data: 'abapNavigator.diccionario.generarData',
  tablaInterna: 'abapNavigator.diccionario.generarTablaInterna',
};

type Origen = 'cursor' | 'explicito';

/** Lo último que se llegó a mostrar con datos o motivo; «Cargando…» nunca se guarda aquí. */
interface Mostrado { estado: Omit<EstadoPanel, 'fijado'>; peticion: Peticion | undefined }

/** Las filas de un objeto: viven solo mientras se muestra ese objeto y nunca se registran ni se guardan. */
interface DatosDelObjeto { clave: string; estado: EstadoDatos }

/**
 * «Dónde se usa» de un objeto: vive solo mientras se muestra ese objeto. `completo` es la lista sin filtrar:
 * añadir un prefijo propio vuelve a filtrarla aquí, sin llamar al servicio (su caché puede haber caducado).
 */
interface UsosDelObjeto { clave: string; estado: EstadoUsos; completo?: ResultadoUsos }

/** El campo seleccionado y resuelto: vive solo mientras se muestra su tabla. */
interface CampoDelObjeto { clave: string; seleccionado: CampoSeleccionado }

function clave(p: Peticion): string {
  return `${p.destino}|${p.nombre.toUpperCase()}`;
}

/** Clave del objeto con catálogo de campos que muestra un estado; `undefined` si no muestra una tabla o estructura. */
function claveConCampos(estado: Omit<EstadoPanel, 'fijado'>): string | undefined {
  const { destino, resuelto, motivoVacio } = estado;
  if (motivoVacio !== undefined || destino === undefined || resuelto === undefined || !tieneCampos(resuelto.objeto.tipo)) {
    return undefined;
  }
  return clave({ destino, nombre: resuelto.objeto.nombre });
}

/** Clave del objeto con filas que muestra un estado; `undefined` si no muestra una tabla. */
function claveConDatos(estado: Omit<EstadoPanel, 'fijado'>): string | undefined {
  const { resuelto } = estado;
  return resuelto !== undefined && admiteDatos(resuelto.objeto.tipo) ? claveConCampos(estado) : undefined;
}

/** Clave del objeto que muestra un estado, sea del tipo que sea; `undefined` sin objeto. */
function claveObjeto(estado: Omit<EstadoPanel, 'fijado'>): string | undefined {
  const { destino, resuelto, motivoVacio } = estado;
  if (motivoVacio !== undefined || destino === undefined || resuelto === undefined) {
    return undefined;
  }
  return clave({ destino, nombre: resuelto.objeto.nombre });
}

async function confirmarConAviso(mensaje: string): Promise<boolean> {
  return (await vscode.window.showWarningMessage(mensaje, { modal: false }, OPCION_CONTINUAR)) === OPCION_CONTINUAR;
}

function esPeticion(valor: unknown): valor is Peticion {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }
  const { destino, nombre } = valor as Record<string, unknown>;
  return typeof destino === 'string' && destino !== '' && typeof nombre === 'string' && nombre !== '';
}

function destinoDelArgumento(valor: unknown): string | undefined {
  if (typeof valor !== 'object' || valor === null) {
    return undefined;
  }
  const { destino } = valor as Record<string, unknown>;
  return typeof destino === 'string' && destino !== '' ? destino : undefined;
}

function esPeticionCase(valor: unknown): valor is PeticionCase {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }
  const { destino, dominio, variable } = valor as Record<string, unknown>;
  return typeof destino === 'string' && destino !== '' && typeof dominio === 'string' && dominio !== ''
    && (variable === undefined || typeof variable === 'string');
}

function esNodo(valor: unknown): valor is NodoDiccionario {
  return typeof valor === 'object' && valor !== null && typeof (valor as Record<string, unknown>).clase === 'string';
}

export class PanelDiccionario implements vscode.TreeDataProvider<NodoDiccionario>, vscode.Disposable {
  private readonly emisor = new vscode.EventEmitter<NodoDiccionario | undefined | void>();
  /** Sin argumento, todo el árbol; con un nodo, solo ese (el campo recién resuelto). */
  readonly onDidChangeTreeData: vscode.Event<NodoDiccionario | undefined | void> = this.emisor.event;
  private estado: EstadoPanel = { fijado: false };
  /** Lo que muestra o está cargando el panel; evita repetir la misma consulta. */
  private actual: Peticion | undefined;
  private mostrado: Mostrado = { estado: {}, peticion: undefined };
  private secuencia = 0;
  private origenEnVuelo: Origen | undefined;
  private temporizadorCursor: ReturnType<typeof setTimeout> | undefined;
  private temporizadorCargando: ReturnType<typeof setTimeout> | undefined;
  private readonly suscripciones: vscode.Disposable[] = [];
  private datos: DatosDelObjeto | undefined;
  private secuenciaDatos = 0;
  private contextoConCampos = false;
  private contextoEsTabla = false;
  private usos: UsosDelObjeto | undefined;
  private secuenciaUsos = 0;
  private campo: CampoDelObjeto | undefined;
  private secuenciaCampo = 0;
  private abortoUsos: AbortController | undefined;
  /** Último «sin datos» registrado (destino y motivo): la línea solo se repite si cambia. */
  private ultimoSinDatos: string | undefined;

  constructor(private readonly deps: DependenciasPanel) {
    this.suscripciones.push(
      vscode.window.onDidChangeTextEditorSelection((e) => this.programar(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.programar(editor)),
    );
    void vscode.commands.executeCommand('setContext', CONTEXTO_FIJADO, false);
    void vscode.commands.executeCommand('setContext', CONTEXTO_CON_CAMPOS, false);
    void vscode.commands.executeCommand('setContext', CONTEXTO_ES_TABLA, false);
  }

  get destino(): string | undefined {
    return this.estado.destino;
  }

  /** Muestra un objeto pedido explícitamente (enlace del hover); vale también con el panel fijado. */
  async mostrar(destino: string, nombre: string): Promise<void> {
    await this.cargar({ destino, nombre }, false, 'explicito');
  }

  fijar(valor: boolean): void {
    if (valor) {
      clearTimeout(this.temporizadorCursor);
      if (this.origenEnVuelo === 'cursor') {
        // Lo que el cursor estaba trayendo ya no se muestra: se queda lo último mostrado.
        this.secuencia++;
        this.restaurar();
      }
    }
    this.estado = { ...this.estado, fijado: valor };
    void vscode.commands.executeCommand('setContext', CONTEXTO_FIJADO, valor);
    this.notificar();
    if (!valor) {
      this.programar(vscode.window.activeTextEditor);
    }
  }

  /** Vacía la caché del destino y vuelve a pedir lo que se muestra; si se ven filas, también las vuelve a pedir. */
  async refrescar(): Promise<void> {
    const peticion = this.actual;
    if (peticion === undefined) {
      this.notificar();
      return;
    }
    this.deps.servicio.vaciar(peticion.destino);
    this.campo = undefined;
    await this.cargar(peticion, true, 'explicito');
    const datos = this.datosVisibles();
    if (datos !== undefined) {
      await this.pedirDatos(datos.pedidas);
    }
    if (this.usosVisibles() !== undefined) {
      await this.pedirUsos();
    }
  }

  /** Pide las primeras FILAS_POR_PAGINA filas de la tabla mostrada, con todos los campos del catálogo; una estructura no tiene filas. */
  async verDatos(): Promise<void> {
    if (claveConDatos(this.estado) === undefined) {
      if (claveConCampos(this.estado) !== undefined) {
        void vscode.window.showInformationMessage(AVISO_SOLO_TABLAS_DATOS);
      }
      return;
    }
    await this.pedirDatos(FILAS_POR_PAGINA);
  }

  /** NO VERIFICADO: si Data Preview admite OFFSET; sin él se vuelve a pedir todo con FILAS_POR_PAGINA filas más. */
  async masDatos(): Promise<void> {
    const actuales = this.datosVisibles();
    if (actuales === undefined) {
      return;
    }
    const recibidas = actuales.datos?.filas.length ?? 0;
    const total = actuales.datos?.total;
    if (total !== undefined && recibidas >= total) {
      return;
    }
    await this.pedirDatos(recibidas + FILAS_POR_PAGINA);
  }

  ocultarDatos(): void {
    this.soltarDatos();
    this.notificar();
  }

  /** Busca dónde se usa el objeto mostrado; si no es propio, avisa antes porque puede tardar un minuto. */
  async dondeSeUsa(): Promise<void> {
    const claveActual = claveObjeto(this.estado);
    const { destino, resuelto } = this.estado;
    if (claveActual === undefined || destino === undefined || resuelto === undefined) {
      return;
    }
    if (!esPropio(resuelto.objeto.nombre, this.prefijos(destino))) {
      const confirmar = this.deps.confirmar ?? confirmarConAviso;
      if (!(await confirmar(AVISO_ESTANDAR))) {
        this.registrar('Diccionario: usos → cancelado (objeto estándar)');
        return;
      }
      if (claveObjeto(this.estado) !== claveActual) {
        return;
      }
    }
    await this.pedirUsos();
  }

  ocultarUsos(): void {
    this.soltarUsos();
    this.notificar();
  }

  /** Guarda el prefijo y vuelve a filtrar la lista completa que guarda el panel: nunca repite la petición. */
  async anadirPrefijoPropio(prefijo: string): Promise<void> {
    const claveActual = claveObjeto(this.estado);
    const destino = this.estado.destino;
    if (claveActual === undefined || destino === undefined || this.usos?.clave !== claveActual || this.usos.completo === undefined) {
      return;
    }
    if (this.deps.anadirPrefijo === undefined) {
      log.warn('Diccionario: guardar prefijos propios no está disponible');
      return;
    }
    await this.deps.anadirPrefijo(destino, prefijo);
    this.registrar('Diccionario: usos → prefijo propio añadido');
    const actual = this.usos;
    if (claveObjeto(this.estado) !== claveActual || actual?.clave !== claveActual || actual.completo === undefined) {
      return;
    }
    const resultado = filtrarUsos(actual.completo, this.prefijos(destino));
    this.usos = { ...actual, estado: { cargando: false, resultado } };
    this.notificar();
  }

  getTreeItem(nodo: NodoDiccionario): vscode.TreeItem {
    const etiqueta = etiquetaDe(nodo, this.estadoVisible());
    const colapso = {
      no: vscode.TreeItemCollapsibleState.None,
      abierto: vscode.TreeItemCollapsibleState.Expanded,
      cerrado: vscode.TreeItemCollapsibleState.Collapsed,
    }[etiqueta.colapsable];
    const item = new vscode.TreeItem(etiqueta.label, colapso);
    item.id = idDe(nodo);
    item.description = etiqueta.description;
    item.contextValue = etiqueta.contextValue;
    if (etiqueta.tooltip !== undefined) {
      item.tooltip = etiqueta.tooltipMarkdown ? new vscode.MarkdownString(etiqueta.tooltip) : etiqueta.tooltip;
    }
    const icono = iconoDe(nodo);
    if (icono !== undefined) {
      item.iconPath = new vscode.ThemeIcon(icono);
    }
    if (nodo.clase === 'vacio' && this.estado.motivoVacio === 'conectar' && this.estado.destino !== undefined) {
      item.command = { command: COMANDO_CONECTAR, title: 'Conectar', arguments: [{ destino: this.estado.destino }] };
    }
    if (nodo.clase === 'uso') {
      item.command = { command: COMANDO_ABRIR_USO, title: 'Abrir', arguments: [nodo] };
    }
    if (nodo.clase === 'anadirPrefijo') {
      item.command = { command: COMANDO_ANADIR_PREFIJO, title: 'Añadir a propios', arguments: [nodo] };
    }
    return item;
  }

  getChildren(nodo?: NodoDiccionario): NodoDiccionario[] {
    const estado = this.estadoVisible();
    return nodo === undefined ? nodosRaiz(estado) : hijosDe(nodo, estado);
  }

  /** El objeto de la cabecera, para los comandos lanzados desde el título de la vista. */
  cabecera(): NodoDiccionario | undefined {
    return nodosRaiz(this.estado).find((n) => n.clase === 'cabecera');
  }

  /** La tabla o estructura mostrada con su catálogo; `undefined` con otro tipo de objeto o sin objeto. */
  objetoConCampos(): ObjetoConCampos | undefined {
    const { resuelto } = this.estado;
    if (claveConCampos(this.estado) === undefined || resuelto === undefined) {
      return undefined;
    }
    return { tabla: resuelto.objeto.nombre, campos: resuelto.campos ?? [] };
  }

  /** Selección en el árbol: un único campo carga su elemento y su dominio, sin cambiar lo mostrado ni el fijado. */
  async seleccionar(seleccion: readonly NodoDiccionario[]): Promise<void> {
    const nodo = campoParaCargar(seleccion);
    if (nodo !== undefined) {
      await this.resolverCampo(nodo);
    }
  }

  /** Elemento y dominio de un campo de la tabla mostrada (`servicio.campo`, con su caché); `undefined` si no se pudo. */
  async resolverCampo(nodo: NodoCampo): Promise<CampoResuelto | undefined> {
    const claveActual = claveConCampos(this.estado);
    const destino = this.estado.destino;
    if (claveActual === undefined || destino === undefined) {
      return undefined;
    }
    const cargado = resueltoDelCampo(nodo, this.estadoVisible());
    if (cargado !== undefined) {
      return cargado;
    }
    const turno = ++this.secuenciaCampo;
    const resuelto = await this.deps.servicio.campo(destino, nodo.tabla, nodo.campo.nombre).catch(() => undefined);
    if (resuelto !== undefined && turno === this.secuenciaCampo && claveConCampos(this.estado) === claveActual) {
      this.campo = { clave: claveActual, seleccionado: { tabla: nodo.tabla, resuelto } };
      this.registrar(`Diccionario: campo → ${tieneValoresFijos(resuelto.dominio) ? 'con' : 'sin'} valores fijos`);
      this.emisor.fire(nodo);
    }
    return resuelto;
  }

  /** Verdadero si el panel muestra una tabla (con filas en la base de datos). */
  esTabla(): boolean {
    return claveConDatos(this.estado) !== undefined;
  }

  dispose(): void {
    clearTimeout(this.temporizadorCursor);
    clearTimeout(this.temporizadorCargando);
    this.abortoUsos?.abort();
    for (const s of this.suscripciones) {
      s.dispose();
    }
    this.emisor.dispose();
  }

  private programar(editor: vscode.TextEditor | undefined): void {
    clearTimeout(this.temporizadorCursor);
    if (editor === undefined || this.estado.fijado) {
      return;
    }
    this.temporizadorCursor = setTimeout(() => {
      this.seguir(editor).catch((error: unknown) => this.registrar(`Diccionario: panel → error ${nombreDeError(error)}`));
    }, RETARDO_CURSOR_MS);
  }

  /** Lo que no es un objeto del diccionario no cambia lo mostrado: el panel acompaña mientras se escribe. */
  private async seguir(editor: vscode.TextEditor): Promise<void> {
    if (this.estado.fijado || editor.document.isClosed) {
      return;
    }
    const destino = this.deps.destinoDe(editor.document.uri);
    if (destino === undefined) {
      return;
    }
    const posicion = editor.selection.active;
    const { lineas, fila } = ventanaDe(editor.document, posicion.line);
    const contexto = contextoEn(lineas, fila, posicion.character);
    if (contexto === undefined || contexto.clase === 'mensaje') {
      return;
    }
    const nombre = contexto.clase === 'objeto' ? contexto.nombre : contexto.tabla;
    await this.cargar({ destino, nombre }, false, 'cursor');
  }

  private async cargar(peticion: Peticion, forzar: boolean, origen: Origen): Promise<void> {
    if (!forzar && this.actual !== undefined && clave(this.actual) === clave(peticion) && this.estado.motivoVacio !== 'conectar') {
      return;
    }
    this.actual = peticion;
    this.origenEnVuelo = origen;
    const turno = ++this.secuencia;
    clearTimeout(this.temporizadorCargando);
    this.temporizadorCargando = setTimeout(() => {
      if (turno === this.secuencia) {
        this.estado = { fijado: this.estado.fijado, destino: peticion.destino, motivoVacio: 'cargando' };
        this.notificar();
      }
    }, RETARDO_CARGANDO_MS);
    let nuevo: Omit<EstadoPanel, 'fijado'> | undefined;
    try {
      nuevo = await this.resolver(peticion);
    } catch (error) {
      this.registrar(`Diccionario: panel → error ${nombreDeError(error)}`);
    }
    if (turno !== this.secuencia) {
      return;
    }
    clearTimeout(this.temporizadorCargando);
    this.origenEnVuelo = undefined;
    if (nuevo === undefined || (origen === 'cursor' && this.estado.fijado)) {
      // Objeto inexistente, sesión abriéndose, fallo o panel fijado: vuelve lo mostrado y se podrá pedir de nuevo.
      this.restaurar();
    } else {
      this.mostrado = { estado: nuevo, peticion };
      this.estado = { ...nuevo, fijado: this.estado.fijado };
      if (this.datos !== undefined && this.datos.clave !== claveConDatos(nuevo)) {
        // Otro objeto: sus filas no se arrastran.
        this.soltarDatos();
      }
      if (this.usos !== undefined && this.usos.clave !== claveObjeto(nuevo)) {
        // Otro objeto: su «Dónde se usa» tampoco; la respuesta en vuelo se descarta.
        this.soltarUsos();
      }
    }
    this.notificar();
  }

  private estadoVisible(): EstadoPanel {
    const datos = this.datosVisibles();
    const usos = this.usosVisibles();
    const visible: EstadoPanel = {
      ...this.estado,
      ...(datos === undefined ? {} : { datos }),
      ...(usos === undefined ? {} : { usos }),
    };
    const claveActual = claveConCampos(this.estado);
    return claveActual !== undefined && this.campo?.clave === claveActual ? conCampoSeleccionado(visible, this.campo.seleccionado) : visible;
  }

  /** «Dónde se usa» solo se ve sobre el objeto del que se pidió (no durante «Cargando…»). */
  private usosVisibles(): EstadoUsos | undefined {
    const claveActual = claveObjeto(this.estado);
    return claveActual !== undefined && this.usos?.clave === claveActual ? this.usos.estado : undefined;
  }

  private soltarUsos(): void {
    this.usos = undefined;
    this.secuenciaUsos++;
    this.abortoUsos?.abort();
    this.abortoUsos = undefined;
  }

  private prefijos(destino: string): string[] {
    return this.deps.prefijosDe?.(destino) ?? [...PREFIJOS_PROPIOS_POR_DEFECTO];
  }

  private async pedirUsos(): Promise<void> {
    const claveActual = claveObjeto(this.estado);
    const { destino, resuelto } = this.estado;
    if (claveActual === undefined || destino === undefined || resuelto === undefined) {
      return;
    }
    this.abortoUsos?.abort();
    const aborto = new AbortController();
    this.abortoUsos = aborto;
    const turno = ++this.secuenciaUsos;
    this.usos = { clave: claveActual, estado: { cargando: true } };
    this.notificar();
    let nuevos: UsosDelObjeto;
    try {
      const { completo, ...resultado } = await this.deps.servicio.usos(destino, resuelto.objeto.uriAdt, this.prefijos(destino), aborto.signal);
      nuevos = { clave: claveActual, estado: { cargando: false, resultado }, completo };
    } catch (error) {
      // El mensaje del servidor va a la interfaz, nunca al registro (el servicio ya registra la forma).
      nuevos = { clave: claveActual, estado: { cargando: false, error: { nombre: nombreDeError(error), mensaje: mensajeLegibleDe(error) } } };
    }
    if (turno !== this.secuenciaUsos) {
      return;
    }
    this.abortoUsos = undefined;
    this.usos = nuevos;
    this.notificar();
  }

  /** Las filas solo se ven sobre el objeto del que se pidieron (no durante «Cargando…»). */
  private datosVisibles(): EstadoDatos | undefined {
    const claveActual = claveConDatos(this.estado);
    return claveActual !== undefined && this.datos?.clave === claveActual ? this.datos.estado : undefined;
  }

  private soltarDatos(): void {
    this.datos = undefined;
    this.secuenciaDatos++;
  }

  /** Solo tablas: Data Preview no admite estructuras (verificado 2026-10-31). */
  private async pedirDatos(pedidas: number): Promise<void> {
    const claveActual = claveConDatos(this.estado);
    const { destino, resuelto } = this.estado;
    if (claveActual === undefined || destino === undefined || resuelto === undefined) {
      return;
    }
    const turno = ++this.secuenciaDatos;
    const previos = this.datos?.clave === claveActual ? this.datos.estado.datos : undefined;
    this.datos = { clave: claveActual, estado: { pedidas, cargando: true, ...(previos ? { datos: previos } : {}) } };
    this.notificar();
    const campos = (resuelto.campos ?? []).map((c) => c.nombre);
    let estado: EstadoDatos;
    try {
      const datos = await this.deps.servicio.datos(destino, resuelto.objeto.nombre, campos, pedidas);
      estado = { pedidas, cargando: false, datos };
    } catch (error) {
      // El mensaje del servidor va a la interfaz, nunca al registro (el servicio ya registra la forma).
      estado = { pedidas, cargando: false, error: { nombre: nombreDeError(error), mensaje: mensajeLegibleDe(error) } };
    }
    if (turno !== this.secuenciaDatos) {
      return;
    }
    this.datos = { clave: claveActual, estado };
    this.notificar();
  }

  private notificar(): void {
    const conCampos = claveConCampos(this.estado) !== undefined;
    if (conCampos !== this.contextoConCampos) {
      this.contextoConCampos = conCampos;
      void vscode.commands.executeCommand('setContext', CONTEXTO_CON_CAMPOS, conCampos);
    }
    const esTabla = this.esTabla();
    if (esTabla !== this.contextoEsTabla) {
      this.contextoEsTabla = esTabla;
      void vscode.commands.executeCommand('setContext', CONTEXTO_ES_TABLA, esTabla);
    }
    this.emisor.fire();
  }

  private restaurar(): void {
    clearTimeout(this.temporizadorCargando);
    this.origenEnVuelo = undefined;
    this.actual = this.mostrado.peticion;
    this.estado = { ...this.mostrado.estado, fijado: this.estado.fijado };
  }

  /** `undefined` = no hay nada nuevo que mostrar. */
  private async resolver({ destino, nombre }: Peticion): Promise<Omit<EstadoPanel, 'fijado'> | undefined> {
    const { servicio } = this.deps;
    const resuelto = await servicio.objeto(destino, nombre);
    if (resuelto === undefined) {
      const guardada = await this.deps.credencialGuardada(destino);
      const motivo = guardada ? 'credencial guardada' : 'conectar';
      if (this.ultimoSinDatos !== `${destino}|${motivo}`) {
        this.ultimoSinDatos = `${destino}|${motivo}`;
        this.registrar(`Diccionario: panel → sin datos (${motivo})`);
      }
      return guardada ? undefined : { destino, motivoVacio: 'conectar' };
    }
    this.ultimoSinDatos = undefined;
    if (resuelto.objeto.tipo !== 'elementoDatos') {
      this.registrar(`Diccionario: panel → ${resuelto.objeto.tipo} (${resuelto.campos?.length ?? 0} campos)`);
      return { destino, resuelto };
    }
    const elemento = await servicio.elementoDatos(destino, resuelto.objeto.nombre).catch(() => undefined);
    const dominio = elemento?.dominio ? await servicio.dominio(destino, elemento.dominio).catch(() => undefined) : undefined;
    this.registrar(`Diccionario: panel → elementoDatos (${dominio ? 'con' : 'sin'} dominio)`);
    return {
      destino,
      resuelto,
      ...(elemento ? { elemento } : {}),
      ...(dominio ? { dominio } : {}),
    };
  }

  private registrar(mensaje: string): void {
    (this.deps.registrar ?? ((m: string) => log.info(m)))(mensaje);
  }
}

async function copiarNombre(panel: PanelDiccionario, argumento: unknown): Promise<void> {
  const nodo = esNodo(argumento) ? argumento : panel.cabecera();
  const nombre = nodo === undefined ? undefined : nombreACopiar(nodo);
  if (nombre !== undefined) {
    await vscode.env.clipboard.writeText(nombre);
  }
}

/** Exportado para probarlo con un panel propio: la activación ya registra el comando sobre el panel real. */
export async function abrirDdl(panel: PanelDiccionario, deps: DependenciasPanel): Promise<void> {
  const cabecera = panel.cabecera();
  if (cabecera?.clase !== 'cabecera') {
    return;
  }
  if (deps.abrir === undefined) {
    log.warn('Diccionario: abrir el objeto no está disponible');
    return;
  }
  await deps.abrir(resultadoDdl(cabecera.objeto));
}

/** Clic en un uso de «Dónde se usa»: lo abre en la extensión oficial. Exportado para probarlo, como `abrirDdl`. */
export async function abrirUso(deps: DependenciasPanel, argumento: unknown): Promise<void> {
  if (!esNodo(argumento) || argumento.clase !== 'uso') {
    return;
  }
  if (deps.abrir === undefined) {
    log.warn('Diccionario: abrir el objeto no está disponible');
    return;
  }
  await deps.abrir(resultadoUso(argumento.uso));
}

async function anadirPrefijoDesde(panel: PanelDiccionario, argumento: unknown): Promise<void> {
  if (esNodo(argumento) && argumento.clase === 'anadirPrefijo') {
    await panel.anadirPrefijoPropio(argumento.prefijo);
  }
}

function nodosDe(valor: unknown): NodoDiccionario[] | undefined {
  return Array.isArray(valor) ? valor.filter(esNodo) : undefined;
}

function codigoGenerado(tipo: TipoGenerar, tabla: string, campos: ObjetoConCampos['campos']): string {
  switch (tipo) {
    case 'types':
      return generarTypes({ tabla, campos });
    case 'select':
      return generarSelect({ tabla, campos });
    case 'data':
      return generarData(tabla);
    case 'tablaInterna':
      return generarTablaInterna(tabla);
  }
}

/** VS Code pasa el nodo pulsado y, con selección múltiple, la selección como segundo argumento. */
async function generarDesde(panel: PanelDiccionario, tipo: TipoGenerar, argumento: unknown, seleccion: unknown): Promise<void> {
  if (tipo === 'select' && !panel.esTabla()) {
    void vscode.window.showInformationMessage(AVISO_SOLO_TABLAS_SELECT);
    return;
  }
  const nodo = esNodo(argumento) ? argumento : panel.cabecera();
  const objeto = nodo === undefined ? undefined : camposParaGenerar(nodo, nodosDe(seleccion), panel.objetoConCampos());
  const conCampos = tipo === 'types' || tipo === 'select';
  if (objeto === undefined || (conCampos && objeto.campos.length === 0)) {
    void vscode.window.showInformationMessage(AVISO_SIN_CAMPOS);
    return;
  }
  if (vscode.window.activeTextEditor === undefined) {
    void vscode.window.showInformationMessage(AVISO_SIN_EDITOR);
    return;
  }
  if (await insertarEnCursor(codigoGenerado(tipo, objeto.tabla, objeto.campos))) {
    log.info(`Diccionario: generar ${tipo} → ${conCampos ? `${objeto.campos.length} campos` : 'insertado'}`);
  }
}

/** Desde un campo, su dominio (cargado al momento si aún no lo estaba); desde el enlace del hover, el pedido al servicio. */
async function objetivoCaseDesde(panel: PanelDiccionario, deps: DependenciasPanel, argumento: unknown): Promise<ResultadoCase | undefined> {
  if (esNodo(argumento)) {
    if (argumento.clase === 'campo') {
      return caseDeCampo(argumento, await panel.resolverCampo(argumento));
    }
    return argumento.clase === 'dominio' ? caseDeDominio(argumento.dominio) : undefined;
  }
  if (!esPeticionCase(argumento)) {
    return undefined;
  }
  const lectura: LecturaDominio = await deps.servicio.dominio(argumento.destino, argumento.dominio).then(
    (dominio) => ({ dominio }),
    (error: unknown) => {
      log.warn(`Diccionario: generar case → error ${nombreDeError(error)}`);
      return { error: true } as const;
    },
  );
  return caseDeLectura(argumento.dominio, lectura, argumento.variable);
}

/** Exportado para probarlo con un panel propio, como `abrirDdl`. Con muchos valores pregunta antes de insertar. */
export async function generarCaseDesde(panel: PanelDiccionario, deps: DependenciasPanel, argumento: unknown): Promise<void> {
  const objetivo = await objetivoCaseDesde(panel, deps, argumento);
  if (objetivo === undefined || 'aviso' in objetivo) {
    void vscode.window.showInformationMessage(objetivo?.aviso ?? AVISO_SIN_VALORES);
    return;
  }
  if (vscode.window.activeTextEditor === undefined) {
    void vscode.window.showInformationMessage(AVISO_SIN_EDITOR);
    return;
  }
  const { dominio, variable } = objetivo;
  const total = dominio.valores.length;
  if (total > MAX_VALORES_CASE_SIN_PREGUNTAR) {
    const preguntar = deps.preguntar ?? ((mensaje: string, accion: string) => vscode.window.showWarningMessage(mensaje, accion));
    const respuesta = await preguntar(`El dominio ${dominio.nombre} tiene ${total} valores. ¿Generar el CASE igual?`, OPCION_GENERAR);
    if (respuesta !== OPCION_GENERAR) {
      log.info(`Diccionario: generar case → cancelado (${total} valores)`);
      return;
    }
  }
  if (await insertarSnippetEnCursor(generarCase(dominio, variable))) {
    log.info(`Diccionario: generar case → ${total} valores`);
  }
}

/** Exportado para probarlo con un panel propio, como `abrirDdl`. */
export async function conectarPanel(panel: PanelDiccionario, deps: DependenciasPanel, argumento: unknown): Promise<void> {
  const destino = destinoDelArgumento(argumento) ?? panel.destino;
  if (deps.conectar === undefined || destino === undefined) {
    void vscode.window.showInformationMessage(AVISO_SIN_CONECTAR);
    return;
  }
  await deps.conectar(destino);
  await panel.refrescar();
}

export function registrarPanelDiccionario(
  context: Pick<vscode.ExtensionContext, 'subscriptions'>, deps: DependenciasPanel,
): PanelDiccionario {
  const panel = new PanelDiccionario(deps);
  const vista = vscode.window.createTreeView(VISTA_DICCIONARIO, { treeDataProvider: panel, showCollapseAll: false, canSelectMany: true });
  const conRegistro = (nombre: string, accion: () => Promise<void>) => async (): Promise<void> => {
    try {
      await accion();
    } catch (error) {
      log.warn(`Diccionario: ${nombre} → error ${nombreDeError(error)}`);
    }
  };
  context.subscriptions.push(
    panel,
    vista,
    panel.onDidChangeTreeData(() => {
      vista.description = panel.destino;
    }),
    vista.onDidChangeSelection((e) => conRegistro('seleccionar', () => panel.seleccionar(e.selection))()),
    vscode.commands.registerCommand(COMANDO_ABRIR_PANEL, (argumento: unknown) => conRegistro('abrir', async () => {
      if (esPeticion(argumento)) {
        await panel.mostrar(argumento.destino, argumento.nombre);
      }
      await vscode.commands.executeCommand(`${VISTA_DICCIONARIO}.focus`);
    })()),
    vscode.commands.registerCommand(COMANDO_FIJAR, () => panel.fijar(true)),
    vscode.commands.registerCommand(COMANDO_SOLTAR, () => panel.fijar(false)),
    vscode.commands.registerCommand(COMANDO_REFRESCAR, () => conRegistro('refrescar', () => panel.refrescar())()),
    vscode.commands.registerCommand(COMANDO_COPIAR, (argumento: unknown) => conRegistro('copiar', () => copiarNombre(panel, argumento))()),
    vscode.commands.registerCommand(COMANDO_ABRIR_DDL, () => conRegistro('abrirDdl', () => abrirDdl(panel, deps))()),
    vscode.commands.registerCommand(COMANDO_CONECTAR, (argumento: unknown) => conRegistro('conectar', () => conectarPanel(panel, deps, argumento))()),
    vscode.commands.registerCommand(COMANDO_VER_DATOS, () => conRegistro('verDatos', () => panel.verDatos())()),
    vscode.commands.registerCommand(COMANDO_MAS_DATOS, () => conRegistro('masDatos', () => panel.masDatos())()),
    vscode.commands.registerCommand(COMANDO_OCULTAR_DATOS, () => panel.ocultarDatos()),
    vscode.commands.registerCommand(COMANDO_DONDE_SE_USA, () => conRegistro('dondeSeUsa', () => panel.dondeSeUsa())()),
    vscode.commands.registerCommand(COMANDO_OCULTAR_USOS, () => panel.ocultarUsos()),
    vscode.commands.registerCommand(COMANDO_ANADIR_PREFIJO, (argumento: unknown) =>
      conRegistro('anadirPrefijo', () => anadirPrefijoDesde(panel, argumento))()),
    vscode.commands.registerCommand(COMANDO_ABRIR_USO, (argumento: unknown) => conRegistro('abrirUso', () => abrirUso(deps, argumento))()),
    ...TIPOS_GENERAR.map((tipo) =>
      vscode.commands.registerCommand(COMANDOS_GENERAR[tipo], (argumento: unknown, seleccion: unknown) =>
        conRegistro(`generar ${tipo}`, () => generarDesde(panel, tipo, argumento, seleccion))())),
    vscode.commands.registerCommand(COMANDO_GENERAR_CASE, (argumento: unknown) =>
      conRegistro('generar case', () => generarCaseDesde(panel, deps, argumento))()),
  );
  return panel;
}
