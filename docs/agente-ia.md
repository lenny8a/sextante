# Agente de IA en Sextante (servidor MCP)

Sextante incluye un servidor MCP propio que deja a un agente de IA (Claude Code, Codex, otro cliente MCP)
**ver lo mismo que tú**: qué objeto tienes abierto, su código completo, sus includes y su estructura. El agente
puede además abrir objetos y transacciones en tu editor y, desde la entrega 4b, **proponer cambios de código**:
los ves como un diff en VS Code y decides tú con Aplicar o Rechazar. También puede verificar la sintaxis, lanzar
los unit tests y pedirte activar (con confirmación tuya). El contexto SAP (diccionario, dumps, versiones) llega
en la 4c.

El servidor solo escucha en `127.0.0.1`, exige un token y no guarda ninguna credencial SAP.

## Requisitos

- Sextante instalado y activo.
- Claude Code (o cualquier cliente MCP con transporte HTTP).
- La extensión oficial de SAP con el sistema ya conectado (logon hecho). Si no lo está, Sextante te pide el
  logon en VS Code cuando el agente intenta abrir un objeto: la contraseña la escribes tú, nunca pasa por el
  agente.

## Cómo conectar

### Claude Code

Ejecuta el comando **"Sextante: Conectar el agente (Claude Code)"** (también está en la vista "Actividad de la IA").
Sextante hace por ti, sin shell:

```
claude mcp remove --scope user sextante
claude mcp add --transport http --scope user sextante http://127.0.0.1:2237/mcp --header "Authorization: Bearer <token>"
```

Si no encuentra la CLI de `claude`, abre un documento sin guardar con el comando completo para que lo copies y
lo ejecutes tú. Ese documento lleva tu token: no lo compartas.

A mano es el mismo `claude mcp add`, con el puerto de `abapNavigator.ia.puerto` y el token que da
"Copiar configuración MCP".

### Codex y otros clientes

"Copiar configuración MCP" deja en el portapapeles:

```toml
# ~/.codex/config.toml
[mcp_servers.sextante]
url = "http://127.0.0.1:2237/mcp"
bearer_token_env_var = "SEXTANTE_MCP_TOKEN"
```

y define `SEXTANTE_MCP_TOKEN=<token>` en el entorno antes de abrir Codex. Para cualquier otro cliente MCP:

```json
{
  "type": "http",
  "url": "http://127.0.0.1:2237/mcp",
  "headers": { "Authorization": "Bearer <token>" }
}
```

## Procedimiento del agente

El servidor lo entrega a cualquier cliente en la respuesta `initialize` (`instructions`):

0. Para cualquier tarea sobre código ABAP, usar primero las herramientas de `sextante`. Si el agente tiene
   también el servidor `adt` de SAP (herramientas `abap_*`), usarlo solo para lo que Sextante no cubre
   (transportes) y nunca para leer, editar, verificar, activar ni pasar el ATC de un objeto que Sextante pueda
   tratar. Sin esta regla, Claude Code tiende a elegir primero el servidor de SAP.
1. Llamar a `contexto_actual` al empezar y antes de cada edición: dice qué sistema, objeto, archivo, cursor y
   selección tiene el usuario, y si es solo lectura.
2. Abrir el objeto en pantalla (`abrir_objeto`, `abrir_transaccion`) antes de leerlo: el usuario ve lo que
   el agente mira.
3. Leer el programa completo (`leer_programa`) antes de proponer nada; orientarse con `estructura_objeto` y
   leer tramos con `leer_archivo` si el objeto es grande.
4. Los cambios de código van siempre por `proponer_cambio`; nunca por otro servidor ni por edición directa.
5. Activar solo cuando el usuario lo pida expresamente. Si el objeto tiene includes o hay varios objetos inactivos,
   activar con `todo: true` (lista «Activate All» de la extensión oficial), no archivo por archivo.
6. En sistemas QAS o PRD, solo análisis.
7. Si `contexto_actual` trae `diario`, llamar a `diario_objeto` antes de leer o proponer: ahí está lo que se hizo
   antes en ese objeto y por qué. Al trabajar sobre un include, consultar también el diario del programa principal
   (pasando su `uri`).
8. Al terminar una tarea sobre un objeto, o al tomar una decisión que convenga recordar, anotar el porqué con
   `anotar_diario`; en `proponer_cambio` dar siempre `porque`.
9. Antes de afirmar algo del sistema (release, sentencias disponibles, clases estándar) o de un objeto, consultarlo
   con `info_sistema`, `leer_programa` o diccionario; si no puede, preguntar al usuario. Nunca seguir adelante con un
   supuesto marcado como no verificado.
10. Si necesita un objeto que no existe, pedirlo con `crear_objeto`. Un objeto principal (programa, clase, grupo de
    funciones) va por el asistente de la extensión oficial: el usuario elige ahí tipo, paquete y orden. Un include de
    un programa que ya existe se crea directo indicando `programaPrincipal`: hereda el paquete y la orden del
    programa y el usuario solo confirma. Nunca suponer un paquete ni una orden. Un objeto que ya existe se queda en su
    paquete. Si no puede crear, parar y decírselo. Nunca guardar código en archivos locales ni inventar nombres,
    paquetes o rutas sin preguntar.
11. Al terminar el código de una tarea, y con `verificar_sintaxis` sin errores, pasar el ATC con `ejecutar_atc`
    sobre el objeto. Corregir con `proponer_cambio` todos los errores y advertencias que salgan y volver a pasar el
    ATC; repetir hasta que no quede ninguno. No dar la tarea por terminada sin un ATC limpio. Si un hallazgo no se
    puede corregir sin cambiar lo que pidió el usuario, o sigue saliendo después de corregirlo, parar y explicárselo
    al usuario en vez de insistir.

### Instrucciones pre-armadas para `CLAUDE.md` o `AGENTS.md`

Las `instructions` del servidor son una sugerencia; el agente las sigue mejor si además están en su archivo de
instrucciones (`~/.claude/CLAUDE.md` en Claude Code, `AGENTS.md` en Codex). Bloque listo para pegar:

```markdown
## Sextante (ABAP en VS Code)
- Para ABAP usa el servidor MCP `sextante`: `contexto_actual` al empezar y antes de cada edición,
  `abrir_objeto` / `abrir_transaccion` para abrir en pantalla, `leer_programa` antes de proponer nada.
- Los cambios de código van SIEMPRE por `proponer_cambio` (el usuario los aprueba en un diff). Nunca edites
  con `abap_object_edit_file` ni con ninguna otra herramienta, aunque esté disponible.
- `verificar_sintaxis` tras aplicar y, al terminar el código, `ejecutar_atc` hasta que no quede ningún hallazgo;
  `ejecutar_unit_tests` y `activar` solo si el usuario lo pide. Un diagnóstico
  "Objeto(s) activado(s)" (origen `abapActivation`) en el `.json` de metadatos es el mensaje de éxito de la activación
  de la oficial: Sextante lo devuelve como `info`, no es un error.
- Si el objeto tiene includes o hay varios objetos inactivos, activa con `activar { todo: true }` (lista «Activate All»
  de la oficial, el usuario marca y confirma ahí), no archivo por archivo.
- El servidor `adt` de SAP (`abap_*`), si está registrado, solo para transportes (nunca para pasar el ATC).
- Al terminar el código, con `verificar_sintaxis` sin errores, pasa `ejecutar_atc`; corrige con `proponer_cambio` lo que salga y repite hasta un ATC limpio. Si un hallazgo no se puede corregir sin cambiar lo pedido, o persiste, para y explícaselo al usuario.
- En sistemas QAS o PRD solo análisis: las herramientas de escritura responden "rechazado por rol".
- Si contexto_actual trae diario, lee diario_objeto antes de proponer; al terminar anota el porqué con anotar_diario y da siempre porque en proponer_cambio.
- Antes de afirmar nada del sistema (release, sentencias, clases estándar) verifícalo con `info_sistema`, `leer_programa` o el diccionario; si no puedes, pregunta. Nunca sigas con un supuesto sin verificar.
- Si necesitas un objeto que no existe, pídelo con `crear_objeto`. Un objeto principal (programa, clase, grupo de funciones) va por el asistente de la extensión oficial y el usuario elige ahí tipo, paquete y orden; si responde `pendiente`, vuelve a llamar con el mismo nombre para seguir esperando (no relanza el asistente). Un include de un programa que ya existe: pasa `tipo: INCL` y `programaPrincipal` y Sextante lo crea directo en el paquete y la orden del programa tras un clic del usuario; si responde `asistente`, repite sin `programaPrincipal`. Nunca guardes código en archivos locales ni inventes nombres, paquetes o rutas.
- Nunca supongas un paquete ni una orden. Un objeto que ya existe se queda en su paquete.
```

## Herramientas de lectura (entrega 4a)

Todas aceptan `sistema` (destino) donde se indica; si falta se usa el del editor activo y, si no, el
sistema activo de Sextante. `uri` es siempre una URI `abap:` completa, como la devuelven `contexto_actual`
y `abrir_objeto`. Líneas y columnas cuentan desde 1.

| Herramienta | Entrada | Devuelve |
|---|---|---|
| `contexto_actual` | ninguna | JSON: `sistema` (id, rol, vía y `release` si se conoce: el del logon RFC, el de la caché o, solo por REST, el de CVERS; no espera más de 3 s y, si vence, lo omite), objeto, archivo, cursor, bloque bajo el cursor, selección (máx. 4000 caracteres), solo lectura, modo bloque, editores abiertos y, si el objeto tiene diario, `diario { entradas, ultima, archivo }`. Si el foco está fuera del editor, usa el último editor `abap:` |
| `abrir_objeto` | `nombre`, `tipo` opcional (`PROG`, `CLAS`, `INTF`, `FUGR`, `TABL`, `DDLS`, `INCL`), `sistema` | Abre el objeto en el editor y devuelve `tipo`, `paquete`, `nombre` y, si se conoce el archivo abierto, `uri`; si no, una `indicacion` para llamar a `contexto_actual`. Solo abre un objeto con ese nombre exacto; si no hay exactamente uno, devuelve los candidatos sin abrir nada (aunque sea uno solo) |
| `abrir_transaccion` | `tcode`, `sistema` | Resuelve por RFC el programa o la clase de la transacción, lo abre y devuelve `transaccion` y, si se conoce el archivo abierto, `uri`; si no, una `indicacion` para llamar a `contexto_actual`. Solo con vía RFC |
| `leer_programa` | `uri` (principal o cualquier include), `incluirIncludes` (por defecto `true`), `maxLineasPorArchivo` (1 a 20000, por defecto 2000) | Texto del principal y de cada include alcanzable (hasta 40 archivos); desde un include devuelve ese include y sus sub-includes, no el principal (el FS `abap:` no enlaza un include con su principal). Cada archivo va bajo `=== ruta (n líneas) ===` y con números de línea. Si un archivo se corta lo indica y da la línea desde la que seguir con `leer_archivo`; los archivos que no pudo leer los lista con "no se pudo leer" |
| `leer_archivo` | `uri`, `desdeLinea`, `hastaLinea` (ambas incluidas) | Las líneas del rango, numeradas, bajo `=== ruta (líneas a-b de n) ===` |
| `estructura_objeto` | `uri` | JSON con el árbol SE80 / SE24 del objeto: secciones, métodos, FORMs, includes, con `nombreKind`, `rango` y, en cada nodo, la `uri` del archivo donde está (puede ser un include distinto del pedido) y `nombreInclude`. El objeto debe estar abierto |
| `editores_abiertos` | ninguna | Lista de editores `abap:` abiertos: `uri`, objeto, sistema y cuál es el activo |
| `info_sistema` | `sistema` opcional | JSON `{ sistema, rol, via, release, componentes[{ componente, release, nivel }], fuente, indicacion? }`: release y componentes reales (tabla CVERS) del sistema. Nunca pide contraseña; con contraseña guardada abre la sesión sin preguntar. Sin conexión ADT propia devuelve `fuente: "no disponible"` con una `indicacion`. La lectura de CVERS espera como mucho 10 s; si falla, durante 60 s responde el mismo aviso sin volver a consultar. Se cachean release y componentes; el rol y la vía se leen en cada llamada |

Los recuentos de líneas ignoran el salto de línea final del archivo.

## Herramientas de escritura (entrega 4b)

`uri` es una URI `abap:` de un archivo del objeto, como la devuelven `contexto_actual` y `abrir_objeto`.

| Herramienta | Entrada | Devuelve |
|---|---|---|
| `proponer_cambio` | `uri`, `resumen` (una línea, hasta 200 caracteres), y `cambios` (hasta 50 pares `buscar` / `reemplazar`) o `textoCompleto`, nunca los dos | Abre el diff y espera hasta 60 s a la decisión. JSON `{ id, estado }` con `estado` `aplicado`, `rechazado` (con `motivo` si lo hay) o `pendiente` (con una `indicacion` para llamar a `estado_propuesta`) |
| `estado_propuesta` | `id` de `proponer_cambio` | Espera hasta 60 s más y devuelve `aplicado`, `rechazado` (con `motivo`) o `pendiente`. Un `id` que ya no existe es un error |
| `verificar_sintaxis` | `uri` | JSON `{ diagnosticos, publicados }`; cada diagnóstico lleva `severidad` (`error`, `aviso`, `info`, `pista`), `linea` y `columna` desde 1, `mensaje` y a veces `origen`. El mensaje "Objeto(s) activado(s)" (origen `abapActivation`) en el `.json` de metadatos llega como `info`. Si `publicados` es `false` la oficial no publicó diagnósticos en 3 s: no significa "sin errores" y trae una `indicacion` para mirar el panel Problemas. Si hay algún error y el archivo es el principal de un programa, trae una `indicacion` para activar con `todo: true` y volver a verificar (includes sin activar) |
| `ejecutar_atc` | `uri` | Pasa el ATC de la oficial (variante por defecto del sistema) y devuelve JSON `{ estado, total, errores, avisos, infos, hallazgos, truncado?, indicacion? }`. Cada hallazgo: `uri`, `linea` (desde 1), `prioridad` (`error`, `aviso`, `info`), `mensaje` y a veces `codigo`; orden: prioridad, uri, línea; hasta 200 (`truncado: true` si hay más; los contadores cuentan todos). `estado`: `con hallazgos`; `sin hallazgos`; `sin confirmar` (hay hallazgos pero la oficial no los actualizó en esta pasada: pueden ser viejos, se pregunta al usuario antes de corregir); `en curso` (pasan 60 s sin terminar: se vuelve a llamar con la misma `uri`, que recoge la pasada sin lanzar otro ATC; un resultado sin recoger se guarda 5 minutos). Sin hallazgos y sin señal de la oficial, trae una `indicacion`: Sextante no distingue «limpio» de «falló o cancelado». Funciona con cualquier rol |
| `ejecutar_unit_tests` | `uri` | `{ estado: "lanzado" }`: el resultado está en el panel de pruebas de VS Code, no en la respuesta |
| `activar` | `uri`, `todo` opcional (booleano) | Sin `todo`: muestra un modal "El agente pide activar <objeto>." Si aceptas, activa ese archivo con la oficial y devuelve `{ estado: "activado" }`; si no, `{ estado: "cancelado" }`. Con `todo: true`: abre la lista «Activate All» de la oficial sin modal propio y devuelve `{ estado: "lanzado", indicacion }`. Ver "Activar" |
| `crear_objeto` | `nombre`, `descripcion` (1 a 60 caracteres), `tipo` opcional (`PROG`, `INCL`, `CLAS`, `INTF`, `FUGR`, `TABL`, `DDLS`; en el modo asistente solo sirve para el cuadro guía), `programaPrincipal` opcional (solo con `tipo: INCL`: modo directo), `relanzar` opcional (booleano: solo si el usuario cerró el asistente y quiere repetirlo), `sistema` | Ver "Crear objetos". JSON `{ estado: "creado", uri?, nombre, paquete, orden?, programaPrincipal?, indicacion }`, `{ estado: "cancelado", nombre }`, `{ estado: "pendiente", nombre, indicacion }` (modo asistente: volver a llamar con el mismo nombre para seguir esperando), `{ estado: "asistente", nombre, indicacion }` (modo directo: el programa no está en una única orden abierta) o un error con el motivo |

En `proponer_cambio`:

- `porque` (opcional, 1 a 1000 caracteres) es la razón del cambio; va a la línea `Por qué:` de la entrada del
  diario cuando el usuario decide (ver "Diario por objeto").
- Cada `buscar` debe aparecer **exactamente una vez** en el texto en curso del archivo; los cambios se aplican en
  orden, cada uno sobre el resultado del anterior. Un fragmento vacío, ausente o repetido rechaza la propuesta
  con un texto que dice cuál.
- `textoCompleto` sustituye todo el archivo; úsalo solo cuando reescribas el archivo entero, por ejemplo un
  include recién creado.
- Una propuesta que no cambia nada se rechaza.

Antes de `verificar_sintaxis`, `ejecutar_unit_tests` y `activar`, Sextante muestra el archivo y **le da el foco**
(el editor activo pasa al archivo del agente), porque los comandos de la oficial actúan sobre el editor activo; si
ese archivo no queda como editor activo, no lanza el comando y el agente recibe un error que pide al usuario
abrirlo.

### Activar

`activar` tiene dos modos, los dos con la extensión oficial y solo con rol DEV:

- **Un archivo** (sin `todo`): modal de Sextante "El agente pide activar <objeto>." y, si aceptas,
  `adt-vscode.activate` sobre ese archivo.
- **Todo** (`todo: true`): Sextante muestra el archivo y lanza `adt-vscode.activateAll` («Activate All...»). La
  oficial abre su lista «Your Inactive Objects in <sistema>»; marcas ahí qué activar y confirmas: esa lista es la
  confirmación, sin modal de Sextante. La herramienta devuelve `lanzado` en cuanto la lista está abierta (espera como
  mucho 1,5 s por si la oficial falla al arrancar); no espera a que elijas. Al confirmar, el agente vuelve a llamar a
  `verificar_sintaxis` sobre el programa principal.

Por qué: tras crear un programa con varios includes, la verificación del principal falla ("El tipo LCL_APP es
desconocido") porque los includes siguen inactivos, y activar archivo por archivo tampoco vale porque cada include
depende de los demás; hay que activarlos juntos. La oficial no admite preseleccionar objetos en «Activate All», por
eso eliges tú en su lista. El mismo botón está en la vista Acciones y en la barra del editor, junto a Activar: «Activar todo…».

## Crear objetos

`crear_objeto` tiene dos modos. Decisión del usuario del 2026-11-04, tras probar el asistente: solo el objeto
principal pasa por el asistente; los includes de un programa que ya existe los crea Sextante.

| Modo | Cuándo | Quién decide paquete y orden | Clics del usuario |
| --- | --- | --- | --- |
| Asistente | Sin `programaPrincipal`: objeto principal (programa, clase, grupo de funciones…) | El usuario, en el asistente de la oficial | Cuadro guía y el asistente entero |
| Directo | `tipo: INCL` y `programaPrincipal` de un programa que ya existe | Se heredan del programa principal | Un cuadro con «Crear» |

`programaPrincipal` con otro tipo responde `programaPrincipal solo vale para includes`; sin `tipo`,
`programaPrincipal solo vale para includes: indica tipo INCL`.

### Modo asistente

No crea nada por su cuenta: abre el asistente «Create New ABAP Object…» de la extensión oficial
(`adt-vscode.createObject`), que ya trae el tipo de objeto, el buscador de paquetes y la orden de transporte (una
existente o «Create New Transport Request…»). Pasos, en este orden; cualquier parada devuelve un resultado claro al
agente:

1. Sistema: el `sistema` dado o el del editor; sin ninguno, error `indica el sistema o abre un objeto`.
2. Rol: solo DEV; en QAS, PRD o sin rol, `rechazado por rol`.
3. Validación: `nombre` hasta 40 caracteres (admite namespace `/NS/`), `descripcion` de 1 a 60 sin saltos de
   línea; `tipo` es opcional y solo sirve para el cuadro guía.
4. Cuadro guía (modal, botón «Abrir asistente»): «El agente pide crear programa ZTEST_NUEVO «Informe de prueba» en
   DEV.» (sin `tipo`: «crear el objeto ZTEST_NUEVO…»), con el detalle:

   ```
   Se abrirá el asistente de SAP y te pedirá, en este orden:
   1. Tipo de objeto: elige el que corresponde (aquí: programa).
   2. Datos del objeto: nombre (ya está en el portapapeles: pégalo con Ctrl+V), descripción y paquete (escribe para buscar; $TMP es local).
   3. Orden de transporte: elige una tuya o «Create New Transport Request…». Los objetos locales no la piden.
   ```

   Sin `tipo`, el paso 1 dice solo «elige el que corresponde.». Cancelar devuelve `{ estado: "cancelado", nombre }`
   sin lanzar nada ni tocar el portapapeles. El orden de los campos del paso 2 lo define el backend de SAP (no
   verificado).
5. Sextante lanza el asistente con el sistema preseleccionado, igual que el botón «Nuevo objeto ABAP» de la vista
   Acciones (si el sistema no está conectado, pide conectar primero), y deja el nombre en el portapapeles. Sin la
   extensión oficial o sin conexión, error con el motivo y el portapapeles intacto.
6. El usuario completa el asistente (elige tipo, pega el nombre, elige paquete y orden). Al crear, la oficial abre el
   objeto nuevo en el editor; Sextante espera hasta 60 s a que aparezca un editor de ese sistema con ese nombre (un
   objeto que ya estaba abierto antes de lanzar el asistente no cuenta).
   - Si aparece: entrada `creado` en el diario del objeto (con su paquete) y `{ estado: "creado", uri, nombre,
     paquete, indicacion }`.
   - Si no: `{ estado: "pendiente", nombre, indicacion }`. El agente vuelve a llamar a `crear_objeto` con el mismo
     nombre para seguir esperando: durante 10 minutos desde el lanzamiento, otra llamada para el mismo sistema y
     nombre no muestra el cuadro ni relanza el asistente ni toca el portapapeles; solo vuelve a esperar. Si el usuario
     dice que lo canceló, el agente no insiste.
   - Si el usuario cerró el asistente y quiere repetir antes de esos 10 minutos, el agente llama con
     `relanzar: true`: se descarta la creación en curso y la llamada se comporta como la primera (vuelve el cuadro
     guía, así que relanzar siempre necesita el clic del usuario).
   - Mientras el cuadro guía de ese objeto sigue abierto, otra llamada para el mismo sistema y nombre (también con
     `relanzar`) responde `pendiente` al momento, sin un segundo cuadro y sin esperar.

Si el sistema no tiene logon, Sextante pide primero al usuario que se conecte, y la herramienta puede responder
después del límite de tiempo del propio cliente MCP; en ese caso el agente vuelve a llamar con el mismo nombre (no
relanza el asistente) o pregunta al usuario y usa `abrir_objeto`.

El asistente de la oficial no admite tipo, nombre, descripción ni paquete precargados (solo el sistema), por eso el
nombre va por el portapapeles. Después, el agente escribe el código con `proponer_cambio` y `textoCompleto`. El
diario sigue la regla híbrida de siempre: `creado` se anota solo, el resto lo anota el agente.

### Modo directo: include de un programa que ya existe

Sextante crea el include por su conexión ADT propia, sin asistente. Pasos, en este orden:

1. Sistema y rol, igual que en el modo asistente (solo DEV).
2. Validación: `nombre`, `descripcion` y `programaPrincipal` (mismo patrón que `nombre`, a mayúsculas).
3. Conexión propia silenciosa (nunca pide contraseña); sin ella, error `Sin conexión ADT propia con <sistema>:
   conéctate (o busca una vez) y vuelve a intentarlo`. Sin usuario en el destino, `no se conoce el usuario de
   <sistema>`.
4. Paquete del programa principal: el `packageName` real que devuelve la búsqueda ADT para el programa (`PROG/P`) con
   ese nombre exacto. Si no aparece: `no existe el programa <PRINCIPAL> en <sistema>: créalo antes (crear_objeto sin
   programaPrincipal) o revisa el nombre`.
5. Orden: un paquete que empieza por `$` no lleva orden. Si no, la única orden **modificable** en la que está el
   programa, con la misma consulta que «Orden del objeto» (E071 por RFC, siempre fresca). Ninguna, varias, lista
   truncada o sin vía RFC: no se crea directo y responde `{ estado: "asistente", nombre, indicacion }` (repetir sin
   `programaPrincipal` para que el usuario elija la orden en el asistente).
6. Cuadro modal (botón «Crear»): «El agente pide crear el include ZTEST_TOP «Datos globales» en DEV.», con el detalle
   `Paquete: ZPAQ1 (el del programa ZTEST).` y `Orden de transporte: DEVK900001 (la del programa).` (paquete local:
   `Objeto local: sin orden de transporte.`). Cancelar devuelve `{ estado: "cancelado", nombre }` sin enviar nada.
7. `POST /sap/bc/adt/programs/includes` (`…programs.includes.v2+xml`) con `include:abapInclude`, nombre,
   descripción, responsable (usuario del destino) y `packageRef`; `?corrNr=<orden>` si hay orden. Formato verificado
   contra un sistema real el 2026-11-04 para paquete local; `corrNr` con paquete transportable **no verificado** (se confirma
   en F5). Sin `contextRef`: SAP lo acepta pero no lo guarda. Un error de SAP responde `SAP rechazó la creación
   (HTTP <estado>): <texto>`; el cuerpo nunca va al log.
8. Abre el include por el mismo camino que `abrir_objeto` (hasta 3 intentos con 1 s), anota `creado` en su diario y
   responde `{ estado: "creado", uri, nombre, paquete, orden?, programaPrincipal, indicacion }`. La indicación
   recuerda añadir la sentencia `INCLUDE` en el programa principal si falta. Si no se pudo abrir, sin `uri` y con
   «ábrelo con abrir_objeto en unos segundos».

## Propuestas de cambio

1. `proponer_cambio` abre en VS Code un diff titulado "Propuesta: <resumen>": a la izquierda el archivo `abap:`
   vivo, a la derecha el texto propuesto (esquema virtual `sextante-propuesta`).
2. En la barra de título del diff hay dos botones: **Aplicar cambio** y **Rechazar**. También
   son botones en línea de cada propuesta **pendiente** de la vista Actividad (sección "Propuestas"; las decididas
   no los llevan) y están en la paleta; desde la paleta, si hay varias pendientes, se elige en un selector.
3. **Aplicar** sustituye el contenido del documento con una sola edición y lo guarda (`doc.save()`), de modo que el
   bloqueo y la orden de transporte los sigue gestionando la oficial. Después cierra el diff.
4. **Rechazar** pide un "Motivo del rechazo": se lo pasa al agente. Escape en esa caja cancela (la propuesta sigue
   pendiente y el diff abierto); aceptarla vacía rechaza sin motivo.
5. Si el archivo cambió desde que se hizo la propuesta, el primer Aplicar **recalcula** los cambios sobre el texto
   actual pero **no escribe**: refresca el lado derecho del diff con el resultado, la propuesta sigue pendiente y un
   aviso pide revisar el diff actualizado y volver a pulsar Aplicar; el segundo Aplicar escribe lo que ya viste. Si
   algún fragmento ya no es único, la propuesta caduca: el agente la ve como `rechazado` con el motivo "el archivo
   cambió desde la propuesta…" y debe volver a leer y proponer. Si el archivo ya contiene el cambio (lo hiciste a
   mano), caduca con el motivo "el archivo ya contiene el cambio propuesto…".
6. Si el documento tiene ediciones tuyas sin guardar, Aplicar recalcula sobre ese texto en vivo (con el aviso del
   punto 5) y **guarda también esas ediciones** (el lado izquierdo del diff es el documento vivo, así que las ves).
7. Si la edición se aplicó pero la oficial no guardó (bloqueo u orden de transporte pendiente), la propuesta
   consta como `aplicado` con un motivo que avisa de que debes guardar con Ctrl+S; Sextante pone el archivo sin
   guardar como editor activo y **deja el diff abierto**. Si VS Code no pudo aplicar la edición, consta como
   `rechazado`. Al usuario se le avisa con un texto propio; los motivos van dirigidos al agente.
8. El agente escribe siempre con saltos LF; si el documento está en CRLF, Sextante adapta los saltos de cada
   fragmento antes de buscarlo, y el archivo sigue en CRLF.
9. Un segundo clic en Aplicar mientras hay uno en curso no aplica dos veces.
10. Si el diff no se puede abrir, la propuesta caduca con el motivo "no se pudo abrir el diff" y el agente recibe
    el error.
11. **Cerrar la pestaña del diff no decide nada**: la propuesta sigue pendiente (se reabre desde la vista
   Actividad) y el agente sigue esperando hasta agotar sus 60 s, tras los cuales recibe `pendiente`.
12. Las propuestas viven en memoria de la ventana: **se pierden al reiniciar** VS Code o recargar la ventana. Se
    conservan las 20 últimas decididas; un `id` descartado o de otra ventana responde "no hay ninguna propuesta
    con ese id en esta ventana".

### Errores

Los errores de herramienta llegan con `isError: true` y un texto que dice qué falta. Los más frecuentes:

- `No sé sobre qué sistema actuar: indica el sistema (destino)…`: no hay editor `abap:` ni sistema activo.
- `El destino … está esperando el logon del usuario en VS Code; vuelve a llamar…`: Sextante lanzó el logon
  y espera hasta 60 s; el agente debe reintentar.
- `El usuario canceló el logon … o el logon falló`: pedir al usuario que conecte desde la vista Sistemas.
- `La transacción solo se resuelve por RFC; …`: usar `abrir_objeto` con el programa.
- `No se pudo leer <uri>: ábrelo antes con abrir_objeto…`.
- `Rango no válido: …; pide un rango entre 1 y n`.
- `rechazado por rol: <destino> tiene rol …`: ver "Reglas de rol".
- `la uri contiene segmentos de ruta no válidos (".", ".." o vacíos)`: las herramientas que escriben o actúan
  sobre la oficial no aceptan rutas relativas, para que el control de rol no se salte con otro destino.
- `no se pudo poner el archivo en el editor activo; …`: `verificar_sintaxis`, `ejecutar_unit_tests` o `activar`
  no pudieron dejar el archivo como editor activo; el usuario debe abrirlo y el agente volver a llamar.
- `El objeto no está cargado en la vista Objeto; ábrelo primero con abrir_objeto…`.
- Entradas fuera de esquema (nombres con caracteres no válidos, URI que no es `abap:`): el texto indica el
  campo y el motivo.

## Reglas de rol

Solo el rol DEV permite escribir. En QAS, PRD o sin rol asignado, `proponer_cambio`, `ejecutar_unit_tests` y
`activar` responden `rechazado por rol`, igual que `crear_objeto`, sin tocar nada. `verificar_sintaxis`, `estado_propuesta` y las
herramientas de lectura funcionan con cualquier rol, igual que `ejecutar_atc`.

## Diario por objeto

Sextante guarda, para cada objeto, un diario en Markdown de lo que se hizo y por qué, para que el agente (y tú)
retomen un objeto días después sin repetir trabajo ni deshacer decisiones tomadas a propósito.

| Herramienta | Entrada | Devuelve |
|---|---|---|
| `diario_objeto` | `uri` | JSON `{ objeto, tipo, sistema, archivo, entradas, texto, recortado }`. Si no hay diario, `entradas: 0` y una `indicacion`. Al agente le llegan como máximo 30 000 caracteres (las últimas entradas); `recortado` lo indica |
| `anotar_diario` | `uri`, `texto` (1 a 4000 caracteres) | `{ archivo, entradas }`: añade una entrada `nota` al final |

Ambas funcionan con cualquier rol (también en QAS y PRD): escriben en tu disco, no en SAP. `contexto_actual`
incluye la clave `diario` (`entradas`, `ultima` y `archivo`, la ruta del `.md`) cuando el objeto tiene diario.

**Dónde está.** `<globalStorage>/diario/<destino>/<TIPO>-<NOMBRE>.md`, un archivo por destino y objeto (el nombre
va con `encodeURIComponent`, así `/ABC/CL_X` es `%2FABC%2FCL_X`). Es por destino: el mismo programa en DEV y en
QAS tiene diarios distintos. Un include de programa va al diario del **programa** cuando la vista Objeto muestra
ese programa y el include cuelga de su árbol (lo abriste desde el programa o la vista lo enseña dentro de él); la
línea `Archivo:` lleva entonces el nombre del include. Si no (include abierto suelto, o una ventana que no tiene ese
programa en la vista), el include tiene diario propio (`INCL-<NOMBRE>.md`), porque el FS `abap:` no lo enlaza con
su principal; por eso las instrucciones al agente le piden consultar también el del principal. Los includes de un
grupo de funciones van siempre al diario del `FUGR`, y los locales de una clase, al de la `CLAS`. El
archivo se crea en la primera escritura; un objeto sin historia no deja rastro. El destino se valida y la ruta
final debe quedar dentro de la carpeta del diario.

**Formato.**

```markdown
# Diario de ZXXX_REPORT (PROG) en DEV_S4H

Lo escriben Sextante (propuestas aplicadas y rechazadas), el agente de IA (notas) y tú. Puedes editarlo
libremente; cada entrada empieza por `## fecha · tipo`.

## 2026-11-04 10:32 · aplicado · Validar fecha vacía antes del SELECT
Archivo: ZXXX_REPORT_F01
Por qué: el SELECT con fecha inicial vacía recorría toda la tabla; el usuario confirmó que el campo es obligatorio.

## 2026-11-04 10:40 · rechazado · Quitar el SELECT * del FORM leer_datos
Archivo: ZXXX_REPORT_F01
Motivo del usuario: ya se usa así en otros reports y no vamos a tocarlo ahora.

## 2026-11-04 10:45 · nota
Revisado completo el flujo de selección (START-OF-SELECTION → leer_datos → mostrar_alv). El FORM mostrar_alv
usa REUSE_ALV_GRID_DISPLAY; no se cambia a CL_SALV_TABLE porque el usuario quiere mantener la variante de
layout guardada. Pendiente para otra vez: el MESSAGE en el F01 línea 120 no tiene clase de mensaje.
```

Las dos primeras entradas son de propuestas sobre el include `ZXXX_REPORT_F01` hechas con `ZXXX_REPORT` en la vista
Objeto: por eso están en el diario del programa con `Archivo: ZXXX_REPORT_F01`. Con el include abierto suelto
habrían ido a `INCL-ZXXX_REPORT_F01.md` con `Archivo: principal`.

Las entradas nuevas van al final y la hora es la local de tu máquina. Una línea `## ` dentro del texto del agente
se pasa a `### ` para no partir la entrada.

**Qué se anota solo.** Cuando decides una propuesta: `aplicado` siempre (si la oficial no guardó en SAP, con una
línea `Aviso:`) y `rechazado` con tu motivo si lo escribiste. No se anotan las propuestas `caducada` ni los rechazos
técnicos (VS Code no pudo aplicar la edición): no fueron decisión tuya. El texto de `porque` del agente va en la
línea `Por qué:`. Nunca se guarda código ni diff. Un fallo al escribir se registra en el log y no altera tu decisión.

**Editarlo y abrirlo.** El archivo es tuyo: edítalo libremente (cada entrada empieza por `## fecha · tipo`; una
línea `## ` que no siga el patrón cuenta como entrada de tipo `otro`). Se abre con el botón **Abrir diario del
objeto** del título de la vista Objeto o con el nodo **Diario · N entradas · última …** del final del árbol (solo
si el objeto tiene diario con entradas); si no existe, el botón lo crea con la cabecera. Comando
`abapNavigator.objeto.diario`.

## Vista "Actividad de la IA"

Está en el contenedor de Sextante. Muestra:

- Estado del servidor: puerto, número de sesiones, o "atiende otra ventana".
- Las últimas llamadas del agente: hora, herramienta, resumen de la entrada y resultado (ok o error). Un clic
  en una llamada con `uri` abre ese archivo.
- La sección **Propuestas**: las pendientes y las 20 últimas decididas, cada una con su resumen, archivo y estado
  (el motivo en el tooltip). Un clic en una pendiente reabre su diff; en una decidida muestra su estado. Las
  pendientes llevan en línea los botones **Aplicar cambio** y **Rechazar**. La
  vista "Actividad de la IA" lleva un **badge** con el número de propuestas pendientes ("1
  propuesta pendiente", "N propuestas pendientes").

Botones: Arrancar, Parar, Conectar el agente, Copiar configuración MCP, Regenerar token (reinicia el servidor
y obliga a registrar de nuevo el agente).

Ajustes:

- `abapNavigator.ia.servidor` (por defecto `true`): arranca el servidor al activar la extensión.
- `abapNavigator.ia.puerto` (por defecto `2237`, 1024 a 65535).

## Varias ventanas de VS Code

El agente conoce un solo puerto, así que atiende una sola ventana: la última que tuvo el foco. El servidor
no se cierra al perder el foco. Al ganar el foco, una ventana que no atiende pide el puerto: si está ocupado,
envía `POST /ceder` a `127.0.0.1:<puerto>` con el token compartido; la que atiende responde 204, cierra su
servidor y muestra "atiende otra ventana", y la que pide reintenta hasta 6 veces cada 500 ms. Una ventana
sola nunca cede. Un `Mcp-Session-Id` desconocido se acepta como sesión nueva.

Pasar el foco a otra ventana de Sextante corta una espera del agente en curso (`proponer_cambio` o
`estado_propuesta`); la propuesta sigue pendiente en la ventana que la abrió.

## No verificado (ATC)

- Si el ATC de la oficial evalúa la versión activa o la inactiva del objeto.
- Si un ATC cancelado o con error se distingue de uno limpio: la oficial solo lo avisa en la ventana del usuario y no
  deja rastro que Sextante lea.
- Límite conocido de la señal (`huboSenal`): cualquier aviso de diagnósticos sobre un archivo que ya tenía hallazgos ATC
  cuenta como señal (por ejemplo, el servidor de lenguaje republicando diagnósticos de sintaxis), así que hallazgos
  viejos pueden volver como `con hallazgos`.
- La variante de chequeo por defecto del sistema: se tomó del bundle 1.2.0 (cadena vacía), sin probar en un sistema real.
- Que el ATC corra sobre el objeto completo y no solo sobre el archivo cuya uri se pasa.

## Qué no hay todavía

- Diccionario, dónde se usa, versiones, dumps y comparar con otro sistema para el agente (entrega 4c).
- Diario compartido entre personas o máquinas: el diario vive en tu `globalStorage`.
- Búsqueda en todos los diarios a la vez.
- Aviso entre ventanas de VS Code cuando otra ventana escribe en un diario (el nodo Diario se refresca al cambiar
  de objeto).

## Seguridad

- Solo `127.0.0.1`; si llega una cabecera `Origin` que no sea `localhost` o `127.0.0.1`, 403.
- Token Bearer aleatorio guardado en `context.secrets` y compartido por las ventanas; sin token válido, 401.
  Nunca va a settings, logs ni archivos de Sextante.
- Cuerpo de petición máximo de 2 MB.
- El token aparece en `~/.claude.json` (en la cabecera del servidor `sextante`), igual que el del servidor
  `adt` de SAP. Es un token local, no una credencial SAP; si se filtra, usa "Regenerar token".
- El log "Sextante" solo guarda forma y conteos (por ejemplo "propuesta aplicada (N líneas)"), nunca código, el
  resumen de la propuesta, nombres de objetos de cliente ni credenciales.
- **Convivencia con el servidor `adt` de SAP:** si también lo tienes registrado y la extensión oficial tiene
  activado `adt.mcpServer.enableEditFileToolForABAPObjects` (por defecto `false`), el agente podría editar con
  `abap_object_edit_file` saltándose el diff y la regla de rol. Mantén ese ajuste desactivado.
