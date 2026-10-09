/**
 * Hoja de pago del sistema (Apple Pay / Google Pay). Nunca lanza: devuelve una unión explícita.
 *
 *  - Vista previa en navegador: el visor dibuja «Simulación de Apple Pay/Google Pay — no se cobra nada» (`payWithWallet`).
 *  - App real: hace falta el SDK del proveedor de pagos, que todavía NO está integrado (proveedor sin contratar: ver
 *    BLOCKERS). Hasta entonces devuelve `unavailable` y la pantalla lo cuenta con honestidad; con el proveedor desactivado
 *    el servidor ni siquiera crea el intento de pago (`PAYMENTS_PROVIDER_DISABLED`).
 *
 * IMPORTANTE: autorizar en la hoja NO es haber pagado. El pago solo se da por hecho cuando el servidor lo confirma
 * (`GET /v1/payments/:id`); esta función solo dice si la persona autorizó, canceló o falló.
 */
import { getPreviewShell } from "./previewBridge";

export interface WalletSheetRequest {
  kind: "apple_pay" | "google_pay";
  /** Comercio mostrado en la hoja. */
  merchant: string;
  /** Concepto («Plaza Sevilla Centro → Universidad»). */
  label: string;
  /** Importe ya formateado («6,00 €»); la hoja no calcula nada. */
  amountLabel: string;
}

export type WalletSheetResult =
  | { status: "authorized"; reference: string | null }
  | { status: "cancelled" }
  | { status: "failed" }
  | { status: "unavailable" };

export async function presentWalletSheet(request: WalletSheetRequest): Promise<WalletSheetResult> {
  const shell = getPreviewShell();
  if (shell === undefined) return { status: "unavailable" };
  try {
    const outcome = await shell.payWithWallet({ merchant: request.merchant, label: request.label, amountLabel: request.amountLabel });
    if (outcome.status === "authorized") return { status: "authorized", reference: outcome.reference ?? null };
    return { status: outcome.status };
  } catch {
    return { status: "failed" };
  }
}
