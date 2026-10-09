/**
 * Genera `design/tokens.json` a partir de `mobile/src/theme/*` (que es la ÚNICA fuente de verdad: este fichero no
 * contiene ningún valor propio). Cada color lleva su procedencia (el comentario que lo acompaña en `colors.ts`, es
 * decir, cómo se midió sobre las láminas) y cada variante tipográfica la nota de dónde se midió.
 *
 * Uso (desde la raíz del repositorio):
 *   node_modules/.bin/tsx tools/design/gen_tokens.cts           # escribe design/tokens.json
 *   node_modules/.bin/tsx tools/design/gen_tokens.cts --check   # falla si design/tokens.json está desfasado
 *
 * Es un módulo CommonJS (`.cts`) a propósito: `mobile/` es CommonJS y así los `import` nombrados de sus `.ts` funcionan.
 *
 * Es idempotente y determinista (sin fechas): ejecutarlo dos veces produce el mismo archivo byte a byte.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { colors } from "../../mobile/src/theme/colors";
import { avatarSizes, layout, radii, shadows, sizes, spacing } from "../../mobile/src/theme/layout";
import { MAX_FONT_SIZE_MULTIPLIER, fontFaceNames, typeScale } from "../../mobile/src/theme/typeScale";

const ROOT = resolve(__dirname, "..", "..");
export const TOKENS_PATH = resolve(ROOT, "design", "tokens.json");
const COLORS_SOURCE = resolve(ROOT, "mobile", "src", "theme", "colors.ts");

export interface ColorToken {
  value: string;
  provenance: string;
}
export interface ColorTree {
  [key: string]: ColorToken | ColorTree;
}

function cleanComment(raw: string): string {
  return raw
    .replace(/^\s*\/\*\*?/, "")
    .replace(/\*\/\s*$/, "")
    .replace(/^\s*\*\s?/, "")
    .replace(/^\s*\/\/\s?/, "")
    .trim();
}

/**
 * Lee `colors.ts` y devuelve, para cada ruta de color (`text.body`), el comentario que lo precede (o, en su defecto, el
 * del grupo al que pertenece). Es un análisis por líneas sobre el formato que tiene ese fichero; si se rompe, la
 * prueba de cobertura de procedencia falla en vez de generar un JSON sin justificar.
 */
export function parseColorProvenance(source: string): Map<string, string> {
  const result = new Map<string, string>();
  const groupDescriptions = new Map<string, string>();
  const stack: string[] = [];
  let buffer: string[] = [];
  let inBlock = false;
  let blockLines: string[] = [];

  const pathOf = (key: string): string => [...stack, key].join(".");
  const nearestGroup = (): string => {
    for (let depth = stack.length; depth >= 1; depth -= 1) {
      const text = groupDescriptions.get(stack.slice(0, depth).join("."));
      if (text !== undefined && text !== "") return text;
    }
    return "";
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (inBlock) {
      blockLines.push(cleanComment(line));
      if (line.includes("*/")) {
        inBlock = false;
        buffer.push(blockLines.filter(Boolean).join(" "));
        blockLines = [];
      }
      continue;
    }
    if (line === "") {
      buffer = [];
      continue;
    }
    if (line.startsWith("/**") || line.startsWith("/*")) {
      if (line.includes("*/")) {
        buffer.push(cleanComment(line));
      } else {
        inBlock = true;
        blockLines = [cleanComment(line)];
      }
      continue;
    }
    if (line.startsWith("//")) {
      buffer.push(cleanComment(line));
      continue;
    }
    if (/^export const brand = \{/.test(line)) {
      stack.length = 0;
      stack.push("brand");
      groupDescriptions.set("brand", buffer.join(" "));
      buffer = [];
      continue;
    }
    if (/^export const colors = \{/.test(line)) {
      stack.length = 0;
      buffer = [];
      continue;
    }
    const group = /^(\w+): \{/.exec(line);
    if (group !== null && group[1] !== undefined) {
      groupDescriptions.set(pathOf(group[1]), buffer.join(" "));
      stack.push(group[1]);
      buffer = [];
      continue;
    }
    if (/^\}/.test(line)) {
      stack.pop();
      buffer = [];
      continue;
    }
    const leaf = /^(\w+): "([^"]+)",?\s*(?:\/\*\*(.*?)\*\/)?\s*$/.exec(line);
    if (leaf !== null && leaf[1] !== undefined) {
      const inline = leaf[3] !== undefined ? cleanComment(`/**${leaf[3]}*/`) : "";
      const own = [...buffer, inline].filter(Boolean).join(" ");
      result.set(pathOf(leaf[1]), own !== "" ? own : nearestGroup());
      buffer = [];
      continue;
    }
    buffer = [];
  }
  return result;
}

function colorTree(node: unknown, prefix: string[], provenance: Map<string, string>): ColorTree | ColorToken {
  if (typeof node === "string") {
    return { value: node, provenance: provenance.get(prefix.join(".")) ?? "" };
  }
  const out: ColorTree = {};
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    out[key] = colorTree(child, [...prefix, key], provenance);
  }
  return out;
}

/** Aplana el árbol de colores a `ruta → token` (para las pruebas y para la documentación). */
export function flattenColors(tree: ColorTree, prefix: string[] = []): Array<[string, ColorToken]> {
  const rows: Array<[string, ColorToken]> = [];
  for (const [key, child] of Object.entries(tree)) {
    const path = [...prefix, key];
    if (typeof (child as ColorToken).value === "string") rows.push([path.join("."), child as ColorToken]);
    else rows.push(...flattenColors(child as ColorTree, path));
  }
  return rows;
}

export function buildTokens(): Record<string, unknown> {
  const provenance = parseColorProvenance(readFileSync(COLORS_SOURCE, "utf8"));
  const typography: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(typeScale)) {
    typography[name] = {
      fontFamily: fontFaceNames[spec.face],
      fontSize: spec.size,
      lineHeight: spec.lineHeight,
      letterSpacingEm: spec.letterSpacingEm,
      letterSpacing: Math.round(spec.letterSpacingEm * spec.size * 100) / 100,
      provenance: spec.note,
    };
  }
  return {
    $description:
      "Tokens de diseño de MVC · Me voy contigo (solo tema claro). GENERADO por tools/design/gen_tokens.cts desde mobile/src/theme/*: no editar a mano. Las medidas salen de las láminas aprobadas (design/screens-raw; 1 pt = 2 px en design/screens); ver docs/DESIGN_SYSTEM.md.",
    $units: "Tamaños y radios en pt (puntos de diseño de 393 pt de ancho); letterSpacingEm en em; letterSpacing en pt.",
    color: colorTree(colors, [], provenance),
    typography: {
      maxFontSizeMultiplier: MAX_FONT_SIZE_MULTIPLIER,
      fontFaces: fontFaceNames,
      variants: typography,
    },
    spacing,
    radius: radii,
    layout,
    size: sizes,
    avatarSize: avatarSizes,
    shadow: shadows,
  };
}

export function renderTokens(): string {
  return `${JSON.stringify(buildTokens(), null, 2)}\n`;
}

function main(): number {
  const text = renderTokens();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(TOKENS_PATH, "utf8");
    } catch {
      current = "";
    }
    if (current !== text) {
      process.stderr.write("design/tokens.json está desfasado: ejecuta `node_modules/.bin/tsx tools/design/gen_tokens.cts`.\n");
      return 1;
    }
    process.stdout.write("design/tokens.json está al día.\n");
    return 0;
  }
  writeFileSync(TOKENS_PATH, text, "utf8");
  process.stdout.write(`escrito design/tokens.json (${Buffer.byteLength(text)} bytes)\n`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
