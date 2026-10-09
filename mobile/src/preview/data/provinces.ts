/**
 * Provincia(s) de la vista previa. SIMULACIÓN: el contorno es un polígono grosero y NO oficial (unos 20 vértices)
 * dibujado a mano para que «dentro / fuera de provincia» se comporte de forma verosímil en el mapa de Sevilla. El
 * backend real importa el contorno oficial del IGN/CNIG (`src/geo/province-import.ts`).
 */
import { stableUuid } from "../core/ids";
import type { ProvinceRow } from "../core/rows";

/** Mismo id que usan los ejemplos de `docs/contracts/trips.md`. */
export const SEVILLA_PROVINCE_ID = "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001";

export const SEVILLA_RING: ReadonlyArray<[number, number]> = [
  [-6.4, 37.18],
  [-6.38, 37.5],
  [-6.28, 37.78],
  [-6.05, 37.98],
  [-5.85, 38.14],
  [-5.55, 38.1],
  [-5.3, 37.95],
  [-5.25, 37.78],
  [-5.1, 37.62],
  [-4.95, 37.5],
  [-4.82, 37.3],
  [-4.85, 37.12],
  [-5.05, 36.95],
  [-5.3, 36.88],
  [-5.6, 36.95],
  [-5.85, 36.82],
  [-6.12, 36.82],
  [-6.2, 36.95],
  [-6.35, 37.05],
  [-6.4, 37.18],
];

export function sevillaProvince(): ProvinceRow {
  return {
    id: SEVILLA_PROVINCE_ID,
    code: "41",
    name: "Sevilla",
    source_name: "Vista previa (contorno simplificado)",
    source_url: "https://example.invalid",
    source_date: "2026-10-04",
    source_license: "solo simulación",
    ring: SEVILLA_RING.map(([lng, lat]) => [lng, lat] as [number, number]),
  };
}

/** Id estable de cualquier otra provincia que un escenario quiera añadir. */
export function provinceIdFor(code: string): string {
  return code === "41" ? SEVILLA_PROVINCE_ID : stableUuid(`province:${code}`);
}
