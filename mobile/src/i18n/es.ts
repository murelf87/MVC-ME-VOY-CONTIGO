/**
 * Catálogo de textos en español de España (es-ES): esqueleto con los textos transversales que usan los componentes del
 * sistema de diseño y los literales de las láminas aprobadas que se repiten en varias pantallas. Los textos propios de
 * una pantalla viven en su slice (`features/<slice>`); aquí solo lo común.
 *
 * Regla de producto: los textos se copian LITERALES de las láminas («Por definir», «Propuesta», «Datos ilustrativos»).
 */
import type { TripCategory, Weekday } from "@/api/types/common";

export const es = {
  locale: "es-ES",
  country: "ES",
  province: "Sevilla",

  common: {
    back: "Atrás",
    close: "Cerrar",
    continue: "Continuar",
    cancel: "Cancelar",
    accept: "Aceptar",
    reject: "Rechazar",
    save: "Guardar",
    edit: "Editar",
    add: "Añadir",
    remove: "Quitar",
    delete: "Eliminar",
    retry: "Reintentar",
    seeAll: "Ver todos",
    search: "Buscar",
    clear: "Borrar",
    yes: "Sí",
    no: "No",
    ok: "De acuerdo",
    notNow: "Ahora no",
    loading: "Cargando…",
    optional: "(opcional)",
    more: "Más opciones",
    menu: "Menú",
    send: "Enviar",
    share: "Compartir",
    copy: "Copiar",
    done: "Hecho",
    next: "Siguiente",
    previous: "Anterior",
    select: "Seleccionar",
    selected: "Seleccionado",
    verified: "Verificado",
    call: "Llamar",
    openSettings: "Abrir ajustes",
    notAvailable: "No disponible por el momento",
    today: "Hoy",
    tomorrow: "Mañana",
    yesterday: "Ayer",
  },

  money: {
    pending: "Por definir",
    illustrative: "ilustrativo",
    proposal: "Propuesta",
    example: "Ejemplo",
    illustrativeAmounts: "Importes ilustrativos; no son tarifas finales.",
    illustrativeData: "Datos ilustrativos",
    total: "Total",
  },

  weekdaysShort: {
    mon: "Lun",
    tue: "Mar",
    wed: "Mié",
    thu: "Jue",
    fri: "Vie",
    sat: "Sáb",
    sun: "Dom",
  } satisfies Record<Weekday, string>,

  /** Etiquetas de categoría de trayecto, tal cual la lámina 09/18. */
  categories: {
    work: "Trabajo",
    university: "Universidad",
    fp_academies: "FP",
    hospital: "Hospital",
    sport: "Deporte",
    other: "Otros",
  } satisfies Record<TripCategory, string>,

  /** Estados de conectividad y datos (banner global, pantallas con carga). */
  connectivity: {
    offlineTitle: "Sin conexión",
    offlineMessage: "Sin conexión. Mostrando los últimos datos guardados.",
    backOnline: "Conexión recuperada",
    serverError: "No hemos podido conectar con el servidor.",
    serverErrorHint: "Comprueba tu conexión e inténtalo de nuevo.",
    unexpected: "Ha ocurrido un error inesperado.",
    sessionExpired: "Tu sesión ha caducado. Vuelve a entrar.",
  },

  /** Las cuatro tarjetas de la lámina 36a «Si algo no va bien». */
  errorStates: {
    noSeats: {
      title: "No hay plazas",
      message: "En este momento no hay plazas disponibles para esta ruta.",
      action: "Buscar otra ruta",
    },
    outOfProvince: {
      title: "Destino fuera de provincia",
      message: "El destino seleccionado está fuera de la provincia.",
      action: "Cambiar destino",
    },
    paymentRejected: {
      title: "Pago rechazado",
      message: "Tu pago no ha podido realizarse. Comprueba tu método de pago.",
      action: "Reintentar pago",
    },
    gpsOff: {
      title: "Sin señal GPS",
      message: "No podemos obtener tu ubicación en este momento.",
      action: "Ver última actualización",
    },
  },

  /** Permisos del sistema: texto previo a la petición y alternativa si se deniega. */
  permissions: {
    allow: "Permitir",
    notNow: "Ahora no",
    openSettings: "Abrir ajustes",
    deniedHint: "Puedes activarlo cuando quieras en los ajustes del móvil.",
    deniedRetry: "No has dado permiso. Puedes volver a intentarlo o continuar sin él.",
    location: {
      title: "Usar tu ubicación",
      message: "Te sugerimos tu municipio y mostramos los coches cercanos. Puedes buscar sin activarla.",
    },
    camera: {
      title: "Usar la cámara",
      message: "La necesitamos para hacer tu foto de perfil y la comprobación privada.",
    },
    notifications: {
      title: "Recibir avisos",
      message: "Te avisamos de cambios de hora, recogidas y mensajes. Puedes elegir cuáles en Ajustes.",
    },
    photos: {
      title: "Elegir una foto",
      message: "Selecciona una imagen de tu galería. Solo accedemos a la que elijas.",
    },
  },

  /** Etiquetas accesibles de controles sin texto. */
  a11y: {
    back: "Volver",
    moreOptions: "Más opciones",
    moreInfo: "Más información",
    callDriver: "Llamar",
    locateMe: "Centrar en mi ubicación",
    clearField: "Borrar el campo",
    showPassword: "Mostrar",
    rating: "Valoración",
    removeStop: "Quitar parada",
    reorderStop: "Reordenar parada",
    notificationCount: "notificaciones sin leer",
    unread: "sin leer",
    avatar: "Foto de perfil",
  },
} as const;

export type EsStrings = typeof es;
