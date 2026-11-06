import com.sap.conn.jco.JCoAttributes;
import com.sap.conn.jco.JCoDestination;
import com.sap.conn.jco.JCoDestinationManager;
import com.sap.conn.jco.JCoException;
import com.sap.conn.jco.JCoFunction;
import com.sap.conn.jco.JCoRuntimeException;
import com.sap.conn.jco.JCoStructure;
import com.sap.conn.jco.JCoTable;
import com.sap.conn.jco.ext.DestinationDataEventListener;
import com.sap.conn.jco.ext.DestinationDataProvider;
import com.sap.conn.jco.ext.Environment;
import com.sap.conn.jco.AbapException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Todo lo que toca JCo. PuenteRfc solo usa esta clase después de que 'preparar' haya extraído
 * sapjco3.dll, para que ninguna clase com.sap.conn.jco se cargue antes.
 */
final class Rfc {

    private static final String FUNCION_ADT = "SADT_REST_RFC_ENDPOINT";
    private static final String FUNCION_TABLA = "RFC_READ_TABLE";
    /** Segunda barrera: solo estas tablas se leen, aunque el cliente ya filtre. */
    private static final List<String> TABLAS_LEGIBLES = Arrays.asList("SNAP");
    private static final Pattern TABLA_VALIDA = Pattern.compile("^[A-Z0-9_/]{1,30}$");
    private static final Pattern CAMPO_VALIDO = Pattern.compile("^[A-Z0-9_]{1,30}$");
    private static final int LONGITUD_MAXIMA_CONDICION = 72;

    /** Datos de conexión por destino; la contraseña solo vive aquí, en memoria. */
    private static final class Proveedor implements DestinationDataProvider {
        private final Map<String, Properties> destinos = new ConcurrentHashMap<String, Properties>();
        private volatile DestinationDataEventListener oyente;

        public Properties getDestinationProperties(String destino) {
            return destinos.get(destino);
        }

        public boolean supportsEvents() {
            return true;
        }

        public void setDestinationDataEventListener(DestinationDataEventListener oyente) {
            this.oyente = oyente;
        }

        void poner(String destino, Properties datos) {
            boolean existia = destinos.put(destino, datos) != null;
            DestinationDataEventListener actual = oyente;
            if (existia && actual != null) {
                actual.updated(destino);
            }
        }

        boolean quitar(String destino) {
            boolean existia = destinos.remove(destino) != null;
            DestinationDataEventListener actual = oyente;
            if (existia && actual != null) {
                actual.deleted(destino);
            }
            return existia;
        }

        boolean tiene(String destino) {
            return destinos.containsKey(destino);
        }
    }

    private static volatile Proveedor proveedor;

    private Rfc() {
    }

    private static synchronized Proveedor proveedor() {
        if (proveedor == null) {
            proveedor = new Proveedor();
            Environment.registerDestinationDataProvider(proveedor);
        }
        return proveedor;
    }

    static Map<String, Object> logon(Long id, String destino, Map<String, String> conexion, String usuario, String contrasena)
            throws Protocolo.Fallo {
        Properties datos = new Properties();
        for (Map.Entry<String, String> entrada : conexion.entrySet()) {
            if (!entrada.getValue().isEmpty()) {
                datos.setProperty(claveJco(entrada.getKey()), entrada.getValue());
            }
        }
        datos.setProperty(DestinationDataProvider.JCO_USER, usuario);
        datos.setProperty(DestinationDataProvider.JCO_PASSWD, contrasena);
        // Hasta 4 peticiones a la vez desde el pool de PuenteRfc más un logon u olvido.
        datos.setProperty(DestinationDataProvider.JCO_POOL_CAPACITY, "3");
        datos.setProperty(DestinationDataProvider.JCO_PEAK_LIMIT, "5");
        Proveedor actual = proveedor();
        actual.poner(destino, datos);
        try {
            JCoDestination jco = JCoDestinationManager.getDestination(destino);
            jco.ping();
            JCoAttributes atributos = jco.getAttributes();
            Map<String, Object> respuesta = Protocolo.ok(id);
            respuesta.put("sistema", atributos.getSystemID());
            respuesta.put("release", atributos.getPartnerRelease());
            return respuesta;
        } catch (JCoException e) {
            actual.quitar(destino);
            throw clasificar(e.getGroup(), e.getMessage());
        } catch (JCoRuntimeException e) {
            actual.quitar(destino);
            throw clasificar(e.getGroup(), e.getMessage());
        }
    }

    static Map<String, Object> peticion(Long id, String destino, String metodo, String uri, Map<String, String> cabeceras, byte[] cuerpo)
            throws Protocolo.Fallo {
        if (!proveedor().tiene(destino)) {
            throw new Protocolo.Fallo(Protocolo.PROTOCOLO, "el destino no tiene sesión: falta 'logon'");
        }
        try {
            JCoDestination jco = JCoDestinationManager.getDestination(destino);
            // Una JCoFunction nueva por llamada: no se comparte entre los hilos del pool.
            JCoFunction funcion = jco.getRepository().getFunction(FUNCION_ADT);
            if (funcion == null) {
                throw new Protocolo.Fallo(Protocolo.FUNCION, "el sistema no tiene la función " + FUNCION_ADT);
            }
            JCoStructure solicitud = funcion.getImportParameterList().getStructure("REQUEST");
            JCoStructure linea = solicitud.getStructure("REQUEST_LINE");
            linea.setValue("METHOD", metodo);
            linea.setValue("URI", uri);
            linea.setValue("VERSION", "HTTP/1.1");
            JCoTable campos = solicitud.getTable("HEADER_FIELDS");
            for (Map.Entry<String, String> cabecera : cabeceras.entrySet()) {
                campos.appendRow();
                campos.setValue("NAME", cabecera.getKey());
                campos.setValue("VALUE", cabecera.getValue());
            }
            if (cuerpo.length > 0) {
                solicitud.setValue("MESSAGE_BODY", cuerpo);
            }
            funcion.execute(jco);
            return respuesta(id, funcion.getExportParameterList().getStructure("RESPONSE"));
        } catch (JCoException e) {
            throw clasificar(e.getGroup(), e.getMessage());
        } catch (JCoRuntimeException e) {
            throw clasificar(e.getGroup(), e.getMessage());
        }
    }

    /** Lee una tabla con RFC_READ_TABLE. Los valores salen con su relleno; el cliente recorta. */
    static Map<String, Object> tabla(Long id, String destino, String tabla, List<String> campos, List<String> condiciones, long filasMax)
            throws Protocolo.Fallo {
        if (!TABLA_VALIDA.matcher(tabla).matches()) {
            throw new Protocolo.Fallo(Protocolo.PROTOCOLO, "nombre de tabla no válido");
        }
        if (!TABLAS_LEGIBLES.contains(tabla)) {
            throw new Protocolo.Fallo(Protocolo.PROTOCOLO, "tabla no legible: " + tabla);
        }
        if (campos.isEmpty()) {
            throw new Protocolo.Fallo(Protocolo.PROTOCOLO, "falta al menos un campo");
        }
        for (String campo : campos) {
            if (!CAMPO_VALIDO.matcher(campo).matches()) {
                throw new Protocolo.Fallo(Protocolo.PROTOCOLO, "nombre de campo no válido");
            }
        }
        for (String condicion : condiciones) {
            if (condicion.length() > LONGITUD_MAXIMA_CONDICION) {
                throw new Protocolo.Fallo(Protocolo.PROTOCOLO, "una condición supera " + LONGITUD_MAXIMA_CONDICION + " caracteres");
            }
        }
        if (!proveedor().tiene(destino)) {
            throw new Protocolo.Fallo(Protocolo.PROTOCOLO, "el destino no tiene sesión: falta 'logon'");
        }
        try {
            JCoDestination jco = JCoDestinationManager.getDestination(destino);
            JCoFunction funcion = jco.getRepository().getFunction(FUNCION_TABLA);
            if (funcion == null) {
                throw new Protocolo.Fallo(Protocolo.FUNCION, "el sistema no tiene la función " + FUNCION_TABLA);
            }
            funcion.getImportParameterList().setValue("QUERY_TABLE", tabla);
            funcion.getImportParameterList().setValue("DELIMITER", "");
            funcion.getImportParameterList().setValue("ROWCOUNT", (int) Math.min(filasMax, Integer.MAX_VALUE));
            JCoTable pedidos = funcion.getTableParameterList().getTable("FIELDS");
            for (String campo : campos) {
                pedidos.appendRow();
                pedidos.setValue("FIELDNAME", campo);
            }
            JCoTable opciones = funcion.getTableParameterList().getTable("OPTIONS");
            for (String condicion : condiciones) {
                opciones.appendRow();
                opciones.setValue("TEXT", condicion);
            }
            funcion.execute(jco);
            return resultadoTabla(id, funcion.getTableParameterList().getTable("FIELDS"), funcion.getTableParameterList().getTable("DATA"));
        } catch (AbapException e) {
            throw new Protocolo.Fallo(Protocolo.ABAP, e.getKey());
        } catch (JCoException e) {
            throw clasificar(e.getGroup(), e.getMessage());
        } catch (JCoRuntimeException e) {
            throw clasificar(e.getGroup(), e.getMessage());
        }
    }

    private static Map<String, Object> resultadoTabla(Long id, JCoTable campos, JCoTable datos) {
        int n = campos.getNumRows();
        int[] desplazamientos = new int[n];
        int[] longitudes = new int[n];
        List<Object> columnas = new ArrayList<Object>();
        for (int i = 0; i < n; i++) {
            campos.setRow(i);
            desplazamientos[i] = Integer.parseInt(campos.getString("OFFSET").trim());
            longitudes[i] = Integer.parseInt(campos.getString("LENGTH").trim());
            Map<String, Object> columna = new LinkedHashMap<String, Object>();
            columna.put("nombre", campos.getString("FIELDNAME").trim());
            columna.put("longitud", Long.valueOf(longitudes[i]));
            columnas.add(columna);
        }
        List<Object> filas = new ArrayList<Object>();
        for (int fila = 0; fila < datos.getNumRows(); fila++) {
            datos.setRow(fila);
            String linea = datos.getString("WA");
            List<Object> valores = new ArrayList<Object>();
            for (int i = 0; i < n; i++) {
                valores.add(trozo(linea, desplazamientos[i], longitudes[i]));
            }
            filas.add(valores);
        }
        Map<String, Object> salida = Protocolo.conId(id);
        salida.put("columnas", columnas);
        salida.put("filas", filas);
        return salida;
    }

    /** JCo recorta los blancos finales de WA: se vuelve a rellenar hasta la longitud del campo. */
    private static String trozo(String linea, int desplazamiento, int longitud) {
        StringBuilder valor = new StringBuilder();
        if (desplazamiento < linea.length()) {
            valor.append(linea, desplazamiento, Math.min(linea.length(), desplazamiento + longitud));
        }
        while (valor.length() < longitud) {
            valor.append(' ');
        }
        return valor.toString();
    }

    static void olvidar(String destino) {
        if (proveedor != null) {
            proveedor.quitar(destino);
        }
    }

    private static Map<String, Object> respuesta(Long id, JCoStructure respuesta) throws Protocolo.Fallo {
        JCoStructure estado = respuesta.getStructure("STATUS_LINE");
        String codigo = estado.getString("STATUS_CODE").trim();
        int numero;
        try {
            numero = Integer.parseInt(codigo);
        } catch (NumberFormatException e) {
            throw new Protocolo.Fallo(Protocolo.OTRO, "código de estado no numérico en la respuesta");
        }
        Map<String, String> cabeceras = new LinkedHashMap<String, String>();
        JCoTable campos = respuesta.getTable("HEADER_FIELDS");
        for (int fila = 0; fila < campos.getNumRows(); fila++) {
            campos.setRow(fila);
            String nombre = campos.getString("NAME");
            String valor = campos.getString("VALUE");
            String previo = cabeceras.get(nombre);
            cabeceras.put(nombre, previo == null ? valor : previo + ", " + valor);
        }
        byte[] datos = respuesta.getByteArray("MESSAGE_BODY");
        Map<String, Object> salida = Protocolo.conId(id);
        salida.put("estado", Integer.valueOf(numero));
        salida.put("razon", estado.getString("REASON_PHRASE"));
        salida.put("cabeceras", cabeceras);
        salida.put("cuerpo", Base64.getEncoder().encodeToString(datos == null ? new byte[0] : datos));
        return salida;
    }

    private static String claveJco(String clave) throws Protocolo.Fallo {
        if ("ashost".equals(clave)) {
            return DestinationDataProvider.JCO_ASHOST;
        }
        if ("sysnr".equals(clave)) {
            return DestinationDataProvider.JCO_SYSNR;
        }
        if ("client".equals(clave)) {
            return DestinationDataProvider.JCO_CLIENT;
        }
        if ("lang".equals(clave)) {
            return DestinationDataProvider.JCO_LANG;
        }
        if ("saprouter".equals(clave)) {
            return DestinationDataProvider.JCO_SAPROUTER;
        }
        if ("mshost".equals(clave)) {
            return DestinationDataProvider.JCO_MSHOST;
        }
        if ("msserv".equals(clave)) {
            return DestinationDataProvider.JCO_MSSERV;
        }
        if ("group".equals(clave)) {
            return DestinationDataProvider.JCO_GROUP;
        }
        if ("sysid".equals(clave)) {
            // JCo no tiene JCO_SYSID: el id de sistema del logon por servidor de mensajes es r3name.
            return DestinationDataProvider.JCO_R3NAME;
        }
        throw new Protocolo.Fallo(Protocolo.PROTOCOLO, "clave de conexión no admitida: " + clave);
    }

    private static Protocolo.Fallo clasificar(int grupo, String mensaje) {
        if (grupo == JCoException.JCO_ERROR_LOGON_FAILURE) {
            return new Protocolo.Fallo(Protocolo.LOGON, mensaje);
        }
        if (grupo == JCoException.JCO_ERROR_COMMUNICATION || grupo == JCoException.JCO_ERROR_SYSTEM_FAILURE) {
            return new Protocolo.Fallo(Protocolo.COMUNICACION, mensaje);
        }
        return new Protocolo.Fallo(Protocolo.OTRO, mensaje);
    }
}
