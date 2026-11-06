# Cambios

## Sin publicar

- **Código abierto.** Sextante pasa a la licencia MIT: gratis y libre para usar, copiar, modificar y redistribuir.
- **ATC para el agente.** Nueva herramienta `ejecutar_atc`: lanza el ATC de la extensión oficial sobre el objeto y
  devuelve los hallazgos con archivo y línea. El agente la pasa al terminar el código, corrige lo que salga y repite
  hasta un ATC limpio (regla 11).
- **El agente verifica el sistema.** Nueva herramienta `info_sistema`: release y componentes reales del sistema
  (también `release` en el contexto), para que el agente no asuma versiones ni sentencias.
- **El agente pide objetos nuevos.** Nueva herramienta `crear_objeto` (solo en DEV): tras un cuadro que explica qué se
  va a crear y qué te pedirá el asistente, abre el asistente «Create New
  ABAP Object…» de la extensión oficial con el sistema elegido y deja el nombre en el portapapeles; tú eliges ahí el
  tipo, el paquete y la orden de transporte (o creas una nueva). Cuando el objeto se abre, Sextante lo anota en el
  diario y el agente escribe el código con `proponer_cambio`.
- **Includes sin asistente.** Si el agente pide un include de un programa que ya existe, Sextante lo crea directamente
  en el paquete del programa y con su orden de transporte, tras un solo clic en «Crear». Si el programa no está en una
  única orden abierta, el include se crea con el asistente para que elijas la orden.
- **«Nuevo objeto ABAP» preselecciona el sistema** en el asistente de la oficial.
- **Activar todo.** Botón «Activar todo…» en la vista Acciones y en la barra del editor (junto a Activar) y `activar { todo: true }` para el agente: abren la
  lista «Activate All» de la extensión oficial para activar juntos el programa y sus includes (activarlos uno a uno
  falla porque dependen entre sí). Solo en DEV. `verificar_sintaxis` ya no presenta como error el mensaje
  «Objeto(s) activado(s)» de la oficial.
- **Diario por objeto.** Sextante guarda un diario en Markdown por objeto y sistema con lo que se aplicó, lo que
  rechazaste y las notas del agente de IA, para retomar un objeto sin repetir trabajo. Se abre con el botón
  "Abrir diario del objeto" de la vista Objeto, puedes editarlo a mano, y el agente lo consulta (`diario_objeto`) y
  lo completa (`anotar_diario`, `porque` en cada propuesta).

## 0.1.0 — preview inicial (2026-11-03)

Primera versión publicada. Requiere la extensión oficial "ABAP Development Tools for Visual Studio
Code" de SAP; si falta, Sextante avisa y ofrece instalarla.

- **Sistemas.** Lista los destinos de la extensión oficial, pide una vez el rol (DEV / QAS / PRD) y
  muestra la vía de conexión (RFC, REST o buscador de la oficial). Conectar, marcar activo, nuevo
  destino y editar destinos.
- **Buscar objeto** por nombre con vista previa de resultados; buscar texto en ABAP; transacciones.
- **Objeto.** Árbol tipo SE80 / SE24 del objeto abierto: componentes, métodos, includes, con salto
  al código. Fijar objeto, abrir métodos como bloque. Ctrl+clic o F12 sobre un `PERFORM` abre su
  `FORM` (en el mismo archivo, en los includes del programa o en los del principal), como bloque si el
  modo bloque está activo; Alt+Flecha izquierda vuelve.
- **Acciones** con botones visibles sobre el objeto activo: Activar, Verificar sintaxis, ATC, Unit
  tests, Transporte, Comparar con la última versión y con otro sistema, Ejecutar, Documentación,
  Historial de versiones.
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
- **Agente de IA (servidor MCP).** Servidor MCP local (`127.0.0.1`, con token) que da a Claude Code y a
  otros clientes siete herramientas de lectura: contexto del editor, abrir objeto y transacción, leer el
  programa con sus includes, leer tramos, estructura y editores abiertos. Además, el agente propone cambios
  de código como un diff en VS Code con botones Aplicar y Rechazar, verifica la sintaxis, lanza los unit
  tests y pide activar con una confirmación tuya; la escritura es solo para sistemas con rol DEV. Comando
  para registrarlo en Claude Code y vista "Actividad de la IA" con las propuestas. El contexto SAP llega en
  la 4c.
- **Consola SQL** con identificadores validados.
- **Nuevo objeto ABAP** guiado.
- **Tema "Sextante Oscuro"** (paleta One Dark) y gramáticas propias para ABAP y ABAP SQL.
- **Seguridad.** En sistemas QAS / PRD el código se abre en solo lectura y Activar, Bloquear y
  Transporte se deshabilitan. Contraseñas únicamente en el almacén seguro de VS Code.

Limitaciones conocidas: la vía RFC solo está disponible en Windows (usa el JCo que instala la
extensión oficial); en macOS y Linux se usa REST o el buscador de la oficial. Sin soporte de
SSO/SNC ni BTP (OAuth) para la conexión propia. Solo S/4HANA.
