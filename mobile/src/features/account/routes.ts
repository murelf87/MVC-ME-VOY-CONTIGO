/**
 * Rutas del slice `account` (lámina 09: pagos y cobros, ajustes, centro de ayuda y estados de error).
 *
 * ANDAMIAJE: cada ruta apunta a `PendingScreen` hasta que el agente del slice escribe la pantalla real. Este fichero
 * es suyo desde ese momento: cambia `component`, ajusta los tipos de `AccountParams` y añade las rutas nuevas
 * (legal, permisos, recibos…) que necesite. Reglas:
 *  - `AccountParams` es un `type` (no `interface`) y SOLO lleva datos serializables (ids, textos, números).
 *  - Los nombres de ruta son únicos en TODA la app (el registro falla al arrancar si se repiten).
 *  - `access`: "public" (también invitados) · "auth" (por defecto) · "staff".
 *  - Pantalla = componente que recibe `AppScreenProps<"Nombre">`; navega con `useAppNavigation()` y lee los
 *    parámetros con `useAppRoute("Nombre")`.
 */
import { PendingScreen } from "@/navigation/PendingScreen";
import { defineRoute, type RouteDef } from "@/navigation/routeDef";
import { HelpCenterScreen } from "./help/screens/HelpCenterScreen";
import { SupportNewTicketScreen } from "./help/screens/SupportNewTicketScreen";
import { SupportTicketDetailScreen } from "./help/screens/SupportTicketDetailScreen";
import { SupportTicketsScreen } from "./help/screens/SupportTicketsScreen";
import { SettingsScreen } from "./help/screens/SettingsScreen";
import { PaymentsEarningsScreen } from "./money/screens/PaymentsEarningsScreen";

export type AccountParams = {
  PaymentsEarnings: { mode?: "passenger" | "driver" } | undefined;
  Settings: undefined;
  HelpCenter: { ticketId?: string; tripId?: string; category?: "trip_issue" | "payment_issue" | "account_profile" } | undefined;
  ServiceStatus: { kind?: "offline" | "server" | "out_of_province" | "no_capacity" } | undefined;
  // ── Páginas adicionales de producción (catálogo de docs/BUILD_BRIEF.md §10.3). Contrato entre equipos: añade parámetros opcionales, no renombres ni quites.
  PaymentHistory: { mode?: "passenger" | "driver"; section?: "payouts" } | undefined;
  PaymentMethods: undefined;
  AddPaymentMethod: { purpose?: "charge" | "payout" } | undefined;
  ReceiptsList: undefined;
  ReceiptDetail: { receiptId: string };
  PayoutDetail: { payoutId: string };
  EarningDetail: { bookingId: string };
  Refunds: undefined;
  LegalCenter: undefined;
  LegalDocument: { kind: "terms" | "privacy" | "cancellation" | "private_check_notice"; version?: number };
  SupportTickets: undefined;
  SupportNewTicket: { tripId?: string } | undefined;
  SupportTicketDetail: { ticketId: string; /** `true` justo después de enviarla: muestra la confirmación con la referencia. */ sent?: boolean };
  DataExports: undefined;
  DeleteAccount: undefined;
  About: undefined;
  // ── account-help: centros de «Ajustes» (sin lámina propia)
  PrivacyData: undefined;
  AppPermissions: undefined;
};

export const accountRoutes: RouteDef[] = [
  defineRoute({ name: "PaymentsEarnings", component: PaymentsEarningsScreen, access: "auth", screen: "33", title: "Pagos y cobros" }),
  defineRoute({ name: "Settings", component: SettingsScreen, access: "public", screen: "34", title: "Ajustes" }),
  defineRoute({ name: "HelpCenter", component: HelpCenterScreen, access: "public", screen: "35", title: "Centro de ayuda" }),
  defineRoute({ name: "ServiceStatus", component: PendingScreen, access: "public", screen: "36", title: "Estados de error" }),
  // ── Páginas adicionales de producción (sin lámina: se diseñan en el mismo lenguaje visual)
  defineRoute({ name: "PaymentHistory", component: PendingScreen, access: "auth", title: "Historial de pagos" }),
  defineRoute({ name: "PaymentMethods", component: PendingScreen, access: "auth", title: "Métodos de pago" }),
  defineRoute({ name: "AddPaymentMethod", component: PendingScreen, access: "auth", title: "Añadir método de pago" }),
  defineRoute({ name: "ReceiptsList", component: PendingScreen, access: "auth", title: "Recibos y justificantes" }),
  defineRoute({ name: "ReceiptDetail", component: PendingScreen, access: "auth", title: "Recibo" }),
  defineRoute({ name: "PayoutDetail", component: PendingScreen, access: "auth", title: "Liquidación" }),
  defineRoute({ name: "EarningDetail", component: PendingScreen, access: "auth", title: "Detalle del cobro" }),
  defineRoute({ name: "Refunds", component: PendingScreen, access: "auth", title: "Mis devoluciones" }),
  defineRoute({ name: "LegalCenter", component: PendingScreen, access: "public", title: "Información legal" }),
  defineRoute({ name: "LegalDocument", component: PendingScreen, access: "public", title: "Documento legal" }),
  defineRoute({ name: "SupportTickets", component: SupportTicketsScreen, access: "auth", title: "Mis consultas" }),
  defineRoute({ name: "SupportNewTicket", component: SupportNewTicketScreen, access: "auth", title: "Nueva consulta" }),
  defineRoute({ name: "SupportTicketDetail", component: SupportTicketDetailScreen, access: "auth", title: "Consulta", previewParams: { ticketId: { $ref: "help.ticketOpen" } }, previewSeed: "help-tickets" }),
  defineRoute({ name: "DataExports", component: PendingScreen, access: "auth", title: "Descargar mis datos" }),
  defineRoute({ name: "DeleteAccount", component: PendingScreen, access: "auth", title: "Eliminar cuenta" }),
  defineRoute({ name: "About", component: PendingScreen, access: "public", title: "Acerca de MVC" }),
  defineRoute({ name: "PrivacyData", component: PendingScreen, access: "auth", title: "Privacidad y datos" }),
  defineRoute({ name: "AppPermissions", component: PendingScreen, access: "public", title: "Permisos de la app" }),
];
