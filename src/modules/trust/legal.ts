import { createHmac } from "node:crypto";
import type { AuthPrincipal } from "../../auth/session.js";
import { writeAudit } from "../../lib/audit.js";
import { UUID_RE, iso, isoOrNull, trustError } from "./common.js";
import type { Db, TrustContext } from "./context.js";

export const LEGAL_KINDS = ["terms", "privacy", "cancellation", "private_check_notice"] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];
export type LegalStatus = "draft_pending_legal_review" | "published" | "retired";
export type LegalContext = "registration" | "account" | "booking" | "private_check" | "other";
export const LEGAL_CONTEXTS: readonly LegalContext[] = ["registration", "account", "booking", "private_check", "other"];

export type LegalSection = { heading: string; paragraphs: string[]; bullets: string[] };

type LegalRow = {
  id: string;
  kind: LegalKind;
  version: number;
  status: LegalStatus;
  title: string;
  locale: string;
  sections: LegalSection[];
  content_sha256: string;
  effective_from: Date | null;
  published_at: Date | null;
};

const COLUMNS = `id, kind, version, status, title, locale, sections, content_sha256, effective_from, published_at`;

export function toLegalSummary(row: LegalRow) {
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    status: row.status,
    title: row.title,
    locale: "es-ES" as const,
    legallyEffective: row.status === "published",
    pendingLegalReview: row.status === "draft_pending_legal_review",
    effectiveFrom: isoOrNull(row.effective_from),
    publishedAt: isoOrNull(row.published_at),
    contentSha256: row.content_sha256.trim()
  };
}

export function toLegalDocument(row: LegalRow) {
  return { ...toLegalSummary(row), sections: row.sections };
}

/** «Vigente» = la versión publicada; si no hay ninguna publicada, la más alta en borrador (marcada pendiente de revisión legal). */
export async function latestLegalDocument(db: Db, kind: LegalKind): Promise<LegalRow | null> {
  const result = await db.query<LegalRow>(
    `select ${COLUMNS}
       from trust_legal_documents
      where kind = $1 and status in ('published','draft_pending_legal_review')
      order by (status = 'published') desc, version desc
      limit 1`,
    [kind]
  );
  return result.rows[0] ?? null;
}

export async function listLatestLegalDocuments(db: Db): Promise<LegalRow[]> {
  const out: LegalRow[] = [];
  for (const kind of LEGAL_KINDS) {
    const row = await latestLegalDocument(db, kind);
    if (row) out.push(row);
  }
  return out;
}

export async function getLegalDocument(db: Db, kind: LegalKind, version?: number): Promise<LegalRow> {
  const row =
    version === undefined
      ? await latestLegalDocument(db, kind)
      : (await db.query<LegalRow>(`select ${COLUMNS} from trust_legal_documents where kind = $1 and version = $2`, [kind, version])).rows[0] ?? null;
  if (!row) throw trustError("LEGAL_DOCUMENT_NOT_FOUND", "No existe ese documento legal.", 404);
  return row;
}

const SCOPE: Record<LegalKind, "account" | "booking" | "private_check"> = {
  terms: "account",
  privacy: "account",
  cancellation: "booking",
  private_check_notice: "private_check"
};

const DEFAULT_CONTEXT: Record<LegalKind, LegalContext> = {
  terms: "account",
  privacy: "account",
  cancellation: "booking",
  private_check_notice: "private_check"
};

export async function legalStatusForUser(db: Db, userId: string) {
  const items = [];
  for (const kind of LEGAL_KINDS) {
    const latest = await latestLegalDocument(db, kind);
    if (!latest) continue;
    const accepted = await db.query<{ version: number; accepted_at: Date; document_id: string }>(
      `select version, accepted_at, document_id
         from trust_legal_acceptances
        where user_id = $1 and kind = $2
        order by version desc, accepted_at desc
        limit 1`,
      [userId, kind]
    );
    const last = accepted.rows[0];
    const acceptsLatest = Boolean(last && last.document_id === latest.id);
    items.push({
      kind,
      latestVersion: latest.version,
      status: latest.status,
      pendingLegalReview: latest.status === "draft_pending_legal_review",
      scope: SCOPE[kind],
      accepted: acceptsLatest,
      acceptedVersion: last ? last.version : null,
      acceptedAt: last ? iso(last.accepted_at) : null
    });
  }
  const byKind = new Map(items.map(item => [item.kind, item]));
  return {
    items,
    accountDocumentsAccepted: Boolean(byKind.get("terms")?.accepted && byKind.get("privacy")?.accepted)
  };
}

type AcceptanceRow = {
  id: string;
  document_id: string;
  kind: LegalKind;
  version: number;
  context: LegalContext;
  accepted_at: Date;
  document_status: LegalStatus;
};

function toAcceptance(row: AcceptanceRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    kind: row.kind,
    version: row.version,
    context: row.context,
    acceptedAt: iso(row.accepted_at),
    legallyEffective: row.document_status === "published"
  };
}

export function hashIp(pepper: string | undefined, ip: string | undefined): string | null {
  if (!pepper || !ip) return null;
  return createHmac("sha256", pepper).update(ip, "utf8").digest("hex");
}

export async function listAcceptances(db: Db, userId: string) {
  const rows = await db.query<AcceptanceRow>(
    `select id, document_id, kind, version, context, accepted_at, document_status
       from trust_legal_acceptances
      where user_id = $1
      order by accepted_at desc, id desc
      limit 200`,
    [userId]
  );
  return rows.rows.map(toAcceptance);
}

export async function acceptLegalDocument(
  ctx: TrustContext,
  principal: AuthPrincipal,
  input: { kind: LegalKind; version: number; context?: LegalContext },
  meta: { ip: string | undefined; requestId: string }
): Promise<{ created: boolean; acceptance: ReturnType<typeof toAcceptance> }> {
  const doc = await getLegalDocument(ctx.pool, input.kind, input.version);
  if (doc.status === "retired") {
    throw trustError("LEGAL_DOCUMENT_RETIRED", "Esa versión ya no está vigente.", 409);
  }
  const latest = await latestLegalDocument(ctx.pool, input.kind);
  if (!latest || latest.id !== doc.id) {
    throw trustError("LEGAL_VERSION_OUTDATED", "Hay una versión más reciente de este documento.", 409, {
      latestVersion: latest?.version ?? null
    });
  }
  const context = input.context ?? DEFAULT_CONTEXT[input.kind];
  const ipHash = hashIp(ctx.config.ipHashPepper, meta.ip);

  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<AcceptanceRow>(
      `insert into trust_legal_acceptances(user_id, document_id, kind, version, context, document_status, ip_hash)
       values($1,$2,$3,$4,$5,$6,$7)
       on conflict (user_id, document_id) do nothing
       returning id, document_id, kind, version, context, accepted_at, document_status`,
      [principal.userId, doc.id, doc.kind, doc.version, context, doc.status, ipHash]
    );
    let row = inserted.rows[0];
    const created = Boolean(row);
    if (!row) {
      const existing = await client.query<AcceptanceRow>(
        `select id, document_id, kind, version, context, accepted_at, document_status
           from trust_legal_acceptances where user_id = $1 and document_id = $2`,
        [principal.userId, doc.id]
      );
      row = existing.rows[0];
      if (!row) throw new Error("aceptación no encontrada tras conflicto");
    } else {
      await writeAudit(client, {
        actorUserId: principal.userId,
        action: "legal.accepted",
        entityType: "legal_document",
        entityId: doc.id,
        requestId: meta.requestId,
        metadata: { kind: doc.kind, version: doc.version, context, documentStatus: doc.status, proofHashed: ipHash !== null }
      });
    }
    await client.query("commit");
    return { created, acceptance: toAcceptance(row) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** ¿Ha aceptado el usuario la versión vigente del documento? (la usa la comprobación privada) */
export async function hasAcceptedLatest(db: Db, userId: string, kind: LegalKind) {
  const latest = await latestLegalDocument(db, kind);
  if (!latest) return { latest: null, acceptedAt: null as string | null, accepted: false };
  const found = await db.query<{ accepted_at: Date }>(
    `select accepted_at from trust_legal_acceptances where user_id = $1 and document_id = $2`,
    [userId, latest.id]
  );
  const row = found.rows[0];
  return { latest, acceptedAt: row ? iso(row.accepted_at) : null, accepted: Boolean(row) };
}

/* ───────────── Administración ───────────── */

export async function adminListLegalDocuments(db: Db) {
  const rows = await db.query<LegalRow>(
    `select ${COLUMNS} from trust_legal_documents order by kind, version desc`
  );
  return rows.rows.map(toLegalSummary);
}

function validateSections(sections: unknown): LegalSection[] {
  const fields: Array<{ field: string; message: string }> = [];
  const out: LegalSection[] = [];
  if (!Array.isArray(sections) || sections.length < 1 || sections.length > 60) {
    throw trustError("LEGAL_CONTENT_INVALID", "El documento debe tener entre 1 y 60 secciones.", 422, {
      fields: [{ field: "sections", message: "entre 1 y 60 secciones" }]
    });
  }
  sections.forEach((raw, index) => {
    const section = raw as Partial<LegalSection>;
    const heading = typeof section.heading === "string" ? section.heading.trim() : "";
    const paragraphs = Array.isArray(section.paragraphs) ? section.paragraphs.map(p => (typeof p === "string" ? p.trim() : "")) : [];
    const bullets = Array.isArray(section.bullets) ? section.bullets.map(b => (typeof b === "string" ? b.trim() : "")) : [];
    if (heading.length < 1 || heading.length > 200) fields.push({ field: `sections.${index}.heading`, message: "entre 1 y 200 caracteres" });
    if (paragraphs.length > 50 || paragraphs.some(p => p.length < 1 || p.length > 5000)) {
      fields.push({ field: `sections.${index}.paragraphs`, message: "como máximo 50 párrafos de 1 a 5000 caracteres" });
    }
    if (bullets.length > 50 || bullets.some(b => b.length < 1 || b.length > 1000)) {
      fields.push({ field: `sections.${index}.bullets`, message: "como máximo 50 viñetas de 1 a 1000 caracteres" });
    }
    if (paragraphs.length === 0 && bullets.length === 0) {
      fields.push({ field: `sections.${index}`, message: "cada sección necesita al menos un párrafo o una viñeta" });
    }
    out.push({ heading, paragraphs, bullets });
  });
  if (fields.length > 0) throw trustError("LEGAL_CONTENT_INVALID", "El contenido del documento no es válido.", 422, { fields });
  return out;
}

export async function adminCreateLegalDocument(
  ctx: TrustContext,
  principal: AuthPrincipal,
  input: { kind: LegalKind; title: string; sections: LegalSection[] },
  requestId: string
) {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 200) {
    throw trustError("LEGAL_CONTENT_INVALID", "El título debe tener entre 3 y 200 caracteres.", 422, {
      fields: [{ field: "title", message: "entre 3 y 200 caracteres" }]
    });
  }
  const sections = validateSections(input.sections);
  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`trust_legal:${input.kind}`]);
    const next = await client.query<{ next: number }>(
      `select coalesce(max(version), 0) + 1 as next from trust_legal_documents where kind = $1`,
      [input.kind]
    );
    const version = Number(next.rows[0]?.next ?? 1);
    const inserted = await client.query<LegalRow>(
      `insert into trust_legal_documents(kind, version, status, title, sections, content_sha256, created_by_user_id)
       values($1,$2,'draft_pending_legal_review',$3,$4::jsonb, trust_legal_content_hash($3,$4::jsonb), $5)
       returning ${COLUMNS}`,
      [input.kind, version, title, JSON.stringify(sections), principal.userId]
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("alta de documento legal sin fila");
    await writeAudit(client, {
      actorUserId: principal.userId,
      action: "admin.legal.created",
      entityType: "legal_document",
      entityId: row.id,
      requestId,
      metadata: { kind: input.kind, version, sections: sections.length }
    });
    await client.query("commit");
    return toLegalDocument(row);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function adminPublishLegalDocument(
  ctx: TrustContext,
  principal: AuthPrincipal,
  documentId: string,
  input: { legalReviewReference: string; effectiveFrom?: string },
  requestId: string
) {
  const reference = input.legalReviewReference.trim();
  if (reference.length < 3) {
    throw trustError(
      "LEGAL_REVIEW_REFERENCE_REQUIRED",
      "Indica la referencia de la revisión legal que aprueba este texto.",
      422
    );
  }
  let effectiveFrom = ctx.now();
  if (input.effectiveFrom !== undefined) {
    const parsed = new Date(input.effectiveFrom);
    if (Number.isNaN(parsed.getTime())) {
      throw trustError("LEGAL_CONTENT_INVALID", "La fecha de entrada en vigor no es válida.", 422, {
        fields: [{ field: "effectiveFrom", message: "fecha ISO-8601 válida" }]
      });
    }
    effectiveFrom = parsed;
  }
  if (!UUID_RE.test(documentId)) throw trustError("LEGAL_DOCUMENT_NOT_FOUND", "No existe ese documento legal.", 404);

  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    const found = await client.query<LegalRow>(`select ${COLUMNS} from trust_legal_documents where id = $1 for update`, [documentId]);
    const doc = found.rows[0];
    if (!doc) throw trustError("LEGAL_DOCUMENT_NOT_FOUND", "No existe ese documento legal.", 404);
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`trust_legal:${doc.kind}`]);
    if (doc.status === "published") throw trustError("LEGAL_ALREADY_PUBLISHED", "Esa versión ya está publicada.", 409);
    if (doc.status === "retired") throw trustError("LEGAL_DOCUMENT_RETIRED", "Esa versión está retirada y no puede publicarse.", 409);
    const current = await client.query<{ id: string; version: number }>(
      `select id, version from trust_legal_documents where kind = $1 and status = 'published' for update`,
      [doc.kind]
    );
    const published = current.rows[0];
    if (published && published.version > doc.version) {
      throw trustError("LEGAL_VERSION_OUTDATED", "Hay publicada una versión más reciente que esta.", 409, {
        latestVersion: published.version
      });
    }
    if (published) {
      await client.query(`update trust_legal_documents set status = 'retired', retired_at = now() where id = $1`, [published.id]);
    }
    const updated = await client.query<LegalRow>(
      `update trust_legal_documents
          set status = 'published', published_at = now(), effective_from = $2,
              legal_review_reference = $3, published_by_user_id = $4
        where id = $1
        returning ${COLUMNS}`,
      [documentId, effectiveFrom.toISOString(), reference, principal.userId]
    );
    const row = updated.rows[0];
    if (!row) throw new Error("publicación de documento legal sin fila");
    await writeAudit(client, {
      actorUserId: principal.userId,
      action: "admin.legal.published",
      entityType: "legal_document",
      entityId: documentId,
      requestId,
      metadata: {
        kind: doc.kind,
        version: doc.version,
        retiredVersion: published?.version ?? null,
        legalReviewReference: reference
      }
    });
    await client.query("commit");
    return toLegalDocument(row);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
