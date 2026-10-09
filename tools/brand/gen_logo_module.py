#!/usr/bin/env python3
"""
Genera `mobile/src/brand/logoPaths.ts` a partir de `design/logo/layers.json` (logo oficial vectorizado de forma literal
por `tools/brand/trace_logo.py`). NO redibuja nada: copia las cuatro capas de trazado (`iconBlue`, `iconGreen`,
`wordNavy`, `tagBlue`), sus cajas y los tres colores del logo.

Uso (desde la raíz del repositorio):
    python3 tools/brand/gen_logo_module.py

Es idempotente: ejecutarlo dos veces produce el mismo archivo byte a byte.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "design", "logo", "layers.json")
OUT = os.path.join(ROOT, "mobile", "src", "brand", "logoPaths.ts")

LAYER_ORDER = ["iconBlue", "iconGreen", "wordNavy", "tagBlue"]
BOX_ORDER = ["all", "icon", "word", "tag"]


def ts_string(value: str) -> str:
    # Los trazados solo contienen [MLCZ0-9 .-]; json.dumps garantiza el escape correcto igualmente.
    return json.dumps(value)


def main() -> int:
    with open(SRC, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    missing = [k for k in LAYER_ORDER if k not in data["layers"]] + [k for k in BOX_ORDER if k not in data["boxes"]]
    if missing:
        print(f"layers.json incompleto, faltan: {missing}", file=sys.stderr)
        return 1

    lines = []
    lines.append("/**")
    lines.append(" * GENERADO por tools/brand/gen_logo_module.py a partir de design/logo/layers.json. NO EDITAR A MANO.")
    lines.append(" *")
    lines.append(" * Logo oficial de MVC · Me voy contigo, vectorizado de forma literal (tools/brand/trace_logo.py).")
    lines.append(" * Está prohibido redibujarlo: `MvcLogo` solo coloca y escala estas capas.")
    lines.append(" */")
    lines.append("")
    lines.append("/** Colores del logo oficial. Solo los usa `MvcLogo`; la interfaz usa `theme/colors.ts`. */")
    lines.append("export const logoColors = {")
    for key in ("blue", "green", "navy"):
        lines.append(f"  {key}: {ts_string(data['colors'][key])},")
    lines.append("} as const;")
    lines.append("")
    lines.append("/** Caja `[x, y, ancho, alto]` de cada bloque en las coordenadas de origen de los trazados. */")
    lines.append("export type LogoBox = readonly [number, number, number, number];")
    lines.append("")
    lines.append("export const logoBoxes: Record<\"all\" | \"icon\" | \"word\" | \"tag\", LogoBox> = {")
    for key in BOX_ORDER:
        x, y, w, h = data["boxes"][key]
        lines.append(f"  {key}: [{x}, {y}, {w}, {h}],")
    lines.append("};")
    lines.append("")
    lines.append("/** Trazados SVG (relleno `evenodd`) por capa de color. */")
    lines.append("export const logoPaths = {")
    for key in LAYER_ORDER:
        lines.append(f"  {key}: {ts_string(data['layers'][key])},")
    lines.append("} as const;")
    lines.append("")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))
    size = os.path.getsize(OUT)
    print(f"escrito {os.path.relpath(OUT, ROOT)} ({size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
