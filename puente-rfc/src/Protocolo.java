import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.io.UnsupportedEncodingException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Protocolo por líneas JSON: un objeto por línea en stdout (UTF-8) y diagnóstico en stderr.
 * stdout solo lleva respuestas; stderr solo forma y conteos, nunca URI completa, cabeceras,
 * cuerpos ni contraseña.
 */
final class Protocolo {

    static final String PROTOCOLO = "protocolo";
    static final String LOGON = "logon";
    static final String COMUNICACION = "comunicacion";
    static final String FUNCION = "funcion";
    static final String ABAP = "abap";
    static final String OTRO = "otro";

    /** Fallo con la clase de error que viaja en la respuesta. */
    static final class Fallo extends Exception {
        final String clase;

        Fallo(String clase, String mensaje) {
            super(mensaje);
            this.clase = clase;
        }
    }

    private static PrintStream salida;

    private Protocolo() {
    }

    static void iniciarSalida() throws UnsupportedEncodingException {
        salida = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        System.setOut(System.err);
    }

    static synchronized void responder(Map<String, ?> respuesta) {
        salida.print(Json.escribir(respuesta));
        salida.print('\n');
        salida.flush();
    }

    static void registrar(String mensaje) {
        System.err.println("puente-rfc: " + mensaje);
        System.err.flush();
    }

    static Map<String, Object> conId(Long id) {
        Map<String, Object> respuesta = new LinkedHashMap<String, Object>();
        if (id != null) {
            respuesta.put("id", id);
        }
        return respuesta;
    }

    static Map<String, Object> ok(Long id) {
        Map<String, Object> respuesta = conId(id);
        respuesta.put("ok", Boolean.TRUE);
        return respuesta;
    }

    static Map<String, Object> error(Long id, String clase, String mensaje) {
        Map<String, Object> detalle = new LinkedHashMap<String, Object>();
        detalle.put("clase", clase);
        detalle.put("mensaje", mensaje == null ? "" : mensaje);
        Map<String, Object> respuesta = conId(id);
        respuesta.put("error", detalle);
        return respuesta;
    }

    static Long id(Map<String, Object> peticion) throws Fallo {
        Object valor = peticion.get("id");
        if (valor == null) {
            return null;
        }
        if (!(valor instanceof Long)) {
            throw new Fallo(PROTOCOLO, "el campo 'id' debe ser un número entero");
        }
        return (Long) valor;
    }

    static String cadena(Map<String, Object> peticion, String campo) throws Fallo {
        Object valor = peticion.get(campo);
        if (!(valor instanceof String)) {
            throw new Fallo(PROTOCOLO, "falta el campo de texto '" + campo + "'");
        }
        return (String) valor;
    }

    static String cadenaOpcional(Map<String, Object> peticion, String campo) throws Fallo {
        return peticion.get(campo) == null ? "" : cadena(peticion, campo);
    }

    static List<String> listaDeCadenas(Map<String, Object> peticion, String campo) throws Fallo {
        Object valor = peticion.get(campo);
        if (!(valor instanceof List)) {
            throw new Fallo(PROTOCOLO, "falta la lista '" + campo + "'");
        }
        List<String> resultado = new ArrayList<String>();
        for (Object elemento : (List<?>) valor) {
            if (!(elemento instanceof String)) {
                throw new Fallo(PROTOCOLO, "falta la lista '" + campo + "'");
            }
            resultado.add((String) elemento);
        }
        return resultado;
    }

    static long enteroOpcional(Map<String, Object> peticion, String campo, long porDefecto) throws Fallo {
        Object valor = peticion.get(campo);
        if (valor == null) {
            return porDefecto;
        }
        if (!(valor instanceof Long)) {
            throw new Fallo(PROTOCOLO, "el campo '" + campo + "' debe ser un número entero");
        }
        return (Long) valor;
    }

    /** Objeto anidado cuyos valores son todos cadenas (conexion, cabeceras). */
    static Map<String, String> objetoDeCadenas(Map<String, Object> peticion, String campo, boolean obligatorio) throws Fallo {
        Object valor = peticion.get(campo);
        Map<String, String> resultado = new LinkedHashMap<String, String>();
        if (valor == null && !obligatorio) {
            return resultado;
        }
        if (!(valor instanceof Map)) {
            throw new Fallo(PROTOCOLO, "falta el objeto '" + campo + "'");
        }
        for (Map.Entry<?, ?> entrada : ((Map<?, ?>) valor).entrySet()) {
            if (!(entrada.getValue() instanceof String)) {
                throw new Fallo(PROTOCOLO, "los valores de '" + campo + "' deben ser texto");
            }
            resultado.put((String) entrada.getKey(), (String) entrada.getValue());
        }
        return resultado;
    }
}
