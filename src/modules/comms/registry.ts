import type { PoolClient } from "pg";
import type { Queryable } from "./common.js";

/**
 * Puntos de extensión para que otros módulos (money, trips, live, trust…) participen en los derechos sobre los datos
 * sin que `comms` conozca sus tablas. Se registran una vez al arrancar el módulo propietario (por nombre: registrar
 * dos veces con el mismo nombre sustituye al anterior).
 */

export type DeletionBlocker = { code: string; message: string; count: number };

/** Condición que impide eliminar la cuenta ahora (pagos pendientes, disputas abiertas, liquidaciones al conductor…). */
export type DeletionBlockerProvider = {
  name: string;
  check(db: Queryable, userId: string): Promise<DeletionBlocker[]>;
};

/** Sección extra del archivo de exportación (solo datos del propio usuario). Se incluye bajo `modules.<name>`. */
export type ExportContributor = {
  name: string;
  build(db: Queryable, userId: string): Promise<unknown>;
};

export type ErasureCounts = Record<string, number>;

/** Paso de borrado/anonimización de un módulo, ejecutado dentro de la transacción de la eliminación de cuenta. */
export type ErasureStep = {
  name: string;
  /** Claves de objetos privados del módulo que deben borrarse del almacenamiento ANTES de anonimizar. */
  storageKeys?(db: Queryable, userId: string): Promise<string[]>;
  run(db: PoolClient, userId: string): Promise<ErasureCounts | void>;
};

const blockerProviders = new Map<string, DeletionBlockerProvider>();
const exportContributors = new Map<string, ExportContributor>();
const erasureSteps = new Map<string, ErasureStep>();

export function registerDeletionBlocker(provider: DeletionBlockerProvider): void {
  blockerProviders.set(provider.name, provider);
}

export function registerExportContributor(contributor: ExportContributor): void {
  exportContributors.set(contributor.name, contributor);
}

export function registerErasureStep(step: ErasureStep): void {
  erasureSteps.set(step.name, step);
}

export function getDeletionBlockerProviders(): DeletionBlockerProvider[] {
  return [...blockerProviders.values()];
}

export function getExportContributors(): ExportContributor[] {
  return [...exportContributors.values()];
}

export function getErasureSteps(): ErasureStep[] {
  return [...erasureSteps.values()];
}

/** Solo para pruebas: deja los registros vacíos. */
export function resetCommsRegistries(): void {
  blockerProviders.clear();
  exportContributors.clear();
  erasureSteps.clear();
}

/**
 * Secciones de otros módulos que el archivo de exportación debe incluir pero que todavía no se han integrado:
 * se listan en `notIncluded` hasta que el módulo registre su `ExportContributor` con ese nombre.
 */
export const KNOWN_EXTERNAL_EXPORT_SECTIONS: ReadonlyArray<{ name: string; section: string; reason: string }> = [
  { name: "money", section: "Pagos, reembolsos, recibos y liquidaciones", reason: "El módulo de pagos todavía no aporta su sección a la exportación." },
  { name: "live", section: "Valoraciones, incidencias de viaje y enlaces de viaje compartido", reason: "El módulo de viaje en vivo todavía no aporta su sección a la exportación." },
  { name: "trips", section: "Lugares favoritos, rutina y reservas semanales", reason: "El módulo de viajes todavía no aporta su sección a la exportación." },
  { name: "trust", section: "Revisión de identidad, fotos de perfil y aceptación de textos legales", reason: "El módulo de confianza y seguridad todavía no aporta su sección a la exportación." }
];
