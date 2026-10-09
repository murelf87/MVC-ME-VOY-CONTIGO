/**
 * Textos del paquete `driver-ops` (operar el viaje como conductor), en es-ES, tuteo y frases cortas como las láminas.
 * Las pantallas no llevan literales: todo sale de aquí (y los importes, de `formatMoney`).
 */
import { pluralize } from "@/i18n";

const confirmedWord = (n: number): string => (n === 1 ? "confirmado" : "confirmados");

export const opsStrings = {
  common: {
    retry: "Reintentar",
    back: "Volver",
    close: "Cerrar",
    cancel: "Cancelar",
    understood: "Entendido",
    refresh: "Actualizar",
    openSettings: "Abrir ajustes",
    offlineTitle: "Sin conexión",
    offlineDetail: "Mostramos lo último que tenemos. Se actualizará al volver la conexión.",
    offlineAction: "Necesitas conexión para hacer esto. Inténtalo cuando vuelvas a tener red.",
    passengerCount: (n: number): string => pluralize(n, "pasajero"),
    confirmedPassengers: (n: number): string => `${pluralize(n, "pasajero")} ${confirmedWord(n)}`,
    seatsOccupied: (occupied: number, offered: number): string => `${occupied} de ${offered} plazas ocupadas`,
    nameWithPlace: (name: string, place: string): string => `${name} · ${place}`,
    unnamedStop: (seq: number): string => `Parada ${seq}`,
    plate: (plate: string): string => plate,
    vehicleLine: (make: string, model: string, color: string | null): string =>
      color ? `${make} ${model} · ${color}` : `${make} ${model}`,
  },

  console: {
    title: "Consola del viaje",
    subtitleDeparture: (time: string): string => `Salida ${time}`,
    loading: "Cargando tu viaje",
    banner: {
      scheduledTitle: (time: string): string => `Tu viaje sale a las ${time}`,
      scheduledMessage: (n: number): string =>
        n === 0
          ? "Aún no tienes pasajeros confirmados."
          : `${pluralize(n, "pasajero")} ${confirmedWord(n)}. Inicia el viaje cuando salgas.`,
      activeTitle: "Viaje en curso",
      activeMessage: (time: string): string => `Empezaste a las ${time}`,
      activeMessageNoTime: "Tus pasajeros te siguen en directo",
      completedTitle: "Viaje terminado",
      completedMessage: (time: string): string => `Terminaste a las ${time}`,
      completedMessageNoTime: "Gracias por conducir con MVC",
      cancelledTitle: "Viaje cancelado",
      cancelledMessage: "Este viaje ya no está activo.",
    },
    departure: {
      eyebrow: "Salida prevista",
      inMinutes: (duration: string): string => `Faltan ${duration}`,
      due: "Ya es la hora de salir",
      passengers: (n: number): string => (n === 0 ? "Sin pasajeros confirmados" : `${pluralize(n, "pasajero")} ${confirmedWord(n)}`),
    },
    next: {
      eyebrow: "Siguiente recogida",
      etaLabel: "Llegada estimada",
      minutesAndDistance: (minutes: string, distance: string | null): string =>
        distance ? `${minutes} · ${distance}` : minutes,
      approximate: "Hora aproximada",
      noEta: "Sin hora estimada todavía",
      allAboardTitle: "Todos van en el coche",
      allAboardMessage: "Has recogido a todos tus pasajeros. Termina el viaje al llegar.",
      noPassengersTitle: "Sin pasajeros que recoger",
      noPassengersMessage: "No tienes pasajeros confirmados en este viaje.",
      toPickup: (name: string, place: string): string => `${name} · ${place}`,
      verify: "Verificar código",
    },
    map: {
      title: "Tu posición",
      you: "Tú",
      youSub: "en ruta",
      noPosition: "Aún no hay posición",
      unavailableTitle: "No se puede mostrar el mapa",
      unavailableMessage: "No hemos podido cargar el mapa. Tu viaje sigue funcionando.",
      lastUpdate: (age: string): string => `Última actualización: ${age}`,
      staleTitle: "Sin señal",
      staleDetail: (age: string): string => `Última posición: ${age}`,
      noneUpdate: "Todavía no hemos recibido tu posición",
      pickupLabel: (name: string): string => name,
      a11y: "Mapa con tu posición y las recogidas pendientes",
      directions: "Cómo llegar",
      directionsTo: (place: string): string => `Cómo llegar a ${place}`,
      directionsFailed: "No se ha podido abrir la app de mapas.",
      pickupsLegend: (n: number): string => (n === 1 ? "1 recogida pendiente" : `${n} recogidas pendientes`),
    },
    passengers: {
      title: "Pasajeros",
      counter: (verified: number, total: number): string => `${verified} de ${total} recogidos`,
      empty: "Aún no tienes pasajeros confirmados",
      emptyDetail: "Cuando confirmen una plaza aparecerán aquí con su punto de recogida.",
      pickupAt: (place: string): string => `Recogida en ${place}`,
      pickupPlanned: (place: string, time: string): string => `${place} · ${time}`,
      pickedAt: (time: string): string => `Recogido a las ${time}`,
      pickedNoTime: "Recogido",
      dropoffAt: (place: string): string => `Baja en ${place}`,
      completedLine: "Trayecto completado",
      noShowLine: "No se presentó a la recogida",
      status: {
        waiting: "Esperando",
        picked: "En el coche",
        codeLocked: "Código bloqueado",
        codeMissing: "Sin código",
        completed: "Completado",
        noShow: "No presentado",
        cancelled: "Cancelada",
      },
      actions: {
        verify: "Verificar código",
        message: "Escribir",
        messageOf: (name: string): string => `Escribir a ${name}`,
        verifyOf: (name: string): string => `Verificar el código de ${name}`,
      },
      rated: "Valorado",
    },
    routeChange: {
      bannerTitle: "Propuesta de parada enviada",
      bannerMessage: (accepted: number, required: number): string =>
        required === 0 ? "Esperando respuesta" : `${accepted} de ${required} ya han aceptado`,
      bannerExpires: (time: string): string => `Caduca a las ${time}`,
      open: "Ver propuesta",
      propose: "Proponer nueva parada",
      proposeDisabledPending: "Ya hay una propuesta pendiente",
      proposeDisabledStatus: "Solo puedes proponer paradas con el viaje publicado o en curso.",
      proposeUnavailable: "Ahora mismo no se pueden calcular desvíos. Inténtalo en unos minutos.",
    },
    actions: {
      start: "Iniciar viaje",
      complete: "Terminar viaje",
      manage: "Gestionar viaje",
      summary: "Ver resumen del viaje",
      cancelTrip: "Cancelar viaje",
      share: "Compartir viaje",
      backToTrips: "Volver a mis viajes",
      openPickup: "Verificar una recogida",
    },
    startDialog: {
      title: "¿Iniciar el viaje?",
      message: (n: number): string =>
        n > 0
          ? `Empezarás a compartir tu ubicación en directo con tus ${pluralize(n, "pasajero")} ${confirmedWord(n)}.`
          : "Todavía no tienes pasajeros confirmados. Empezarás a compartir tu ubicación en cuanto haya alguno.",
      foreground: "Deja MVC abierta mientras conduces: si la app pasa a segundo plano, el envío se detiene hasta que vuelvas.",
      confirm: "Iniciar viaje",
      cancel: "Todavía no",
    },
    completeDialog: {
      title: "¿Terminar el viaje?",
      messageNoShow: (n: number): string =>
        `${pluralize(n, "pasajero")} sin recoger ${n === 1 ? "se marcará" : "se marcarán"} como no presentado${n === 1 ? "" : "s"}. Esta acción no se puede deshacer.`,
      messageAll: "Se cerrará el viaje para todos tus pasajeros. Esta acción no se puede deshacer.",
      confirm: "Terminar viaje",
      cancel: "Seguir en ruta",
    },
    toast: {
      started: "Viaje iniciado",
      completed: "Viaje terminado",
    },
    states: {
      notOwnerTitle: "Este viaje no es tuyo",
      notOwnerMessage: "Solo el conductor del viaje puede abrir su consola.",
      notFoundTitle: "Viaje no encontrado",
      notFoundMessage: "Puede que se haya cancelado o que ya no exista.",
      draftTitle: "Todavía no has publicado este viaje",
      draftMessage: "Publícalo desde «Publica tu ruta» para poder gestionarlo.",
      goToTrips: "Ir a mis viajes",
    },
    startBlocked: {
      title: "Antes de salir, revisa tu vehículo",
      fixVehicle: "Revisar mi vehículo",
    },
    chat: {
      opening: "Abriendo el chat",
      failedTitle: "No se puede abrir el chat",
    },
  },

  sharing: {
    liveTitle: "Compartes tu ubicación",
    liveDetail: "Tus pasajeros te ven en directo.",
    staleTitle: "Sin señal GPS",
    staleDetail: (age: string): string => `Última posición: ${age}`,
    noneTitle: "Buscando tu posición",
    noneDetail: "Aún no hemos recibido tu ubicación. Sal a un lugar despejado.",
    pausedTitle: "Ubicación sin compartir",
    pausedDetail: "Tus pasajeros no ven tu posición. Puedes reanudarlo cuando quieras.",
    resume: "Compartir ubicación",
    sendFailedTitle: "No se envía tu posición",
    sendFailedDetail: "Reintentando en cuanto haya conexión.",
    foregroundNote: "Deja MVC abierta mientras conduces: si la app pasa a segundo plano, el envío se detiene hasta que vuelvas.",
    simulation: "Simulación de recorrido (solo vista previa)",
    permission: {
      undeterminedTitle: "Comparte tu ubicación con tus pasajeros",
      undeterminedMessage: "Así saben cuándo llegas a recogerlos. Solo se comparte mientras el viaje está en curso.",
      allow: "Permitir ubicación",
      deniedTitle: "Sin permiso de ubicación",
      deniedMessage: "Tus pasajeros no podrán seguirte en el mapa. Puedes darnos acceso ahora o seguir sin compartir.",
      blockedTitle: "Permiso de ubicación bloqueado",
      blockedMessage: "Actívalo en los ajustes del móvil para compartir tu posición con tus pasajeros.",
      continueWithout: "Seguir sin compartir",
    },
    gpsOffTitle: "El GPS está desactivado",
    gpsOffMessage: "Actívalo en los ajustes del móvil para compartir tu posición con tus pasajeros.",
    unavailableTitle: "No encontramos tu posición",
    unavailableMessage: "Estamos buscando señal GPS. Sal a un lugar despejado y espera unos segundos.",
  },

  pickup: {
    title: "Código de recogida",
    chooser: {
      title: "¿A quién recoges?",
      subtitle: "Elige al pasajero que está subiendo al coche.",
      empty: "No hay recogidas pendientes",
      emptyDetail: "Todos tus pasajeros ya van en el coche.",
      boardsAt: (place: string): string => `Sube en ${place}`,
      backToConsole: "Volver a la consola",
    },
    passenger: {
      boardsAt: (place: string): string => `Recogida en ${place}`,
      planned: (time: string): string => `Prevista a las ${time}`,
      rating: (value: string): string => value,
    },
    form: {
      heading: (name: string): string => `Pídele el código a ${name}`,
      subheading: "Es el código de 6 cifras que ve en su app, en «En el coche».",
      codeAccessibility: (digits: string): string =>
        digits === ""
          ? "Código de recogida, vacío. Faltan 6 cifras."
          : `Código de recogida: ${digits.split("").join(" ")}. ${digits.length === 6 ? "Completo." : digits.length === 5 ? "Falta 1 cifra." : `Faltan ${6 - digits.length} cifras.`}`,
      missingDigits: (n: number): string => (n === 1 ? "Falta 1 cifra." : `Faltan ${n} cifras.`),
      complete: "Código completo.",
      verifying: "Comprobando el código…",
      attemptsLeft: (n: number): string => (n === 1 ? "Te queda 1 intento." : `Te quedan ${n} intentos.`),
      wrongCode: "Código incorrecto: inténtalo de nuevo.",
      submit: "Verificar código",
      infoTitle: "Verifica solo en persona",
      infoMessage: "Confirma que quien sube es quien reservó. Nunca des ni pidas el código por mensaje.",
      offlineHint: "Sin conexión no se puede verificar. El código que has escrito se conserva: inténtalo al recuperar la red.",
    },
    keypad: {
      digit: (digit: string): string => `Cifra ${digit}`,
      clear: "Borrar todo",
      clearAll: "Borrar todas las cifras",
      backspace: "Borrar la última cifra",
    },
    result: {
      successTitle: "Recogida verificada",
      successMessage: (name: string): string => `${name} ya va en tu coche.`,
      successTime: (time: string): string => `Hora de recogida ${time}`,
      alreadyTitle: "Esta recogida ya estaba verificada",
      alreadyMessage: (name: string, time: string | null): string =>
        time ? `${name} subió a las ${time}.` : `${name} ya iba en tu coche.`,
      nextPickup: "Siguiente recogida",
      backToConsole: "Volver a la consola",
      nextUp: (name: string, place: string): string => `Siguiente: ${name} · ${place}`,
      allDone: "Has recogido a todos tus pasajeros.",
    },
    blocked: {
      lockedTitle: "Código bloqueado",
      lockedMessage: (name: string): string =>
        `Se han agotado los intentos. Pídele a ${name} que genere un código nuevo desde su app y vuelve a intentarlo.`,
      lockedAction: "Comprobar de nuevo",
      notGeneratedTitle: "Aún no hay código",
      notGeneratedMessage: (name: string): string =>
        `${name} todavía no ha generado su código. Pídele que abra «En el coche» en su app y lo cree.`,
      notGeneratedAction: "Comprobar de nuevo",
      notGeneratedWaiting: "Esta pantalla se actualiza sola en cuanto lo genere.",
      notLiveTitle: "El viaje no está en marcha",
      notLiveMessage: "Inicia el viaje para poder verificar recogidas.",
      notLiveAction: "Ir a la consola",
      notEligibleTitle: "Esta reserva ya no admite recogida",
      notEligibleMessage: "La reserva ya no está confirmada. Puede que se haya cancelado.",
      noShowTitle: "Reserva marcada como no presentada",
      noShowMessage: "El viaje ya terminó para esta reserva.",
      cancelledTitle: "Reserva cancelada",
      cancelledMessage: "Esta reserva se canceló y no admite recogida.",
    },
    states: {
      loading: "Cargando la recogida",
      bookingNotFoundTitle: "Reserva no encontrada",
      bookingNotFoundMessage: "No encontramos esa reserva en tu viaje. Vuelve a la consola y elige otra.",
    },
  },

  errors: {
    notOwner: { title: "Este viaje no es tuyo", message: "Solo el conductor del viaje puede hacer esto." },
    tripNotFound: { title: "Viaje no encontrado", message: "Puede que se haya cancelado o que ya no exista." },
    tripDraft: { title: "Viaje sin publicar", message: "Publica el viaje para poder gestionarlo." },
    notStartable: {
      title: "No se puede iniciar",
      message: "Este viaje ya no se puede iniciar. Actualiza para ver en qué estado está.",
    },
    notCompletable: {
      title: "No se puede terminar",
      message: "Este viaje no está en curso. Actualiza para ver en qué estado está.",
    },
    vehiclePhotoRequired: {
      title: "Falta la foto del vehículo",
      message: "Para iniciar el viaje, tu vehículo necesita una foto aprobada.",
      action: "Añadir foto del vehículo",
    },
    vehicleInsuranceRequired: {
      title: "Falta el seguro del vehículo",
      message: "Para iniciar el viaje, indica el seguro de tu vehículo.",
      action: "Añadir el seguro",
    },
    vehicleInsuranceExpiryRequired: {
      title: "Falta el vencimiento del seguro",
      message: "Indica hasta cuándo está en vigor el seguro de tu vehículo.",
      action: "Indicar el vencimiento",
    },
    vehicleInsuranceExpired: {
      title: "Seguro caducado",
      message: "El seguro de tu vehículo ha caducado. Actualízalo para iniciar el viaje.",
      messageOn: (date: string): string => `El seguro de tu vehículo caducó el ${date}. Actualízalo para iniciar el viaje.`,
      action: "Actualizar el seguro",
    },
    invalidPickupCode: { title: "Código no válido", message: "El código tiene 6 cifras." },
    pickupCodeWrong: { title: "Código incorrecto", message: "Código incorrecto: inténtalo de nuevo." },
    pickupAttemptsExceeded: {
      title: "Demasiados intentos",
      message: "Se han agotado los intentos. El pasajero tiene que generar un código nuevo desde su app.",
    },
    pickupNotGenerated: {
      title: "Aún no hay código",
      message: "El pasajero todavía no ha generado su código de recogida.",
    },
    tripNotLive: { title: "El viaje no está en marcha", message: "Inicia el viaje para poder verificar recogidas." },
    bookingNotEligible: {
      title: "Esta reserva ya no admite recogida",
      message: "La reserva ya no está confirmada. Puede que se haya cancelado.",
    },
    bookingNotFound: { title: "Reserva no encontrada", message: "No encontramos esa reserva en tu viaje." },
    bookingNotCancellable: {
      title: "No se puede cancelar",
      message: "Esta reserva ya no se puede cancelar: ya está cancelada o el viaje terminó.",
    },
    tripAlreadyStarted: {
      title: "El viaje ya ha empezado",
      message: "Con el viaje en curso no se puede cancelar. Termínalo o cuéntanos qué ha pasado desde «Reportar incidencia».",
    },
    idempotencyReused: {
      title: "Acción repetida",
      message: "Ya habíamos recibido otra petición distinta con el mismo identificador. Vuelve a intentarlo.",
    },
    locationForbidden: { title: "No se puede enviar tu posición", message: "Solo el conductor del viaje puede compartir su ubicación." },
    locationTooOld: { title: "Posición demasiado antigua", message: "La posición enviada es demasiado antigua. Esperamos la siguiente." },
    routeChange: {
      invalidStop: { title: "Parada no válida", message: "No hemos podido usar ese punto como parada. Elige otro sobre el mapa." },
      alreadyPending: {
        title: "Ya hay una propuesta pendiente",
        message: "Espera a que tus pasajeros respondan o retírala antes de enviar otra.",
      },
      notChangeable: {
        title: "No se puede cambiar la ruta",
        message: "Solo puedes proponer paradas con el viaje publicado o en curso.",
      },
      routeDataMissing: { title: "Ruta no disponible", message: "Este viaje no tiene una ruta guardada para modificar." },
      driverPositionUnavailable: {
        title: "Aún no tenemos tu posición",
        message: "Con el viaje en curso necesitamos saber dónde estás para calcular el cambio. Activa tu ubicación e inténtalo de nuevo.",
      },
      routeStale: {
        title: "La ruta ha cambiado",
        message: "La ruta se ha actualizado mientras calculábamos. Vuelve a elegir la parada.",
      },
      noCapacity: {
        title: "No hay plaza",
        message: "Con esa parada, el pasajero que quieres recoger no tendría plaza en el coche.",
      },
      outsideProvince: {
        title: "Parada fuera de la provincia",
        message: "La parada tiene que estar dentro de la provincia del viaje.",
      },
      noRouteInProvince: {
        title: "No hay ruta posible",
        message: "No encontramos una ruta dentro de la provincia que pase por esa parada.",
      },
      detourTooLarge: { title: "Desvío demasiado grande", message: "Esa parada supera el desvío máximo de tu viaje." },
      detourTooLargeWith: (added: string, max: string): string =>
        `Esa parada añade ${added} de desvío y tu viaje admite hasta ${max}. Elige un punto más cercano a la ruta.`,
      behindVehicle: { title: "Parada por detrás", message: "Ese punto ya lo has pasado. Elige una parada que aún te quede por delante." },
      invalidIndex: { title: "Posición de parada no válida", message: "No se puede insertar la parada en ese punto del recorrido." },
      requestInvalid: { title: "Solicitud no válida", message: "La solicitud de plaza vinculada ya no está pendiente de respuesta." },
      stopTooClose: { title: "Parada demasiado cerca", message: "Ese punto está demasiado cerca de otra parada. Elige uno más separado." },
      providerUnavailable: {
        title: "Mapas no disponibles",
        message: "No podemos calcular el desvío ahora mismo. Inténtalo de nuevo en unos minutos.",
      },
      notFound: { title: "Propuesta no encontrada", message: "No encontramos esa propuesta. Puede que ya se haya resuelto." },
      notPending: { title: "La propuesta ya está resuelta", message: "Esta propuesta ya no está pendiente." },
    },
    chat: {
      forbidden: { title: "Chat cerrado", message: "Este chat ya no está disponible porque la reserva ya no está vigente." },
      blocked: { title: "Chat no disponible", message: "Una de las dos personas ha bloqueado a la otra." },
    },
  },
} as const;

export type OpsStrings = typeof opsStrings;
