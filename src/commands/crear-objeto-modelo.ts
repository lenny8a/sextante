import { analizarUriAbap, ESQUEMA_ABAP, rutaRaizDestino, type UriMinimo } from '../bridge/adt-uri';
import { esProtegido, type RolSistema } from '../config/navegador-config';

/**
 * Asistente «Create New ABAP Object…» de la oficial (bundle de sapse.adt-vscode 1.2.0, leído el 2026-11-04): del
 * argumento solo lee el destino, cuando es una uri `abap:` con el id del destino como tercer segmento de ruta; tipo,
 * nombre, descripción y paquete los elige el usuario. Resuelve en cuanto lo lanza, sin esperar al asistente.
 */
export const COMANDO_CREAR_OBJETO_OFICIAL = 'adt-vscode.createObject';
export const MSG_SIN_SISTEMA_PARA_CREAR = 'Marca un sistema activo o abre un objeto para crear uno nuevo';

export type ResultadoCrear = 'lanzado' | 'sinSistema' | 'protegido' | 'sinConexion' | 'sinOficial';
export type DecisionCrear = { ejecutar: true } | { ejecutar: false; motivo: string };
export type Lanzamiento = { ok: true } | { ok: false; motivo: string };

export function destinoDeRuta(ruta: string | undefined): string | undefined {
  if (ruta === undefined) {
    return undefined;
  }
  return analizarUriAbap({ scheme: ESQUEMA_ABAP, path: ruta })?.destino;
}

export function destinoParaCrear(candidatos: {
  nodo?: string;
  objetoAbierto?: string;
  sistemaActivo?: string;
}): string | undefined {
  return candidatos.nodo ?? candidatos.objetoAbierto ?? candidatos.sistemaActivo;
}

export function decidirCrear(rol: RolSistema | undefined): DecisionCrear {
  if (esProtegido(rol)) {
    return { ejecutar: false, motivo: `Sistema ${rol}: no se crean objetos en solo lectura` };
  }
  return { ejecutar: true };
}

/** `abap:/repotree-v1/<DEST>`: el asistente preselecciona ese destino. */
export function argumentoAsistente(destino: string): UriMinimo {
  return { scheme: ESQUEMA_ABAP, path: rutaRaizDestino(destino) };
}

/** Motivo para el agente cuando el asistente no llegó a lanzarse. */
export function lanzamientoDe(resultado: ResultadoCrear, destino: string): Lanzamiento {
  switch (resultado) {
    case 'lanzado':
      return { ok: true };
    case 'sinOficial':
      return {
        ok: false,
        motivo:
          'falta la extensión oficial de SAP (ABAP Development Tools for VS Code): pide al usuario que la instale y vuelve a llamar',
      };
    case 'sinConexion':
      return { ok: false, motivo: `${destino} no está conectado: pide al usuario que se conecte (vista Sistemas) y vuelve a llamar` };
    case 'protegido':
      return { ok: false, motivo: `rechazado por rol: ${destino} es de solo lectura` };
    case 'sinSistema':
      return { ok: false, motivo: 'indica el sistema o abre un objeto' };
  }
}
