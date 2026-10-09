/**
 * Rutas que solo existen en desarrollo y en la vista previa (nunca en la app de producción).
 *
 * Hoy: `UiGallery`, la galería del sistema de diseño (`src/dev/UiGallery`, propiedad de `ds`).
 *
 * IMPORTANTE: el `require` de la galería está DENTRO de la rama condicional y con las expresiones literales
 * `__DEV__` / `process.env.EXPO_PUBLIC_PREVIEW === "1"`. Metro las sustituye en la compilación de producción, pliega la
 * condición a `false` y descarta la rama ENTERA antes de recoger dependencias: la galería no entra en el paquete.
 * (Una constante exportada desde otro módulo NO produciría ese efecto.)
 */
import type { ComponentType } from "react";
import { Text, View } from "react-native";
import { defineRoute, type RouteDef } from "./routeDef";
import type { AppScreenProps } from "./types";

type GalleryComponent = ComponentType<AppScreenProps<"UiGallery">>;

interface GalleryModule {
  UiGallery?: GalleryComponent;
  default?: GalleryComponent;
}

function GalleryUnavailable() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text accessibilityRole="header">La galería del sistema de diseño no está disponible.</Text>
    </View>
  );
}

export const devRoutes: RouteDef[] =
  __DEV__ || process.env.EXPO_PUBLIC_PREVIEW === "1"
    ? (() => {
        let Gallery: GalleryComponent = GalleryUnavailable;
        try {
          const loaded = require("@/dev/UiGallery") as GalleryModule;
          Gallery = loaded.UiGallery ?? loaded.default ?? GalleryUnavailable;
        } catch {
          // `ds` todavía no ha entregado la galería: la ruta existe y muestra un aviso en vez de romper el arranque.
        }
        return [defineRoute({ name: "UiGallery", component: Gallery, access: "public", title: "Galería del sistema de diseño" })];
      })()
    : [];
