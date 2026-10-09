import { clampLimit, decodeCursor, encodeCursor, iso, nameParts, sliceOverflow } from "./common.js";
import type { Db } from "./context.js";
import { publicPhotoUrl } from "./public-photo-url.js";

export type ItemKey = "identity" | "private_check" | "driver_license" | "profile_photo";
export const ITEM_KEYS: readonly ItemKey[] = ["identity", "driver_license", "profile_photo", "private_check"];
export type ItemState = "none" | "in_review" | "needs_retry" | "approved" | "rejected";
export type Tab = "pending" | "approved" | "rejected";

export type QueueFilters = {
  tab: Tab;
  role?: "driver" | "passenger" | undefined;
  item?: ItemKey | undefined;
  sort: "recent" | "oldest";
  cursor?: string | undefined;
  limit?: number | undefined;
};

export type ReviewRow = {
  user_id: string;
  user_status: string;
  display_name: string | null;
  public_photo_key: string | null;
  public_photo_status: string | null;
  roles: string[];
  photo_state: ItemState;
  check_state: ItemState;
  id_state: ItemState;
  lic_state: ItemState;
  pending_count: number;
  tab: Tab | null;
  ref_at: Date | null;
  ref_at_text: string | null;
};

/**
 * Consulta única que deriva, por usuario, el estado de sus cuatro elementos de revisión, la pestaña y el instante de referencia.
 *   $1 = elemento filtrado (null = todos) · $2 = rol (null = todos) · $3 = usuario concreto (null = todos)
 * Pestaña: pending si algún elemento (del filtro) está en revisión · si no rejected si alguno rechazado · si no approved si alguno aprobado.
 * `needs_retry` por sí solo no mete al usuario en la cola (espera acción de la persona usuaria, no del personal).
 */
export const REVIEW_STATES_SQL = `
  with base as (
    select u.id as user_id, u.status::text as user_status, p.display_name, p.public_photo_key, p.public_photo_status::text as public_photo_status,
           p.updated_at as profile_updated_at,
           array(select ur.role::text from user_roles ur where ur.user_id = u.id and ur.role in ('passenger','driver') order by ur.role::text) as roles,
           ph.status as ph_status, ph.submitted_at as photo_submitted_at, ph.decided_at as photo_decided_at,
           ck.state as ck_state, ck.decided_at as check_decided_at, ck.updated_at as check_updated_at, ca.submitted_at as check_submitted_at,
           idd.review_status::text as id_status, idd.created_at as id_submitted_at, idd.reviewed_at as id_decided_at,
           lic.review_status::text as lic_status, lic.created_at as lic_submitted_at, lic.reviewed_at as lic_decided_at
      from app_users u
      join profiles p on p.user_id = u.id
      left join lateral (
        select status, submitted_at, decided_at from trust_profile_photos
         where user_id = u.id and status <> 'superseded' order by submitted_at desc, id desc limit 1) ph on true
      left join trust_identity_checks ck on ck.user_id = u.id and ck.state <> 'not_started'
      left join lateral (
        select submitted_at from trust_identity_check_attempts where user_id = u.id order by attempt_no desc limit 1) ca on true
      left join lateral (
        select review_status, created_at, reviewed_at from private_documents
         where owner_user_id = u.id and kind = 'identity_document' order by created_at desc, id desc limit 1) idd on true
      left join lateral (
        select review_status, created_at, reviewed_at from private_documents
         where owner_user_id = u.id and kind = 'driver_license' order by created_at desc, id desc limit 1) lic on true
     where u.status <> 'deleted'
       and ($3::uuid is null or u.id = $3::uuid)
       and ($2::text is null or exists (select 1 from user_roles r where r.user_id = u.id and r.role::text = $2::text))
  ),
  st as (
    select b.*,
      coalesce(
        case b.ph_status when 'in_review' then 'in_review' when 'approved' then 'approved' when 'rejected' then 'rejected' end,
        case when b.public_photo_status = 'approved' and b.public_photo_key is not null then 'approved' else 'none' end) as photo_state,
      case b.ck_state when 'in_review' then 'in_review' when 'needs_retry' then 'needs_retry' when 'completed' then 'approved' when 'rejected' then 'rejected' else 'none' end as check_state,
      case b.id_status when 'pending' then 'in_review' when 'approved' then 'approved' when 'rejected' then 'rejected' else 'none' end as id_state,
      case b.lic_status when 'pending' then 'in_review' when 'approved' then 'approved' when 'rejected' then 'rejected' else 'none' end as lic_state
    from base b
  ),
  eff as (
    select st.*,
      case when $1::text is null or $1::text = 'profile_photo' then photo_state else 'none' end as e_photo,
      case when $1::text is null or $1::text = 'private_check' then check_state else 'none' end as e_check,
      case when $1::text is null or $1::text = 'identity' then id_state else 'none' end as e_id,
      case when $1::text is null or $1::text = 'driver_license' then lic_state else 'none' end as e_lic
    from st
  ),
  tabbed as (
    select eff.*,
      ((photo_state = 'in_review')::int + (check_state = 'in_review')::int + (id_state = 'in_review')::int + (lic_state = 'in_review')::int) as pending_count,
      ((e_photo = 'in_review')::int + (e_check = 'in_review')::int + (e_id = 'in_review')::int + (e_lic = 'in_review')::int) as e_pending
    from eff
  ),
  final as (
    select t.user_id, t.user_status, t.display_name, t.public_photo_key, t.public_photo_status, t.roles,
           t.photo_state, t.check_state, t.id_state, t.lic_state, t.pending_count,
           case
             when t.e_pending > 0 then 'pending'
             when 'rejected' in (t.e_photo, t.e_check, t.e_id, t.e_lic) then 'rejected'
             when 'approved' in (t.e_photo, t.e_check, t.e_id, t.e_lic) then 'approved'
           end as tab,
           coalesce(
             case when t.e_pending > 0 then greatest(
                 case when t.e_photo = 'in_review' then t.photo_submitted_at end,
                 case when t.e_check = 'in_review' then t.check_submitted_at end,
                 case when t.e_id = 'in_review' then t.id_submitted_at end,
                 case when t.e_lic = 'in_review' then t.lic_submitted_at end)
             else greatest(
                 case when t.e_photo in ('approved','rejected') then coalesce(t.photo_decided_at, t.photo_submitted_at) end,
                 case when t.e_check in ('approved','rejected') then coalesce(t.check_decided_at, t.check_updated_at) end,
                 case when t.e_id in ('approved','rejected') then coalesce(t.id_decided_at, t.id_submitted_at) end,
                 case when t.e_lic in ('approved','rejected') then coalesce(t.lic_decided_at, t.lic_submitted_at) end)
             end,
             t.profile_updated_at) as ref_at
      from tabbed t
  )
`;

function labelFor(key: ItemKey, state: ItemState): string {
  switch (key) {
    case "identity":
      return state === "approved"
        ? "DNI verificado"
        : state === "in_review"
          ? "Identidad · En revisión"
          : state === "rejected"
            ? "Identidad · Rechazada"
            : "Identidad · Sin enviar";
    case "driver_license":
      return "Permiso de conducir";
    case "profile_photo":
      return "Foto de perfil";
    case "private_check":
      return state === "approved"
        ? "Comprobación privada · Completada"
        : state === "in_review"
          ? "Comprobación privada · En revisión"
          : state === "needs_retry"
            ? "Comprobación privada · Nueva captura"
            : state === "rejected"
              ? "Comprobación privada · Rechazada"
              : "Comprobación privada";
  }
}

/** «Requiere revisión» solo cuando espera a personal y la etiqueta no lo dice ya. */
function badgeFor(key: ItemKey, state: ItemState): string | null {
  if (state !== "in_review") return null;
  return key === "identity" ? null : "Requiere revisión";
}

export function itemStatesOf(row: ReviewRow): Record<ItemKey, ItemState> {
  return {
    identity: row.id_state,
    driver_license: row.lic_state,
    profile_photo: row.photo_state,
    private_check: row.check_state
  };
}

const STATUS_LABEL: Record<Tab | "none", string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
  none: "Sin entregas"
};

export function toQueueItem(row: ReviewRow, reviewerId: string) {
  const states = itemStatesOf(row);
  const isDriver = row.roles.includes("driver");
  const rows = ITEM_KEYS.filter(key => {
    if (key === "identity" || key === "profile_photo") return true;
    if (key === "driver_license") return isDriver || states.driver_license !== "none";
    return states.private_check !== "none";
  }).map(key => ({ key, label: labelFor(key, states[key]), state: states[key], badge: badgeFor(key, states[key]) }));
  const { displayName, firstName } = nameParts(row.display_name);
  const tab = row.tab ?? "none";
  return {
    userId: row.user_id,
    displayName,
    firstName,
    photoUrl: publicPhotoUrl(row.user_id, row.public_photo_key, row.public_photo_status),
    roles: row.roles as Array<"passenger" | "driver">,
    tab,
    statusLabel: STATUS_LABEL[tab],
    submittedAt: iso(row.ref_at ?? new Date(0)),
    rows,
    pendingCount: row.pending_count,
    canDecide: row.pending_count > 0 && row.user_id !== reviewerId
  };
}

export async function getReviewRow(db: Db, userId: string): Promise<ReviewRow | null> {
  const result = await db.query<ReviewRow>(
    `${REVIEW_STATES_SQL} select f.*, to_char(f.ref_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ref_at_text from final f`,
    [null, null, userId]
  );
  return result.rows[0] ?? null;
}

export async function getReviewSummary(db: Db, userId: string, reviewerId: string) {
  const row = await getReviewRow(db, userId);
  return row ? toQueueItem(row, reviewerId) : null;
}

export async function listReviewQueue(db: Db, reviewerId: string, filters: QueueFilters) {
  const limit = clampLimit(filters.limit);
  const item = filters.item ?? null;
  const role = filters.role ?? null;
  const asc = filters.sort === "oldest";
  const params: unknown[] = [item, role, null, filters.tab];
  let keyset = "";
  if (filters.cursor) {
    const cursor = decodeCursor(filters.cursor, { t: "iso", id: "uuid" });
    params.push(String(cursor.t), String(cursor.id));
    keyset = `and (f.ref_at, f.user_id) ${asc ? ">" : "<"} ($5::timestamptz, $6::uuid)`;
  }
  const rows = await db.query<ReviewRow>(
    `${REVIEW_STATES_SQL}
     select f.*, to_char(f.ref_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ref_at_text
       from final f
      where f.tab = $4::text ${keyset}
      order by f.ref_at ${asc ? "asc" : "desc"}, f.user_id ${asc ? "asc" : "desc"}
      limit ${limit + 1}`,
    params
  );
  const { page, hasMore } = sliceOverflow(rows.rows, limit);
  const last = page[page.length - 1];
  const countsQ = await db.query<{ tab: Tab; n: string }>(
    `${REVIEW_STATES_SQL} select tab, count(*)::text as n from final where tab is not null group by tab`,
    [item, role, null]
  );
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const c of countsQ.rows) counts[c.tab] = Number(c.n);
  return {
    items: page.map(row => toQueueItem(row, reviewerId)),
    nextCursor: hasMore && last && last.ref_at_text ? encodeCursor({ t: last.ref_at_text, id: last.user_id }) : null,
    counts
  };
}
