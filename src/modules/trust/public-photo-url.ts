import { createHash } from "node:crypto";

/**
 * Ruta (relativa a la API) de la foto pública APROBADA de un usuario, o null.
 * Para uso de los demás módulos al construir `PublicUser.photoUrl`:
 *   publicPhotoUrl(row.user_id, row.public_photo_key, row.public_photo_status)
 * La ruta responde 302 a una URL firmada de vida corta (el almacenamiento es privado). `v` cambia al cambiar la foto
 * (invalida cachés) y no revela la clave de almacenamiento.
 */
export function publicPhotoUrl(
  userId: string,
  publicPhotoKey: string | null | undefined,
  publicPhotoStatus: string | null | undefined
): string | null {
  if (!publicPhotoKey || publicPhotoStatus !== "approved") return null;
  const version = createHash("sha256").update(publicPhotoKey, "utf8").digest("hex").slice(0, 8);
  return `/v1/public/users/${userId}/photo?v=${version}`;
}
