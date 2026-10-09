/**
 * Modelo de la pantalla 16 «Estado y pago» a partir de lo que dice el servidor. Función pura: NUNCA decide si algo está
 * pagado, aceptado o caducado — solo traduce `RideRequestDetail` / `WeeklyReservation` / `RequestPaymentContext` a texto,
 * pasos y bloqueos. Aceptada ≠ confirmada: «Plaza confirmada» solo cuando la reserva existe.
 */
import type {
  ChargeMethodKind,
  Money,
  PaymentBlockReason,
  PaymentSummary,
  RequestPaymentContext,
  RideRequestDetail,
  RideRequestStatus,
  WeeklyReservation,
} from "@/api/types";
import { MONEY_PENDING_TEXT, formatCountdown, moneyParts } from "@/i18n";
import type { StepState } from "@/ui";
import { requestStrings } from "../strings";

const copy = requestStrings.status;

export type StatusPhase =
  | "waiting"
  | "accepted"
  | "confirmed"
  | "partial"
  | "rejected"
  | "expired"
  | "hold_expired"
  | "payment_late"
  | "cancelled";

export interface StatusSources {
  ride: RideRequestDetail;
  weekly: WeeklyReservation | null;
  /** Solo existe (y solo se pide) cuando la solicitud está aceptada. */
  context: RequestPaymentContext | null;
}

export type BannerTone = "success" | "info" | "warning" | "error";

export interface StatusBannerModel {
  tone: BannerTone;
  title: string;
  message: string;
}

export interface MethodOptionModel {
  kind: ChargeMethodKind;
  label: string;
  available: boolean;
}

export interface SummaryModel {
  heading: string;
  rows: Array<{ key: string; label: string; value: string }>;
  fee: { label: string; value: string };
  total: { label: string; value: string };
  /** Hay importes de ejemplo (la lámina los rotula «(ejemplo)»). */
  illustrative: boolean;
}

export interface PayBlockModel {
  code: PaymentBlockReason["code"];
  title: string;
  message: string;
}

export interface StatusModel {
  phase: StatusPhase;
  weekly: boolean;
  driverName: string;
  steps: readonly string[];
  stepStates: StepState[];
  /** Índice del paso actual para el lector de pantalla. */
  stepIndex: number;
  banner: StatusBannerModel;
  /** Cuenta atrás visible (solo con aceptada + reserva provisional vigente). */
  hold: { secondsLeft: number; text: string } | null;
  showPayment: boolean;
  methods: MethodOptionModel[];
  summary: SummaryModel | null;
  payBlock: PayBlockModel | null;
  /** «Pagar reserva» activo (el servidor lo permite y queda tiempo). */
  canPay: boolean;
  canWithdraw: boolean;
  /** Hay un pago en curso (hay que seguirlo, no crear otro). */
  openPaymentId: string | null;
  confirmed: { bookingId: string | null } | null;
  /** «n de m» días de la reserva semanal. */
  weeklyCounts: { confirmed: number; total: number } | null;
}

const driverNameOf = (ride: RideRequestDetail): string => ride.trip.driver.firstName.trim() || ride.trip.driver.displayName;

/** Estados de la solicitud → fase de la pantalla (el servidor ya normaliza `accepted` ≡ `payment_pending`). */
export function phaseOf(status: RideRequestStatus, holdActive: boolean, hadHold: boolean, weeklyStatus: WeeklyReservation["status"] | null): StatusPhase {
  if (weeklyStatus === "partially_confirmed") return "partial";
  switch (status) {
    case "pending":
      return "waiting";
    case "accepted":
    case "payment_pending":
      return holdActive ? "accepted" : "hold_expired";
    case "confirmed":
      return "confirmed";
    case "rejected":
      return "rejected";
    case "payment_late":
      return "payment_late";
    case "cancelled":
      return "cancelled";
    case "expired":
      return hadHold ? "hold_expired" : "expired";
  }
}

function stepStatesOf(phase: StatusPhase): StepState[] {
  switch (phase) {
    case "waiting":
      return ["complete", "upcoming", "upcoming", "upcoming"];
    case "accepted":
    case "partial":
      return ["reached", "complete", "upcoming", "upcoming"];
    case "confirmed":
      return ["reached", "reached", "reached", "complete"];
    case "hold_expired":
    case "payment_late":
      return ["reached", "reached", "upcoming", "upcoming"];
    default:
      return ["reached", "upcoming", "upcoming", "upcoming"];
  }
}

/** Segundos de cuenta atrás: los que dijo el servidor menos lo que ha pasado desde que llegó la respuesta. */
export function holdSecondsLeft(remainingSeconds: number | null | undefined, receivedAtMs: number | null, nowMs: number): number | null {
  if (remainingSeconds === null || remainingSeconds === undefined) return null;
  const elapsed = receivedAtMs === null ? 0 : Math.max(0, Math.floor((nowMs - receivedAtMs) / 1000));
  return Math.max(0, remainingSeconds - elapsed);
}

function bannerOf(phase: StatusPhase, name: string, weekly: boolean): StatusBannerModel {
  switch (phase) {
    case "waiting":
      return { tone: "info", title: copy.waitingTitle(name), message: copy.waitingMessage };
    case "accepted":
      return { tone: "success", title: copy.accepted, message: weekly ? copy.acceptedWeeklyBy(name) : copy.acceptedBy(name) };
    case "confirmed":
      return { tone: "success", title: copy.confirmedTitle, message: copy.confirmedMessage(name) };
    case "partial":
      return { tone: "warning", title: copy.partiallyConfirmedTitle, message: copy.partiallyConfirmedMessage };
    case "rejected":
      return { tone: "error", title: copy.rejectedTitle(name), message: copy.rejectedMessage };
    case "expired":
      return { tone: "warning", title: copy.expiredRequestTitle, message: copy.expiredRequestMessage };
    case "hold_expired":
      return { tone: "warning", title: copy.holdExpiredTitle, message: copy.holdExpiredMessage };
    case "payment_late":
      return { tone: "warning", title: copy.paymentLateTitle, message: copy.paymentLateMessage };
    case "cancelled":
      return { tone: "info", title: copy.withdrawnTitle, message: copy.withdrawnMessage };
  }
}

const METHOD_LABEL: Record<ChargeMethodKind, string> = {
  apple_pay: copy.methodApplePay,
  google_pay: copy.methodGooglePay,
  card: copy.methodCard,
};

/**
 * Métodos que se ofrecen: Apple Pay solo en iOS y Google Pay solo en Android (`platform`); «Tarjeta» siempre. Un método
 * que el servidor no ofrece sale deshabilitado («No disponible»), nunca oculto: la persona ve por qué no puede elegirlo.
 */
export function methodOptions(context: RequestPaymentContext | null, platform: "ios" | "android" | "web"): MethodOptionModel[] {
  const wanted: ChargeMethodKind[] = platform === "android" ? ["google_pay", "card"] : ["apple_pay", "card"];
  return wanted.map((kind) => ({
    kind,
    label: METHOD_LABEL[kind],
    available: context?.methods.find((m) => m.kind === kind)?.available ?? false,
  }));
}

/** Método elegido por defecto: el primero disponible; si ninguno lo está, el primero (para enseñar el bloqueo). */
export function defaultMethod(options: readonly MethodOptionModel[]): ChargeMethodKind {
  return (options.find((o) => o.available) ?? options[0])?.kind ?? "card";
}

const text = (money: Money): string => moneyParts(money).text;

export function summaryOf(summary: PaymentSummary, weekly: WeeklyReservation | null): SummaryModel {
  const weeklyQuote = weekly?.quote.weekly ?? null;
  const contribution = weeklyQuote !== null ? weeklyQuote.contributionPerWeek : summary.contribution;
  const total = weeklyQuote !== null ? weeklyQuote.totalPerWeek : summary.total;
  const illustrative = [contribution, summary.platformFee, total].some((m) => moneyParts(m).illustrative);
  const pending = [contribution, summary.platformFee, total].some((m) => moneyParts(m).pending);
  const contributionLabel =
    weeklyQuote !== null
      ? illustrative
        ? copy.summaryWeeklyContributionExample
        : copy.summaryWeeklyContribution
      : illustrative
        ? copy.summaryContributionExample
        : copy.summaryContribution;
  const heading =
    weeklyQuote !== null ? copy.summaryTitle : pending ? `${copy.summaryExampleTitle} · ${copy.summaryAmountPending}` : illustrative ? copy.summaryExampleTitle : copy.summaryTitle;
  const feePending = moneyParts(summary.platformFee).pending;
  return {
    heading,
    rows: [{ key: "contribution", label: contributionLabel, value: text(contribution) }],
    // 16a: «Gestión MVC · Por definir» con «—»; 16b (semanal): «Gestión MVC» con «Por definir» a la derecha.
    fee:
      weeklyQuote !== null
        ? { label: copy.summaryFee, value: text(summary.platformFee) }
        : { label: feePending ? `${copy.summaryFee} · ${MONEY_PENDING_TEXT}` : copy.summaryFee, value: feePending ? "—" : text(summary.platformFee) },
    total: { label: copy.summaryTotal, value: text(total) },
    illustrative,
  };
}

function blockOf(reason: PaymentBlockReason | null, method: MethodOptionModel | undefined): PayBlockModel | null {
  if (reason !== null) {
    switch (reason.code) {
      case "PAYMENTS_PROVIDER_DISABLED":
        return { code: reason.code, title: copy.blockedTitle, message: copy.blockedProviderMessage };
      case "PAYMENT_AMOUNT_NOT_DEFINED":
        return { code: reason.code, title: copy.blockedTitle, message: copy.blockedAmountMessage };
      case "PAYMENT_ALREADY_OPEN":
        return { code: reason.code, title: copy.paymentOpenTitle, message: copy.paymentOpenMessage };
      default:
        return { code: reason.code, title: copy.blockedTitle, message: reason.message };
    }
  }
  if (method !== undefined && !method.available) {
    return { code: "PAYMENTS_PROVIDER_DISABLED", title: copy.methodUnavailable, message: copy.blockedMethodMessage };
  }
  return null;
}

export function buildStatusModel(sources: StatusSources, input: { secondsLeft: number | null; platform: "ios" | "android" | "web"; method: ChargeMethodKind | null }): StatusModel {
  const { ride, weekly, context } = sources;
  const holdInfo = weekly !== null ? weekly.hold : ride.hold;
  const live = input.secondsLeft ?? holdInfo?.remainingSeconds ?? 0;
  const holdActive = holdInfo !== null && holdInfo.active && live > 0;
  const weeklyStatus = weekly?.status ?? null;
  const effectiveStatus: RideRequestStatus = weekly !== null ? weeklyAsRequestStatus(weekly.status) : ride.status;
  const phase = phaseOf(effectiveStatus, holdActive, holdInfo !== null || ride.hold !== null, weeklyStatus);
  const name = driverNameOf(ride);
  const counts =
    weekly !== null
      ? {
          confirmed: weekly.occurrences.filter((o) => o.requestStatus === "confirmed").length,
          total: weekly.occurrences.filter((o) => o.requestStatus !== null).length,
        }
      : null;
  const options = methodOptions(context, input.platform);
  const selected = options.find((o) => o.kind === (input.method ?? defaultMethod(options)));
  const showPayment = phase === "accepted" || phase === "partial";
  const payBlock = showPayment ? blockOf(context?.cannotPayReason ?? null, selected) : null;
  const openPaymentId =
    context?.payment !== null && context?.payment !== undefined && (context.payment.status === "processing" || context.payment.status === "requires_action") ? context.payment.id : null;
  const seconds = input.secondsLeft;
  return {
    phase,
    weekly: weekly !== null,
    driverName: name,
    steps: copy.steps,
    stepStates: stepStatesOf(phase),
    stepIndex: phase === "waiting" ? 0 : phase === "confirmed" ? 3 : 1,
    banner: bannerOf(phase, name, weekly !== null),
    hold: phase === "accepted" && seconds !== null ? { secondsLeft: seconds, text: formatCountdown(seconds) } : null,
    showPayment,
    methods: options,
    summary: showPayment && context !== null ? summaryOf(context.summary, weekly) : null,
    payBlock,
    canPay: showPayment && context !== null && context.canPay && selected?.available === true && (seconds === null || seconds > 0),
    canWithdraw: phase === "waiting",
    openPaymentId,
    confirmed: phase === "confirmed" ? { bookingId: ride.booking?.id ?? null } : null,
    weeklyCounts: counts,
  };
}

/** Estado agregado de la reserva semanal → estado «de solicitud» para elegir la fase. */
function weeklyAsRequestStatus(status: WeeklyReservation["status"]): RideRequestStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "payment_pending":
    case "partially_confirmed":
      return "payment_pending";
    case "confirmed":
      return "confirmed";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
  }
}
