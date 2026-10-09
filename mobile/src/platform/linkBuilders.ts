/** Construcción y validación de enlaces externos (puras, sin módulos nativos). */

export type MapsPlatform = "ios" | "android" | "web";

export interface MapsTarget {
  latitude: number;
  longitude: number;
  label?: string;
}

function coordinate(value: number): string {
  return value.toFixed(6);
}

export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

/** Enlace para VER un lugar en el mapa del sistema (`null` si las coordenadas no son válidas). */
export function buildMapsUrl(target: MapsTarget, platform: MapsPlatform): string | null {
  if (!isValidCoordinate(target.latitude, target.longitude)) return null;
  const point = `${coordinate(target.latitude)},${coordinate(target.longitude)}`;
  const label = target.label?.trim();
  switch (platform) {
    case "ios":
      return `https://maps.apple.com/?ll=${point}${label ? `&q=${encodeURIComponent(label)}` : ""}`;
    case "android":
      return `geo:${point}?q=${point}${label ? `(${encodeURIComponent(label)})` : ""}`;
    case "web":
      return `https://www.google.com/maps/search/?api=1&query=${point}`;
  }
}

/** Enlace «Cómo llegar» en coche hasta el destino (`null` si las coordenadas no son válidas). */
export function buildDirectionsUrl(target: MapsTarget, platform: MapsPlatform): string | null {
  if (!isValidCoordinate(target.latitude, target.longitude)) return null;
  const point = `${coordinate(target.latitude)},${coordinate(target.longitude)}`;
  if (platform === "ios") return `https://maps.apple.com/?daddr=${point}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=driving`;
}

/**
 * Número apto para `tel:` / `sms:`: conserva un `+` inicial y dígitos (6–15). `null` si no es un número
 * (evita construir enlaces con texto arbitrario).
 */
export function normalizePhoneForDialing(input: string): string | null {
  const compact = input.replace(/[\s().-]/g, "");
  return /^\+?[0-9]{6,15}$/.test(compact) ? compact : null;
}

/** ¿Es seguro abrir esta URL fuera de la app? Solo https y mailto (nunca javascript:, file:, intent:…). */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function buildMailtoUrl(to: string, subject?: string, body?: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return null;
  const parts: string[] = [];
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body) parts.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${to}${parts.length ? `?${parts.join("&")}` : ""}`;
}
