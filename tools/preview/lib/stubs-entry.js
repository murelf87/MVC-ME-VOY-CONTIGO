// Entrada del arnés de los sustitutos web (flujo «stubs» de tools/preview/flows/stubs.mjs). NO forma parte de la app.
// Importa cada módulo con sustituto POR SU NOMBRE DE PAQUETE (tools/preview/lib/stubs-harness.mjs los resuelve a
// mobile/web-stubs/*.js leyendo la misma tabla WEB_STUBS que mobile/metro.config.js) y los deja en window.__stubs para que
// Playwright los ejecute de verdad contra el shell real (tools/preview/shell/inner.js).
import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import * as Camera from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as KeepAwake from 'expo-keep-awake';
import * as Linking from 'expo-linking';
import * as Localization from 'expo-localization';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import * as StatusBarModule from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import * as WebBrowser from 'expo-web-browser';
import NetInfo from '@react-native-community/netinfo';

window.__stubs = { Camera, DocumentPicker, Clipboard, Haptics, ImagePicker, KeepAwake, Linking, Localization, Location, Notifications, SecureStore, Sharing, StatusBarModule, SystemUI, WebBrowser, NetInfo };
window.__react = { React, flushSync, createRoot };
