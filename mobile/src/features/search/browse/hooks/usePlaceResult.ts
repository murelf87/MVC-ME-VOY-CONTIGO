/**
 * Recibir el lugar que devuelve `PlaceSearch`.
 *
 * Uso en la pantalla que abre el buscador (favoritos, paradas del conductor…):
 *
 *   navigation.navigate("PlaceSearch", { field: "place", returnTo: { route: "FavoriteForm", param: "place" } });
 *   …
 *   usePlaceResult("place", (place) => setAddress(place));
 *
 * `PlaceSearch` vuelve con `popTo(route, { [param]: place }, { merge: true })`. Este hook detecta el parámetro, avisa
 * UNA vez a `onPlace` y lo borra de los parámetros de la pantalla para no reaplicarlo al volver a enfocarla.
 */
import { useNavigation, useRoute, type NavigationProp, type ParamListBase } from "@react-navigation/native";
import { useEffect, useRef } from "react";
import type { PlaceParam } from "../../routes";
import { isPlaceParam } from "../logic/places";
import { clearRouteParam } from "../placeNavigation";

export function usePlaceResult(param: string, onPlace: (place: PlaceParam) => void): void {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute();
  const params = route.params as Record<string, unknown> | undefined;
  const received = params?.[param];

  const handler = useRef(onPlace);
  useEffect(() => {
    handler.current = onPlace;
  });

  useEffect(() => {
    if (!isPlaceParam(received)) return;
    handler.current(received);
    clearRouteParam(navigation, param);
  }, [received, param, navigation]);
}
