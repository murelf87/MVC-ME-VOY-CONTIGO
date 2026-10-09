/**
 * Pruebas de los tokens de diseño (`design/tokens.json` y `mobile/src/theme/*`).
 *
 * Uso (desde la raíz del repositorio):
 *   node_modules/.bin/tsx --test tools/design/gen_tokens.test.cts
 *
 * Comprueban que:
 *  - `design/tokens.json` está generado a partir del código actual (si no, hay que ejecutar `gen_tokens.cts`);
 *  - todo color tiene un valor válido y una procedencia con un origen reconocible (Medido / Ajustado / Derivado /
 *    Valor de proyecto), de modo que ningún valor aparece sin justificar;
 *  - los pares texto/fondo que se usan para texto pequeño cumplen contraste AA (≥ 4,5:1) y los iconos secundarios sobre
 *    blanco ≥ 3:1, salvo las excepciones documentadas más abajo;
 *  - la escala tipográfica es coherente (interlineado ≥ tamaño y cara registrada).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { colors } from "../../mobile/src/theme/colors";
import { fontFaceNames, typeScale } from "../../mobile/src/theme/typeScale";
import { TOKENS_PATH, buildTokens, flattenColors, renderTokens, type ColorTree } from "./gen_tokens.cjs";

const ORIGINS = ["Medido", "Ajustado", "Derivado", "Valor de proyecto"] as const;

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("design/tokens.json está generado desde mobile/src/theme (ejecuta gen_tokens.cts si falla)", () => {
  assert.equal(readFileSync(TOKENS_PATH, "utf8"), renderTokens());
});

test("todos los colores tienen valor válido y procedencia con origen reconocible", () => {
  const tree = buildTokens().color as ColorTree;
  const rows = flattenColors(tree);
  assert.ok(rows.length >= 100, `se esperaban ≥ 100 colores y hay ${rows.length}`);
  for (const [path, token] of rows) {
    assert.match(token.value, /^(#[0-9A-F]{6}|rgba\(\d+, \d+, \d+, 0?\.\d+\))$/, `${path}: valor de color inválido (${token.value})`);
    assert.ok(token.provenance.trim() !== "", `${path}: sin procedencia`);
    assert.ok(
      ORIGINS.some((origin) => token.provenance.startsWith(origin)),
      `${path}: la procedencia debe empezar por ${ORIGINS.join(" / ")} (${token.provenance.slice(0, 60)})`,
    );
  }
});

test("los valores ajustados indican el valor medido original", () => {
  const rows = flattenColors(buildTokens().color as ColorTree);
  for (const [path, token] of rows) {
    if (token.provenance.startsWith("Ajustado")) {
      assert.match(token.provenance, /#[0-9A-F]{6}/, `${path}: un color ajustado debe citar el valor medido`);
    }
  }
});

/** Texto pequeño sobre fondo: debe llegar a 4,5:1. */
const SMALL_TEXT: ReadonlyArray<[string, string, string]> = [
  [colors.heading, colors.bg.screen, "heading sobre blanco"],
  [colors.heading, colors.bg.tint, "heading sobre tint"],
  [colors.heading, colors.info.bg, "heading sobre banda informativa"],
  [colors.heading, colors.bg.avatarTile, "inicial del administrador"],
  [colors.text.strong, colors.bg.screen, "strong sobre blanco"],
  [colors.text.body, colors.bg.screen, "body sobre blanco"],
  [colors.text.body, colors.bg.bubble, "body sobre burbuja"],
  [colors.text.body, colors.info.bg, "body sobre banda informativa"],
  [colors.text.muted, colors.bg.screen, "muted sobre blanco"],
  [colors.text.muted, colors.bg.tint, "muted sobre tint"],
  [colors.text.muted, colors.bg.tintStrong, "muted sobre tintStrong"],
  [colors.text.muted, colors.bg.chip, "muted sobre chip"],
  [colors.text.deep, colors.bg.screen, "deep sobre blanco"],
  [colors.text.deep, colors.info.bg, "deep sobre banda informativa"],
  [colors.text.subtle, colors.bg.screen, "subtle sobre blanco"],
  [colors.text.subtle, colors.bg.tint, "subtle sobre tint"],
  [colors.text.subtle, colors.bg.chip, "subtle sobre chip"],
  [colors.text.stepIdle, colors.bg.screen, "stepIdle sobre blanco"],
  [colors.text.placeholder, colors.bg.screen, "placeholder sobre blanco"],
  [colors.text.placeholder, colors.bg.chip, "placeholder sobre chip"],
  [colors.text.time, colors.bg.bubble, "hora de mensaje sobre burbuja"],
  [colors.text.link, colors.bg.screen, "enlace sobre blanco"],
  [colors.text.link, colors.bg.tint, "enlace sobre tint"],
  [colors.primary, colors.bg.screen, "primary sobre blanco"],
  [colors.primary, colors.bg.chip, "primary sobre chip"],
  [colors.primary, colors.bg.tintStrong, "primary sobre tintStrong"],
  [colors.onPrimary, colors.primary, "blanco sobre primary"],
  [colors.onPrimary, colors.primaryPressed, "blanco sobre primary pulsado"],
  [colors.onPrimary, colors.error.solid, "blanco sobre error.solid"],
  [colors.success.text, colors.success.bg, "success.text sobre su fondo"],
  [colors.success.strong, colors.success.bg, "success.strong sobre su fondo"],
  [colors.warning.text, colors.warning.bg, "warning.text sobre su fondo"],
  [colors.warning.text, colors.warning.bgSoft, "warning.text sobre fondo suave"],
  [colors.warning.textStrong, colors.amber.bg, "warning.textStrong sobre ámbar"],
  [colors.warning.textStrong, colors.notice.bg, "warning.textStrong sobre aviso"],
  [colors.warning.title, colors.warning.bg, "título de aviso"],
  [colors.error.text, colors.error.bg, "error.text sobre su fondo"],
  [colors.error.text, colors.bg.screen, "error.text sobre blanco"],
  [colors.error.strong, colors.error.bg, "error.strong sobre su fondo"],
  [colors.notice.title, colors.notice.bg, "título de aviso fuerte"],
  [colors.notice.detail, colors.notice.bg, "detalle de aviso fuerte"],
  [colors.empty.text, colors.empty.bg, "texto de estado vacío"],
  [colors.nav.labelInactive, colors.bg.screen, "etiqueta inactiva de la barra"],
  [colors.pill.green.fg, colors.pill.green.bg, "píldora verde"],
  [colors.pill.amber.fg, colors.pill.amber.bg, "píldora ámbar"],
  [colors.pill.orange.fg, colors.pill.orange.bg, "píldora naranja"],
  [colors.pill.red.fg, colors.pill.red.bg, "píldora roja"],
  [colors.pill.blue.fg, colors.pill.blue.bg, "píldora azul"],
  [colors.pill.gray.fg, colors.pill.gray.bg, "píldora gris"],
  [colors.soft.green.fg, colors.soft.green.bg, "botón suave verde"],
  [colors.soft.red.fg, colors.soft.red.bg, "botón suave rojo"],
];

test("el texto pequeño cumple contraste AA (≥ 4,5:1)", () => {
  const failures: string[] = [];
  for (const [foreground, background, name] of SMALL_TEXT) {
    const ratio = contrast(foreground, background);
    if (ratio < 4.5) failures.push(`${name}: ${foreground} sobre ${background} = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, []);
});

/**
 * Excepciones documentadas (no se exige 4,5:1):
 *  - `text.disabled` y `daypill.mutedText`: elementos desactivados o de solo lectura, exentos por WCAG 1.4.3.
 *  - Blanco sobre `success.button` (20 «Aceptar»): 2,4:1 heredado de la lámina; texto grande en negrita. Decisión de
 *    diseño pendiente (se propone #0E9F72, 3,4:1); no se cambia sin acuerdo para no apartarse de la lámina aprobada.
 * Esta prueba fija los valores actuales para que un cambio de token que los empeore no pase desapercibido.
 */
test("las excepciones de contraste documentadas siguen siendo las conocidas", () => {
  assert.ok(contrast(colors.onPrimary, colors.success.button) > 2.3 && contrast(colors.onPrimary, colors.success.button) < 2.5);
  assert.ok(contrast(colors.text.disabled, colors.bg.screen) < 3);
  assert.ok(contrast(colors.daypill.mutedText, colors.daypill.mutedBg) < 3);
});

test("los iconos secundarios sobre blanco cumplen ≥ 3:1", () => {
  for (const [name, value] of [
    ["gray.icon", colors.gray.icon],
    ["gray.help", colors.gray.help],
  ] as const) {
    const ratio = contrast(value, colors.bg.screen);
    assert.ok(ratio >= 3, `${name}: ${ratio.toFixed(2)}:1`);
  }
});

test("la escala tipográfica es coherente", () => {
  const faces = new Set(Object.keys(fontFaceNames));
  for (const [name, spec] of Object.entries(typeScale)) {
    assert.ok(faces.has(spec.face), `${name}: cara desconocida ${spec.face}`);
    assert.ok(spec.lineHeight >= spec.size, `${name}: interlineado menor que el tamaño`);
    assert.ok(spec.size >= 12 && spec.size <= 60, `${name}: tamaño fuera de rango (${spec.size})`);
    assert.ok(spec.note.length > 10, `${name}: sin nota de medición`);
  }
});
