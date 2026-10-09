import * as Clipboard from "expo-clipboard";

/** Copia texto al portapapeles. `true` si se copió. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

/** Lee el portapapeles (p. ej. pegar un código). Cadena vacía si no se puede. */
export async function readClipboard(): Promise<string> {
  try {
    return await Clipboard.getStringAsync();
  } catch {
    return "";
  }
}
