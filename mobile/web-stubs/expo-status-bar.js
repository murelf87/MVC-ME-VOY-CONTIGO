// Sustituto web de expo-status-bar (SOLO VISTA PREVIA). En el navegador no hay barra de estado: este sustituto se la
// describe al marco del móvil del visor (shell.setStatusBar) para que dibuje la hora, la cobertura y la batería oscuras
// (style="dark") o claras (style="light"; con "auto" el visor mira si lo que hay debajo es oscuro).
// Igual que en React Native, manda el <StatusBar> montado más recientemente; las llamadas imperativas valen hasta el siguiente cambio.
import { useEffect, useRef } from 'react';
import { previewShell } from './_preview-system';

const STYLES = ['auto', 'inverted', 'light', 'dark'];
const stack = [];
let imperative = null;
let lastKey = '';
let nextId = 1;

function normalizeStyle(style) {
  return STYLES.indexOf(style) >= 0 ? style : 'auto';
}

function emit() {
  const top = stack.length ? stack[stack.length - 1] : null;
  const state = {
    style: normalizeStyle(imperative && imperative.style !== undefined ? imperative.style : top ? top.style : 'auto'),
    hidden: Boolean(imperative && imperative.hidden !== undefined ? imperative.hidden : top ? top.hidden : false),
  };
  const key = `${state.style}|${state.hidden}`;
  if (key === lastKey) return;
  lastKey = key;
  const shell = previewShell();
  if (shell && typeof shell.setStatusBar === 'function') shell.setStatusBar(state);
}

export function StatusBar({ style = 'auto', hidden = false }) {
  const entry = useRef(null);
  if (entry.current === null) entry.current = { id: nextId++, style, hidden };

  useEffect(() => {
    const e = entry.current;
    stack.push(e);
    imperative = null;
    emit();
    return () => {
      const i = stack.indexOf(e);
      if (i >= 0) stack.splice(i, 1);
      imperative = null;
      emit();
    };
  }, []);

  useEffect(() => {
    entry.current.style = style;
    entry.current.hidden = Boolean(hidden);
    imperative = null;
    emit();
  }, [style, hidden]);

  return null;
}

export function setStatusBarStyle(style) {
  imperative = Object.assign({}, imperative || {}, { style: normalizeStyle(style) });
  emit();
}
export function setStatusBarHidden(hidden) {
  imperative = Object.assign({}, imperative || {}, { hidden: Boolean(hidden) });
  emit();
}
