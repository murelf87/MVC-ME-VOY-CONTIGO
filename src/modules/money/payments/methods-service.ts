import type { Pool } from "pg";
import type { AuthPrincipal } from "../../../auth/session.js";
import { DomainError } from "../../../errors.js";
import { writeAudit } from "../../../lib/audit.js";
import type { Queryable } from "../lib/db.js";
import { toIsoRequired, tx } from "../lib/db.js";
import { withIdempotency, type IdempotentOutcome } from "../lib/idempotency.js";
import { callProvider } from "../provider/call.js";
import type { PaymentProvider } from "../provider/types.js";
import type { PaymentMethodDto, PaymentMethodKind, PaymentMethodPurpose, PaymentsAvailabilityDto } from "../types.js";
import { describeAvailability } from "./availability.js";

export type MethodRow = {
  id: string;
  purpose: PaymentMethodPurpose;
  kind: PaymentMethodKind;
  brand: string | null;
  last4: string | null;
  country: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  status: "active" | "requires_action" | "expired" | "removed";
  created_at: Date | string;
};

export const METHOD_COLUMNS = `id,purpose,kind,brand,last4,country,exp_month,exp_year,is_default,status,created_at`;

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

export function methodTitle(kind: PaymentMethodKind, brand: string | null): string {
  switch (kind) {
    case "card":
      return brand ? `Tarjeta ${titleCase(brand)}` : "Tarjeta";
    case "sepa_debit":
      return "Adeudo SEPA";
    case "bank_account":
      return "Cuenta bancaria";
    case "apple_pay":
      return "Apple Pay";
    case "google_pay":
      return "Google Pay";
  }
}

/** «ES** **** **** 4589» para cuentas, «•••• 4242» para tarjetas. Nunca el número completo. */
export function methodMaskedLabel(kind: PaymentMethodKind, last4: string | null, country: string | null): string {
  if (kind === "bank_account" || kind === "sepa_debit") {
    return last4 ? `${country ?? "ES"}** **** **** ${last4}` : methodTitle(kind, null);
  }
  return last4 ? `•••• ${last4}` : methodTitle(kind, null);
}

export function toMethodDto(row: MethodRow): PaymentMethodDto {
  return {
    id: row.id,
    purpose: row.purpose,
    kind: row.kind,
    brand: row.brand,
    last4: row.last4,
    country: row.country,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    title: methodTitle(row.kind, row.brand),
    maskedLabel: methodMaskedLabel(row.kind, row.last4, row.country),
    isDefault: row.is_default,
    status: row.status === "removed" ? "expired" : row.status,
    createdAt: toIsoRequired(row.created_at)
  };
}

export async function loadDefaultMethod(
  db: Queryable,
  userId: string,
  purpose: PaymentMethodPurpose
): Promise<PaymentMethodDto | null> {
  const result = await db.query<MethodRow>(
    `select ${METHOD_COLUMNS} from payment_methods
      where user_id=$1 and purpose=$2 and status in ('active','requires_action')
      order by is_default desc, created_at desc
      limit 1`,
    [userId, purpose]
  );
  const row = result.rows[0];
  return row ? toMethodDto(row) : null;
}

export async function listMethodRows(db: Queryable, userId: string, purpose: PaymentMethodPurpose): Promise<MethodRow[]> {
  const result = await db.query<MethodRow>(
    `select ${METHOD_COLUMNS} from payment_methods
      where user_id=$1 and purpose=$2 and status <> 'removed'
      order by is_default desc, created_at desc, id`,
    [userId, purpose]
  );
  return result.rows;
}

export async function listPaymentMethods(
  pool: Pool,
  provider: PaymentProvider,
  principal: AuthPrincipal,
  purpose: PaymentMethodPurpose
): Promise<{ items: PaymentMethodDto[]; availability: PaymentsAvailabilityDto }> {
  const rows = await listMethodRows(pool, principal.userId, purpose);
  return { items: rows.map(toMethodDto), availability: describeAvailability(provider) };
}

/** Luhn: un valor que lo cumpla con 13–19 dígitos es un número de tarjeta, no un token del proveedor. */
export function looksLikeCardNumber(value: string): boolean {
  const compact = value.replace(/[\s-]/g, "");
  if (!/^[0-9]{13,19}$/.test(compact)) return false;
  let sum = 0;
  let double = false;
  for (let i = compact.length - 1; i >= 0; i -= 1) {
    let digit = compact.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

const CHARGE_KINDS: ReadonlySet<PaymentMethodKind> = new Set(["card", "apple_pay", "google_pay", "sepa_debit"]);
const PAYOUT_KINDS: ReadonlySet<PaymentMethodKind> = new Set(["bank_account", "sepa_debit"]);

export async function addPaymentMethod(
  pool: Pool,
  provider: PaymentProvider,
  principal: AuthPrincipal,
  idempotencyKey: string,
  body: { purpose: PaymentMethodPurpose; providerToken: string; setAsDefault?: boolean }
): Promise<IdempotentOutcome<PaymentMethodDto>> {
  // Un número de tarjeta se rechaza SIEMPRE (también con el proveedor desactivado) y no se registra ni se almacena.
  if (looksLikeCardNumber(body.providerToken)) {
    throw new DomainError(
      "RAW_CARD_DATA_REJECTED",
      "No envíes números de tarjeta a MVC: usa el formulario seguro del proveedor de pagos.",
      400
    );
  }
  if (!provider.enabled) {
    throw new DomainError("PAYMENTS_PROVIDER_DISABLED", "Pagos aún no disponibles. Todavía no se pueden añadir métodos de pago.", 409);
  }

  return withIdempotency(
    pool,
    {
      userId: principal.userId,
      key: idempotencyKey,
      scope: "payment_method:add",
      // El token no se incluye tal cual en la huella guardada: basta con su longitud y propósito para detectar reutilización de clave.
      fingerprint: { purpose: body.purpose, tokenLength: body.providerToken.length, setAsDefault: body.setAsDefault ?? false },
      successStatus: 201
    },
    async client => {
      const attached = await callProvider(() =>
        provider.attachMethod({
          userId: principal.userId,
          purpose: body.purpose,
          providerToken: body.providerToken
        })
      );
      const allowed = body.purpose === "payout" ? PAYOUT_KINDS : CHARGE_KINDS;
      if (!allowed.has(attached.kind)) {
        throw new DomainError("PAYMENT_METHOD_NOT_AVAILABLE", "Ese tipo de método no se admite para esta finalidad.", 409);
      }

      const existingDefault = await client.query(
        `select 1 from payment_methods
          where user_id=$1 and purpose=$2 and is_default and status in ('active','requires_action')
          for update`,
        [principal.userId, body.purpose]
      );
      const makeDefault = body.setAsDefault === true || existingDefault.rowCount === 0;
      if (makeDefault) {
        await client.query(
          `update payment_methods set is_default=false
            where user_id=$1 and purpose=$2 and is_default`,
          [principal.userId, body.purpose]
        );
      }
      const inserted = await client.query<MethodRow>(
        `insert into payment_methods(user_id,purpose,provider,provider_method_ref,kind,brand,last4,country,exp_month,exp_year,is_default)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (provider,provider_method_ref) do nothing
         returning ${METHOD_COLUMNS}`,
        [
          principal.userId,
          body.purpose,
          provider.name,
          attached.providerMethodRef,
          attached.kind,
          attached.brand,
          attached.last4,
          attached.country,
          attached.expMonth,
          attached.expYear,
          makeDefault
        ]
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new DomainError("PAYMENT_METHOD_NOT_AVAILABLE", "Ese método de pago ya está registrado.", 409);
      }
      await writeAudit(client, {
        actorUserId: principal.userId,
        action: "payment_method.added",
        entityType: "payment_method",
        entityId: row.id,
        metadata: { purpose: body.purpose, kind: attached.kind }
      });
      return toMethodDto(row);
    }
  );
}

export async function removePaymentMethod(
  pool: Pool,
  provider: PaymentProvider,
  principal: AuthPrincipal,
  methodId: string
): Promise<{ removed: true }> {
  return tx(pool, async client => {
    const found = await client.query<MethodRow & { provider_method_ref: string }>(
      `select ${METHOD_COLUMNS}, provider_method_ref from payment_methods
        where id=$1 and user_id=$2 and status <> 'removed'
        for update`,
      [methodId, principal.userId]
    );
    const method = found.rows[0];
    if (!method) throw new DomainError("PAYMENT_METHOD_NOT_FOUND", "Método de pago no encontrado.", 404);

    const open = await client.query(
      `select 1 from payments where payment_method_id=$1 and status in ('requires_action','processing') limit 1`,
      [methodId]
    );
    if (open.rowCount) {
      throw new DomainError("PAYMENT_ALREADY_OPEN", "Hay un pago en curso con este método: espera a que termine.", 409);
    }
    // Con el proveedor desactivado no hay a quién pedirle el desvinculado; el registro local se retira igualmente.
    if (provider.enabled) await callProvider(() => provider.detachMethod(method.provider_method_ref));

    await client.query(
      `update payment_methods set status='removed', removed_at=now(), is_default=false where id=$1`,
      [methodId]
    );
    if (method.is_default) {
      await client.query(
        `update payment_methods set is_default=true
          where id=(select id from payment_methods
                     where user_id=$1 and purpose=$2 and status in ('active','requires_action')
                     order by created_at desc, id limit 1)`,
        [principal.userId, method.purpose]
      );
    }
    await writeAudit(client, {
      actorUserId: principal.userId,
      action: "payment_method.removed",
      entityType: "payment_method",
      entityId: methodId,
      metadata: { purpose: method.purpose, kind: method.kind }
    });
    return { removed: true as const };
  });
}
