/**
 * API pública del módulo `comms` para el resto de módulos y para los trabajos programados.
 * Los demás módulos NO deben importar ficheros internos de `comms`: solo este.
 *
 *  · registerDeletionBlocker / registerExportContributor / registerErasureStep → participar en los derechos sobre los datos
 *    (docs/contracts/comms.md §11).
 *  · getShareLiveLocationInTrip → el módulo de viaje en vivo respeta «Compartir ubicación en viaje».
 *  · isEssentialNotification → para decidir si un aviso puede suprimirse por preferencias.
 *  · runCommsJobsOnce y los trabajos sueltos → cron externo / pruebas.
 */
export {
  getDeletionBlockerProviders,
  getErasureSteps,
  getExportContributors,
  registerDeletionBlocker,
  registerErasureStep,
  registerExportContributor,
  resetCommsRegistries
} from "./registry.js";
export type { DeletionBlocker, DeletionBlockerProvider, ErasureCounts, ErasureStep, ExportContributor } from "./registry.js";
export { getShareLiveLocationInTrip } from "./settings.js";
export { isEssentialNotification } from "./notifications.js";
export { buildUserDataExport, expireDataExports, processQueuedDataExports } from "./data-export.js";
export { collectDeletionBlockers, executeDueAccountDeletions } from "./account-deletion.js";
export { cleanupSupportUploads, runCommsJobsOnce, startCommsJobs } from "./jobs.js";
export type { CommsJobsHandle, CommsJobsSummary } from "./jobs.js";
export type { DataRightsDeps } from "./deps.js";
export type { CommsConfig } from "./config.js";
export { loadCommsConfig } from "./config.js";
export type { ObjectEraser } from "./object-eraser.js";
