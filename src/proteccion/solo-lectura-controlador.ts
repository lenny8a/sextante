import { uriOrigenDe } from '../bloques/bloque-modelo';
import type { UriMinimo } from '../bridge/adt-uri';
import type { RolSistema } from '../config/navegador-config';
import { nombreDeError } from '../util/errores';
import { COMANDO_RESET_SOLO_LECTURA_SESION, COMANDO_SOLO_LECTURA_SESION } from './comandos-solo-lectura';
import { decidirProteccion, type DecisionProteccion } from './proteccion-modelo';
import { NOMBRE_PRODUCTO } from '../producto';

export interface BarraSoloLectura {
  mostrar(texto: string, tooltip: string): void;
  ocultar(): void;
}

export interface DependenciasControlador {
  ejecutar: (comando: string) => Promise<void>;
  barra: BarraSoloLectura;
  rolDe: (id: string) => RolSistema | undefined;
  registrar?: (mensaje: string) => void;
}

const TOOLTIP_BARRA = `Sistema QAS/PRD: ${NOMBRE_PRODUCTO} abre el código en solo lectura`;

export class ControladorSoloLectura {
  private readonly protegidos = new Set<string>();

  constructor(private readonly deps: DependenciasControlador) {}

  async evaluar(uri: UriMinimo | undefined): Promise<void> {
    const decision = this.decidir(uri);
    if (!decision.proteger || uri === undefined) {
      this.deps.barra.ocultar();
      return;
    }
    const clave = claveDe(uri);
    if (!this.protegidos.has(clave)) {
      try {
        await this.deps.ejecutar(COMANDO_SOLO_LECTURA_SESION);
      } catch (err) {
        this.deps.registrar?.(`Solo lectura: el comando falló (${nombreDeError(err)})`);
        this.deps.barra.ocultar();
        return;
      }
      this.protegidos.add(clave);
      this.deps.registrar?.('Solo lectura: protección aplicada');
    }
    this.deps.barra.mostrar(`$(lock) Solo lectura: sistema ${decision.rol ?? ''}`.trimEnd(), TOOLTIP_BARRA);
  }

  /** Devuelve true si se retiró la protección de un documento que ya estaba protegido. */
  async reevaluar(uri: UriMinimo | undefined): Promise<boolean> {
    const clave = uri === undefined ? undefined : claveDe(uri);
    if (clave === undefined || !this.protegidos.has(clave) || this.decidir(uri).proteger) {
      await this.evaluar(uri);
      return false;
    }
    try {
      await this.deps.ejecutar(COMANDO_RESET_SOLO_LECTURA_SESION);
    } catch (err) {
      this.deps.registrar?.(`Solo lectura: el comando de retiro falló (${nombreDeError(err)})`);
      return false;
    }
    this.protegidos.delete(clave);
    this.deps.barra.ocultar();
    this.deps.registrar?.('Solo lectura: protección retirada');
    return true;
  }

  /** Retira del conjunto los documentos que ya no deben protegerse; el reset solo actúa sobre el editor activo. */
  async reevaluarTodos(uris: UriMinimo[], activa?: UriMinimo): Promise<void> {
    const claveActiva = activa === undefined ? undefined : claveDe(activa);
    let pendientes = 0;
    for (const uri of uris) {
      const clave = claveDe(uri);
      if (!this.protegidos.has(clave) || this.decidir(uri).proteger) {
        continue;
      }
      if (clave === claveActiva) {
        await this.reevaluar(uri);
      } else {
        this.protegidos.delete(clave);
        pendientes++;
      }
    }
    if (pendientes > 0) {
      const texto = pendientes === 1 ? '1 editor sigue bloqueado' : `${pendientes} editores siguen bloqueados`;
      this.deps.registrar?.(`Solo lectura: ${texto} hasta reabrirlos`);
    }
  }

  /** Un editor de bloque se decide por su archivo `abap:` de origen. */
  private decidir(uri: UriMinimo | undefined): DecisionProteccion {
    return decidirProteccion(uriOrigenDe(uri), this.deps.rolDe);
  }
}

function claveDe(uri: UriMinimo): string {
  return `${uri.scheme}:${uri.path}`;
}
