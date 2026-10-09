#!/usr/bin/env bash
# Descarga las fuentes públicas del mapa base a una carpeta de caché (no se versionan).
#   - es-atlas 0.6.0 (npm): TopoJSON de municipios y provincias de España (datos del IGN, CC BY 4.0).
# Red necesaria: solo el registro de npm. Uso:  tools/preview/map/fetch-sources.sh   (MVC_MAP_CACHE cambia la carpeta)
set -euo pipefail
CACHE="${MVC_MAP_CACHE:-${TMPDIR:-/tmp}/mvc-map-cache}"
mkdir -p "$CACHE/es-atlas"
if [ ! -f "$CACHE/es-atlas/package/es/municipalities.json" ]; then
  tmp="$(mktemp -d)"
  (cd "$tmp" && npm pack es-atlas@0.6.0 --silent >/dev/null)
  tar -xzf "$tmp"/es-atlas-0.6.0.tgz -C "$CACHE/es-atlas"
  rm -rf "$tmp"
fi
echo "es-atlas listo en $CACHE/es-atlas/package"
