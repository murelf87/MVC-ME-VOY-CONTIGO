#!/usr/bin/env python3
"""
Recorta de las láminas aprobadas (design/screens/<NN>.png, 786 px de ancho) el arte ILUSTRATIVO que necesita la app para
la vista previa y para maquetar: fotos de perfil, fotos de coche, la ilustración de la bienvenida y las de los roles.

IMPORTANTE (documentado en docs/DESIGN_SYSTEM.md §«Arte»): estos recortes son de BAJA resolución (las láminas se
generaron a ~358 px de ancho por pantalla y se reescalaron) y retratan a PERSONAS Y VEHÍCULOS ILUSTRATIVOS (imágenes
generadas), no a usuarios reales. Sirven para igualar el diseño en la vista previa; los originales deben sustituirlos
antes de producción. Los mapas NO son activos: los dibuja `src/maps`.

Qué hace
  1. Recorta cada pieza de la lámina de origen (círculo, rectángulo o elipse), tapando con `cv2.inpaint` las
     superposiciones de la interfaz (insignia de cámara, aspa roja, rotulado de la bienvenida…).
  2. Guarda JPEG (o PNG con transparencia para las elipses de los roles) en `mobile/assets/design/`.
  3. Genera `mobile/src/assets/index.ts`, el registro TIPADO que consume la app (`images.avatars.ana`…).

Uso (desde la raíz del repositorio):   python3 tools/design/extract_assets.py
Requiere: opencv-python, numpy y Pillow. Es determinista: ejecutarlo dos veces produce los mismos archivos.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCREENS = os.path.join(ROOT, "design", "screens")
OUT = os.path.join(ROOT, "mobile", "assets", "design")
REGISTRY = os.path.join(ROOT, "mobile", "src", "assets", "index.ts")

JPEG_QUALITY = 88

_cache = {}


def load(screen):
    """Lámina completa en BGR (cacheada)."""
    if screen not in _cache:
        path = os.path.join(SCREENS, f"{screen}.png")
        img = cv2.imread(path, cv2.IMREAD_COLOR)
        if img is None:
            raise FileNotFoundError(path)
        _cache[screen] = img
    return _cache[screen].copy()


def inpaint(img, shapes):
    """Rellena las zonas `shapes` ((\"circle\", cx, cy, r) o (\"rect\", x0, y0, x1, y1)) a partir de su entorno."""
    if not shapes:
        return img
    mask = np.zeros(img.shape[:2], np.uint8)
    for shape in shapes:
        if shape[0] == "circle":
            _, cx, cy, r = shape
            cv2.circle(mask, (int(cx), int(cy)), int(r), 255, -1)
        else:
            _, x0, y0, x1, y1 = shape
            cv2.rectangle(mask, (int(x0), int(y0)), (int(x1), int(y1)), 255, -1)
    return cv2.inpaint(img, mask, 6, cv2.INPAINT_TELEA)


def save_jpeg(bgr, rel_path):
    path = os.path.join(OUT, rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)).save(
        path, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True, subsampling=0
    )
    return path


def save_png(rgba, rel_path):
    path = os.path.join(OUT, rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(path, "PNG", optimize=True)
    return path


def resize(bgr, width):
    h, w = bgr.shape[:2]
    height = int(round(h * width / w))
    interp = cv2.INTER_AREA if width < w else cv2.INTER_LANCZOS4
    return cv2.resize(bgr, (width, height), interpolation=interp)


def circle_crop(screen, cx, cy, r, out_px, rel_path, shrink=0.94, mask=None):
    """Cuadrado inscrito en el círculo (radio reducido `shrink` para no coger el aro blanco ni la sombra)."""
    img = inpaint(load(screen), mask)
    half = int(round(r * shrink))
    crop = img[int(cy) - half : int(cy) + half, int(cx) - half : int(cx) + half]
    return save_jpeg(resize(crop, out_px), rel_path)


def rect_crop(screen, box, out_w, rel_path, mask=None):
    x0, y0, x1, y1 = box
    img = inpaint(load(screen), mask)
    return save_jpeg(resize(img[y0:y1, x0:x1], out_w), rel_path)


def ellipse_png(screen, box, bg_point, rel_path):
    """Ilustración elíptica sobre tarjeta de color plano: segmenta por distancia al color de la tarjeta y exporta RGBA."""
    img = load(screen)
    x0, y0, x1, y1 = box
    region = img[y0:y1, x0:x1].astype(int)
    bg = img[bg_point[1], bg_point[0]].astype(int)
    diff = np.abs(region - bg).sum(axis=2)
    binary = (diff > 38).astype(np.uint8) * 255
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea)
    (cx, cy), (ax1, ax2), angle = cv2.fitEllipse(contour)
    bx, by, bw, bh = cv2.boundingRect(contour)
    pad = 3
    cx0, cy0 = max(bx - pad, 0), max(by - pad, 0)
    cx1, cy1 = min(bx + bw + pad, region.shape[1]), min(by + bh + pad, region.shape[0])
    ss = 4  # sobremuestreo de la máscara para suavizar el borde
    alpha = np.zeros(((cy1 - cy0) * ss, (cx1 - cx0) * ss), np.uint8)
    inset = 1.5
    cv2.ellipse(
        alpha,
        (((cx - cx0) * ss, (cy - cy0) * ss), ((ax1 - 2 * inset) * ss, (ax2 - 2 * inset) * ss), angle),
        255,
        -1,
        cv2.LINE_AA,
    )
    alpha = cv2.resize(alpha, (cx1 - cx0, cy1 - cy0), interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(img[y0:y1, x0:x1][cy0:cy1, cx0:cx1], cv2.COLOR_BGR2RGB)
    rgba = np.dstack([rgb, alpha])
    return save_png(rgba, rel_path), (cx1 - cx0, cy1 - cy0)


def text_mask(img, mask, box, threshold=205):
    """Marca como «texto» los píxeles oscuros o saturados de `box` (el cielo de la bienvenida es azul muy claro)."""
    x0, y0, x1, y1 = box
    region = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    saturation = region.max(axis=2).astype(int) - region.min(axis=2).astype(int)
    found = ((gray < threshold) | ((saturation > 90) & (gray < 215))).astype(np.uint8) * 255
    mask[y0:y1, x0:x1] |= found


def hero():
    """Escena de la bienvenida (01) sin el logotipo ni los textos superpuestos (se pintan en vivo con `MvcLogo`/`Text`)."""
    img = load("01")
    mask = np.zeros(img.shape[:2], np.uint8)
    text_mask(img, mask, (215, 138, 565, 470))  # logotipo apilado
    text_mask(img, mask, (170, 485, 745, 640))  # «Tu provincia, en movimiento.»
    text_mask(img, mask, (235, 640, 640, 725))  # «Comparte coche para tus trayectos habituales.»
    text_mask(img, mask, (55, 118, 110, 185))  # chevron de volver
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=5)
    clean = cv2.inpaint(img, mask, 7, cv2.INPAINT_TELEA)
    return save_jpeg(clean[112:1146, 38:750], "hero/welcome.jpg")


# ── Piezas ──────────────────────────────────────────────────────────────────────────────────────────────────────────
# Coordenadas en píxeles de design/screens/<lámina>.png (786 px de ancho). Centros y radios medidos con HoughCircles.

AVATARS = [
    # nombre,         lámina, cx,  cy,   r,  px   fuente
    ("ana", "12", 159, 305, 90, 160),  # «Ana» conductora (12 Detalle del viaje)
    ("miguel", "25", 138, 963, 75, 160),  # «Miguel» (25 Mensajes)
    ("laura", "25", 138, 1176, 75, 160),  # «Laura» (25 Mensajes)
    ("carlos", "34b", 125, 1223, 60, 160),  # «Carlos» (33/34 cobros)
    ("marta", "34b", 125, 1384, 59, 160),  # «Marta» (33/34 cobros)
    ("miguel-profile", "29", 170, 349, 113, 200),  # foto de «Mi perfil» (29)
]


def main():
    written = []

    for name, screen, cx, cy, r, px in AVATARS:
        written.append(circle_crop(screen, cx, cy, r, px, f"avatars/{name}.jpg"))

    # Foto de perfil de la 05 (círculo grande) sin la insignia de cámara; su versión desenfocada es la de la 07/08.
    photo = circle_crop("05", 392, 613, 219, 320, "profile/photo.jpg", shrink=0.97, mask=[("circle", 555, 744, 70)])
    written.append(photo)
    sharp = cv2.imread(photo, cv2.IMREAD_COLOR)
    written.append(save_jpeg(cv2.GaussianBlur(sharp, (0, 0), 13), "profile/photo-blur.jpg"))
    # Foto desenfocada de «Estado de la comprobación» (08), sin la insignia roja.
    written.append(rect_crop("08", (222, 670, 564, 892), 342, "profile/check-blur.jpg", mask=[("circle", 521, 858, 50)]))

    # Vehículos
    written.append(rect_crop("17", (68, 222, 728, 534), 660, "cars/seat-arona.jpg", mask=[("circle", 648, 460, 68)]))
    written.append(rect_crop("21", (514, 1222, 716, 1314), 404, "cars/seat-leon.jpg"))

    # Bienvenida y roles
    written.append(hero())
    sizes = {}
    for name, box, bg in (("passenger", (70, 440, 400, 800), (100, 445)), ("driver", (70, 860, 400, 1215), (100, 845))):
        path, size = ellipse_png("02", box, bg, f"roles/{name}.png")
        written.append(path)
        sizes[name] = size

    write_registry()

    total = 0
    for path in written:
        with Image.open(path) as im:
            size = os.path.getsize(path)
            total += size
            print(f"{os.path.relpath(path, ROOT)}: {im.size[0]}x{im.size[1]} {im.mode} {size} bytes")
    print(f"total {total} bytes en {len(written)} archivos")
    return 0


def dims(rel_path):
    with Image.open(os.path.join(OUT, rel_path)) as im:
        return im.size


def write_registry():
    """Escribe `mobile/src/assets/index.ts`: registro tipado de las imágenes (con sus dimensiones naturales)."""
    entries = [
        ("avatars", "ana", "avatars/ana.jpg", "Ana, conductora (12, 11, 21, 25, 26, 28)."),
        ("avatars", "miguel", "avatars/miguel.jpg", "Miguel, pasajero/conductor (11, 25)."),
        ("avatars", "laura", "avatars/laura.jpg", "Laura (25, 34)."),
        ("avatars", "carlos", "avatars/carlos.jpg", "Carlos (34)."),
        ("avatars", "marta", "avatars/marta.jpg", "Marta (34)."),
        ("avatars", "miguelProfile", "avatars/miguel-profile.jpg", "Foto de «Mi perfil» (29)."),
        ("profile", "photo", "profile/photo.jpg", "Retrato de «Tu foto de perfil» (05, 07)."),
        ("profile", "photoBlur", "profile/photo-blur.jpg", "Retrato desenfocado de «Comprobación privada» (07)."),
        ("profile", "checkBlur", "profile/check-blur.jpg", "Captura desenfocada de «Estado de la comprobación» (08)."),
        ("cars", "seatArona", "cars/seat-arona.jpg", "SEAT Arona blanco de «Tu vehículo» (17)."),
        ("cars", "seatLeon", "cars/seat-leon.jpg", "SEAT León blanco de «Esperando el coche» (21)."),
        ("hero", "welcome", "hero/welcome.jpg", "Escena de la bienvenida (01) sin logotipo ni textos."),
        ("roles", "passenger", "roles/passenger.png", "Ilustración «Soy pasajero» (02), elipse con transparencia."),
        ("roles", "driver", "roles/driver.png", "Ilustración «Soy conductor» (02), elipse con transparencia."),
    ]
    groups = {}
    for group, key, rel, doc in entries:
        groups.setdefault(group, []).append((key, rel, doc))

    lines = [
        "/**",
        " * GENERADO por tools/design/extract_assets.py. NO EDITAR A MANO.",
        " *",
        " * Arte ILUSTRATIVO recortado de las láminas aprobadas, en BAJA resolución, para la vista previa y la maquetación.",
        " * Retrata personas y vehículos ilustrativos (imágenes generadas), no usuarios reales: antes de producción deben",
        " * sustituirlo los originales (ver docs/DESIGN_SYSTEM.md §«Arte»). Los mapas no son activos: los dibuja `src/maps`.",
        " */",
        "/**",
        " * Imagen estática con sus dimensiones naturales en píxeles (para reservar el alto sin saltos).",
        " * `source` es el identificador numérico de recurso que devuelve `require` en Metro (sirve a `Image`, a `expo-image`",
        " * y a `Avatar`).",
        " */",
        "export interface ImageAsset {",
        "  readonly source: number;",
        "  readonly width: number;",
        "  readonly height: number;",
        "}",
        "",
        "// `require` de recursos estáticos devuelve `any` en el borde de Metro; se tipa aquí, una sola vez.",
        "function asset(source: number, width: number, height: number): ImageAsset {",
        "  return { source, width, height };",
        "}",
        "",
        "export const images = {",
    ]
    for group, items in groups.items():
        lines.append(f"  {group}: {{")
        for key, rel, doc in items:
            w, h = dims(rel)
            lines.append(f"    /** {doc} */")
            lines.append(f'    {key}: asset(require("../../assets/design/{rel}"), {w}, {h}),')
        lines.append("  },")
    lines.append("} as const;")
    lines.append("")
    lines.append("export type AvatarKey = keyof typeof images.avatars;")
    lines.append("")
    lines.append("/** Lista de avatares ilustrativos, útil para repartirlos en listas de ejemplo de la vista previa. */")
    lines.append("export const avatarKeys = Object.keys(images.avatars) as readonly AvatarKey[];")
    lines.append("")
    os.makedirs(os.path.dirname(REGISTRY), exist_ok=True)
    with open(REGISTRY, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))


if __name__ == "__main__":
    sys.exit(main())
