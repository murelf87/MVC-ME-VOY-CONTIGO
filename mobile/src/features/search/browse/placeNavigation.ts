/**
 * Cómo viaja un lugar elegido en el buscador de vuelta a quien lo pidió.
 *
 * `PlaceSearch` NO usa `navigate({ merge: true })`: en React Navigation 7 `navigate` a una pantalla que ya está en la
 * pila no vuelve a ella (apila otra). Se usa `StackActions.popTo(route, params, { merge: true })`:
 *  - si `route` ya está en la pila (caso normal: `DefineRoute`, `FavoriteForm`, `StopsRoute`…), vuelve a ella y FUSIONA
 *    `{ [param]: place }` en sus parámetros;
 *  - si no está (p. ej. se llegó al buscador desde el mapa), sustituye `PlaceSearch` por esa pantalla con el lugar.
 *
 * Quien recibe el lugar lo lee de `route.params[param]` (hook `usePlaceResult`) y, si lo guarda en su estado, borra el
 * parámetro para no reaplicarlo.
 */
import { CommonActions, StackActions, type NavigationProp, type ParamListBase } from "@react-navigation/native";
import type { PlaceParam } from "../routes";

export type PlaceReturnTarget = { route: string; param: string };

type Dispatcher = Pick<NavigationProp<ParamListBase>, "dispatch">;

/** Devuelve `place` a `target.route` en el parámetro `target.param`. */
export function deliverPlace(navigation: Dispatcher, target: PlaceReturnTarget, place: PlaceParam): void {
  navigation.dispatch(StackActions.popTo(target.route, { [target.param]: place }, { merge: true }));
}

/** Borra un parámetro de la pantalla actual (tras consumir un lugar recibido). */
export function clearRouteParam(navigation: Dispatcher, param: string): void {
  navigation.dispatch(CommonActions.setParams({ [param]: undefined }));
}
