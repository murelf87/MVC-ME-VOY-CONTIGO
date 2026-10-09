/**
 * Relevo entre `PermissionPrompt` y la pantalla que lo abrió. Los parámetros de navegación solo llevan datos
 * serializables, así que el resultado («concedido», «denegado»…) se deja aquí y la pantalla de origen lo recoge al
 * recuperar el foco para continuar justo donde estaba (p. ej. abrir la cámara tras conceder el permiso).
 */
export type PromptKind = "location" | "notifications" | "camera" | "photos";
export type PromptOutcome = "granted" | "denied" | "blocked" | "skipped" | "unavailable";

const pending = new Map<PromptKind, PromptOutcome>();

export function setPromptOutcome(kind: PromptKind, outcome: PromptOutcome): void {
  pending.set(kind, outcome);
}

/** Devuelve y olvida el resultado pendiente de ese permiso (o `null`). */
export function takePromptOutcome(kind: PromptKind): PromptOutcome | null {
  const outcome = pending.get(kind) ?? null;
  pending.delete(kind);
  return outcome;
}
