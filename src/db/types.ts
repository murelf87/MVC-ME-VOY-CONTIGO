import pg from "pg";

/**
 * Las columnas `date` son fechas de calendario (p. ej. caducidad del seguro), no instantes.
 * Se devuelven como "YYYY-MM-DD" para que el resultado no dependa de la zona horaria del servidor
 * (el parser por defecto de `pg` crea un Date a medianoche local y `toISOString()` lo desplaza un día
 * en cualquier zona horaria por delante de UTC, como Europe/Madrid).
 */
export function installPgTypeParsers(): void {
  pg.types.setTypeParser(1082, (value: string) => value);
}

installPgTypeParsers();
