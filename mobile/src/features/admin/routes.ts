/**
 * Rutas del slice `admin` (lámina 10: panel de administración (solo personal)).
 *
 * ANDAMIAJE: cada ruta apunta a `PendingScreen` hasta que el agente del slice escribe la pantalla real. Este fichero
 * es suyo desde ese momento: cambia `component`, ajusta los tipos de `AdminParams` y añade las rutas nuevas
 * (legal, permisos, recibos…) que necesite. Reglas:
 *  - `AdminParams` es un `type` (no `interface`) y SOLO lleva datos serializables (ids, textos, números).
 *  - Los nombres de ruta son únicos en TODA la app (el registro falla al arrancar si se repiten).
 *  - `access`: "public" (también invitados) · "auth" (por defecto) · "staff".
 *  - Pantalla = componente que recibe `AppScreenProps<"Nombre">`; navega con `useAppNavigation()` y lee los
 *    parámetros con `useAppRoute("Nombre")`.
 */
import { PendingScreen } from "@/navigation/PendingScreen";
import { defineRoute, type RouteDef } from "@/navigation/routeDef";
import { AdminUsersReviewScreen } from "./review/screens/AdminUsersReviewScreen";
import { AdminBookingsRefundsScreen } from "./review/screens/AdminBookingsRefundsScreen";
import { AdminAlertsScreen, AdminAuditLogScreen, AdminTariffsOpsScreen } from "./ops/screens/OpsPanelScreen";

export type AdminParams = {
  AdminSummary: undefined;
  AdminUsersReview: { userId?: string } | undefined;
  AdminBookingsRefunds: undefined;
  AdminTariffsOps: { tab?: "tariffs" | "operations" | "alerts" | "audit" } | undefined;
  // ── Páginas adicionales de producción (catálogo de docs/BUILD_BRIEF.md §10.3). Contrato entre equipos: añade parámetros opcionales, no renombres ni quites.
  AdminHome: undefined;
  AdminUserFile: { userId: string };
  AdminRefundDetail: { refundId: string };
  AdminPayoutRuns: undefined;
  AdminTariffVersions: undefined;
  AdminAlerts: undefined;
  AdminAuditLog: undefined;
  AdminLegalDocs: undefined;
  AdminLegalEditor: { documentId?: string } | undefined;
  AdminSupportQueue: undefined;
  AdminSupportTicket: { ticketId: string };
};

export const adminRoutes: RouteDef[] = [
  defineRoute({ name: "AdminSummary", component: PendingScreen, access: "staff", screen: "37", title: "Panel · Resumen" }),
  defineRoute({ name: "AdminUsersReview", component: AdminUsersReviewScreen, access: "staff", screen: "38", title: "Panel · Usuarios" }),
  defineRoute({ name: "AdminBookingsRefunds", component: AdminBookingsRefundsScreen, access: "staff", screen: "39", title: "Panel · Reservas y reembolsos" }),
  defineRoute({ name: "AdminTariffsOps", component: AdminTariffsOpsScreen, access: "staff", screen: "40", title: "Panel · Tarifas y operación" }),
  // ── Páginas adicionales de producción (sin lámina: se diseñan en el mismo lenguaje visual)
  defineRoute({ name: "AdminHome", component: PendingScreen, access: "staff", title: "Panel de administración" }),
  defineRoute({ name: "AdminUserFile", component: PendingScreen, access: "staff", title: "Panel · Expediente" }),
  defineRoute({ name: "AdminRefundDetail", component: PendingScreen, access: "staff", title: "Panel · Devolución" }),
  defineRoute({ name: "AdminPayoutRuns", component: PendingScreen, access: "staff", title: "Panel · Liquidaciones" }),
  defineRoute({ name: "AdminTariffVersions", component: PendingScreen, access: "staff", title: "Panel · Versiones de tarifa" }),
  defineRoute({ name: "AdminAlerts", component: AdminAlertsScreen, access: "staff", title: "Panel · Alertas" }),
  defineRoute({ name: "AdminAuditLog", component: AdminAuditLogScreen, access: "staff", title: "Panel · Auditoría" }),
  defineRoute({ name: "AdminLegalDocs", component: PendingScreen, access: "staff", title: "Panel · Documentos legales" }),
  defineRoute({ name: "AdminLegalEditor", component: PendingScreen, access: "staff", title: "Panel · Editar documento legal" }),
  defineRoute({ name: "AdminSupportQueue", component: PendingScreen, access: "staff", title: "Panel · Atención al cliente" }),
  defineRoute({ name: "AdminSupportTicket", component: PendingScreen, access: "staff", title: "Panel · Consulta" }),
];
