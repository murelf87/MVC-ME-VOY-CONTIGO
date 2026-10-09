// Sustituto web de expo-location (SOLO VISTA PREVIA). El móvil simulado está en un punto de EJEMPLO de la provincia de
// Sevilla (Plaza Nueva por defecto; se cambia en «Simulaciones» del visor) y el GPS puede ser preciso, débil o estar
// desactivado. Nunca se presenta como la ubicación real de nadie y no se llama a ningún geocodificador externo.
//  - Permisos: «al usar la app» (location) y «siempre» (locationAlways) con el diálogo del sistema simulado.
//  - El seguimiento en segundo plano (startLocationUpdatesAsync, geovallas) NO existe en un navegador: falla de forma explícita.
import { codedError, currentSim, expoPermission, onShellEvent, permissionStatus, requestPermission, usePermissionHook } from './_preview-system';

export const Accuracy = { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 };
export const LocationAccuracy = Accuracy;
export const ActivityType = { Other: 1, AutomotiveNavigation: 2, Fitness: 3, OtherNavigation: 4, Airborne: 5 };
export const GeofencingEventType = { Enter: 1, Exit: 2 };
export const GeofencingRegionState = { Unknown: 0, Inside: 1, Outside: 2 };
export const PermissionStatus = { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' };

// Municipios de ejemplo para la geocodificación inversa de la vista previa (provincia de Sevilla).
const MUNICIPALITIES = [
  { city: 'Sevilla', lat: 37.3886, lng: -5.9953, postalCode: '41001' },
  { city: 'Camas', lat: 37.4044, lng: -6.0327, postalCode: '41900' },
  { city: 'Tomares', lat: 37.3737, lng: -6.0475, postalCode: '41940' },
  { city: 'San Juan de Aznalfarache', lat: 37.3569, lng: -6.0412, postalCode: '41920' },
  { city: 'Mairena del Aljarafe', lat: 37.3447, lng: -6.0629, postalCode: '41927' },
  { city: 'Bormujos', lat: 37.3714, lng: -6.0734, postalCode: '41930' },
  { city: 'Dos Hermanas', lat: 37.2828, lng: -5.9208, postalCode: '41700' },
  { city: 'Montequinto', lat: 37.3317, lng: -5.9379, postalCode: '41089' },
  { city: 'Alcalá de Guadaíra', lat: 37.3376, lng: -5.8399, postalCode: '41500' },
  { city: 'La Rinconada', lat: 37.4869, lng: -5.9809, postalCode: '41300' },
  { city: 'Carmona', lat: 37.4713, lng: -5.6411, postalCode: '41410' },
  { city: 'Utrera', lat: 37.1853, lng: -5.7812, postalCode: '41710' },
  { city: 'Écija', lat: 37.5423, lng: -5.0826, postalCode: '41400' },
  { city: 'Coria del Río', lat: 37.2897, lng: -6.0538, postalCode: '41100' },
];

function distance2(a, b) {
  const dx = (a.lat - b.latitude) * 111.2;
  const dy = (a.lng - b.longitude) * 111.2 * Math.cos((b.latitude * Math.PI) / 180);
  return dx * dx + dy * dy;
}

function gps() {
  const g = currentSim().gps;
  return g === 'weak' || g === 'off' ? g : 'good';
}
const fg = () => permissionStatus('location');
const bg = () => permissionStatus('locationAlways');

function basePoint() {
  const p = currentSim().place;
  return { latitude: p.latitude, longitude: p.longitude };
}

/** Posición del móvil simulado: el punto base con la pequeña variación de un GPS real. */
function sample(accuracyLevel) {
  const base = basePoint();
  const weak = gps() === 'weak';
  const spread = weak ? 0.0016 : 0.00006;
  const jitter = () => (Math.random() - 0.5) * spread;
  const accuracy = weak ? 140 + Math.round(Math.random() * 120) : accuracyLevel !== undefined && accuracyLevel <= Accuracy.Low ? 65 : 10 + Math.round(Math.random() * 8);
  return {
    coords: { latitude: base.latitude + jitter(), longitude: base.longitude + jitter(), accuracy, altitude: 9, altitudeAccuracy: weak ? 40 : 6, heading: null, speed: 0 },
    timestamp: Date.now(),
    mocked: false,
  };
}

const notGranted = () => codedError('E_LOCATION_UNAUTHORIZED', 'Not authorized to use location services');
const servicesOff = () => codedError('E_LOCATION_SERVICES_DISABLED', 'Location services are disabled');
const permission = (st) => expoPermission(st, { ios: { scope: st === 'granted' ? 'whenInUse' : 'none' }, android: { accuracy: st === 'granted' ? 'fine' : 'none' } });

export async function hasServicesEnabledAsync() {
  return gps() !== 'off';
}
export async function enableNetworkProviderAsync() {}
export async function getProviderStatusAsync() {
  const on = gps() !== 'off';
  return { locationServicesEnabled: on, backgroundModeEnabled: false, gpsAvailable: on, networkAvailable: on, passiveAvailable: on };
}
export async function isBackgroundLocationAvailableAsync() {
  return false;
}

export async function getForegroundPermissionsAsync() {
  return permission(fg());
}
export async function requestForegroundPermissionsAsync() {
  return permission(await requestPermission('location'));
}
export async function getBackgroundPermissionsAsync() {
  const st = fg() === 'granted' ? bg() : fg() === 'undetermined' ? 'undetermined' : 'blocked';
  return expoPermission(st, { ios: { scope: st === 'granted' ? 'always' : 'none' } });
}
export async function requestBackgroundPermissionsAsync() {
  if (fg() !== 'granted') {
    const f = await requestPermission('location');
    if (f !== 'granted') return expoPermission(f);
  }
  return expoPermission(await requestPermission('locationAlways'));
}
export function useForegroundPermissions() {
  return usePermissionHook('location');
}
export function useBackgroundPermissions() {
  return usePermissionHook('locationAlways');
}
export async function getMotionActivityPermissionsAsync() {
  return expoPermission('granted');
}
export async function requestMotionActivityPermissionsAsync() {
  return expoPermission('granted');
}
export function useMotionActivityPermissions() {
  return [expoPermission('granted'), async () => expoPermission('granted'), async () => expoPermission('granted')];
}
export async function getMotionActivityAsync() {
  return [];
}
export async function watchMotionActivityAsync() {
  return { remove() {} };
}

export async function getCurrentPositionAsync(options) {
  if (fg() !== 'granted') throw notGranted();
  if (gps() === 'off') throw servicesOff();
  await new Promise((r) => setTimeout(r, gps() === 'weak' ? 1400 : 300));
  if (gps() === 'off') throw servicesOff();
  return sample(options && options.accuracy);
}

export async function getLastKnownPositionAsync() {
  if (fg() !== 'granted' || gps() === 'off') return null;
  const s = sample(Accuracy.Balanced);
  return Object.assign({}, s, { timestamp: s.timestamp - 60000 });
}

export async function watchPositionAsync(options, callback) {
  if (fg() !== 'granted') throw notGranted();
  const interval = Math.max(2000, Number(options && options.timeInterval) || 5000);
  const emit = () => {
    if (fg() !== 'granted' || gps() === 'off') return;
    try {
      callback(sample(options && options.accuracy));
    } catch (e) {
      // un fallo de la app no detiene el seguimiento
    }
  };
  const first = setTimeout(emit, 350);
  const timer = setInterval(emit, interval);
  const off = onShellEvent('mvc:preview-sim', () => setTimeout(emit, 150));
  return {
    remove() {
      clearTimeout(first);
      clearInterval(timer);
      off();
    },
  };
}

export async function getHeadingAsync() {
  return { trueHeading: 90, magHeading: 90, accuracy: 3 };
}
export async function watchHeadingAsync() {
  return { remove() {} };
}

export async function reverseGeocodeAsync(coords) {
  if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return [];
  let best = MUNICIPALITIES[0];
  let bestD = Infinity;
  MUNICIPALITIES.forEach((m) => {
    const d = distance2(m, coords);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  });
  // Fuera de la provincia (más de ~60 km de cualquier municipio de ejemplo): sin resultado, como un geocodificador sin datos.
  if (bestD > 60 * 60) return [];
  return [{ city: best.city, district: null, streetNumber: null, street: null, region: 'Andalucía', subregion: 'Sevilla', country: 'España', postalCode: best.postalCode, name: best.city, isoCountryCode: 'ES', timezone: 'Europe/Madrid', formattedAddress: `${best.city}, Sevilla` }];
}

export async function geocodeAsync(address) {
  const q = String(address || '').toLowerCase();
  const hit = MUNICIPALITIES.find((m) => q.includes(m.city.toLowerCase()));
  return hit ? [{ latitude: hit.lat, longitude: hit.lng, altitude: 0, accuracy: 500 }] : [];
}

// Segundo plano: no existe en un navegador. Se dice claramente en vez de simularlo.
const noBackground = () => {
  throw codedError('E_TASKMANAGER_NOT_AVAILABLE', 'El seguimiento en segundo plano no está disponible en la vista previa del navegador.');
};
export async function startLocationUpdatesAsync() {
  noBackground();
}
export async function stopLocationUpdatesAsync() {}
export async function hasStartedLocationUpdatesAsync() {
  return false;
}
export async function startGeofencingAsync() {
  noBackground();
}
export async function stopGeofencingAsync() {}
export async function hasStartedGeofencingAsync() {
  return false;
}

export const EventEmitter = { addListener: () => ({ remove() {} }) };
export function installWebGeolocationPolyfill() {}
export function _getCurrentWatchId() {
  return 0;
}
