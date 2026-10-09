/**
 * Proveedor de verificación por SMS SIMULADO (equivale a Twilio Verify). No envía ningún SMS: genera un código de 6
 * dígitos y lo muestra en el visor (`__MVC_PREVIEW_SHELL__.deliverSms({ to, from, body, code })`) o, si no hay visor,
 * en un aviso flotante etiquetado «Simulación». El código también queda en la colección `sim_sms_verifications`.
 */
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { deliverSmsToShell, readShell } from "../core/shell";

export const SMS_PROVIDER_NAME = "preview-sim";

export interface VerificationStart {
  providerChallengeId: string;
  providerStatus: string;
}

export interface VerificationCheck {
  approved: boolean;
  providerStatus: string;
}

export interface SentSms {
  code: string;
  phone: string;
  at: number;
}

let lastSms: SentSms | null = null;

/** Último SMS «enviado» (para pruebas y para `window.__mvc.lastSms()`). */
export function getLastSms(): SentSms | null {
  return lastSms;
}

function showFallbackToast(code: string, phone: string): void {
  if (typeof document === "undefined") return;
  try {
    const existing = document.getElementById("mvc-preview-sms-toast");
    existing?.remove();
    const box = document.createElement("div");
    box.id = "mvc-preview-sms-toast";
    box.setAttribute("role", "status");
    box.style.cssText =
      "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:92vw;" +
      "background:#0F2A4F;color:#fff;font:600 14px/1.35 system-ui,sans-serif;padding:10px 14px;border-radius:12px;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.35);text-align:center";
    box.textContent = `Simulación · SMS a ${phone}: tu código MVC es ${code}`;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 60_000);
  } catch {
    // sin DOM utilizable: el código sigue disponible en getLastSms()
  }
}

/** Remitente alfanumérico del SMS simulado. */
export const SMS_SENDER = "MVC";

export function smsBody(code: string): string {
  return `Tu código de MVC es ${code}. Caduca en 10 minutos. No lo compartas con nadie.`;
}

export function deliverSms(db: PreviewDb, code: string, phone: string): void {
  lastSms = { code, phone, at: db.nowMs() };
  if (deliverSmsToShell({ to: phone, from: SMS_SENDER, body: smsBody(code), code, at: db.nowMs() })) return;
  showFallbackToast(code, phone);
}

export function startVerification(db: PreviewDb, phoneE164: string): VerificationStart {
  const providerChallengeId = `VE${db.ids.hex(32)}`;
  const code = readShell().otp ?? db.ids.digits(6);
  db.simSms.insert({
    id: providerChallengeId,
    phone_e164: phoneE164,
    code,
    status: "pending",
    attempts: 0,
    created_at: db.nowMs(),
  });
  deliverSms(db, code, phoneE164);
  return { providerChallengeId, providerStatus: "pending" };
}

export function checkVerification(db: PreviewDb, providerChallengeId: string, code: string): VerificationCheck {
  if (!/^[^\s]{4,10}$/.test(code)) {
    throw new ApiFailure("INVALID_VERIFICATION_CODE", "Verification code must contain 4 to 10 characters");
  }
  const row = db.simSms.get(providerChallengeId);
  if (!row) {
    throw new ApiFailure("AUTH_CODE_INVALID_OR_EXPIRED", "Verification code is invalid or expired", 401);
  }
  if (row.status === "approved") return { approved: true, providerStatus: "approved" };
  if (row.code === code) {
    db.simSms.update(row.id, { status: "approved", attempts: row.attempts + 1 });
    return { approved: true, providerStatus: "approved" };
  }
  db.simSms.update(row.id, { attempts: row.attempts + 1 });
  return { approved: false, providerStatus: "pending" };
}
