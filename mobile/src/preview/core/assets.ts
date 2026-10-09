/**
 * Imágenes ilustrativas de la vista previa (retratos de las láminas). El backend en memoria guarda en las filas una
 * CLAVE estable (`preview-asset://avatar/ana`); la URL real la resuelve, solo en el navegador, el instalador
 * (`install.ts`) con los recursos empaquetados de la app. Así `src/preview` no importa recursos de Metro y las
 * pruebas de Node siguen funcionando.
 *
 * SIMULACIÓN: son personas ilustrativas del diseño, nunca usuarios reales. El producto usa fotos subidas por cada persona.
 */

export const PREVIEW_ASSET_PREFIX = "preview-asset://";

/** Identificadores de retrato disponibles (coinciden con `images.avatars` de `@/assets`). */
export const AVATAR_SLUGS = ["ana", "miguel", "laura", "carlos", "marta", "miguelProfile"] as const;
export type AvatarSlug = (typeof AVATAR_SLUGS)[number];

export function avatarKey(slug: AvatarSlug): string {
  return `${PREVIEW_ASSET_PREFIX}avatar/${slug}`;
}

export type AssetResolver = (key: string) => string | null;

const identityResolver: AssetResolver = (key) => key;
let resolver: AssetResolver = identityResolver;

/** El instalador registra aquí cómo convertir una clave en una URL cargable. `null` restablece el valor por defecto. */
export function setPreviewAssetResolver(next: AssetResolver | null): void {
  resolver = next ?? identityResolver;
}

/** URL pública de una clave de recurso. Una clave que no es `preview-asset://` se devuelve tal cual. */
export function resolvePreviewAsset(key: string): string | null {
  if (!key.startsWith(PREVIEW_ASSET_PREFIX)) return key;
  try {
    return resolver(key);
  } catch {
    return null;
  }
}
