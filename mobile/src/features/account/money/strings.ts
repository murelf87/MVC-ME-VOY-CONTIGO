/**
 * Textos del paquete «pagos y cobros» (slice `account`, lámina 33: «Mis pagos y cobros»).
 *
 * Voz de las láminas: tuteo, frases cortas, sin tecnicismos. Los literales de la lámina se copian tal cual
 * («Pendiente este mes», «A cobrar este mes», «Mis movimientos», «Próximo abono», «Por definir»…).
 *
 * Reglas de honestidad (docs/contracts/money.md §15 y BUILD_BRIEF §2):
 *  - Nada es «pagado», «cobrado», «abonado» ni «devuelto» salvo que lo diga el servidor (estado del contrato).
 *  - Mientras la economía no esté activada los importes son «Por definir»; nunca se promete una devolución ni un abono.
 *  - Los recibos son justificantes NO fiscales: no son facturas.
 */
import { NBSP, strings as shared } from "@/i18n";

/** Plural con número y espacio de no separación: `count(2, "viaje")` → `2 viajes`. */
function count(n: number, singular: string, plural: string): string {
  return `${n}${NBSP}${n === 1 ? singular : plural}`;
}

export const moneyStrings = {
  /** Cabecera de la pantalla 33. */
  title: "Mis pagos y cobros",
  seeAll: shared.common.seeAll,
  edit: shared.common.edit,
  retry: shared.common.retry,
  pending: shared.money.pending,
  illustrativeNote: shared.money.illustrativeAmounts,
  illustrativeTag: shared.money.illustrative,

  roles: {
    passenger: "Soy pasajero",
    driver: "Soy conductor",
    a11yTabs: "Tipo de movimientos",
  },

  /** Pantalla 33 (a/b) y su pestaña de conductor (34b). */
  overview: {
    monthButton: "Elegir mes",
    monthSheetTitle: "Elegir mes",
    monthSheetSubtitle: "Resumen de pagos y cobros de ese mes",
    currentMonthTag: "Mes actual",
    viewingMonth: (label: string): string => `Estás viendo ${label}`,
    backToCurrentMonth: "Volver a este mes",

    pendingTitle: "Pendiente este mes",
    pendingTitleFor: (month: string): string => `Pendiente en ${month}`,
    upcomingTrips: (n: number): string => (n === 0 ? "Sin próximos viajes" : count(n, "próximo viaje", "próximos viajes")),

    toCollectTitle: "A cobrar este mes",
    toCollectTitleFor: (month: string): string => `A cobrar en ${month}`,
    completedTrips: (n: number): string => (n === 0 ? "Ningún viaje realizado" : count(n, "viaje realizado", "viajes realizados")),

    nextPayout: "Próximo abono",
    nextPayoutProcessing: "En proceso",
    nextPayoutHelp: "Más información sobre el próximo abono",

    passengerList: "Mis pagos",
    mixedList: "Mis movimientos",
    driverList: "Últimos cobros",
    tripTag: "Viaje",
    earningTag: "Cobro",

    methodTitle: "Método de pago",
    payoutAccountTitle: "Cuenta de cobro",
    noMethodTitle: "Sin método de pago",
    noMethodEnabled: "Añade uno para pagar tus reservas",
    noPayoutTitle: "Sin cuenta de cobro",
    noPayoutEnabled: "Añade la cuenta donde quieres recibir tus abonos",
    notAvailableYet: "Pagos aún no disponibles",

    monthlyPayout: "Liquidación mensual",
    commissionMvc: (value: string): string => `Comisión MVC · ${value}`,
    commissionPlatform: "Comisión de la plataforma",
    history: "Historial de pagos y recibos",
    driverHistory: "Historial de cobros",
    receipts: "Facturas y justificantes",
    refunds: "Mis devoluciones",

    emptyPassenger: {
      title: "Aún no tienes pagos",
      message: "Aparecerán aquí cuando una conductora acepte tu solicitud y pagues la reserva.",
    },
    emptyDriver: {
      title: "Aún no tienes cobros",
      message: "Aparecerán aquí cuando completes un viaje con pasajeros.",
    },
    emptyMixed: {
      title: "Aún no tienes movimientos",
      message: "Tus pagos como pasajero y tus cobros como conductor aparecerán aquí.",
    },

    availabilityTitle: "Pagos aún no disponibles",
    availabilityMessage: "Puedes consultar tus datos, pero todavía no se puede pagar ni cobrar dentro de la app.",

    guest: {
      title: "Entra para ver tus pagos",
      message: "Tus pagos, cobros y justificantes están vinculados a tu cuenta.",
      action: "Entrar o crear cuenta",
    },
    notDriver: {
      title: "Esta cuenta no ofrece plazas",
      message: "Los cobros aparecen cuando una cuenta con perfil de conductor completa viajes. Tu cuenta solo tiene perfil de pasajero.",
      action: "Ver mis pagos de pasajero",
    },
    loadError: "No hemos podido cargar tus pagos",
    refreshFailed: "No hemos podido actualizar tus pagos. Mostramos los últimos datos que tenemos.",
  },

  commissionSheet: {
    title: "Comisión de la plataforma",
    pending: "MVC todavía no ha definido la comisión de la plataforma. Cuando se apruebe, la verás aquí y en el desglose de cada pago antes de confirmarlo.",
    passengerRate: (percent: string): string => `Comisión al pasajero: ${percent}`,
    driverRate: (percent: string): string => `Comisión al conductor: ${percent}`,
    defined: "Se aplica al importe de cada viaje y aparece en el desglose de tus recibos.",
    understood: "Entendido",
  },

  nextPayoutSheet: {
    title: "Próximo abono",
    pending:
      "El calendario de abonos todavía no está definido. Cuando lo esté, aquí verás la fecha y el importe. Un abono solo cuenta como cobrado cuando el proveedor de pagos lo confirma.",
    scheduled: (date: string): string =>
      `Previsto para el ${date}. Es una fecha prevista: el abono solo cuenta como cobrado cuando el proveedor de pagos lo confirma.`,
    processing: "Hemos pedido el abono al proveedor de pagos. Te avisaremos cuando lo confirme.",
    understood: "Entendido",
    seePayouts: "Ver liquidaciones",
  },

  /** Etiquetas de estado (chips). Los tonos están en `model.ts`. */
  paymentState: {
    pending: "Pendiente",
    under_review: "En revisión",
    paid: "Pagado",
    partially_refunded: "Devuelto parcialmente",
    refunded: "Devuelto",
    failed: "Fallido",
    expired: "Caducado",
  },
  earningState: {
    pending: "Pendiente",
    available: "Por cobrar",
    in_payout: "En liquidación",
    paid_out: "Cobrado",
  },
  payoutStatus: {
    draft: "Preparada",
    processing: "En proceso",
    paid: "Abonada",
    failed: "Fallida",
    cancelled: "Cancelada",
  },
  refundStatus: {
    pending_review: "En revisión",
    approved: "Aprobada",
    executing: "En trámite",
    refunded: "Devuelta",
    rejected: "Rechazada",
    failed: "Fallida",
    not_applicable: "No procede",
  },
  methodStatus: {
    active: "Activo",
    requires_action: "Requiere acción",
    expired: "Caducada",
  },

  /** Historial de pagos y cobros. */
  history: {
    passengerTitle: "Historial de pagos",
    driverTitle: "Historial de cobros",
    sectionEarnings: "Cobros",
    sectionPayouts: "Liquidaciones",
    filterAll: "Todos",
    filterLabel: "Filtrar por estado",
    emptyPassenger: {
      title: "Aún no tienes pagos",
      message: "Cuando pagues una reserva, aparecerá aquí con su estado.",
    },
    emptyDriver: {
      title: "Aún no tienes cobros",
      message: "Cuando completes un viaje con pasajeros, el cobro aparecerá aquí.",
    },
    emptyFiltered: {
      title: "Nada con este estado",
      message: "No hay movimientos que coincidan con el filtro elegido.",
      action: "Quitar filtro",
    },
    emptyPayouts: {
      title: "Aún no tienes liquidaciones",
      message: "Una liquidación agrupa lo que cobras en un mes. Se genera cuando hay saldo disponible.",
    },
    payoutPeriod: "Liquidación de",
    payoutTrips: (n: number): string => count(n, "viaje", "viajes"),
    payoutScheduled: (date: string): string => `Prevista ${date}`,
    payoutScheduledPending: "Fecha por definir",
    payoutPaidOn: (date: string): string => `Abonada el ${date}`,
    loadMoreError: "No hemos podido cargar más. Reintenta para seguir.",
    loadingMore: "Cargando más…",
    nextPayoutCardTitle: "Próximo abono",
    scheduleTitle: "Calendario de abonos",
    scheduleMonthly: "Una vez al mes",
    scheduleDay: (day: number): string => `Una vez al mes, el día ${day}`,
    scheduleDayPending: "Una vez al mes, día por definir",
    loadError: "No hemos podido cargar el historial",
    payAction: "Ver estado y pago",
  },

  /** Métodos de pago. */
  methods: {
    title: "Métodos de pago",
    chargeSection: "Para pagar tus viajes",
    payoutSection: "Para cobrar tus viajes",
    defaultTag: "Predeterminado",
    expires: (month: number, year: number): string => `Caduca ${String(month).padStart(2, "0")}/${String(year % 100).padStart(2, "0")}`,
    add: "Añadir método de pago",
    emptyCharge: {
      title: "Sin métodos de pago",
      enabled: "Añade una tarjeta o una cuenta bancaria para pagar tus viajes.",
      disabled: "Pagos aún no disponibles. Cuando se activen podrás añadir aquí tu método de pago.",
    },
    emptyPayout: {
      title: "Sin cuenta de cobro",
      enabled: "Añade la cuenta bancaria donde quieres recibir tus abonos.",
      disabled: "Pagos aún no disponibles. Cuando se activen podrás añadir aquí tu cuenta de cobro.",
    },
    privacy: "Nunca guardamos números de tarjeta: tus datos de pago los gestiona directamente el proveedor de pagos.",
    optionsFor: (label: string): string => `Opciones de ${label}`,
    optionRemove: "Quitar este método",
    optionRemoveHint: "Dejará de estar disponible para pagar",
    removeTitle: "¿Quitar este método?",
    removeMessage: (label: string): string => `${label} dejará de estar disponible. Podrás añadirlo de nuevo cuando quieras.`,
    removeConfirm: "Quitar",
    removed: "Método quitado",
    removeFailed: "No hemos podido quitar el método",
    loadError: "No hemos podido cargar tus métodos de pago",
    availabilityTitle: "Pagos aún no disponibles",
    availabilityMessage: "Todavía no hemos activado el proveedor de pagos. No se cobra nada y no se puede guardar ningún método.",
    bankAccount: "Cuenta bancaria",
    card: "Tarjeta",
  },

  /** Añadir método de pago (nunca se pide ni se guarda un número de tarjeta). */
  addMethod: {
    title: "Añadir método de pago",
    purposeLabel: "¿Para qué lo quieres?",
    purposeCharge: "Para pagar",
    purposeChargeLong: "Para pagar tus reservas",
    purposePayout: "Para cobrar",
    purposePayoutLong: "Para cobrar tus viajes",
    blockedTitle: "Bloqueado: proveedor de pago pendiente",
    blockedMessage:
      "Todavía no hemos activado el proveedor de pagos, así que ahora mismo no se puede guardar ningún método. Mientras tanto no se cobra nada ni se guarda ningún dato de pago.",
    blockedNextTitle: "Cuando esté activo",
    blockedNext: [
      "Añadirás tu tarjeta o tu cuenta bancaria desde la pantalla segura del proveedor de pagos.",
      "MVC nunca verá ni guardará el número de tu tarjeta.",
      "Podrás quitar el método cuando quieras desde «Métodos de pago».",
    ],
    understood: "Entendido",
    simulationTitle: "Simulación de la vista previa",
    simulationMessage:
      "Esto solo existe en la vista previa: el proveedor de pagos es simulado, no se cobra nada y no se guarda ningún dato real. En la app de producción este paso lo hace la pantalla segura del proveedor.",
    chooseTitle: "Elige un método de prueba",
    chooseError: "Elige un método de prueba para continuar.",
    makeDefault: "Usar como predeterminado",
    makeDefaultHint: "Será el método con el que se pague primero",
    save: "Guardar método (simulación)",
    saving: "Guardando…",
    saved: "Método guardado (simulación)",
    saveFailed: "No hemos podido guardar el método",
    savedNothingCharged: "No se ha cobrado nada.",
    options: {
      visa: { title: "Tarjeta de prueba Visa", subtitle: "···· 4242" },
      mastercard: { title: "Tarjeta de prueba Mastercard", subtitle: "···· 4444" },
      sepa: { title: "Cuenta bancaria de prueba", subtitle: "ES** **** **** 4589" },
    },
    offlineTitle: "Sin conexión",
    offlineMessage: "Necesitas conexión para guardar un método de pago. Se guardará cuando vuelvas a intentarlo con red.",
  },

  /** Facturas y justificantes. */
  receipts: {
    title: "Facturas y justificantes",
    notFiscalTitle: "Justificantes no fiscales",
    notFiscalMessage: "MVC emite un justificante cuando el servidor confirma un pago, una devolución o un abono. No son facturas.",
    filterAll: "Todos",
    filterPayment: "Pagos",
    filterRefund: "Devoluciones",
    filterEarning: "Abonos",
    kindPayment: "Pago de viaje",
    kindRefund: "Devolución",
    kindEarning: "Abono al conductor",
    empty: {
      title: "Aún no tienes justificantes",
      message: "Se emiten cuando el servidor confirma un pago, una devolución o un abono.",
    },
    emptyFiltered: {
      title: "Sin justificantes de este tipo",
      message: "Prueba con otro filtro.",
      action: "Quitar filtro",
    },
    loadError: "No hemos podido cargar tus justificantes",
    loadMoreError: "No hemos podido cargar más. Reintenta para seguir.",
    numberLabel: "Nº",
    issuedOn: (date: string): string => `Emitido el ${date}`,
  },

  /** Detalle de un justificante. */
  receipt: {
    title: "Recibo",
    numberLabel: "Número",
    issuedLabel: "Emitido",
    typeLabel: "Tipo",
    tripSection: "Viaje",
    withPerson: (first: string): string => `Con ${first}`,
    breakdownSection: "Desglose",
    lineLabels: {
      contribution: "Aportación al viaje",
      platform_fee: "Gestión MVC",
      processing: "Gastos de pago",
      taxes: "Impuestos",
      refund: "Importe devuelto",
      driver_commission: "Comisión de MVC",
      refund_adjustments: "Devoluciones descontadas",
      net: "Neto",
    },
    totalPayment: "Total pagado",
    totalRefund: "Total devuelto",
    totalEarning: "Neto abonado",
    nonFiscalTitle: "Justificante no fiscal",
    nonFiscalMessage: "Este justificante lo emite MVC como comprobante de la operación. No es una factura.",
    share: "Compartir justificante",
    shareSubject: (number: string): string => `Justificante ${number}`,
    copyNumber: "Copiar número",
    copied: "Número copiado",
    printable: "Ver versión imprimible",
    printableTitle: "Versión imprimible",
    print: "Imprimir",
    printableClose: "Cerrar versión imprimible",
    printableLoading: "Preparando la versión imprimible…",
    printableError: "No hemos podido preparar la versión imprimible",
    shareFailed: "No hemos podido compartir el justificante",
    loadError: "No hemos podido cargar el recibo",
    notFound: "Este recibo no existe o no es tuyo",
    shareHeader: "Justificante de MVC · Me voy contigo",
  },

  /** Detalle de una liquidación. */
  payout: {
    title: "Liquidación",
    tripsIncluded: "Viajes incluidos",
    periodLabel: "Periodo",
    statusLabel: "Estado",
    scheduledLabel: "Fecha prevista",
    paidLabel: "Abonada el",
    netLabel: "Neto",
    tripsLabel: "Viajes",
    statusText: {
      draft: "Preparada. Todavía no se ha pedido el abono al proveedor de pagos.",
      processing: "Hemos pedido el abono al proveedor de pagos. Solo cuenta como cobrado cuando él lo confirma.",
      paid: "El proveedor de pagos ha confirmado el abono.",
      failed: "El abono ha fallado. Administración lo volverá a intentar; no tienes que hacer nada.",
      cancelled: "Esta liquidación se ha cancelado.",
    },
    failureHint: (code: string): string => `Código del proveedor: ${code}`,
    itemsEmpty: "Esta liquidación no tiene viajes asociados.",
    loadError: "No hemos podido cargar la liquidación",
    notFound: "Esta liquidación no existe o no es tuya",
    seeReceipts: "Ver mis justificantes",
  },

  /** Detalle de un cobro. */
  earning: {
    title: "Detalle del cobro",
    withPerson: (first: string): string => `Con ${first}`,
    breakdown: "Desglose",
    contribution: "Aportación del pasajero",
    driverCommission: "Comisión del conductor",
    refundAdjustments: "Devoluciones descontadas",
    net: "Neto para ti",
    stateText: {
      pending: "El viaje todavía no se ha completado. El cobro se calcula cuando termina.",
      available: "Por cobrar: se incluirá en tu liquidación mensual.",
      in_payout: "Incluido en una liquidación en curso. Aún no está abonado.",
      paid_out: "El proveedor de pagos ha confirmado el abono de este cobro.",
    },
    privacy: "Por privacidad no mostramos los datos de pago del pasajero.",
    seePayout: "Ver liquidación",
    seeTrip: "Ver reserva",
    loadError: "No hemos podido cargar el cobro",
    notFound: "Este cobro no existe o no es tuyo",
    tripOn: "Viaje",
  },

  /** Devoluciones. */
  refunds: {
    title: "Mis devoluciones",
    introTitle: "Cómo funcionan",
    introMessage:
      "Cuando cancelas una reserva pagada, Administración revisa la devolución. Hasta que no esté aprobada y el proveedor de pagos la confirme, no está devuelta.",
    empty: {
      title: "No tienes devoluciones",
      message: "Si cancelas una reserva que ya has pagado, el seguimiento aparecerá aquí.",
    },
    loadError: "No hemos podido cargar tus devoluciones",
    loadMoreError: "No hemos podido cargar más. Reintenta para seguir.",
    origin: {
      passenger_cancellation: "Cancelaste la reserva",
      driver_cancellation: "Cancelación del conductor",
      platform_cancellation: "Cancelación de MVC",
      force_majeure: "Causa de fuerza mayor",
      no_show: "Viajero no presentado",
      late_payment: "Pago recibido fuera de plazo",
      other: "Otro motivo",
    },
    requestedOn: (date: string): string => `Solicitada el ${date}`,
    paid: "Importe pagado",
    proposed: "Devolución propuesta",
    approved: "Devolución aprobada",
    platformFee: "Gestión de la plataforma",
    finalCost: "Coste final para ti",
    policy: "Política de cancelación",
    policyPending: "Pendiente de revisión",
    policyApproved: (version: number | null): string => (version === null ? "Aprobada" : `Aprobada (versión ${version})`),
    trackingTitle: "Seguimiento",
    steps: {
      requested: "Solicitud recibida",
      review: "Revisión por Administración",
      decision: "Decisión",
      refund: "Devolución a tu método de pago",
    },
    stepDetail: {
      requested: (date: string): string => date,
      reviewPending: "En curso. Aún no hay decisión.",
      reviewDone: "Revisada.",
      decisionApproved: (date: string): string => `Aprobada el ${date}`,
      decisionRejected: (date: string): string => `Rechazada el ${date}`,
      decisionNotApplicable: "No procede devolución.",
      decisionWaiting: "Pendiente.",
      refundWaiting: "Aún no se ha pedido al proveedor de pagos.",
      refundAwaitingProvider: "Aprobada. Falta pedirla al proveedor de pagos.",
      refundSubmitted: "Pedida al proveedor de pagos. Falta su confirmación.",
      refundSucceeded: (date: string): string => `Confirmada por el proveedor el ${date}`,
      refundFailed: "El proveedor de pagos no ha podido completarla. Administración la volverá a intentar.",
      refundNone: "No habrá devolución.",
    },
    noPromise: "Mientras Administración no apruebe la devolución y el proveedor de pagos no la confirme, no podemos asegurar que se devuelva dinero.",
    seeBooking: "Ver reserva",
    close: "Cerrar",
    detailTitle: "Detalle de la devolución",
    openDetail: "Ver seguimiento",
  },

  /** Textos de accesibilidad de componentes. */
  a11y: {
    openDetail: (label: string): string => `Abrir ${label}`,
    amountIllustrative: "importe ilustrativo",
    amountPending: "importe por definir",
    avatarOf: (name: string): string => `Foto de ${name}`,
    mixedTrip: "Viaje como pasajero",
    mixedEarning: "Cobro como conductor",
  },
} as const;

export type MoneyStrings = typeof moneyStrings;
