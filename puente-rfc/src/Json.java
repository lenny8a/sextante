import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Serializador y parser JSON mínimos para el protocolo del puente: objetos, cadenas con escapes,
 * números enteros, booleanos, null y listas. Sin decimales.
 */
final class Json {

    static final class ErrorJson extends Exception {
        ErrorJson(String mensaje) {
            super(mensaje);
        }
    }

    private final String texto;
    private int pos;

    private Json(String texto) {
        this.texto = texto;
    }

    static Map<String, Object> leerObjeto(String texto) throws ErrorJson {
        Json lector = new Json(texto);
        lector.saltarEspacios();
        Map<String, Object> objeto = lector.objeto();
        lector.saltarEspacios();
        if (lector.pos != texto.length()) {
            throw lector.error("contenido sobrante tras el objeto");
        }
        return objeto;
    }

    static String escribir(Map<String, ?> objeto) {
        StringBuilder salida = new StringBuilder();
        escribirObjeto(objeto, salida);
        return salida.toString();
    }

    private Map<String, Object> objeto() throws ErrorJson {
        esperar('{');
        Map<String, Object> objeto = new LinkedHashMap<String, Object>();
        saltarEspacios();
        if (consumir('}')) {
            return objeto;
        }
        do {
            saltarEspacios();
            String clave = cadena();
            saltarEspacios();
            esperar(':');
            saltarEspacios();
            objeto.put(clave, valor());
            saltarEspacios();
        } while (consumir(','));
        esperar('}');
        return objeto;
    }

    private List<Object> lista() throws ErrorJson {
        esperar('[');
        List<Object> elementos = new ArrayList<Object>();
        saltarEspacios();
        if (consumir(']')) {
            return elementos;
        }
        do {
            saltarEspacios();
            elementos.add(valor());
            saltarEspacios();
        } while (consumir(','));
        esperar(']');
        return elementos;
    }

    private Object valor() throws ErrorJson {
        if (pos >= texto.length()) {
            throw error("fin inesperado");
        }
        char c = texto.charAt(pos);
        if (c == '{') {
            return objeto();
        }
        if (c == '[') {
            return lista();
        }
        if (c == '"') {
            return cadena();
        }
        if (c == '-' || (c >= '0' && c <= '9')) {
            return entero();
        }
        if (texto.startsWith("true", pos)) {
            pos += 4;
            return Boolean.TRUE;
        }
        if (texto.startsWith("false", pos)) {
            pos += 5;
            return Boolean.FALSE;
        }
        if (texto.startsWith("null", pos)) {
            pos += 4;
            return null;
        }
        throw error("valor no admitido");
    }

    private Long entero() throws ErrorJson {
        int inicio = pos;
        if (texto.charAt(pos) == '-') {
            pos++;
        }
        int digitos = pos;
        while (pos < texto.length() && texto.charAt(pos) >= '0' && texto.charAt(pos) <= '9') {
            pos++;
        }
        if (pos == digitos) {
            throw error("número sin dígitos");
        }
        if (pos < texto.length() && ".eE".indexOf(texto.charAt(pos)) >= 0) {
            throw error("solo se admiten números enteros");
        }
        try {
            return Long.valueOf(texto.substring(inicio, pos));
        } catch (NumberFormatException e) {
            throw error("número fuera de rango");
        }
    }

    private String cadena() throws ErrorJson {
        esperar('"');
        StringBuilder salida = new StringBuilder();
        while (true) {
            if (pos >= texto.length()) {
                throw error("cadena sin cerrar");
            }
            char c = texto.charAt(pos++);
            if (c == '"') {
                return salida.toString();
            }
            if (c < 0x20) {
                throw error("carácter de control sin escapar");
            }
            if (c != '\\') {
                salida.append(c);
                continue;
            }
            if (pos >= texto.length()) {
                throw error("escape incompleto");
            }
            char e = texto.charAt(pos++);
            switch (e) {
                case '"': salida.append('"'); break;
                case '\\': salida.append('\\'); break;
                case '/': salida.append('/'); break;
                case 'b': salida.append('\b'); break;
                case 'f': salida.append('\f'); break;
                case 'n': salida.append('\n'); break;
                case 'r': salida.append('\r'); break;
                case 't': salida.append('\t'); break;
                case 'u': salida.append(unicode()); break;
                default: throw error("escape no válido");
            }
        }
    }

    private char unicode() throws ErrorJson {
        if (pos + 4 > texto.length()) {
            throw error("escape \\u incompleto");
        }
        try {
            char c = (char) Integer.parseInt(texto.substring(pos, pos + 4), 16);
            pos += 4;
            return c;
        } catch (NumberFormatException e) {
            throw error("escape \\u no válido");
        }
    }

    private void saltarEspacios() {
        while (pos < texto.length() && " \t\r\n".indexOf(texto.charAt(pos)) >= 0) {
            pos++;
        }
    }

    private boolean consumir(char c) {
        if (pos < texto.length() && texto.charAt(pos) == c) {
            pos++;
            return true;
        }
        return false;
    }

    private void esperar(char c) throws ErrorJson {
        if (!consumir(c)) {
            throw error("se esperaba '" + c + "'");
        }
    }

    private ErrorJson error(String mensaje) {
        return new ErrorJson("JSON no válido en la posición " + pos + ": " + mensaje);
    }

    private static void escribirObjeto(Map<String, ?> objeto, StringBuilder salida) {
        salida.append('{');
        boolean primero = true;
        for (Map.Entry<String, ?> entrada : objeto.entrySet()) {
            if (!primero) {
                salida.append(',');
            }
            primero = false;
            escribirCadena(entrada.getKey(), salida);
            salida.append(':');
            escribirValor(entrada.getValue(), salida);
        }
        salida.append('}');
    }

    @SuppressWarnings("unchecked")
    private static void escribirValor(Object valor, StringBuilder salida) {
        if (valor == null) {
            salida.append("null");
        } else if (valor instanceof String) {
            escribirCadena((String) valor, salida);
        } else if (valor instanceof Number || valor instanceof Boolean) {
            salida.append(valor.toString());
        } else if (valor instanceof Map) {
            escribirObjeto((Map<String, ?>) valor, salida);
        } else if (valor instanceof Iterable) {
            salida.append('[');
            boolean primero = true;
            for (Object elemento : (Iterable<?>) valor) {
                if (!primero) {
                    salida.append(',');
                }
                primero = false;
                escribirValor(elemento, salida);
            }
            salida.append(']');
        } else {
            escribirCadena(valor.toString(), salida);
        }
    }

    private static void escribirCadena(String texto, StringBuilder salida) {
        salida.append('"');
        for (int i = 0; i < texto.length(); i++) {
            char c = texto.charAt(i);
            switch (c) {
                case '"': salida.append("\\\""); break;
                case '\\': salida.append("\\\\"); break;
                case '\n': salida.append("\\n"); break;
                case '\r': salida.append("\\r"); break;
                case '\t': salida.append("\\t"); break;
                default:
                    if (c < 0x20 || c == ' ' || c == ' ') {
                        salida.append(String.format("\\u%04x", (int) c));
                    } else {
                        salida.append(c);
                    }
            }
        }
        salida.append('"');
    }
}
