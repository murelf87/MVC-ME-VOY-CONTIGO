/**
 * Abrir cosas fuera de la app: Ajustes del sistema, mapas, llamadas, SMS, correo y enlaces web.
 * Nunca lanzan: devuelven `opened | failed | invalid` para que la pantalla pueda explicar el fallo.
 */
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import {
  buildDirectionsUrl,
  buildMailtoUrl,
  buildMapsUrl,
  isSafeExternalUrl,
  normalizePhoneForDialing,
  type MapsTarget,
} from "./linkBuilders";
import { resolveDevicePlatform } from "./previewBridge";

export type OpenResult = "opened" | "failed" | "invalid";

async function openUrl(url: string | null): Promise<OpenResult> {
  if (!url) return "invalid";
  try {
    await Linking.openURL(url);
    return "opened";
  } catch {
    return "failed";
  }
}

/** Ajustes del sistema de la app (para permisos «bloqueados»). `true` si se abrieron. */
export async function openAppSettings(): Promise<boolean> {
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

/** Ver un lugar en la app de mapas del sistema. */
export function openMapsAt(target: MapsTarget): Promise<OpenResult> {
  return openUrl(buildMapsUrl(target, resolveDevicePlatform(Platform.OS)));
}

/** «Cómo llegar» en coche hasta el punto. */
export function openMapsDirections(target: MapsTarget): Promise<OpenResult> {
  return openUrl(buildDirectionsUrl(target, resolveDevicePlatform(Platform.OS)));
}

/** Abre el marcador del teléfono con el número (no llama sin que la persona pulse). */
export function callPhone(number: string): Promise<OpenResult> {
  const dialable = normalizePhoneForDialing(number);
  return openUrl(dialable ? `tel:${dialable}` : null);
}

export function sendSms(number: string, body?: string): Promise<OpenResult> {
  const dialable = normalizePhoneForDialing(number);
  if (!dialable) return Promise.resolve("invalid");
  return openUrl(`sms:${dialable}${body ? `${Platform.OS === "ios" ? "&" : "?"}body=${encodeURIComponent(body)}` : ""}`);
}

export function openEmail(to: string, subject?: string, body?: string): Promise<OpenResult> {
  return openUrl(buildMailtoUrl(to, subject, body));
}

/** Abre una página web (https) en el navegador integrado. `invalid` para cualquier otro esquema. */
export async function openWebPage(url: string): Promise<OpenResult> {
  if (!isSafeExternalUrl(url)) return "invalid";
  if (url.startsWith("mailto:")) return openUrl(url);
  try {
    await WebBrowser.openBrowserAsync(url);
    return "opened";
  } catch {
    return "failed";
  }
}
