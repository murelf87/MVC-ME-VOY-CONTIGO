/**
 * Carga de fuentes de la app. Llama a `useAppFonts()` una sola vez en la raíz (el esqueleto `app` lo hace en `App.tsx`)
 * y no pintes pantallas hasta que `loaded` sea `true` (o `error` no sea `null`: en ese caso se pinta con la fuente
 * del sistema, que `typography.ts` ya declara como reserva en web).
 *
 * Se importa cada peso por subruta (`…/400Regular`) para que el empaquetado web no arrastre las 18 variantes de la familia.
 */
import { FontDisplay, useFonts } from "expo-font";
import { Epilogue_900Black } from "@expo-google-fonts/epilogue/900Black";
import { RobotoCondensed_400Regular } from "@expo-google-fonts/roboto-condensed/400Regular";
import { RobotoCondensed_500Medium } from "@expo-google-fonts/roboto-condensed/500Medium";
import { RobotoCondensed_600SemiBold } from "@expo-google-fonts/roboto-condensed/600SemiBold";
import { RobotoCondensed_700Bold } from "@expo-google-fonts/roboto-condensed/700Bold";

/** `display: block` en web: el texto queda invisible hasta cargar la fuente en vez de «saltar» desde una de reserva. */
function source(module: number): { uri: number; display: FontDisplay } {
  return { uri: module, display: FontDisplay.BLOCK };
}

const fontMap = {
  RobotoCondensed_400Regular: source(RobotoCondensed_400Regular),
  RobotoCondensed_500Medium: source(RobotoCondensed_500Medium),
  RobotoCondensed_600SemiBold: source(RobotoCondensed_600SemiBold),
  RobotoCondensed_700Bold: source(RobotoCondensed_700Bold),
  Epilogue_900Black: source(Epilogue_900Black),
};

export interface AppFontsState {
  /** `true` cuando todas las fuentes están listas. */
  loaded: boolean;
  /** Error de carga (la app debe seguir arrancando con la fuente del sistema). */
  error: Error | null;
}

export function useAppFonts(): AppFontsState {
  const [loaded, error] = useFonts(fontMap);
  return { loaded, error };
}

/** Nombres de familia registrados (para pruebas y para la galería). */
export const registeredFontFamilies: readonly string[] = Object.keys(fontMap);
