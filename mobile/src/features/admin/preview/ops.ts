/**
 * Backend en memoria de la vista previa · slice `admin` · paquete «tarifas, operación, legal y atención».
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). API del núcleo: `mobile/src/preview/index.ts`, ejemplos en
 * `mobile/src/preview/handlers/*.ts` y contrato de los endpoints en `docs/contracts/<módulo>.md`.
 *
 * Endpoints que registra este paquete (BUILD_BRIEF §10.6, fila `admin-ops`):
 *   trust · tarifas       GET /v1/admin/tariffs · PUT …/draft · POST …/example · GET …/versions · POST …/versions/{id}/publish
 *   trust · operación     GET|PUT /v1/admin/operations · GET /v1/admin/alerts · POST …/evaluate · POST …/{id}/status
 *   trust · auditoría     GET /v1/admin/audit-events
 * (`GET /v1/admin/me` es de `admin-review`; `GET /v1/me/payment-methods` es de `account-money`.)
 *
 * El detalle vive en `./opsWorld/*`: un módulo por dominio, con su RBAC (matriz de `docs/contracts/trust.md` §3), su
 * auditoría y sus errores iguales a los del backend real (`src/modules/trust`).
 */
import { registerSeedRef, type PreviewDb, type PreviewProfileId, type PreviewRouter } from "@/preview";
import { alertsTable } from "./opsWorld/operations";
import { registerOpsRoutes } from "./opsWorld/routesOps";
import {
  applyRoleVariant,
  flushAudit,
  makeCtx,
  seedAlerts,
  seedAuditBackground,
  seedEvaluableCancellations,
  seedOperations,
  seedTariffs,
} from "./opsWorld/seedsOps";
import { tariffsTable } from "./opsWorld/tariffs";

/** Variantes de datos propias del paquete: { "nombre-unico": "qué contiene, en una frase" }. */
export const opsSeedVariants: Readonly<Record<string, string>> = {
  "admin-ops-tariff-a": "Tarifas (lámina 40a): borrador con 0,30 €/km; comisiones y cuota Premium «Por definir».",
  "admin-ops-tariff-b": "Tarifas (lámina 40b): borrador con 0,18 €/km y comisiones del 10 %; cuota Premium «Por definir».",
  "admin-ops-tariff-history": "Tarifas con la activación habilitada: una versión retirada, una en vigor y un borrador completo.",
  "admin-ops-activation-enabled": "Tarifas con la activación habilitada y un borrador completo listo para publicar.",
  "admin-ops-no-draft": "Tarifas sin ningún borrador ni versión (primer uso).",
  "admin-ops-alerts-empty": "Sin alertas de operación, ni abiertas ni históricas.",
  "admin-ops-alerts-many": "Treinta alertas (tres abiertas) para probar «Cargar más».",
  "admin-ops-alerts-evaluable": "Seis reservas canceladas hace pocos minutos: al evaluar las reglas nace una alerta a partir de eventos.",
  "admin-ops-alerts-off": "Alertas en tiempo real desactivadas por Administración.",
  "admin-ops-no-incident-source": "La fuente de incidencias del módulo live aún no está disponible.",
  "admin-ops-support-only": "El personal solo tiene el rol de atención al cliente.",
  "admin-ops-finance-only": "El personal solo tiene el rol de finanzas.",
  "admin-ops-verification-only": "El personal solo tiene el rol de verificación (sin acceso a tarifas, atención ni liquidaciones).",
};

function newest<T extends { id: string }>(rows: readonly T[], at: (row: T) => number): string | undefined {
  return [...rows].sort((a, b) => at(b) - at(a))[0]?.id;
}

function registerOpsRefs(): void {
  registerSeedRef("adminTariff.draft", (db) =>
    newest(
      tariffsTable(db).filter((row) => row.status === "draft"),
      (row) => row.version,
    ),
  );
  registerSeedRef("adminTariff.active", (db) =>
    newest(
      tariffsTable(db).filter((row) => row.status === "approved"),
      (row) => row.effective_from ?? 0,
    ),
  );
  registerSeedRef("adminAlert.open", (db) =>
    newest(
      alertsTable(db).filter((row) => row.status === "open"),
      (row) => row.detected_at,
    ),
  );
  registerSeedRef("adminAlert.acknowledged", (db) =>
    newest(
      alertsTable(db).filter((row) => row.status === "acknowledged"),
      (row) => row.detected_at,
    ),
  );
}

export function registerOpsPreview(r: PreviewRouter, db: PreviewDb): void {
  registerOpsRefs();
  registerOpsRoutes(r, db);
}

export function seedOps(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  const ctx = makeCtx(db, profile, seed);
  seedTariffs(ctx);
  seedOperations(ctx);
  seedAlerts(ctx);
  if (seed === "admin-ops-alerts-evaluable") seedEvaluableCancellations(ctx);
  seedAuditBackground(ctx);
  flushAudit(ctx);
  applyRoleVariant(ctx);
}
