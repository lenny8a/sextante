# Puente RFC (`puente-rfc`)

Proceso Java hijo de ABAP Navigator. Recibe peticiones ADT por `stdin` y las tuneliza por RFC con
la función `SADT_REST_RFC_ENDPOINT`, usando el JRE y el SAP JCo que ya trae la extensión oficial
`sapse.adt-vscode`. Ni el JRE ni JCo se copian al repositorio ni al VSIX.

## Piezas

| Archivo | Papel |
| --- | --- |
| `src/PuenteRfc.java` | bucle principal, `preparar` (extrae la DLL), despacho por `tipo` |
| `src/Rfc.java` | todo lo que toca JCo (destinos, `ping`, llamada a la función) |
| `src/Protocolo.java` | respuestas, clases de error, salida por `stdout` y registro por `stderr` |
| `src/Json.java` | serializador y parser JSON mínimos, sin librerías |

`PuenteRfc` no menciona ningún tipo de JCo: `Rfc` solo se usa después de que `preparar` haya
extraído `sapjco3.dll`, así ninguna clase `com.sap.conn.jco` se carga antes.

## Compilar

`pnpm run compile` llama a `pnpm run compile:puente` (`scripts/compilar-puente.ts`): localiza
`javac` (`JAVA_HOME/bin/javac` o el `PATH`) y el JAR de JCo de la oficial, y compila
`src/*.java` a `out/puente-rfc/` con `-encoding UTF-8 --release 8` (o `-source 8 -target 8` si el
`javac` no admite `--release`). Sin `javac` o sin la oficial avisa y termina con código 0: el
puente simplemente no estará disponible.

## Lanzar

```
<java de la oficial> -Djava.library.path=<carpetaLib> -cp <out/puente-rfc><sep><carpetaLib>/com.sap.conn.jco-<versión>.jar PuenteRfc
```

`<sep>` es el separador de classpath de la plataforma (`path.delimiter` en Node). JCo comprueba
el nombre del archivo del JAR: el verificado es `com.sap.conn.jco-<versión>.jar` (con guion); la
copia a `carpetaLib` la hace el cliente TypeScript.

## Protocolo

Una línea JSON por mensaje, UTF-8, en ambos sentidos. `stdout` solo lleva respuestas.

```
→ {"id":1,"tipo":"preparar","fragmentoJar":"C:\\…\\com.sap.conn.jco.win32.x86_64_3.1.14.jar","carpetaLib":"C:\\…\\lib"}
← {"id":1,"ok":true,"versionJco":"3.1.14"}
→ {"id":2,"tipo":"logon","destino":"DEST","conexion":{"ashost":"…","sysnr":"10","client":"100","lang":"ES","saprouter":"/H/…"},"usuario":"U","contrasena":"P"}
← {"id":2,"ok":true,"sistema":"DEV","release":"752"}  |  {"id":2,"error":{"clase":"logon","mensaje":"…"}}
→ {"id":3,"tipo":"peticion","destino":"DEST","metodo":"GET","uri":"/sap/bc/adt/discovery","cabeceras":{"Accept":"*/*"},"cuerpo":""}
← {"id":3,"estado":200,"razon":"OK","cabeceras":{"Content-Type":"application/atomsvc+xml"},"cuerpo":"<base64>"}
→ {"id":6,"tipo":"tabla","destino":"DEST","tabla":"SNAP","campos":["SEQNO","FLIST"],"condiciones":["DATUM EQ '20261103'"],"filasMax":0}
← {"id":6,"columnas":[{"nombre":"SEQNO","longitud":3},{"nombre":"FLIST","longitud":200}],"filas":[["000","…"],…]}
→ {"id":4,"tipo":"olvidar","destino":"DEST"}   ← {"id":4,"ok":true}
→ {"id":5,"tipo":"salir"}                       ← {"id":5,"ok":true} y el proceso termina
```

- `preparar` extrae `lib/sapjco3.dll` del fragmento nativo a `carpetaLib` si falta (o si su tamaño
  no coincide); `versionJco` sale del `Bundle-Version` del fragmento.
- `conexion` admite `ashost, sysnr, client, lang, saprouter, mshost, msserv, group, sysid`
  (`sysid` va a `jco.client.r3name`); otra clave es error de protocolo. Destino con
  `pool_capacity=3` y `peak_limit=5` (ver "Concurrencia"). `logon` hace `ping`; si falla, olvida el destino.
- `cuerpo` siempre en base64 (vacío = sin cuerpo). Cabeceras de respuesta repetidas se unen con `, `.
- Los nombres de cabecera de la petición pasan tal cual se envían: el cliente TypeScript los manda
  en minúscula (p. ej. `accept`) y el endpoint los aceptó así en la prueba real del 2026-10-30.
- `tabla` solo admite la lista blanca `TABLAS_LEGIBLES` del puente (hoy `SNAP`); cualquier otra, error de protocolo.
- `tabla` lee una tabla con `RFC_READ_TABLE` (`DELIMITER` vacío; `filasMax` 0 = sin límite). `tabla` debe
  cumplir `^[A-Z0-9_/]{1,30}$`, cada campo `^[A-Z0-9_]{1,30}$`, cada condición ≤ 72 caracteres y
  `campos` no puede estar vacío; si no, error de protocolo. Los valores salen con su relleno hasta la
  `longitud` de la columna (JCo recorta los blancos finales de la línea y el puente los repone); el
  cliente recorta lo que quiera. Se atiende en el mismo pool que `peticion`.
- `olvidar` borra los datos del destino (y avisa a JCo para que cierre sus conexiones).
- El fin de `stdin` termina el proceso con código 0.

### Concurrencia

- Las líneas `peticion` y `tabla` se atienden en un pool fijo de 4 hilos daemon: una consulta corta no espera
  a una larga. Sus respuestas pueden llegar en otro orden; el cliente las empareja por `id`.
- `preparar`, `logon`, `olvidar`, `salir` y los errores de protocolo siguen en el hilo lector, en el
  orden en que llegan. Mientras uno de ellos se atiende no se leen más líneas.
- Cada respuesta se escribe entera en una sola línea (`Protocolo.responder` es `synchronized`).
- Cada petición crea su propia `JCoFunction`; el destino JCo admite hasta 5 conexiones
  (`peak_limit`), las 4 del pool más un `logon`.
- `salir` y el fin de `stdin` dejan de aceptar peticiones y esperan a las que están en curso como
  mucho 2 s antes de terminar con código 0.
- El tiempo máximo es cosa del cliente TypeScript: `PeticionAdt.tiempoMs` por petición (si falta, el
  `tiempoMs` del puente, 60 s por defecto). Al agotarse, el cliente rechaza solo esa petición con la
  clase `tiempo` y descarta su respuesta si llega tarde; el proceso y las demás peticiones siguen.
  El puente Java nunca envía la clase `tiempo`.

### Errores

`{"id":n,"error":{"clase":"…","mensaje":"…"}}`

| `clase` | Cuándo |
| --- | --- |
| `logon` | JCo `JCO_ERROR_LOGON_FAILURE` |
| `comunicacion` | JCo `JCO_ERROR_COMMUNICATION` o `JCO_ERROR_SYSTEM_FAILURE` |
| `funcion` | el sistema no tiene `SADT_REST_RFC_ENDPOINT` (o `RFC_READ_TABLE` en `tabla`) |
| `abap` | excepción ABAP de la función; `mensaje` es su nombre (`TABLE_NOT_AVAILABLE`, `NOT_AUTHORIZED`, `OPTION_NOT_VALID`, …) |
| `protocolo` | línea que no es JSON (respuesta sin `id`), `tipo` desconocido, campo ausente, falta `preparar` o `logon` |
| `otro` | cualquier otro fallo |

## Registro y seguridad

- `stderr`: una línea por mensaje (`puente-rfc: …`) con tipo, destino, método, estado, bytes y
  milisegundos. Nunca la URI completa, cabeceras, cuerpos ni la contraseña. `jco.trace_level=0`.
- Las `condiciones` de `tabla` nunca van al registro (pueden llevar un nombre de usuario): la línea
  es `tabla destino=… tabla=SNAP campos=2 filas=16 ms=…`.
- La contraseña solo llega en la línea `logon` por `stdin` y vive en memoria mientras el destino
  esté abierto. Nunca va en argumentos, variables de entorno, registros ni disco.
