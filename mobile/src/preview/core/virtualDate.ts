/**
 * Sustituye `Date` global para que `new Date()` y `Date.now()` devuelvan la hora del reloj virtual: así la app y el
 * servidor simulado comparten «ahora» (lunes 5 de octubre de 2026, 07:17). Solo se instala en la vista previa y
 * solo si el reloj NO está congelado (con el tiempo parado las animaciones basadas en `Date.now()` de
 * react-native-web no avanzarían).
 *
 * `new Date(valor)`, `Date.parse`, `Date.UTC` y `instanceof Date` se comportan igual que el original.
 */
import { realDate, type PreviewClock } from "./clock";

type DateRestore = () => void;

let active: { restore: DateRestore } | null = null;

export function isVirtualDateInstalled(): boolean {
  return active !== null;
}

export function installVirtualDate(clock: PreviewClock): DateRestore {
  if (active) return active.restore;
  const Real = realDate();
  const original = globalThis.Date;
  const virtual: DateConstructor = new Proxy(Real, {
    construct(target, args: unknown[], newTarget): object {
      if (args.length === 0) return new target(clock.nowMs());
      return Reflect.construct(target, args, newTarget === virtual ? target : newTarget);
    },
    apply() {
      return new Real(clock.nowMs()).toString();
    },
    get(target, property, receiver) {
      if (property === "now") return () => clock.nowMs();
      return Reflect.get(target, property, receiver === virtual ? target : receiver);
    },
  });
  globalThis.Date = virtual;
  const restore: DateRestore = () => {
    if (globalThis.Date === virtual) globalThis.Date = original;
    active = null;
  };
  active = { restore };
  return restore;
}
