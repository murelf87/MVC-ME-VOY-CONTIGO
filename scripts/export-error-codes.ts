import fs from "node:fs/promises";
import { HTTP_LAYER_ERRORS, collectDomainErrors } from "../src/contracts/error-catalog.js";

// Regenerates docs/ERRORS.md from the source so the catalogue never drifts from what the API returns.
const entries = collectDomainErrors("src");
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\$\{[^}]+\}/g, "…");
const lines = [
  "# Códigos de error de la API",
  "",
  "Generado con `npm run errors` a partir del código; no editar a mano.",
  "",
  "Todas las respuestas de error tienen la forma `{ \"error\": { \"code\", \"message\", \"details\"? }, \"requestId\" }`.",
  "La app decide qué mostrar por `code`, que es estable; `message` es para depuración y puede cambiar.",
  "Cada código va siempre con el mismo estado HTTP (lo comprueba `tests/error-catalog.test.ts`).",
  "",
  "## Capa HTTP",
  "",
  "| Código | HTTP | Significado |",
  "|---|---|---|",
  ...HTTP_LAYER_ERRORS.map(e => `| \`${e.code}\` | ${e.status} | ${e.message} |`),
  "",
  `## Dominio (${entries.length} códigos)`,
  "",
  "| Código | HTTP | Mensaje | Dónde |",
  "|---|---|---|---|",
  ...entries.map(e => `| \`${e.code}\` | ${e.statuses.join(", ")} | ${esc(e.messages.join(" / "))} | ${e.files.join(", ")} |`),
  ""
];
await fs.writeFile("docs/ERRORS.md", lines.join("\n"));
console.log(`docs/ERRORS.md: ${entries.length} domain codes`);
