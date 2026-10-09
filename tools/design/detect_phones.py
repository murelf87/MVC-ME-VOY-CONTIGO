#!/usr/bin/env python3
"""Detecta los cuatro móviles de cada lámina de diseño y devuelve su rectángulo interior (pantalla)."""
import sys, json, glob, os
import numpy as np
import cv2

def detect(path):
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    dark = (gray < 60).astype(np.uint8) * 255
    # quitar cabecera (logo/títulos): los móviles empiezan por debajo de ~y=140
    dark[:140, :] = 0
    dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    boxes = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if bw > 300 and bh > 650:
            boxes.append((x, y, bw, bh))
    boxes.sort()
    return img, boxes

if __name__ == "__main__":
    for p in sorted(glob.glob(sys.argv[1] + "/*-image.png"))[:13]:
        img, boxes = detect(p)
        print(os.path.basename(p), img.shape[:2], [(x, y, bw, bh, round(bw/bh, 3)) for x, y, bw, bh in boxes])
