/**
 * Importe ILUSTRATIVO de las reservas sembradas. En el producto la tarifa la fija una `tariff_version` aprobada por
 * administración (módulo `money`); mientras no exista, el contrato de viajes devuelve `pending_definition`. Aquí solo hace
 * falta un entero de céntimos coherente con la distancia para que los totales de las pantallas cuadren. El módulo `money`
 * de la vista previa puede sustituirlo en su `seedSlice`.
 */
export function illustrativeFareCents(roadDistanceM: number): number {
  const km = Math.max(0, roadDistanceM) / 1000;
  return Math.round((60 + km * 9.5) / 5) * 5;
}
