#!/usr/bin/env python3
"""
Genera los PNG de marca de la app a partir del logo oficial vectorizado (design/logo/layers.json), sin redibujarlo:
solo se rasterizan, con suavizado, los mismos trazados que usa `MvcLogo`.

Salida en `mobile/assets/brand/`:
  icon.png               1024x1024  Icono de iOS: icono oficial sobre blanco, sin transparencia.
  adaptive-icon.png      1024x1024  Primer plano del icono adaptable de Android (fondo transparente; el dibujo ocupa
                                    el 56 % central: cabe en la zona segura del 66 % de cualquier máscara).
  splash.png             1024x1024  Logo apilado (icono + MVC + «Me voy contigo») sobre transparente. Pensado para
                                    `backgroundColor: "#FFFFFF"` y `resizeMode: "contain"`.
  favicon.png            48x48      Icono sobre transparente.
  notification-icon.png  96x96      Silueta blanca monocroma sobre transparente (icono de notificación de Android).

Uso (desde la raíz del repositorio):  python3 tools/brand/gen_brand_assets.py
Requiere: Pillow y NumPy. El rasterizador (curvas de Bézier cúbicas + relleno par-impar por XOR de subtrazados) solo
admite los comandos M/L/C/Z que produce potrace.
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "design", "logo", "layers.json")
OUT_DIR = os.path.join(ROOT, "mobile", "assets", "brand")

# Misma composición apilada que mobile/src/brand/MvcLogo.tsx
STACKED_ICON_SCALE = 1.118
STACKED_GAP = 8.1

TOKEN = re.compile(r"[MLCZ]|-?\d+(?:\.\d+)?")


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def parse_subpaths(d):
    """Devuelve una lista de subtrazados; cada uno es una lista de puntos (x, y) con las curvas aplanadas."""
    tokens = TOKEN.findall(d)
    i = 0
    subpaths = []
    current = []
    cmd = None
    pos = (0.0, 0.0)

    def num():
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    while i < len(tokens):
        t = tokens[i]
        if t in "MLCZ":
            cmd = t
            i += 1
            if cmd == "Z":
                if current:
                    subpaths.append(current)
                current = []
                continue
        if cmd == "M":
            if current:
                subpaths.append(current)
            pos = (num(), num())
            current = [pos]
            cmd = "L"  # los pares siguientes tras M son líneas
        elif cmd == "L":
            pos = (num(), num())
            current.append(pos)
        elif cmd == "C":
            c1 = (num(), num())
            c2 = (num(), num())
            end = (num(), num())
            p0 = pos
            steps = 14
            for s in range(1, steps + 1):
                u = s / steps
                a = (1 - u) ** 3
                b = 3 * (1 - u) ** 2 * u
                c = 3 * (1 - u) * u**2
                e = u**3
                current.append(
                    (
                        a * p0[0] + b * c1[0] + c * c2[0] + e * end[0],
                        a * p0[1] + b * c1[1] + c * c2[1] + e * end[1],
                    )
                )
            pos = end
        else:
            raise ValueError(f"comando no admitido: {cmd}")
    if current:
        subpaths.append(current)
    return subpaths


def raster_layer(subpaths, size, transform, ss):
    """Máscara booleana (par-impar) de un trazado en un lienzo de `size` px a `ss`x de sobremuestreo."""
    w, h = size
    mask = np.zeros((h * ss, w * ss), dtype=bool)
    sx, sy, tx, ty = transform
    for sub in subpaths:
        pts = [((x * sx + tx) * ss, (y * sy + ty) * ss) for x, y in sub]
        if len(pts) < 3:
            continue
        layer = Image.new("L", (w * ss, h * ss), 0)
        ImageDraw.Draw(layer).polygon(pts, fill=255)
        mask ^= np.asarray(layer, dtype=bool)
    return mask


def downsample(mask, ss):
    h, w = mask.shape[0] // ss, mask.shape[1] // ss
    return mask.reshape(h, ss, w, ss).mean(axis=(1, 3))


def compose(items, size, background=None, ss=4):
    """items: lista de (subpaths, color_rgb, transform). Devuelve imagen RGBA (o RGB si hay fondo opaco)."""
    w, h = size
    if background is None:
        canvas = np.zeros((h, w, 4), dtype=float)
    else:
        canvas = np.zeros((h, w, 4), dtype=float)
        canvas[..., :3] = background
        canvas[..., 3] = 1.0
    for subpaths, color, transform in items:
        alpha = downsample(raster_layer(subpaths, size, transform, ss), ss)[..., None]
        rgb = np.array(color, dtype=float)[None, None, :]
        if background is None:
            out_a = alpha + canvas[..., 3:4] * (1 - alpha)
            safe = np.where(out_a == 0, 1, out_a)
            canvas[..., :3] = (rgb * alpha + canvas[..., :3] * canvas[..., 3:4] * (1 - alpha)) / safe
            canvas[..., 3:4] = out_a
        else:
            canvas[..., :3] = rgb * alpha + canvas[..., :3] * (1 - alpha)
    canvas[..., 3] *= 255.0  # el alfa se acumuló en 0..1
    img = np.clip(np.rint(canvas), 0, 255).astype(np.uint8)
    return Image.fromarray(img, "RGBA")


def main():
    with open(SRC, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    boxes, colors = data["boxes"], data["colors"]
    blue, green, navy = hex_rgb(colors["blue"]), hex_rgb(colors["green"]), hex_rgb(colors["navy"])
    sub = {k: parse_subpaths(v) for k, v in data["layers"].items()}

    ix, iy, iw, ih = boxes["icon"]

    def icon_items(box_w, offset_x, offset_y, scale, color=None):
        """Capas del icono: la esquina (ix, iy) va a (offset_x, offset_y) y todo se escala `scale`."""
        transform = (scale, scale, offset_x - ix * scale, offset_y - iy * scale)
        return [
            (sub["iconBlue"], color or blue, transform),
            (sub["iconGreen"], color or green, transform),
        ]

    os.makedirs(OUT_DIR, exist_ok=True)

    def centered_icon(canvas, fraction, color=None, bg=None, ss=4):
        """Icono centrado que ocupa `fraction` del ancho del lienzo."""
        scale = canvas * fraction / iw
        off_x = (canvas - iw * scale) / 2
        off_y = (canvas - ih * scale) / 2
        return compose(icon_items(iw, off_x, off_y, scale, color), (canvas, canvas), bg, ss)

    # icon.png (iOS, opaco): el icono ocupa el 72 % del ancho sobre blanco
    icon = centered_icon(1024, 0.72, bg=(255, 255, 255), ss=3).convert("RGB")
    icon.save(os.path.join(OUT_DIR, "icon.png"), optimize=True)

    # adaptive-icon.png (Android, transparente): zona segura = 66 % central; el dibujo ocupa el 56 %
    centered_icon(1024, 0.56, ss=3).save(os.path.join(OUT_DIR, "adaptive-icon.png"), optimize=True)

    # favicon.png
    centered_icon(48, 0.92, ss=8).save(os.path.join(OUT_DIR, "favicon.png"), optimize=True)

    # notification-icon.png (blanco monocromo)
    centered_icon(96, 0.86, color=(255, 255, 255), ss=8).save(os.path.join(OUT_DIR, "notification-icon.png"), optimize=True)

    # splash.png: logo apilado centrado; el bloque ocupa el 44 % del ancho (cabe en la máscara circular de Android 12)
    wx, wy, ww, wh = boxes["word"]
    tx_, ty_, tw, th = boxes["tag"]
    block_x, block_y = min(wx, tx_), wy
    block_w = max(wx + ww, tx_ + tw) - block_x
    block_h = ty_ + th - wy
    stacked_icon_w, stacked_icon_h = iw * STACKED_ICON_SCALE, ih * STACKED_ICON_SCALE
    stacked_w = max(stacked_icon_w, block_w)
    stacked_h = stacked_icon_h + STACKED_GAP + block_h
    canvas = 1024
    unit = canvas * 0.44 / stacked_w  # píxeles por unidad de origen
    left = (canvas - stacked_w * unit) / 2
    top = (canvas - stacked_h * unit) / 2
    icon_scale = unit * STACKED_ICON_SCALE
    items = icon_items(iw, left + (stacked_w - stacked_icon_w) * unit / 2, top, icon_scale)
    block_tx = left + (stacked_w - block_w) * unit / 2 - block_x * unit
    block_ty = top + (stacked_icon_h + STACKED_GAP) * unit - block_y * unit
    block_transform = (unit, unit, block_tx, block_ty)
    items.append((sub["wordNavy"], navy, block_transform))
    items.append((sub["tagBlue"], blue, block_transform))
    compose(items, (canvas, canvas), None, 3).save(os.path.join(OUT_DIR, "splash.png"), optimize=True)

    for name in ("icon.png", "adaptive-icon.png", "splash.png", "favicon.png", "notification-icon.png"):
        path = os.path.join(OUT_DIR, name)
        with Image.open(path) as im:
            print(f"{os.path.relpath(path, ROOT)}: {im.size[0]}x{im.size[1]} {im.mode} {os.path.getsize(path)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
