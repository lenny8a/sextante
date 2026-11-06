import type { ResultadoSesion, SesionesAdt } from './adt/sesiones';
import type { Destino } from './config/destinos';
import type { CableadoDiccionario, PuenteDiccionario } from './diccionario/cableado';
import type { ServicioObjeto } from './objeto/servicio';

/** Lo que las herramientas de desarrollo reciben del cableado de la extensión. */
export interface DependenciasDesarrollo {
  abrirSesion: (idDestino: string) => Promise<ResultadoSesion>;
  diccionario: {
    cableado: Pick<CableadoDiccionario, 'servicio' | 'firmas' | 'destinoDe' | 'credencialGuardada'>;
    sesiones: Pick<SesionesAdt, 'sesionSilenciosa'>;
    destinoPorId(id: string): Destino | undefined;
    puente?: PuenteDiccionario;
  };
  objeto: Pick<ServicioObjeto, 'ordenes' | 'ordenesDeObjeto' | 'versiones' | 'fuente'>;
}
