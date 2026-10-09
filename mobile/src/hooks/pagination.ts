import type { Page } from "@/api/types/common";

function defaultItemId(item: unknown): string | number | undefined {
  if (item && typeof item === "object" && "id" in item) {
    const id = (item as { id: unknown }).id;
    if (typeof id === "string" || typeof id === "number") return id;
  }
  return undefined;
}

/** Aplana las páginas descartando elementos repetidos (misma `id`). Pura. */
export function flattenPages<T>(pages: readonly Page<T>[], getItemId: (item: T) => string | number | undefined = defaultItemId): T[] {
  const seen = new Set<string | number>();
  const items: T[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      const id = getItemId(item);
      if (id !== undefined) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      items.push(item);
    }
  }
  return items;
}
