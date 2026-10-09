/**
 * Tipos compartidos del paquete «solicitar plaza y pagar» que viajan entre pantallas como parámetros de ruta
 * (solo datos serializables: textos y números).
 */

/** Resumen del punto de recogida elegido en la pantalla 13; las pantallas 14–16 lo enseñan sin volver a pedirlo. */
export type PickupSummary = {
  /** «A», «B»… */
  code?: string;
  /** «Aparcamiento público». */
  name?: string | null;
  /** «Av. Manuel Siurot». */
  address?: string | null;
  /** Minutos a pie que propuso el servidor. */
  walkMinutes?: number | null;
  detourMinutes?: number | null;
};

/** Cómo va la búsqueda de la ubicación del móvil como punto de partida (pantalla 13). */
export type OriginStatus = "idle" | "locating" | "denied" | "blocked" | "off" | "unavailable";
