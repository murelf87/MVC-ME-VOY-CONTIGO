import { iso, isoOrNull, type Db } from "./common.js";

/**
 * Derechos sobre los datos (RGPD) del módulo «live»: sección `modules.live` de la exportación de datos y paso de
 * eliminación de cuenta. Se conectan al registro público de `comms` (src/modules/comms/public.ts) con `registerLiveDataRights()`.
 *
 * Qué contiene y qué NO (contrato: docs/contracts/live.md §12):
 *  - Exportación: solo datos de la propia persona. De las valoraciones recibidas NO se identifica a quien valoró.
 *    Las notas internas del personal (`incident_reports.resolution_note`) no se exportan (igual que `user_reports` en `comms`).
 *    Las fotos de las incidencias viven en almacenamiento privado: se exportan sus metadatos, no el archivo.
 *  - Eliminación: borra enlaces compartidos, preferencias, valoraciones recibidas y el texto de las valoraciones; CONSERVA las
 *    incidencias presentadas y sus fotos (seguridad de las personas y defensa de reclamaciones, como las denuncias de `comms`).
 *    El plazo de conservación está «por definir» (validación jurídica pendiente) y no existe tarea de purga.
 */
export const LIVE_MODULE_NAME = "live";

/** Máximo de filas por lista; si se supera, `truncated` es true (nada se omite en silencio). */
const LIST_LIMIT = 1000;

export type LiveDataExport = {
  ratingSummary: { average: number | null; count: number };
  ratingsGiven: Array<{ tripId: string; asRole: "driver" | "passenger"; stars: number; comment: string | null; createdAt: string }>;
  /** Sin identificar a quien valoró. */
  ratingsReceived: Array<{ tripId: string; stars: number; comment: string | null; createdAt: string }>;
  incidentReports: Array<{
    id: string;
    tripId: string;
    bookingId: string | null;
    asRole: "driver" | "passenger";
    category: string;
    description: string;
    status: string;
    createdAt: string;
    resolvedAt: string | null;
    attachments: Array<{ id: string; contentType: string; sizeBytes: number | null; status: string; createdAt: string }>;
  }>;
  sharedTripLinks: Array<{
    id: string;
    bookingId: string;
    tripId: string;
    includePlate: boolean;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
    lastViewedAt: string | null;
    viewCount: number;
  }>;
  routeChanges: {
    proposedByYou: Array<{
      id: string; tripId: string; status: string; resolution: string | null; newStopLabel: string | null; createdAt: string; resolvedAt: string | null;
    }>;
    decisionsByYou: Array<{ proposalId: string; tripId: string; decision: "accepted" | "rejected"; decidedAt: string }>;
  };
  privacy: { showProfileToCoPassengers: boolean; updatedAt: string | null };
  /** true si alguna lista superó el máximo de filas. */
  truncated: boolean;
};

export async function exportUserLiveData(db: Db, userId: string): Promise<LiveDataExport> {
  const limit = LIST_LIMIT + 1;
  const [summary, given, received, reports, attachments, shares, proposed, decisions, privacy] = await Promise.all([
    db.query<{ rating_sum: number; rating_count: number }>(
      `select rating_sum, rating_count from profiles where user_id=$1`, [userId]
    ),
    db.query<{ trip_id: string; rater_role: "driver" | "passenger"; stars: number; comment: string | null; created_at: Date }>(
      `select trip_id, rater_role, stars, comment, created_at from trip_ratings
        where rater_user_id=$1 order by created_at desc, id desc limit $2`, [userId, limit]
    ),
    db.query<{ trip_id: string; stars: number; comment: string | null; created_at: Date }>(
      `select trip_id, stars, comment, created_at from trip_ratings
        where ratee_user_id=$1 order by created_at desc, id desc limit $2`, [userId, limit]
    ),
    db.query<{
      id: string; trip_id: string; booking_id: string | null; reporter_role: "driver" | "passenger"; category: string;
      description: string; status: string; resolved_at: Date | null; created_at: Date;
    }>(
      `select id, trip_id, booking_id, reporter_role, category, description, status, resolved_at, created_at
         from incident_reports where reporter_user_id=$1 order by created_at desc, id desc limit $2`, [userId, limit]
    ),
    db.query<{ id: string; report_id: string; content_type: string; size_bytes: string | null; status: string; created_at: Date }>(
      `select a.id, a.report_id, a.content_type, a.size_bytes::text as size_bytes, a.status, a.created_at
         from incident_attachments a join incident_reports r on r.id=a.report_id
        where r.reporter_user_id=$1 order by a.created_at, a.id`, [userId]
    ),
    db.query<{
      id: string; booking_id: string; trip_id: string; include_plate: boolean; created_at: Date; expires_at: Date;
      revoked_at: Date | null; last_viewed_at: Date | null; view_count: number;
    }>(
      `select id, booking_id, trip_id, include_plate, created_at, expires_at, revoked_at, last_viewed_at, view_count
         from trip_shares where created_by_user_id=$1 order by created_at desc, id desc limit $2`, [userId, limit]
    ),
    db.query<{
      id: string; trip_id: string; status: string; resolution: string | null; new_stop_label: string | null;
      created_at: Date; resolved_at: Date | null;
    }>(
      `select id, trip_id, status::text as status, resolution, new_stop_label, created_at, resolved_at
         from route_change_proposals where created_by_user_id=$1 order by created_at desc, id desc limit $2`, [userId, limit]
    ),
    db.query<{ proposal_id: string; trip_id: string; accepted: boolean; decided_at: Date }>(
      `select a.proposal_id, p.trip_id, a.accepted, a.decided_at
         from route_change_acceptances a join route_change_proposals p on p.id=a.proposal_id
        where a.passenger_user_id=$1 order by a.decided_at desc, a.proposal_id limit $2`, [userId, limit]
    ),
    db.query<{ show_profile_to_copassengers: boolean; updated_at: Date }>(
      `select show_profile_to_copassengers, updated_at from live_privacy_preferences where user_id=$1`, [userId]
    )
  ]);

  const lists = [given.rows, received.rows, reports.rows, shares.rows, proposed.rows, decisions.rows];
  const truncated = lists.some(rows => rows.length > LIST_LIMIT);
  const cut = <T>(rows: T[]): T[] => rows.slice(0, LIST_LIMIT);

  const count = summary.rows[0]?.rating_count ?? 0;
  const sum = summary.rows[0]?.rating_sum ?? 0;
  const keptReports = cut(reports.rows);
  return {
    ratingSummary: { average: count > 0 ? Math.round((sum * 10) / count) / 10 : null, count },
    ratingsGiven: cut(given.rows).map(row => ({
      tripId: row.trip_id, asRole: row.rater_role, stars: row.stars, comment: row.comment, createdAt: iso(row.created_at)
    })),
    ratingsReceived: cut(received.rows).map(row => ({
      tripId: row.trip_id, stars: row.stars, comment: row.comment, createdAt: iso(row.created_at)
    })),
    incidentReports: keptReports.map(row => ({
      id: row.id,
      tripId: row.trip_id,
      bookingId: row.booking_id,
      asRole: row.reporter_role,
      category: row.category,
      description: row.description,
      status: row.status,
      createdAt: iso(row.created_at),
      resolvedAt: isoOrNull(row.resolved_at),
      attachments: attachments.rows.filter(file => file.report_id === row.id).map(file => ({
        id: file.id,
        contentType: file.content_type,
        sizeBytes: file.size_bytes === null ? null : Number(file.size_bytes),
        status: file.status,
        createdAt: iso(file.created_at)
      }))
    })),
    sharedTripLinks: cut(shares.rows).map(row => ({
      id: row.id,
      bookingId: row.booking_id,
      tripId: row.trip_id,
      includePlate: row.include_plate,
      createdAt: iso(row.created_at),
      expiresAt: iso(row.expires_at),
      revokedAt: isoOrNull(row.revoked_at),
      lastViewedAt: isoOrNull(row.last_viewed_at),
      viewCount: row.view_count
    })),
    routeChanges: {
      proposedByYou: cut(proposed.rows).map(row => ({
        id: row.id,
        tripId: row.trip_id,
        status: row.status,
        resolution: row.resolution,
        newStopLabel: row.new_stop_label,
        createdAt: iso(row.created_at),
        resolvedAt: isoOrNull(row.resolved_at)
      })),
      decisionsByYou: cut(decisions.rows).map(row => ({
        proposalId: row.proposal_id,
        tripId: row.trip_id,
        decision: row.accepted ? "accepted" : "rejected",
        decidedAt: iso(row.decided_at)
      }))
    },
    privacy: {
      showProfileToCoPassengers: privacy.rows[0]?.show_profile_to_copassengers ?? false,
      updatedAt: isoOrNull(privacy.rows[0]?.updated_at)
    },
    truncated
  };
}

/**
 * Borrado/anonimización dentro de la transacción de eliminación de cuenta de `comms` (antes de anonimizar `app_users`).
 * Devuelve recuentos sin datos personales. Las incidencias (y sus fotos) y las decisiones de cambio de ruta se conservan.
 */
export async function eraseUserLiveData(db: Db, userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const run = async (name: string, sql: string) => {
    const result = await db.query(sql, [userId]);
    counts[name] = result.rowCount ?? 0;
  };
  // Enlaces de «Compartir viaje (privado)»: solo guardan el hash del token; borrarlos los invalida.
  await run("tripSharesDeleted", `delete from trip_shares where created_by_user_id=$1`);
  await run("privacyPreferencesDeleted", `delete from live_privacy_preferences where user_id=$1`);
  // Valoraciones que la persona recibió: no tienen sentido sin su cuenta. Las que dio se conservan SIN texto (sus estrellas ya
  // forman parte de la media de otra persona).
  await run("ratingsReceivedDeleted", `delete from trip_ratings where ratee_user_id=$1`);
  await run("ratingCommentsErased", `update trip_ratings set comment=null where rater_user_id=$1 and comment is not null`);
  await run("ratingAggregatesReset", `update profiles set rating_sum=0, rating_count=0 where user_id=$1 and (rating_sum<>0 or rating_count<>0)`);
  return counts;
}

/**
 * Conecta el módulo con los derechos sobre los datos de `comms` (exportación y eliminación de cuenta).
 * Devuelve false (sin romper el arranque) si la API pública de `comms` no está disponible en este despliegue.
 */
export async function registerLiveDataRights(): Promise<boolean> {
  try {
    const comms = await import("../comms/public.js");
    comms.registerExportContributor({ name: LIVE_MODULE_NAME, build: (db, userId) => exportUserLiveData(db, userId) });
    comms.registerErasureStep({ name: LIVE_MODULE_NAME, run: (client, userId) => eraseUserLiveData(client, userId) });
    return true;
  } catch {
    return false;
  }
}
