import fs from "node:fs";
import path from "node:path";

/** Codes the HTTP layer itself returns, outside any DomainError. */
export const HTTP_LAYER_ERRORS = [
  { code: "VALIDATION_ERROR", status: 400, message: "Request body, query or params do not match the schema" },
  { code: "RATE_LIMITED", status: 429, message: "Too many requests" },
  { code: "HTTP_ERROR", status: 400, message: "Other 4xx raised by Fastify (malformed JSON, unsupported media type…)" },
  { code: "INTERNAL_ERROR", status: 500, message: "Internal server error" }
] as const;

export type CatalogEntry = { code: string; statuses: number[]; messages: string[]; files: string[] };

/**
 * Reads every `new DomainError("CODE", "message", status)` in the source tree.
 * Clients branch on `error.code`, so a code must always come with the same HTTP status.
 */
export function collectDomainErrors(srcDir: string): CatalogEntry[] {
  const pattern = /DomainError\(\s*"([A-Z0-9_]+)"\s*,\s*(`[^`]*`|"[^"]*")\s*(?:,\s*(\d{3}))?/g;
  const byCode = new Map<string, { statuses: Set<number>; messages: Set<string>; files: Set<string> }>();
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []);
  for (const file of walk(srcDir)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(pattern)) {
      const code = m[1]!;
      const entry = byCode.get(code) ?? { statuses: new Set(), messages: new Set(), files: new Set() };
      entry.statuses.add(Number(m[3] ?? 400));
      entry.messages.add(m[2]!.slice(1, -1));
      entry.files.add(path.relative(srcDir, file));
      byCode.set(code, entry);
    }
  }
  return [...byCode.entries()]
    .map(([code, e]) => ({ code, statuses: [...e.statuses].sort(), messages: [...e.messages], files: [...e.files].sort() }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
