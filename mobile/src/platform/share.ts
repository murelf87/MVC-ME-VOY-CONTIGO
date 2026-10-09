/** Hoja de compartir del sistema. En la vista previa, la hoja simulada del visor; en un navegador, `navigator.share`. */
import { Platform, Share } from "react-native";
import { getPreviewShell } from "./previewBridge";

export type ShareOutcome = "shared" | "dismissed" | "unavailable";

export interface SharePayload {
  title?: string;
  /** Texto a compartir. */
  message: string;
  url?: string;
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

export async function shareContent(payload: SharePayload): Promise<ShareOutcome> {
  const { title, message, url } = payload;
  try {
    if (Platform.OS === "web") {
      const shell = getPreviewShell();
      if (shell) return await shell.share({ ...(title ? { title } : {}), message, ...(url ? { url } : {}) });
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ ...(title ? { title } : {}), text: message, ...(url ? { url } : {}) });
        return "shared";
      }
      return "unavailable";
    }
    const result =
      Platform.OS === "ios"
        ? await Share.share({ message, ...(url ? { url } : {}), ...(title ? { title } : {}) })
        : await Share.share({ message: url ? `${message}\n${url}` : message, ...(title ? { title } : {}) }, title ? { dialogTitle: title } : undefined);
    return result.action === Share.sharedAction ? "shared" : "dismissed";
  } catch (error) {
    return isAbort(error) ? "dismissed" : "unavailable";
  }
}
