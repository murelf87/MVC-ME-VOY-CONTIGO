// Sustituto web de expo-clipboard (SOLO VISTA PREVIA). Escribe en el portapapeles del navegador cuando se puede
// (navigator.clipboard o execCommand dentro del iframe); si el navegador lo impide, lo recuerda en memoria para que
// «copiar» y «pegar» sigan siendo coherentes dentro de la vista previa.
let memory = '';
const listeners = new Set();

function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (e) {
    return false;
  }
}

export async function setStringAsync(text) {
  memory = String(text);
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(memory);
      ok = true;
    }
  } catch (e) {
    ok = false;
  }
  if (!ok) ok = legacyCopy(memory);
  listeners.forEach((l) => {
    try {
      l({ contentTypes: ['plain-text'] });
    } catch (e) {
      // sigue con el resto
    }
  });
  return true;
}
export async function getStringAsync() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) return await navigator.clipboard.readText();
  } catch (e) {
    // sin permiso de lectura: se usa lo último copiado desde la propia app
  }
  return memory;
}
export async function hasStringAsync() {
  return memory.length > 0;
}
export async function getUrlAsync() {
  return /^https?:\/\//i.test(memory) ? memory : null;
}
export async function setUrlAsync(url) {
  await setStringAsync(url);
}
export async function hasUrlAsync() {
  return /^https?:\/\//i.test(memory);
}
export async function getImageAsync() {
  return null;
}
export async function setImageAsync() {}
export async function hasImageAsync() {
  return false;
}
export function addClipboardListener(listener) {
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}
export function removeClipboardListener(sub) {
  if (sub && sub.remove) sub.remove();
}
export const isPasteButtonAvailable = false;
export function ClipboardPasteButton() {
  return null;
}
export const CLIPBOARD_CHANGED_EVENT_NAME = 'onClipboardChanged';
