#!/usr/bin/env bash
# Comprobación de tipos de TODA la app móvil, serializada (una sola instancia a la vez en toda la máquina: tsc gasta ~1 GB
# y 12 equipos lanzándolo a la vez agotarían la memoria) e incremental (la segunda vuelta tarda segundos).
#
#   tools/preview/typecheck.sh                       todos los errores del proyecto
#   tools/preview/typecheck.sh src/features/auth     solo los de las rutas que contengan ese texto (puedes pasar varias)
#
# Salida: los errores filtrados + una línea final «TIPOS: N errores en tus rutas · M en el resto del proyecto».
# Código de salida: 0 si no hay errores en TUS rutas (aunque otro equipo tenga errores a medias), 1 si los hay.
# Sin filtros, 0 solo si el proyecto entero está limpio.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}/mobile" || exit 2

export EXPO_NO_TYPESCRIPT_SETUP=1
INFO="${MVC_TSC_INFO:-/tmp/mvc-tsc.tsbuildinfo}"
OUT="$(mktemp)"
trap 'rm -f "${OUT}"' EXIT

exec 9>/tmp/mvc-tsc.lock
flock 9

# --incremental + --noEmit: guarda solo el grafo en INFO (no emite JS). Si el fichero se corrompe, se borra y se repite.
# (node_modules/.bin/tsc es un script de shell de pnpm, no JS: se llama al binario de typescript directamente)
TSC="node_modules/typescript/bin/tsc"
RC=0
run() { node --max-old-space-size=3072 "${TSC}" --noEmit --incremental --tsBuildInfoFile "${INFO}" -p tsconfig.json > "${OUT}" 2>&1; RC=$?; }
run
if [ "${RC}" -ne 0 ] && ! grep -qE '\([0-9]+,[0-9]+\): error TS' "${OUT}"; then rm -f "${INFO}"; run; fi

total="$(grep -cE '^[^ ].*\([0-9]+,[0-9]+\): error TS' "${OUT}" || true)"
if [ "${RC}" -ne 0 ] && [ "${total}" -eq 0 ]; then
  echo "TIPOS: tsc falló sin dar errores de código (¿fallo de la herramienta?):"; head -20 "${OUT}"; exit 2
fi
if [ "$#" -eq 0 ]; then
  if [ "${total}" -eq 0 ]; then echo "TIPOS: 0 errores en el proyecto"; exit 0; fi
  grep -E '^[^ ].*\([0-9]+,[0-9]+\): error TS' "${OUT}" | head -200
  echo "TIPOS: ${total} errores en el proyecto"
  exit 1
fi

pattern="$(printf '%s\n' "$@" | sed 's/[][\.*^$/]/\\&/g' | paste -sd'|' -)"
mine="$(grep -E '^[^ ].*\([0-9]+,[0-9]+\): error TS' "${OUT}" | grep -E "(${pattern})" || true)"
mine_n=0
[ -n "${mine}" ] && mine_n="$(printf '%s\n' "${mine}" | wc -l | tr -d ' ')"
[ -n "${mine}" ] && printf '%s\n' "${mine}" | head -200
echo "TIPOS: ${mine_n} errores en tus rutas · $((total - mine_n)) en el resto del proyecto"
[ "${mine_n}" -eq 0 ]
