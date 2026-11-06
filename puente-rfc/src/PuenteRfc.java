import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.jar.Manifest;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Proceso hijo de ABAP Navigator: recibe peticiones ADT por stdin (una línea JSON por petición) y
 * las tuneliza por RFC (SADT_REST_RFC_ENDPOINT) con el JCo de la extensión oficial.
 *
 * Esta clase no menciona ningún tipo de JCo: todo eso vive en Rfc, que solo se usa después de que
 * 'preparar' haya extraído sapjco3.dll.
 *
 * Las líneas 'peticion' se atienden en un pool de HILOS_PETICION hilos para que una consulta corta no
 * espere a una larga; 'preparar', 'logon', 'olvidar' y 'salir' siguen en orden en el hilo lector.
 */
public final class PuenteRfc {

    private static final String ENTRADA_DLL = "lib/sapjco3.dll";
    private static final String NOMBRE_DLL = "sapjco3.dll";
    private static final List<String> TIPOS = Arrays.asList("preparar", "logon", "peticion", "tabla", "olvidar", "salir");
    private static final Pattern VERSION_EN_NOMBRE = Pattern.compile("_(\\d+(?:\\.\\d+)*)\\.jar$");
    private static final int HILOS_PETICION = 4;
    private static final long ESPERA_AL_SALIR_S = 2;

    /** Hilos daemon: no impiden que el proceso termine. Se crean al llegar la primera petición. */
    private static final ExecutorService PETICIONES = Executors.newFixedThreadPool(HILOS_PETICION, tarea -> {
        Thread hilo = new Thread(tarea, "puente-rfc-peticion");
        hilo.setDaemon(true);
        return hilo;
    });

    private static volatile boolean preparado;

    private PuenteRfc() {
    }

    public static void main(String[] argumentos) throws IOException {
        System.setProperty("jco.trace_level", "0");
        Protocolo.iniciarSalida();
        BufferedReader entrada = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
        String linea;
        while ((linea = entrada.readLine()) != null) {
            if (linea.trim().isEmpty()) {
                continue;
            }
            if (!atender(linea)) {
                terminar();
            }
        }
        Protocolo.registrar("fin de stdin");
        terminar();
    }

    /** Deja que las peticiones en curso respondan, como mucho ESPERA_AL_SALIR_S segundos, y termina con 0. */
    private static void terminar() {
        PETICIONES.shutdown();
        try {
            PETICIONES.awaitTermination(ESPERA_AL_SALIR_S, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        System.exit(0);
    }

    /** Atiende una línea; devuelve false cuando hay que terminar. */
    private static boolean atender(String linea) {
        Map<String, Object> peticion;
        try {
            peticion = Json.leerObjeto(linea);
        } catch (Json.ErrorJson e) {
            Protocolo.registrar("protocolo error línea no válida caracteres=" + linea.length());
            Protocolo.responder(Protocolo.error(null, Protocolo.PROTOCOLO, e.getMessage()));
            return true;
        }
        final String tipo = TIPOS.contains(peticion.get("tipo")) ? (String) peticion.get("tipo") : "desconocido";
        Object destinoCrudo = peticion.get("destino");
        final String destino = destinoCrudo instanceof String ? " destino=" + destinoCrudo : "";
        Long id = null;
        try {
            id = Protocolo.id(peticion);
            String clase = Protocolo.cadena(peticion, "tipo");
            if ("preparar".equals(clase)) {
                Protocolo.responder(preparar(id, peticion));
            } else if ("logon".equals(clase)) {
                Protocolo.responder(logon(id, peticion));
                Protocolo.registrar("logon" + destino + " ok");
            } else if ("peticion".equals(clase)) {
                final Long idPeticion = id;
                final Map<String, Object> datos = peticion;
                PETICIONES.execute(() -> atenderPeticion(idPeticion, datos, tipo, destino));
            } else if ("tabla".equals(clase)) {
                final Long idTabla = id;
                final Map<String, Object> datosTabla = peticion;
                PETICIONES.execute(() -> atenderTabla(idTabla, datosTabla, tipo, destino));
            } else if ("olvidar".equals(clase)) {
                if (preparado) {
                    Rfc.olvidar(Protocolo.cadena(peticion, "destino"));
                }
                Protocolo.responder(Protocolo.ok(id));
                Protocolo.registrar("olvidar" + destino);
            } else if ("salir".equals(clase)) {
                Protocolo.responder(Protocolo.ok(id));
                Protocolo.registrar("salir");
                return false;
            } else {
                throw new Protocolo.Fallo(Protocolo.PROTOCOLO, "tipo desconocido");
            }
        } catch (Throwable e) {
            responderFallo(id, tipo, destino, e);
        }
        return true;
    }

    /** Corre en un hilo del pool; responde lo que pase, igual que el hilo lector. */
    private static void atenderPeticion(Long id, Map<String, Object> peticion, String tipo, String destino) {
        try {
            Protocolo.responder(peticion(id, peticion));
        } catch (Throwable e) {
            responderFallo(id, tipo, destino, e);
        }
    }

    private static void atenderTabla(Long id, Map<String, Object> peticion, String tipo, String destino) {
        try {
            Protocolo.responder(tabla(id, peticion));
        } catch (Throwable e) {
            responderFallo(id, tipo, destino, e);
        }
    }

    private static void responderFallo(Long id, String tipo, String destino, Throwable e) {
        if (e instanceof Protocolo.Fallo) {
            String clase = ((Protocolo.Fallo) e).clase;
            Protocolo.registrar(tipo + destino + " error clase=" + clase);
            Protocolo.responder(Protocolo.error(id, clase, e.getMessage()));
            return;
        }
        Protocolo.registrar(tipo + destino + " error clase=" + Protocolo.OTRO + " excepcion=" + e.getClass().getSimpleName());
        Protocolo.responder(Protocolo.error(id, Protocolo.OTRO, e.getClass().getSimpleName() + ": " + e.getMessage()));
    }

    private static Map<String, Object> preparar(Long id, Map<String, Object> peticion) throws Protocolo.Fallo {
        String fragmento = Protocolo.cadena(peticion, "fragmentoJar");
        File carpeta = new File(Protocolo.cadena(peticion, "carpetaLib"));
        if (!carpeta.isDirectory() && !carpeta.mkdirs()) {
            throw new Protocolo.Fallo(Protocolo.OTRO, "no se pudo crear la carpeta lib");
        }
        String version;
        boolean extraida;
        try (ZipFile zip = new ZipFile(fragmento)) {
            ZipEntry dll = zip.getEntry(ENTRADA_DLL);
            if (dll == null) {
                throw new Protocolo.Fallo(Protocolo.OTRO, "el fragmento nativo no contiene " + ENTRADA_DLL);
            }
            extraida = extraerSiFalta(zip, dll, new File(carpeta, NOMBRE_DLL));
            version = versionJco(zip, new File(fragmento).getName());
        } catch (IOException e) {
            throw new Protocolo.Fallo(Protocolo.OTRO, "no se pudo leer el fragmento nativo de JCo: " + e.getMessage());
        }
        preparado = true;
        Protocolo.registrar("preparar ok dll=" + (extraida ? "extraida" : "presente")
            + " bytes=" + new File(carpeta, NOMBRE_DLL).length());
        Map<String, Object> respuesta = Protocolo.ok(id);
        respuesta.put("versionJco", version);
        return respuesta;
    }

    /** Extrae la DLL si falta o su tamaño no coincide con el del fragmento; escribe aparte y renombra. */
    private static boolean extraerSiFalta(ZipFile zip, ZipEntry dll, File destino) throws IOException {
        if (destino.isFile() && (dll.getSize() < 0 || destino.length() == dll.getSize())) {
            return false;
        }
        Path temporal = Files.createTempFile(destino.getParentFile().toPath(), "sapjco3", ".tmp");
        try (InputStream datos = zip.getInputStream(dll)) {
            Files.copy(datos, temporal, StandardCopyOption.REPLACE_EXISTING);
            Files.move(temporal, destino.toPath(), StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temporal);
        }
        return true;
    }

    private static String versionJco(ZipFile zip, String nombreFragmento) throws IOException {
        ZipEntry manifiesto = zip.getEntry("META-INF/MANIFEST.MF");
        if (manifiesto != null) {
            try (InputStream datos = zip.getInputStream(manifiesto)) {
                String version = new Manifest(datos).getMainAttributes().getValue("Bundle-Version");
                if (version != null && !version.trim().isEmpty()) {
                    return version.trim();
                }
            }
        }
        Matcher coincidencia = VERSION_EN_NOMBRE.matcher(nombreFragmento);
        return coincidencia.find() ? coincidencia.group(1) : "";
    }

    private static Map<String, Object> logon(Long id, Map<String, Object> peticion) throws Protocolo.Fallo {
        exigirPreparado();
        return Rfc.logon(
            id,
            Protocolo.cadena(peticion, "destino"),
            Protocolo.objetoDeCadenas(peticion, "conexion", true),
            Protocolo.cadena(peticion, "usuario"),
            Protocolo.cadena(peticion, "contrasena"));
    }

    private static Map<String, Object> peticion(Long id, Map<String, Object> peticion) throws Protocolo.Fallo {
        exigirPreparado();
        String destino = Protocolo.cadena(peticion, "destino");
        String metodo = Protocolo.cadena(peticion, "metodo");
        String uri = Protocolo.cadena(peticion, "uri");
        Map<String, String> cabeceras = Protocolo.objetoDeCadenas(peticion, "cabeceras", false);
        byte[] cuerpo;
        try {
            cuerpo = Base64.getDecoder().decode(Protocolo.cadenaOpcional(peticion, "cuerpo"));
        } catch (IllegalArgumentException e) {
            throw new Protocolo.Fallo(Protocolo.PROTOCOLO, "el cuerpo no es base64 válido");
        }
        long inicio = System.currentTimeMillis();
        Map<String, Object> respuesta = Rfc.peticion(id, destino, metodo, uri, cabeceras, cuerpo);
        int recibidos = bytesDeBase64((String) respuesta.get("cuerpo"));
        Protocolo.registrar("peticion destino=" + destino + " metodo=" + metodo + " estado=" + respuesta.get("estado")
            + " enviados=" + cuerpo.length + " recibidos=" + recibidos
            + " ms=" + (System.currentTimeMillis() - inicio));
        return respuesta;
    }

    private static Map<String, Object> tabla(Long id, Map<String, Object> peticion) throws Protocolo.Fallo {
        exigirPreparado();
        String destino = Protocolo.cadena(peticion, "destino");
        String tabla = Protocolo.cadena(peticion, "tabla");
        List<String> campos = Protocolo.listaDeCadenas(peticion, "campos");
        List<String> condiciones = Protocolo.listaDeCadenas(peticion, "condiciones");
        long filasMax = Protocolo.enteroOpcional(peticion, "filasMax", 0);
        long inicio = System.currentTimeMillis();
        Map<String, Object> respuesta = Rfc.tabla(id, destino, tabla, campos, condiciones, filasMax);
        Protocolo.registrar("tabla destino=" + destino + " tabla=" + tabla + " campos=" + campos.size()
            + " filas=" + ((List<?>) respuesta.get("filas")).size()
            + " ms=" + (System.currentTimeMillis() - inicio));
        return respuesta;
    }

    private static int bytesDeBase64(String base64) {
        int relleno = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
        return base64.length() / 4 * 3 - relleno;
    }

    private static void exigirPreparado() throws Protocolo.Fallo {
        if (!preparado) {
            throw new Protocolo.Fallo(Protocolo.PROTOCOLO, "falta 'preparar' antes de usar RFC");
        }
    }
}
