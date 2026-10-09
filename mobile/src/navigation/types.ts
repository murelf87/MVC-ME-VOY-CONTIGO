/**
 * Tipos de navegación de toda la app. `AppParamList` se compone de los parámetros que declara cada slice en
 * `features/<slice>/routes.ts` (como `type`, no `interface`: React Navigation exige una firma de índice).
 */
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AccountParams } from "@/features/account/routes";
import type { AdminParams } from "@/features/admin/routes";
import type { AuthParams } from "@/features/auth/routes";
import type { DriverParams } from "@/features/driver/routes";
import type { LiveParams } from "@/features/live/routes";
import type { MessagesParams } from "@/features/messages/routes";
import type { ProfileParams } from "@/features/profile/routes";
import type { SearchParams } from "@/features/search/routes";

/** Rutas solo de desarrollo / vista previa (galería del sistema de diseño). */
export type DevParams = {
  UiGallery: undefined;
};

export type AppParamList = AuthParams &
  SearchParams &
  DriverParams &
  LiveParams &
  MessagesParams &
  ProfileParams &
  AccountParams &
  AdminParams &
  DevParams;

export type AppRouteName = keyof AppParamList & string;

/** Props de una pantalla: `navigation` y `route` tipados con SUS parámetros. */
export type AppScreenProps<Name extends AppRouteName> = NativeStackScreenProps<AppParamList, Name>;
export type AppNavigation = NativeStackNavigationProp<AppParamList>;
export type AppRoute<Name extends AppRouteName> = RouteProp<AppParamList, Name>;

declare global {
  // Hace que `useNavigation()` y `navigation.navigate(...)` queden tipados en toda la app sin genéricos.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends AppParamList {}
  }
}
