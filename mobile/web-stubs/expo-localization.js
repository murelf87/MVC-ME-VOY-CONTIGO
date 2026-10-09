// Sustituto web de expo-localization (SOLO VISTA PREVIA): el producto es es-ES (Europe/Madrid). El navegador de quien mire
// la vista previa puede estar en otro idioma o zona: aquí se fija la configuración del móvil simulado.
import { useMemo } from 'react';

const LOCALES = [
  {
    languageTag: 'es-ES',
    languageCode: 'es',
    languageScriptCode: null,
    regionCode: 'ES',
    languageRegionCode: 'ES',
    languageCurrencyCode: 'EUR',
    languageCurrencySymbol: '€',
    currencyCode: 'EUR',
    currencySymbol: '€',
    decimalSeparator: ',',
    digitGroupingSeparator: '.',
    textDirection: 'ltr',
    measurementSystem: 'metric',
    temperatureUnit: 'celsius',
  },
];
const CALENDARS = [{ calendar: 'gregory', timeZone: 'Europe/Madrid', uses24hourClock: true, firstWeekday: 2 }];

export const getLocales = () => LOCALES.map((l) => Object.assign({}, l));
export const getCalendars = () => CALENDARS.map((c) => Object.assign({}, c));
export function useLocales() {
  return useMemo(() => getLocales(), []);
}
export function useCalendars() {
  return useMemo(() => getCalendars(), []);
}
