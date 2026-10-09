import { theme, type Theme } from "./tokens";

/**
 * Acceso al tema. La app es solo de tema claro (decisión de producto), así que devuelve una constante;
 * existe como hook para que los componentes no dependan de ello si algún día cambia.
 */
export function useTheme(): Theme {
  return theme;
}
