# Cambios

## 0.1.1 (2026-11-06)

- **Página en inglés.** README principal en inglés (con enlace a la versión en español, `README.es.md`) y
  descripción del Marketplace en inglés, para que la comunidad SAP de cualquier país pueda conocerla. Sin cambios en
  la extensión.

## 0.1.0 — primera versión pública (2026-11-06)

Primera versión publicada, gratuita y de código abierto (licencia MIT). Requiere la extensión oficial
"ABAP Development Tools for Visual Studio Code" de SAP; si falta, Sextante avisa y ofrece instalarla.

- **Tutorial de primeros pasos** dentro de VS Code (Welcome: Open Walkthrough… → Primeros pasos con Sextante) y en
  el README, con capturas.
- **Sistemas.** Lista los destinos de la extensión oficial, pide una vez el rol (DEV / QAS / PRD) y
  muestra la vía de conexión (RFC, REST o buscador de la oficial). Conectar, marcar activo, nuevo
  destino y editar destinos.
- **Buscar objeto** por nombre con vista previa de resultados; buscar texto en ABAP; transacciones.
- **Objeto.** Árbol tipo SE80 / SE24 del objeto abierto: componentes, métodos, includes, con salto
  al código. Fijar objeto, abrir métodos como bloque. Ctrl+clic o F12 sobre un `PERFORM` abre su
  `FORM` (en el mismo archivo, en los includes del programa o en los del principal), como bloque si el
  modo bloque está activo; Alt+Flecha izquierda vuelve.
- **Acciones** con botones visibles sobre el objeto activo: Activar, Activar todo…, Verificar sintaxis, ATC, Unit
  tests, Transporte, Comparar con la última versión y con otro sistema, Ejecutar, Documentación,
  Historial de versiones. «Activar todo…» (también en la barra del editor) abre la lista «Activate All» de la
  extensión oficial para activar juntos un programa y sus includes; solo en DEV.
- **Paquetes.** Explorador de paquetes del sistema activo.
- **Diccionario en contexto.** Hover y panel para tablas, campos, elementos de datos, dominios,
  mensajes, módulos de funciones y métodos; "Ver datos" (Data Preview); "Dónde se usa" acotado a
  objetos propios; generar `TYPES`, `SELECT`, `DATA` y `CASE` con los valores fijos de un dominio.
- **Órdenes de transporte.** Vista "Órdenes" con las órdenes del usuario por sistema (modificables,
  liberadas de las últimas dos semanas, customizing), sus tareas y objetos; acción "Orden del objeto" que
  dice en qué orden está el objeto abierto, si está liberada y qué más lleva; copiar número y salto al
  organizador de la oficial.
- **Versiones.** Vista "Versiones" con el historial del objeto abierto por pieza (clase principal e
  includes, módulos e includes de grupos de funciones, programas, CDS): diff de cualquier versión contra
  el editor y entre dos versiones.
- **Comparar con otro sistema.** Lee por RFC el fuente activo del objeto en los sistemas hermanos (QAS,
  PRD) y abre el diff, o un resumen por sistema si son varios; la clase se compara entera.
- **Firmas en contexto.** Hover sobre módulos de funciones, métodos y clases con sus parámetros y
  excepciones; "Insertar llamada" escribe el patrón de llamada debajo de la sentencia, desde el hover
  o desde la paleta.
- **Monitor.** Vista con los dumps de hoy del sistema activo (míos o de todos), los objetos inactivos
  con "Activar todo lo mío" delegado en la oficial, y las órdenes modificables. Un clic en un dump abre el
  include en la línea del error y, al lado, el dump sintetizado: qué falló y dónde, llamadas activas y
  eventos con salto al código, variables por nivel de la pila, campos de sistema, parámetros del error,
  usuario, transacción y entorno. Se lee de la tabla SNAP por RFC; es la única tabla que el puente puede
  leer. El botón "Dumps y feeds" enfoca el Monitor cuando hay vía RFC.
- **Agente de IA (servidor MCP).** Servidor MCP local (`127.0.0.1`, con token) para Claude Code y otros clientes
  MCP: contexto del editor, abrir objeto y transacción, leer el programa con sus includes, leer tramos, estructura
  y editores abiertos, y `info_sistema` con el release y los componentes reales del sistema. El agente propone
  cambios de código como un diff en VS Code con botones Aplicar y Rechazar, verifica la sintaxis, lanza los unit
  tests y el ATC (`ejecutar_atc`, hasta dejarlo limpio) y pide activar con una confirmación tuya; la escritura es
  solo para sistemas con rol DEV. Comando para registrarlo en Claude Code y vista "Actividad de la IA" con las
  propuestas.
- **Objetos nuevos desde el agente.** `crear_objeto` (solo en DEV) abre el asistente «Create New ABAP Object…» de la
  extensión oficial con el sistema elegido y el nombre en el portapapeles; tú eliges tipo, paquete y orden. Un
  include de un programa que ya existe se crea directamente en el paquete y la orden del programa tras un clic en
  «Crear».
- **Diario por objeto.** Un diario en Markdown por objeto y sistema con lo que se aplicó, lo que rechazaste y las
  notas del agente, para retomar un objeto sin repetir trabajo. Se abre desde la vista Objeto y se puede editar a
  mano; el agente lo consulta y lo completa.
- **Consola SQL** con identificadores validados.
- **Nuevo objeto ABAP** guiado, con el sistema preseleccionado en el asistente de la oficial.
- **Tema "Sextante Oscuro"** (paleta One Dark) y gramáticas propias para ABAP y ABAP SQL.
- **Seguridad.** En sistemas QAS / PRD el código se abre en solo lectura y Activar, Bloquear y
  Transporte se deshabilitan. Contraseñas únicamente en el almacén seguro de VS Code.

Limitaciones conocidas: la vía RFC solo está disponible en Windows (usa el JCo que instala la
extensión oficial); en macOS y Linux se usa REST o el buscador de la oficial. Sin soporte de
SSO/SNC ni BTP (OAuth) para la conexión propia. Solo S/4HANA.
