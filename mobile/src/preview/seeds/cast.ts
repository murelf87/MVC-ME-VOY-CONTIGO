/**
 * Reparto de personas FICTICIAS del diseño (Ana, Miguel, Laura, Carlos, Marta…) y de personal de administración.
 * Los teléfonos son del rango de pruebas `+34 611 000 xxx`: sirven para «Iniciar sesión» en la vista previa (el código
 * SMS lo muestra el visor). Los retratos son recortes ilustrativos de las láminas.
 */
import type { PreviewDb } from "../core/db";
import { avatarKey, type AvatarSlug } from "../core/assets";
import type { IdentityStatus } from "../core/rows";
import { madridDateTimeMs } from "../core/time";
import type { UserRole } from "../core/types";
import { createUser, userStats } from "../domain/users";
import { SEED_USER_IDS, type SeedUserKey } from "./ids";

export interface CastMember {
  key: SeedUserKey;
  phone: string;
  displayName: string;
  roles: readonly UserRole[];
  photo: AvatarSlug | null;
  identity: IdentityStatus;
  /** Alta (fecha de calendario). */
  joined: string;
  rating: { average: number; count: number } | null;
  tripsCompleted: number;
}

const BOTH: readonly UserRole[] = ["passenger", "driver"];
const PASSENGER: readonly UserRole[] = ["passenger"];
const STAFF: readonly UserRole[] = ["admin", "verification_admin", "finance_admin", "support_admin"];

export const CAST: readonly CastMember[] = [
  { key: "ana", phone: "+34611000101", displayName: "Ana García López", roles: BOTH, photo: "ana", identity: "verified", joined: "2026-03-12", rating: { average: 4.8, count: 32 }, tripsCompleted: 32 },
  { key: "miguel", phone: "+34611000102", displayName: "Miguel Torres", roles: PASSENGER, photo: "miguelProfile", identity: "verified", joined: "2026-05-20", rating: { average: 4.8, count: 12 }, tripsCompleted: 12 },
  { key: "laura", phone: "+34611000103", displayName: "Laura Sánchez", roles: PASSENGER, photo: "laura", identity: "verified", joined: "2026-06-02", rating: { average: 4.7, count: 9 }, tripsCompleted: 9 },
  { key: "carlos", phone: "+34611000104", displayName: "Carlos Ruiz Mena", roles: BOTH, photo: "carlos", identity: "verified", joined: "2026-04-08", rating: { average: 4.6, count: 14 }, tripsCompleted: 14 },
  { key: "marta", phone: "+34611000105", displayName: "Marta Jiménez Ortega", roles: BOTH, photo: "marta", identity: "verified", joined: "2026-04-21", rating: { average: 4.9, count: 22 }, tripsCompleted: 22 },
  { key: "miguelAngel", phone: "+34611000106", displayName: "Miguel Ángel Ruiz", roles: BOTH, photo: "miguel", identity: "verified", joined: "2026-02-18", rating: { average: 4.9, count: 18 }, tripsCompleted: 18 },
  { key: "daniel", phone: "+34611000107", displayName: "Daniel Herrera Gil", roles: BOTH, photo: null, identity: "verified", joined: "2026-05-04", rating: { average: 4.7, count: 9 }, tripsCompleted: 9 },
  { key: "carmen", phone: "+34611000108", displayName: "Carmen Vidal Pérez", roles: BOTH, photo: null, identity: "verified", joined: "2026-05-27", rating: { average: 4.5, count: 6 }, tripsCompleted: 6 },
  { key: "lucia", phone: "+34611000109", displayName: "Lucía Romero", roles: PASSENGER, photo: null, identity: "verified", joined: "2026-06-11", rating: { average: 4.5, count: 6 }, tripsCompleted: 6 },
  { key: "javier", phone: "+34611000110", displayName: "Javier Díaz", roles: PASSENGER, photo: null, identity: "verified", joined: "2026-06-15", rating: { average: 4.7, count: 11 }, tripsCompleted: 11 },
  { key: "elena", phone: "+34611000111", displayName: "Elena Martín", roles: PASSENGER, photo: null, identity: "verified", joined: "2026-07-01", rating: { average: 5, count: 3 }, tripsCompleted: 3 },
  { key: "pablo", phone: "+34611000112", displayName: "Pablo Navarro", roles: PASSENGER, photo: null, identity: "verified", joined: "2026-07-09", rating: { average: 4.6, count: 8 }, tripsCompleted: 8 },
  { key: "sofia", phone: "+34611000113", displayName: "Sofía Ramos", roles: PASSENGER, photo: null, identity: "pending", joined: "2026-09-30", rating: null, tripsCompleted: 0 },
  { key: "irene", phone: "+34611000116", displayName: "Irene Soler", roles: PASSENGER, photo: null, identity: "verified", joined: "2026-07-14", rating: { average: 4.8, count: 5 }, tripsCompleted: 5 },
  { key: "alvaro", phone: "+34611000117", displayName: "Álvaro Pardo", roles: PASSENGER, photo: null, identity: "verified", joined: "2026-07-20", rating: { average: 4.4, count: 7 }, tripsCompleted: 7 },
  { key: "nuria", phone: "+34611000118", displayName: "Nuria Cano", roles: PASSENGER, photo: null, identity: "verified", joined: "2026-08-03", rating: { average: 4.9, count: 4 }, tripsCompleted: 4 },
  { key: "hugo", phone: "+34611000119", displayName: "Hugo Lara", roles: PASSENGER, photo: null, identity: "verified", joined: "2026-08-10", rating: { average: 4.6, count: 3 }, tripsCompleted: 3 },
  { key: "rafael", phone: "+34611000114", displayName: "Rafael Ortiz", roles: BOTH, photo: null, identity: "verified", joined: "2026-09-28", rating: null, tripsCompleted: 0 },
  { key: "ines", phone: "+34611000115", displayName: "Inés Campos", roles: BOTH, photo: null, identity: "verified", joined: "2026-09-29", rating: null, tripsCompleted: 0 },
  { key: "staff", phone: "+34611000199", displayName: "Administración MVC", roles: STAFF, photo: null, identity: "verified", joined: "2026-01-15", rating: null, tripsCompleted: 0 },
];

export function castMember(key: SeedUserKey): CastMember {
  const member = CAST.find((m) => m.key === key);
  if (!member) throw new Error(`Persona sembrada desconocida: ${key}`);
  return member;
}

/** Crea las personas, sus perfiles, roles y estadísticas públicas. */
export function seedCast(db: PreviewDb): void {
  const stats = userStats(db);
  for (const member of CAST) {
    const joinedAt = madridDateTimeMs(member.joined, "10:00");
    createUser(db, {
      id: SEED_USER_IDS[member.key],
      phone: member.phone,
      roles: member.roles,
      displayName: member.displayName,
      publicPhotoKey: member.photo ? avatarKey(member.photo) : null,
      publicPhotoStatus: member.photo ? "approved" : "pending",
      identityStatus: member.identity,
      createdAt: joinedAt,
    });
    stats.insert({
      id: SEED_USER_IDS[member.key],
      rating_average: member.rating?.average ?? null,
      rating_count: member.rating?.count ?? 0,
      trips_completed: member.tripsCompleted,
    });
  }
}
