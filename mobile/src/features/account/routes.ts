/**
 * Rutas del slice `account` (lámina 09: pagos y cobros, ajustes, centro de ayuda y estados de error).
 *
 * Todas las rutas del slice apuntan a su pantalla real (ninguna usa `PendingScreen`). Reglas:
 *  - `AccountParams` es un `type` (no `interface`) y SOLO lleva datos serializables (ids, textos, números).
 *  - Los nombres de ruta son únicos en TODA la app (el registro falla al arrancar si se repiten).
 *  - `access`: "public" (también invitados) · "auth" (por defecto) · "staff".
 *  - Pantalla = componente que recibe `AppScreenProps<"Nombre">`; navega con `useAppNavigation()` y lee los
 *    parámetros con `useAppRoute("Nombre")`.
 */
import { ReceiptsListScreen } from "./money/screens/ReceiptsListScreen";
import { ReceiptDetailScreen } from "./money/screens/ReceiptDetailScreen";
import { PayoutDetailScreen } from "./money/screens/PayoutDetailScreen";
import { EarningDetailScreen } from "./money/screens/EarningDetailScreen";
import { RefundsScreen } from "./money/screens/RefundsScreen";
import { ServiceStatusScreen } from "./help/screens/ServiceStatusScreen";
import { LegalCenterScreen } from "./help/screens/LegalCenterScreen";
import { LegalDocumentScreen } from "./help/screens/LegalDocumentScreen";
import { DataExportsScreen } from "./help/screens/DataExportsScreen";
import { DeleteAccountScreen } from "./help/screens/DeleteAccountScreen";
import { AboutScreen } from "./help/screens/AboutScreen";
import { PrivacyDataScreen } from "./help/screens/PrivacyDataScreen";
import { AppPermissionsScreen } from "./help/screens/AppPermissionsScreen";
import { defineRoute, type RouteDef } from "@/navigation/routeDef";
import { HelpCenterScreen } from "./help/screens/HelpCenterScreen";
import { SupportNewTicketScreen } from "./help/screens/SupportNewTicketScreen";
import { SupportTicketDetailScreen } from "./help/screens/SupportTicketDetailScreen";
import { SupportTicketsScreen } from "./help/screens/SupportTicketsScreen";
import { SettingsScreen } from "./help/screens/SettingsScreen";
import { PaymentHistoryScreen } from "./money/screens/PaymentHistoryScreen";
import { PaymentMethodsScreen } from "./money/screens/PaymentMethodsScreen";
import { AddPaymentMethodScreen } from "./money/screens/AddPaymentMethodScreen";
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
  defineRoute({ name: "ServiceStatus", component: ServiceStatusScreen, access: "public", screen: "36", title: "Estados de error" }),
  // ── Páginas adicionales de producción (sin lámina: se diseñan en el mismo lenguaje visual)
  defineRoute({ name: "PaymentHistory", component: PaymentHistoryScreen, access: "auth", title: "Historial de pagos" }),
  defineRoute({ name: "PaymentMethods", component: PaymentMethodsScreen, access: "auth", title: "Métodos de pago" }),
  defineRoute({ name: "AddPaymentMethod", component: AddPaymentMethodScreen, access: "auth", title: "Añadir método de pago" }),
  defineRoute({ name: "ReceiptsList", component: ReceiptsListScreen, access: "auth", title: "Recibos y justificantes" }),
  defineRoute({ name: "ReceiptDetail", component: ReceiptDetailScreen, access: "auth", title: "Recibo", previewParams: { receiptId: { $ref: "money.receiptPayment" } }, previewSeed: "money-historial-largo" }),
  defineRoute({ name: "PayoutDetail", component: PayoutDetailScreen, access: "auth", title: "Liquidación", previewParams: { payoutId: { $ref: "money.payoutPaid" } }, previewSeed: "money-historial-largo" }),
  defineRoute({ name: "EarningDetail", component: EarningDetailScreen, access: "auth", title: "Detalle del cobro", previewParams: { bookingId: { $ref: "money.earningPaidOut" } }, previewSeed: "money-historial-largo" }),
  defineRoute({ name: "Refunds", component: RefundsScreen, access: "auth", title: "Mis devoluciones" }),
  defineRoute({ name: "LegalCenter", component: LegalCenterScreen, access: "public", title: "Información legal" }),
  defineRoute({ name: "LegalDocument", component: LegalDocumentScreen, access: "public", title: "Documento legal", previewParams: { kind: "terms" } }),
  defineRoute({ name: "SupportTickets", component: SupportTicketsScreen, access: "auth", title: "Mis consultas" }),
  defineRoute({ name: "SupportNewTicket", component: SupportNewTicketScreen, access: "auth", title: "Nueva consulta" }),
  defineRoute({ name: "SupportTicketDetail", component: SupportTicketDetailScreen, access: "auth", title: "Consulta", previewParams: { ticketId: { $ref: "help.ticketOpen" } }, previewSeed: "help-tickets" }),
  defineRoute({ name: "DataExports", component: DataExportsScreen, access: "auth", title: "Descargar mis datos" }),
  defineRoute({ name: "DeleteAccount", component: DeleteAccountScreen, access: "auth", title: "Eliminar cuenta" }),
  defineRoute({ name: "About", component: AboutScreen, access: "public", title: "Acerca de MVC" }),
  defineRoute({ name: "PrivacyData", component: PrivacyDataScreen, access: "auth", title: "Privacidad y datos" }),
  defineRoute({ name: "AppPermissions", component: AppPermissionsScreen, access: "public", title: "Permisos de la app" }),
];
