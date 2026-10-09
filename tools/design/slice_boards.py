#!/usr/bin/env python3
"""
Trocea las láminas de diseño aprobadas (13 PNG) en pantallas individuales.

Salida (en design/):
  boards/<id>.png            lámina original (sin modificar)
  screens/<NN><v>.png        pantalla normalizada por ANCHO a 786 px (393 pt @2x); la altura es la de la lámina (sin deformar)
  screens-raw/<NN><v>.png    recorte nativo sin reescalar (para muestrear color)
  manifest.json              láminas, variantes, bbox y títulos
Uso: python3 tools/design/slice_boards.py <carpeta-con-las-láminas>
"""
import sys, os, json, shutil
import numpy as np
import cv2

W_PT, H_PT, SCALE = 393, 852, 2

# id de archivo -> (lámina, variante, [números de pantalla])
BOARDS = {
    "e3c876ab": ("01", "",  [1, 2, 3, 4]),
    "0fa52456": ("02", "",  [5, 6, 7, 8]),
    "647e77cf": ("03", "",  [9, 10, 11, 12]),
    "94f0c2a7": ("04", "a", [13, 14, 15, 16]),
    "9946a6cc": ("04", "b", [13, 14, 15, 16]),
    "ef66f2a7": ("05", "",  [17, 18, 19, 20]),
    "4935dd58": ("06", "",  [21, 22, 23, 24]),
    "4b3da40f": ("07", "",  [25, 26, 27, 28]),
    "161c43cd": ("08", "",  [29, 30, 31, 32]),
    "635cb7c8": ("09", "a", [33, 34, 35, 36]),
    "b1e81622": ("09", "b", [33, 34, 35, 36]),
    "2241038a": ("10", "a", [37, 38, 39, 40]),
    "088f251c": ("10", "b", [37, 38, 39, 40]),
}

def find_phones(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    dark = (gray < 60).astype(np.uint8) * 255
    dark[:135, :] = 0
    dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    boxes = [tuple(int(v) for v in stats[i][:4]) for i in range(1, n) if stats[i][2] > 300 and stats[i][3] > 650]
    boxes.sort()
    return boxes, gray

def inner_rect(gray, box):
    """Rectángulo de pantalla: salta el bisel oscuro y su anti-aliasing (mediana de luminancia)."""
    x, y, w, h = box
    y0, y1 = y + int(h * 0.25), y + int(h * 0.75)
    x0, x1 = x + int(w * 0.2), x + int(w * 0.8)
    def first(range_, line_median, thr=150):
        for p in range_:
            if line_median(p) > thr:
                return p
        return range_[0]
    col = lambda p: float(np.median(gray[y0:y1, p]))
    row = lambda p: float(np.median(gray[p, x0:x1]))
    left = first(range(x, x + 40), col)
    right = first(range(x + w - 1, x + w - 41, -1), col)
    top = first(range(y, y + 40), row)
    bottom = first(range(y + h - 1, y + h - 41, -1), row)
    return left + 1, top + 1, right, bottom

def main(src):
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "design")
    root = os.path.abspath(root)
    for d in ("boards", "screens", "screens-raw", "reference"):
        os.makedirs(os.path.join(root, d), exist_ok=True)
    manifest = {"scale": SCALE, "viewport": [W_PT, H_PT], "boards": [], "screens": []}
    for fid, (board, var, nums) in BOARDS.items():
        path = os.path.join(src, f"{fid}-image.png")
        img = cv2.imread(path, cv2.IMREAD_COLOR)
        shutil.copyfile(path, os.path.join(root, "boards", f"{board}{var}.png"))
        boxes, gray = find_phones(img)
        assert len(boxes) == 4, (fid, boxes)
        manifest["boards"].append({"id": fid, "board": f"{board}{var}", "size": list(img.shape[1::-1]), "screens": nums})
        rects = [inner_rect(gray, box) for box in boxes]
        med_h = int(np.median([rb - rt for (_, rt, _, rb) in rects]))
        med_w = int(np.median([rr - rl for (rl, _, rr, _) in rects]))
        for box, num, (l, t, r, b) in zip(boxes, nums, rects):
            r = l + med_w
            b = t + med_h   # las cuatro pantallas de una lámina comparten forma: se usa la mediana
            raw = img[t:b, l:r]
            name = f"{num:02d}{var}"
            cv2.imwrite(os.path.join(root, "screens-raw", f"{name}.png"), raw)
            rw, rh = r - l, b - t
            h_pt = round(rh * W_PT / rw, 1)
            norm = cv2.resize(raw, (W_PT * SCALE, round(h_pt * SCALE)), interpolation=cv2.INTER_LANCZOS4)
            cv2.imwrite(os.path.join(root, "screens", f"{name}.png"), norm)
            ref = cv2.resize(raw, (W_PT, round(h_pt)), interpolation=cv2.INTER_AREA)
            cv2.imwrite(os.path.join(root, "reference", f"{name}.jpg"), ref, [cv2.IMWRITE_JPEG_QUALITY, 88])
            manifest["screens"].append({
                "screen": name, "number": num, "variant": var, "board": f"{board}{var}",
                "bezelBox": list(box), "screenBox": [l, t, r, b],
                "rawSize": [r - l, b - t], "aspect": round((r - l) / (b - t), 4),
                "designHeightPt": h_pt, "ptPerRawPx": round(W_PT / rw, 4),
            })
            print(name, "raw", (r - l, b - t), "aspect", round((r - l) / (b - t), 3))
    with open(os.path.join(root, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)

if __name__ == "__main__":
    main(sys.argv[1])
