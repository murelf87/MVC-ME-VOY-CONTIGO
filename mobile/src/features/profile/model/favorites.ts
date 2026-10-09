/**
 * Destinos favoritos: tipos, iconos, textos por defecto, validación en español y cuerpos de las peticiones.
 * Funciones puras (el formulario solo pinta y envía).
 */
import type { CreateFavoriteBody, FavoriteKind, FavoritePlace, UpdateFavoriteBody } from "@/api/types";
import type { IconName } from "@/icons";
import { profileStrings } from "../strings";

const copy = profileStrings.favorites;
const form = profileStrings.favoriteForm.validation;

/** Máximos del servidor (módulo `trips`): 20 destinos, nombre ≤ 60 y dirección ≤ 200 caracteres. */
export const FAVORITES_MAX = 20;
export const FAVORITE_NAME_MAX = 60;
export const FAVORITE_ADDRESS_MAX = 200;

export const FAVORITE_KINDS: readonly FavoriteKind[] = ["work", "campus", "home", "other"];

const KIND_ICON: Record<FavoriteKind, IconName> = {
  work: "briefcase",
  campus: "school",
  home: "home",
  other: "pin",
};

export function kindIcon(kind: FavoriteKind): IconName {
  return KIND_ICON[kind];
}

export function kindLabel(kind: FavoriteKind): string {
  return copy.kinds[kind];
}

/** Nombre sugerido al elegir el tipo: «Trabajo», «Campus», «Casa»; «Otro» deja el nombre para quien lo escribe. */
export function defaultNameFor(kind: FavoriteKind): string {
  return kind === "other" ? "" : copy.kinds[kind];
}

/**
 * Al cambiar de tipo, el nombre sigue al tipo mientras la persona no lo haya escrito a mano (vacío o igual al sugerido
 * del tipo anterior). Un nombre propio se respeta.
 */
export function nameAfterKindChange(currentName: string, previousKind: FavoriteKind, nextKind: FavoriteKind): string {
  const trimmed = currentName.trim();
  if (trimmed === "" || trimmed === defaultNameFor(previousKind)) return defaultNameFor(nextKind);
  return currentName;
}

/** Lugar elegido en el buscador (WGS84) tal y como viaja entre pantallas. */
export interface FavoritePlaceValue {
  label: string;
  latitude: number;
  longitude: number;
}

export interface FavoriteDraft {
  kind: FavoriteKind;
  name: string;
  place: FavoritePlaceValue | null;
}

export type FavoriteField = "name" | "place";
export type FavoriteErrors = Partial<Record<FavoriteField, string>>;

/** Validación en español. Sin errores → el objeto está vacío. */
export function validateFavoriteDraft(draft: FavoriteDraft): FavoriteErrors {
  const errors: FavoriteErrors = {};
  const name = draft.name.trim();
  if (name === "") errors.name = form.nameRequired;
  else if (name.length > FAVORITE_NAME_MAX) errors.name = form.nameTooLong;
  if (draft.place === null || draft.place.label.trim() === "") errors.place = form.placeRequired;
  else if (draft.place.label.trim().length > FAVORITE_ADDRESS_MAX) errors.place = form.addressTooLong;
  return errors;
}

export function hasFavoriteErrors(errors: FavoriteErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** El lugar guardado de un favorito, en el formato del buscador. */
export function placeOfFavorite(favorite: Pick<FavoritePlace, "address" | "location">): FavoritePlaceValue {
  return { label: favorite.address, latitude: favorite.location.lat, longitude: favorite.location.lng };
}

/** Cuerpo de `POST /v1/me/favorites`. Exige un borrador válido (`validateFavoriteDraft` sin errores). */
export function toCreateBody(draft: FavoriteDraft): CreateFavoriteBody | null {
  if (draft.place === null || hasFavoriteErrors(validateFavoriteDraft(draft))) return null;
  return {
    kind: draft.kind,
    name: draft.name.trim(),
    address: draft.place.label.trim(),
    lat: draft.place.latitude,
    lng: draft.place.longitude,
  };
}

/** Solo lo que cambió respecto al favorito guardado; vacío si no cambió nada (no se envía nada al servidor). */
export function toUpdateBody(original: FavoritePlace, draft: FavoriteDraft): UpdateFavoriteBody {
  const body: UpdateFavoriteBody = {};
  if (draft.kind !== original.kind) body.kind = draft.kind;
  if (draft.name.trim() !== original.name) body.name = draft.name.trim();
  if (draft.place !== null) {
    const address = draft.place.label.trim();
    const moved = draft.place.latitude !== original.location.lat || draft.place.longitude !== original.location.lng;
    if (address !== original.address || moved) {
      body.address = address;
      body.lat = draft.place.latitude;
      body.lng = draft.place.longitude;
    }
  }
  return body;
}

export function isEmptyUpdate(body: UpdateFavoriteBody): boolean {
  return Object.keys(body).length === 0;
}

/** Quedan huecos para más destinos (máximo 20). */
export function canAddFavorite(count: number): boolean {
  return count < FAVORITES_MAX;
}
