/**
 * Rutas del slice `profile` (lámina 08: perfil, mis viajes, favoritos y rutina, planes).
 *
 * Todas las rutas apuntan a su pantalla real. Reglas:
 *  - `ProfileParams` es un `type` (no `interface`) y SOLO lleva datos serializables (ids, textos, números).
 *  - Los nombres de ruta son únicos en TODA la app (el registro falla al arrancar si se repiten).
 *  - `access`: "public" (también invitados) · "auth" (por defecto) · "staff".
 *  - Pantalla = componente que recibe `AppScreenProps<"Nombre">`; navega con `useAppNavigation()` y lee los
 *    parámetros con `useAppRoute("Nombre")`.
 */
import { defineRoute, type RouteDef } from "@/navigation/routeDef";
import { BookingDetailScreen } from "./screens/BookingDetailScreen";
import { WeeklyReservationScreen } from "./screens/WeeklyReservationScreen";
import { EditProfileScreen } from "./screens/EditProfileScreen";
import { VerificationStatusScreen } from "./screens/VerificationStatusScreen";
import { PlansScreen } from "./screens/PlansScreen";
import { RoutineEntryFormScreen } from "./screens/RoutineEntryFormScreen";
import { FavoriteFormScreen } from "./screens/FavoriteFormScreen";
import { FavoritesRoutineScreen } from "./screens/FavoritesRoutineScreen";
import { MyProfileScreen } from "./screens/MyProfileScreen";
import { MyTripsScreen } from "./screens/MyTripsScreen";
import type { PlaceParam } from "@/features/search/routes";

export type ProfileParams = {
  MyProfile: undefined;
  /** `tab`: pestaña con la que se abre («past» y «weekly» son valores históricos: abren Historial y Próximos). `role`: modo con el que se ven los viajes. */
  MyTrips: { tab?: "upcoming" | "in_progress" | "history" | "past" | "weekly"; role?: "passenger" | "driver" } | undefined;
  FavoritesRoutine: undefined;
  Plans: undefined;
  // ── Páginas adicionales de producción (catálogo de docs/BUILD_BRIEF.md §10.3). Contrato entre equipos: añade parámetros opcionales, no renombres ni quites.
  EditProfile: undefined;
  VerificationStatus: undefined;
  WeeklyReservation: { reservationId: string };
  /** Se abre con la solicitud (`requestId`) o con la reserva (`bookingId`, que es lo que traen los avisos y el chat). */
  BookingDetail: { bookingId?: string; requestId?: string };
  /** `place`: lugar que devuelve `PlaceSearch` (se recibe con `usePlaceResult`). */
  FavoriteForm: { favoriteId?: string; place?: PlaceParam } | undefined;
  RoutineEntryForm: { entryId?: string } | undefined;
};

export const profileRoutes: RouteDef[] = [
  defineRoute({ name: "MyProfile", component: MyProfileScreen, access: "auth", screen: "29", title: "Mi perfil" }),
  defineRoute({ name: "MyTrips", component: MyTripsScreen, access: "auth", screen: "30", title: "Mis viajes" }),
  defineRoute({ name: "FavoritesRoutine", component: FavoritesRoutineScreen, access: "auth", screen: "31", title: "Favoritos y rutina" }),
  defineRoute({ name: "Plans", component: PlansScreen, access: "auth", screen: "32", title: "Planes" }),
  // ── Páginas adicionales de producción (sin lámina: se diseñan en el mismo lenguaje visual)
  defineRoute({ name: "EditProfile", component: EditProfileScreen, access: "auth", title: "Editar perfil" }),
  defineRoute({ name: "VerificationStatus", component: VerificationStatusScreen, access: "auth", title: "Verificación y seguridad" }),
  defineRoute({ name: "WeeklyReservation", component: WeeklyReservationScreen, access: "auth", title: "Reserva semanal", previewParams: { reservationId: { $ref: "weekly.miguel" } }, previewSeed: "req-weekly-awaiting-payment", previewClock: "2026-10-05T07:58:00+02:00" }),
  defineRoute({ name: "BookingDetail", component: BookingDetailScreen, access: "auth", title: "Detalle de la reserva", previewParams: { bookingId: { $ref: "booking.mine" } } }),
  defineRoute({ name: "FavoriteForm", component: FavoriteFormScreen, access: "auth", title: "Destino favorito" }),
  defineRoute({ name: "RoutineEntryForm", component: RoutineEntryFormScreen, access: "auth", title: "Fila de rutina" }),
];
