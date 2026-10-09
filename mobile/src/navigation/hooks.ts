import { useNavigation, useRoute } from "@react-navigation/native";
import type { AppNavigation, AppRoute, AppRouteName } from "./types";

/** `navigation` tipado con todas las rutas de la app. */
export function useAppNavigation(): AppNavigation {
  return useNavigation<AppNavigation>();
}

/**
 * `route` de la pantalla actual con SUS parámetros tipados. Pasar el nombre es opcional (sirve para inferir el tipo
 * y, en desarrollo, para detectar que el hook se usó en otra pantalla).
 *
 *   const { params } = useAppRoute("TripDetail");   // params.tripId: string
 */
export function useAppRoute<Name extends AppRouteName>(name?: Name): AppRoute<Name> {
  const route = useRoute<AppRoute<Name>>();
  if (__DEV__ && name !== undefined && route.name !== name) {
    throw new Error(`useAppRoute("${name}") se llamó dentro de la pantalla «${route.name}».`);
  }
  return route;
}
