// Metro: configuración estándar de Expo + sustitutos SOLO para la vista previa web.
// En iOS/Android se usan SIEMPRE los módulos nativos reales; los ficheros de `web-stubs/` existen únicamente para poder
// ejecutar la app en un navegador (vista previa interactiva y herramienta de comparación con el diseño), donde no hay
// cámara, GPS, notificaciones, Keychain ni mapas nativos. Contrato con el visor: tools/preview/shell/API.md.
const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);

const STUBS_DIR = path.join(__dirname, 'web-stubs');

/** nombre del módulo → fichero de web-stubs/ (solo platform === 'web'). */
const WEB_STUBS = {
  'expo-camera': 'expo-camera.js',
  'expo-image-picker': 'expo-image-picker.js',
  'expo-document-picker': 'expo-document-picker.js',
  'expo-location': 'expo-location.js',
  'expo-notifications': 'expo-notifications.js',
  'expo-secure-store': 'expo-secure-store.js',
  'expo-sharing': 'expo-sharing.js',
  'expo-clipboard': 'expo-clipboard.js',
  'expo-haptics': 'expo-haptics.js',
  'expo-linking': 'expo-linking.js',
  'expo-localization': 'expo-localization.js',
  'expo-keep-awake': 'expo-keep-awake.js',
  'expo-system-ui': 'expo-system-ui.js',
  'expo-web-browser': 'expo-web-browser.js',
  'expo-status-bar': 'expo-status-bar.js',
  '@react-native-community/netinfo': 'netinfo.js',
  // El mapa lo escribe el agente `map` (web-stubs/react-native-maps.js). Si todavía no existe, se usa un relleno mínimo.
  'react-native-maps': fs.existsSync(path.join(STUBS_DIR, 'react-native-maps.js')) ? 'react-native-maps.js' : '_react-native-maps-missing.js',
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && Object.prototype.hasOwnProperty.call(WEB_STUBS, moduleName)) {
    return { type: 'sourceFile', filePath: path.join(STUBS_DIR, WEB_STUBS[moduleName]) };
  }
  if (defaultResolveRequest) return defaultResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
