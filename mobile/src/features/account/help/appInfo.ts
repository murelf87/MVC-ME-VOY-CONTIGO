import Constants from "expo-constants";
import { Platform } from "react-native";

export type AppRuntime = "ios" | "android" | "web";

export interface AppInfo {
  /** Versión de la app según la configuración de Expo (`expo.version`); `null` si el entorno no la expone. */
  version: string | null;
  /** Número de compilación (`ios.buildNumber` / `android.versionCode`), si existe. */
  build: string | null;
  runtime: AppRuntime;
}

/** Datos de la app para «Acerca de MVC» y el pie de «Ajustes». Nada está escrito a mano: sale de la configuración de Expo. */
export function getAppInfo(): AppInfo {
  const config = Constants.expoConfig;
  const runtime: AppRuntime = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  const version = config?.version ?? Constants.nativeAppVersion ?? null;
  let build: string | null = null;
  if (runtime === "ios") build = config?.ios?.buildNumber ?? Constants.nativeBuildVersion ?? null;
  else if (runtime === "android") {
    const code = config?.android?.versionCode;
    build = code !== undefined ? String(code) : (Constants.nativeBuildVersion ?? null);
  }
  return { version, build, runtime };
}
