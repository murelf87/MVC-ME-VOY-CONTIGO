// Sustituto web de expo-secure-store (SOLO VISTA PREVIA): almacenamiento local del navegador con prefijo propio.
// En iOS/Android se usa Keychain/Keystore reales. En la vista previa no hay secretos reales: solo la sesión de ejemplo.
export const AFTER_FIRST_UNLOCK = 0;
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 1;
export const ALWAYS = 2;
export const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY = 3;
export const ALWAYS_THIS_DEVICE_ONLY = 4;
export const WHEN_UNLOCKED = 5;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;

const PREFIX = 'mvc.secure.';
const memory = {};

function read(key) {
  try {
    const v = globalThis.localStorage.getItem(PREFIX + key);
    return v === undefined ? null : v;
  } catch (e) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }
}
function write(key, value) {
  try {
    globalThis.localStorage.setItem(PREFIX + key, value);
  } catch (e) {
    memory[key] = value;
  }
}
function remove(key) {
  try {
    globalThis.localStorage.removeItem(PREFIX + key);
  } catch (e) {
    delete memory[key];
  }
}

export async function isAvailableAsync() {
  return true;
}
export async function getItemAsync(key) {
  return read(key);
}
export async function setItemAsync(key, value) {
  write(key, String(value));
}
export async function deleteItemAsync(key) {
  remove(key);
}
export function getItem(key) {
  return read(key);
}
export function setItem(key, value) {
  write(key, String(value));
}
export function canUseBiometricAuthentication() {
  return false;
}
