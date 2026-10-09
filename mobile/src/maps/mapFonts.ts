/**
 * Familias de Roboto Condensed (cargadas por el sistema de diseño con @expo-google-fonts/roboto-condensed). En web se añade
 * una pila de reserva por si la fuente aún no ha cargado. Separado de `mapTheme.ts` para que este siga siendo puro.
 */
import { Platform } from 'react-native';

const webFallback = ', Roboto, "Helvetica Neue", Arial, sans-serif';

export const MAP_FONTS = {
  regular: Platform.OS === 'web' ? `RobotoCondensed_400Regular${webFallback}` : 'RobotoCondensed_400Regular',
  medium: Platform.OS === 'web' ? `RobotoCondensed_500Medium${webFallback}` : 'RobotoCondensed_500Medium',
  bold: Platform.OS === 'web' ? `RobotoCondensed_700Bold${webFallback}` : 'RobotoCondensed_700Bold',
} as const;
