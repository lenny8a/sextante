import type { Destino } from '../config/destinos';

/** Por qué el destino, según destinations.json, no admite la búsqueda REST. */
export type MotivoDestinoSinRest = 'sso' | 'snc' | 'sinServidor';

/** Por qué no se usa ADT propio: lo impide el destino o no hay vía (ni puente RFC ni URL HTTP que responda). */
export type MotivoSinRest = MotivoDestinoSinRest | 'sinVia';

export type DisponibilidadRest = { disponible: true } | { disponible: false; motivo: MotivoDestinoSinRest };

const NUMERO_SISTEMA_VALIDO = /^\d{2}$/;
const SNC_DESACTIVADO = '0';

export function restDisponible(destino: Destino): DisponibilidadRest {
  if (destino.ssoActivado) {
    return { disponible: false, motivo: 'sso' };
  }
  if (usaSnc(destino)) {
    return { disponible: false, motivo: 'snc' };
  }
  if (!servidorYNumero(destino)) {
    return { disponible: false, motivo: 'sinServidor' };
  }
  return { disponible: true };
}

// SAP Logon escribe sncType "0" cuando SNC está desactivado (visto en destinations.json real).
function usaSnc(destino: Destino): boolean {
  const tipo = destino.tipoSnc?.trim();
  return !!tipo && tipo !== SNC_DESACTIVADO;
}

// NO VERIFICADO: la convención de puertos ICM `443<NN>` (https) y `80<NN>` (http) con NN = número de sistema;
// un Web Dispatcher u otra configuración del ICM la rompen y entonces se pide la URL.
export function candidatosUrl(destino: Destino): string[] {
  const datos = servidorYNumero(destino);
  if (!datos) {
    return [];
  }
  return [`https://${datos.servidor}:443${datos.numero}`, `http://${datos.servidor}:80${datos.numero}`];
}

export async function deducirUrl(
  candidatos: string[],
  responde: (url: string) => Promise<boolean>,
): Promise<string | undefined> {
  for (const url of candidatos) {
    if (await respondeSinFallar(responde, url)) {
      return url;
    }
  }
  return undefined;
}

async function respondeSinFallar(responde: (url: string) => Promise<boolean>, url: string): Promise<boolean> {
  try {
    return await responde(url);
  } catch {
    return false;
  }
}

function servidorYNumero(destino: Destino): { servidor: string; numero: string } | undefined {
  const servidor = destino.servidorAplicacion?.trim();
  const numero = destino.numeroSistema?.trim().padStart(2, '0');
  if (!servidor || !numero || !NUMERO_SISTEMA_VALIDO.test(numero)) {
    return undefined;
  }
  return { servidor, numero };
}
