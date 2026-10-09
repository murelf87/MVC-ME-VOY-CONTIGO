/**
 * Claves de la caché de consultas del paquete «pagos y cobros». Todas cuelgan de `["money", …]`: invalidar `MONEY`
 * (p. ej. tras añadir o quitar un método de pago) refresca el resumen, las listas y los detalles que estén a la vista.
 */
import type { DriverEarningState, PassengerPaymentState, PaymentMethodPurpose, ReceiptKind } from "@/api/types/money";

/** Prefijo de todo lo de este paquete. */
export const MONEY = ["money"] as const;

export const moneyKeys = {
  passengerSummary: (month: string): readonly unknown[] => ["money", "passenger-summary", month],
  driverSummary: (month: string): readonly unknown[] => ["money", "driver-summary", month],
  payments: (state: PassengerPaymentState | null): readonly unknown[] => ["money", "payments", state ?? "all"],
  earnings: (state: DriverEarningState | null): readonly unknown[] => ["money", "earnings", state ?? "all"],
  earning: (bookingId: string): readonly unknown[] => ["money", "earning", bookingId],
  methods: (purpose: PaymentMethodPurpose | null): readonly unknown[] => ["money", "methods", purpose ?? "all"],
  receipts: (kind: ReceiptKind | null): readonly unknown[] => ["money", "receipts", kind ?? "all"],
  receipt: (receiptId: string): readonly unknown[] => ["money", "receipt", receiptId],
  printable: (receiptId: string): readonly unknown[] => ["money", "receipt-printable", receiptId],
  payouts: (): readonly unknown[] => ["money", "payouts"],
  payout: (payoutId: string): readonly unknown[] => ["money", "payout", payoutId],
  refunds: (): readonly unknown[] => ["money", "refunds"],
};
