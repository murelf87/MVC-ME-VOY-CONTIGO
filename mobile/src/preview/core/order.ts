/**
 * Orden «más reciente primero» estable. El servidor real ordena por `created_at desc` y casi nunca hay empates; con el
 * reloj virtual detenido TODO lo creado en el mismo instante empata, y lo razonable es que lo insertado después salga
 * antes (como saldría con milisegundos reales de diferencia).
 */
export function newestFirst<T>(rows: readonly T[], at: (row: T) => number): T[] {
  return [...rows].reverse().sort((a, b) => at(b) - at(a));
}
