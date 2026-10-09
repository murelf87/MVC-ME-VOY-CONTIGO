#!/usr/bin/env python3
"""
Vectoriza de forma literal el logo oficial de MVC a partir del recorte de cabecera de la lámina.
No se redibuja nada: cada capa de color se segmenta del raster y se traza con potrace.

Uso: python3 tools/brand/trace_logo.py design/logo-src/header-01.png design/logo
Salida: layers.json (paths por capa), mvc-logo.svg, mvc-icon.svg, mvc-wordmark.svg, preview PNG y diff.
"""
import sys, os, json
import numpy as np
import cv2
import potrace

UP = 8  # factor de sobremuestreo antes de segmentar/trazar

PALETTE = {
    "bg":    (253, 253, 253),
    "blue":  (4, 77, 253),
    "green": (38, 205, 161),
    "navy":  (0, 9, 40),
}

def classify(rgb_up):
    h, w = rgb_up.shape[:2]
    flat = rgb_up.reshape(-1, 3).astype(np.float32)
    names = list(PALETTE)
    d = np.stack([np.linalg.norm(flat - np.array(PALETTE[n], np.float32), axis=1) for n in names], axis=1)
    return d.argmin(axis=1).reshape(h, w), names

def trace_mask(mask, turdsize, opttol, alphamax=1.0):
    bm = potrace.Bitmap(~mask.astype(bool))  # potracer invierte internamente: True = fondo
    plist = bm.trace(turdsize=turdsize, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
                     alphamax=alphamax, opticurve=True, opttolerance=opttol)
    parts = []
    f = lambda p: f"{p.x / UP:.2f} {p.y / UP:.2f}"
    for curve in plist:
        parts.append("M" + f(curve.start_point))
        for seg in curve.segments:
            if seg.is_corner:
                parts.append("L" + f(seg.c) + " " + f(seg.end_point))
            else:
                parts.append("C" + f(seg.c1) + " " + f(seg.c2) + " " + f(seg.end_point))
        parts.append("Z")
    return "".join(parts)

def main(src, outdir):
    os.makedirs(outdir, exist_ok=True)
    bgr = cv2.imread(src, cv2.IMREAD_COLOR)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    up = cv2.resize(rgb, (w * UP, h * UP), interpolation=cv2.INTER_CUBIC)
    up = cv2.GaussianBlur(up, (0, 0), UP * 0.35)
    cls, names = classify(up)
    idx = {n: i for i, n in enumerate(names)}
    # región del icono vs. texto (en px del recorte original)
    split_x = 238 * UP
    xs = np.arange(w * UP)[None, :].repeat(h * UP, axis=0)
    layers = {}
    def clean(m, min_area):
        m = (m.astype(np.uint8)) * 255
        n, lab, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        out = np.zeros_like(m)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= min_area:
                out[lab == i] = 255
        return out > 0
    minA = (3 * UP) ** 2
    layers["iconBlue"]  = trace_mask(clean((cls == idx["blue"]) & (xs < split_x), minA), 4, 0.6)
    layers["iconGreen"] = trace_mask(clean((cls == idx["green"]) & (xs < split_x), minA), 4, 0.6)
    layers["wordNavy"]  = trace_mask(clean((cls == idx["navy"]) & (xs >= split_x), minA), 4, 0.6)
    layers["tagBlue"]   = trace_mask(clean((cls == idx["blue"]) & (xs >= split_x), minA), 4, 0.5)

    # recorte ajustado (bbox de todo lo que no es fondo)
    ink = clean(cls != idx["bg"], minA)
    ys, xs2 = np.where(ink)
    x0, y0, x1, y1 = xs2.min() / UP, ys.min() / UP, xs2.max() / UP, ys.max() / UP
    pad = 0.0
    bbox = [round(x0 - pad, 2), round(y0 - pad, 2), round(x1 - x0 + 2 * pad, 2), round(y1 - y0 + 2 * pad, 2)]
    # bboxes por bloque (útil para variante vertical)
    def bbox_of(mask):
        ys, xs = np.where(mask)
        return [round(xs.min() / UP, 2), round(ys.min() / UP, 2), round((xs.max() - xs.min()) / UP, 2), round((ys.max() - ys.min()) / UP, 2)]
    icon_mask = clean(((cls == idx["blue"]) | (cls == idx["green"])) & (xs < split_x), minA)
    word_mask = clean(cls == idx["navy"], minA)
    tag_mask = clean((cls == idx["blue"]) & (xs >= split_x), minA)
    boxes = {"all": bbox, "icon": bbox_of(icon_mask), "word": bbox_of(word_mask), "tag": bbox_of(tag_mask)}
    colors = {"blue": "#%02X%02X%02X" % PALETTE["blue"], "green": "#%02X%02X%02X" % PALETTE["green"], "navy": "#%02X%02X%02X" % PALETTE["navy"]}
    json.dump({"viewBoxSource": [w, h], "boxes": boxes, "colors": colors, "layers": layers}, open(os.path.join(outdir, "layers.json"), "w"), indent=1)

    def svg(vb, body):
        x, y, bw, bh = vb
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {bw} {bh}" width="{bw}" height="{bh}">{body}</svg>'
    P = lambda key, col: f'<path fill="{col}" fill-rule="evenodd" d="{layers[key]}"/>'
    full = P("iconBlue", colors["blue"]) + P("iconGreen", colors["green"]) + P("wordNavy", colors["navy"]) + P("tagBlue", colors["blue"])
    open(os.path.join(outdir, "mvc-logo.svg"), "w").write(svg(boxes["all"], full))
    open(os.path.join(outdir, "mvc-icon.svg"), "w").write(svg(boxes["icon"], P("iconBlue", colors["blue"]) + P("iconGreen", colors["green"])))
    ww = [boxes["word"][0], boxes["word"][1], boxes["word"][2], boxes["word"][3]]
    open(os.path.join(outdir, "mvc-word.svg"), "w").write(svg(ww, P("wordNavy", colors["navy"])))
    print("bbox", boxes)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
