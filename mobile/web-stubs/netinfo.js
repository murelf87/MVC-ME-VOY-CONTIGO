// Sustituto web de @react-native-community/netinfo (SOLO VISTA PREVIA). La conectividad la manda el panel «Simulaciones»
// del visor (Wi-Fi / datos móviles / sin Internet): el módulo real mide la red del navegador, que aquí no es la del móvil simulado.
import { useEffect, useState } from 'react';
import { currentSim, onShellEvent } from './_preview-system';

export const NetInfoStateType = { unknown: 'unknown', none: 'none', cellular: 'cellular', wifi: 'wifi', bluetooth: 'bluetooth', ethernet: 'ethernet', wimax: 'wimax', vpn: 'vpn', other: 'other' };
export const NetInfoCellularGeneration = { '2g': '2g', '3g': '3g', '4g': '4g', '5g': '5g' };

function snapshot() {
  const n = currentSim().network;
  if (n === 'none') return { type: 'none', isConnected: false, isInternetReachable: false, details: null, isWifiEnabled: true };
  if (n === 'cellular') {
    return { type: 'cellular', isConnected: true, isInternetReachable: true, details: { isConnectionExpensive: true, cellularGeneration: '4g', carrier: null }, isWifiEnabled: true };
  }
  return {
    type: 'wifi',
    isConnected: true,
    isInternetReachable: true,
    details: { isConnectionExpensive: false, ssid: null, bssid: null, strength: null, ipAddress: null, subnet: null, frequency: null, linkSpeed: null, rxLinkSpeed: null, txLinkSpeed: null },
    isWifiEnabled: true,
  };
}

const listeners = new Set();
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  onShellEvent('mvc:preview-sim', () => {
    const s = snapshot();
    listeners.forEach((l) => {
      try {
        l(s);
      } catch (e) {
        // sigue con el resto
      }
    });
  });
}

export function configure() {}
export async function fetch() {
  return snapshot();
}
export async function refresh() {
  return snapshot();
}
export function addEventListener(listener) {
  wire();
  listeners.add(listener);
  // Como el módulo real: avisa enseguida con el estado actual.
  setTimeout(() => {
    if (listeners.has(listener)) listener(snapshot());
  }, 0);
  return () => {
    listeners.delete(listener);
  };
}
export function useNetInfo() {
  const [state, setState] = useState(snapshot);
  useEffect(() => {
    setState(snapshot());
    return addEventListener(setState);
  }, []);
  return state;
}
export function useNetInfoInstance() {
  const netInfo = useNetInfo();
  return { netInfo, refresh: async () => undefined };
}

export default { configure, fetch, refresh, addEventListener, useNetInfo, useNetInfoInstance };
