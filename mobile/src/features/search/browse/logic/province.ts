/**
 * Elección de la provincia activa (lógica pura). Todo trayecto ocurre dentro de UNA provincia: la app trabaja con una
 * «provincia activa» que se recuerda entre sesiones. La primera provincia disponible es Sevilla.
 */
import type { Province } from "@/api/types";

/**
 * La provincia elegida si sigue en la lista de disponibles; si no, la primera. `null` si no hay ninguna.
 * (Un id guardado de una provincia que ya no existe se ignora en silencio.)
 */
export function pickActiveProvince(provinces: readonly Province[], selectedId: string | null): Province | null {
  if (selectedId !== null) {
    const chosen = provinces.find((province) => province.id === selectedId);
    if (chosen !== undefined) return chosen;
  }
  return provinces[0] ?? null;
}
