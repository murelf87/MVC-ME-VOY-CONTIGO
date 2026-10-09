/**
 * Navegación de la app: lo que necesitan los slices. Importa desde `@/navigation`.
 *
 * NO re-exporta `RootNavigator` ni el registro (importan a los slices: provocarían un ciclo). `App.tsx` los
 * importa directamente (`@/navigation/AppNavigation`).
 */
export { applyGate, completeOnboarding, openTarget, requireAccount, resetToRoute, type ApplyGateOptions, type OnboardingOutcome } from "./actions";
export { isRouteAllowed } from "./access";
export { parseDeepLink, resolveNotificationTarget } from "./deepLinks";
export { useAppNavigation, useAppRoute } from "./hooks";
export { getCurrentRoute, getRouteNames, navigationRef, type CurrentRoute } from "./navigationRef";
export { clearPendingReturn, peekPendingReturn, setPendingReturn, takePendingReturn, type ReturnTarget } from "./returnTo";
export { defineRoute, type RouteAccess, type RouteCatalogEntry, type RouteDef, type RouteOptions } from "./routeDef";
export type { AppNavigation, AppParamList, AppRoute, AppRouteName, AppScreenProps } from "./types";
