export function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function nombreDeError(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}
