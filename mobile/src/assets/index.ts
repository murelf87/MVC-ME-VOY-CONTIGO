/**
 * GENERADO por tools/design/extract_assets.py. NO EDITAR A MANO.
 *
 * Arte ILUSTRATIVO recortado de las láminas aprobadas, en BAJA resolución, para la vista previa y la maquetación.
 * Retrata personas y vehículos ilustrativos (imágenes generadas), no usuarios reales: antes de producción deben
 * sustituirlo los originales (ver docs/DESIGN_SYSTEM.md §«Arte»). Los mapas no son activos: los dibuja `src/maps`.
 */
/**
 * Imagen estática con sus dimensiones naturales en píxeles (para reservar el alto sin saltos).
 * `source` es el identificador numérico de recurso que devuelve `require` en Metro (sirve a `Image`, a `expo-image`
 * y a `Avatar`).
 */
export interface ImageAsset {
  readonly source: number;
  readonly width: number;
  readonly height: number;
}

// `require` de recursos estáticos devuelve `any` en el borde de Metro; se tipa aquí, una sola vez.
function asset(source: number, width: number, height: number): ImageAsset {
  return { source, width, height };
}

export const images = {
  avatars: {
    /** Ana, conductora (12, 11, 21, 25, 26, 28). */
    ana: asset(require("../../assets/design/avatars/ana.jpg"), 160, 160),
    /** Miguel, pasajero/conductor (11, 25). */
    miguel: asset(require("../../assets/design/avatars/miguel.jpg"), 160, 160),
    /** Laura (25, 34). */
    laura: asset(require("../../assets/design/avatars/laura.jpg"), 160, 160),
    /** Carlos (34). */
    carlos: asset(require("../../assets/design/avatars/carlos.jpg"), 160, 160),
    /** Marta (34). */
    marta: asset(require("../../assets/design/avatars/marta.jpg"), 160, 160),
    /** Foto de «Mi perfil» (29). */
    miguelProfile: asset(require("../../assets/design/avatars/miguel-profile.jpg"), 200, 200),
  },
  profile: {
    /** Retrato de «Tu foto de perfil» (05, 07). */
    photo: asset(require("../../assets/design/profile/photo.jpg"), 320, 320),
    /** Retrato desenfocado de «Comprobación privada» (07). */
    photoBlur: asset(require("../../assets/design/profile/photo-blur.jpg"), 320, 320),
    /** Captura desenfocada de «Estado de la comprobación» (08). */
    checkBlur: asset(require("../../assets/design/profile/check-blur.jpg"), 342, 222),
  },
  cars: {
    /** SEAT Arona blanco de «Tu vehículo» (17). */
    seatArona: asset(require("../../assets/design/cars/seat-arona.jpg"), 660, 312),
    /** SEAT León blanco de «Esperando el coche» (21). */
    seatLeon: asset(require("../../assets/design/cars/seat-leon.jpg"), 404, 184),
  },
  hero: {
    /** Escena de la bienvenida (01) sin logotipo ni textos. */
    welcome: asset(require("../../assets/design/hero/welcome.jpg"), 712, 1034),
  },
  roles: {
    /** Ilustración «Soy pasajero» (02), elipse con transparencia. */
    passenger: asset(require("../../assets/design/roles/passenger.png"), 293, 335),
    /** Ilustración «Soy conductor» (02), elipse con transparencia. */
    driver: asset(require("../../assets/design/roles/driver.png"), 298, 334),
  },
} as const;

export type AvatarKey = keyof typeof images.avatars;

/** Lista de avatares ilustrativos, útil para repartirlos en listas de ejemplo de la vista previa. */
export const avatarKeys = Object.keys(images.avatars) as readonly AvatarKey[];
