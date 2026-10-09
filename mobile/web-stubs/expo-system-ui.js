// Sustituto web de expo-system-ui (SOLO VISTA PREVIA): el «fondo del sistema» es el fondo del documento de la app.
let current = null;

export async function setBackgroundColorAsync(color) {
  current = color == null ? null : String(color);
  try {
    document.documentElement.style.backgroundColor = current == null ? '' : current;
  } catch (e) {
    // sin DOM
  }
}
export async function getBackgroundColorAsync() {
  return current;
}
