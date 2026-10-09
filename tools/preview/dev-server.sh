#!/usr/bin/env bash
# Servidor de desarrollo ÚNICO de la app (Expo web + Metro, recarga en caliente) en modo vista previa.
#
# Por qué existe: exportar la app entera (`preview:artifact`) tarda ~1 min por cambio y la máquina tiene 2 núcleos. Con
# este servidor, guardar un fichero basta: Metro recompila solo lo que cambió y `compare.mjs --dev` compara en ~10 s.
# Todos los equipos comparten el MISMO servidor (puerto 8081): no arranques otro.
#
#   tools/preview/dev-server.sh start      arranca (si ya está en marcha, no hace nada) y calienta el bundle
#   tools/preview/dev-server.sh status     ¿responde? ¿el bundle compila? (si no compila, dice qué fichero)
#   tools/preview/dev-server.sh restart    paro + arranque (útil si Metro se queda colgado o falta memoria)
#   tools/preview/dev-server.sh stop       lo para
#   tools/preview/dev-server.sh log [N]    últimas N líneas del registro (def. 40)
#
# Variables: MVC_DEV_PORT (def. 8081) · MVC_DEV_LOG (def. /tmp/mvc-dev-server.log)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${MVC_DEV_PORT:-8081}"
LOG="${MVC_DEV_LOG:-/tmp/mvc-dev-server.log}"
ORIGIN="http://localhost:${PORT}"
BUNDLE="${ORIGIN}/index.ts.bundle?platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable"
PATTERN="expo/bin/cli start --web --port ${PORT}"

up() { curl -s -o /dev/null --max-time 3 -w '%{http_code}' "${ORIGIN}/" 2>/dev/null | grep -q '^200$'; }

pids() { pgrep -f -- "${PATTERN}" 2>/dev/null || true; }

bundle_check() {
  # 0 = compila · 1 = no compila (imprime el motivo) · 2 = no se pudo preguntar
  local out code
  out="$(mktemp)"
  code="$(curl -s -o "${out}" --max-time "${1:-240}" -w '%{http_code}' "${BUNDLE}" 2>/dev/null || echo 000)"
  if [ "${code}" = "200" ]; then rm -f "${out}"; return 0; fi
  if [ "${code}" = "000" ]; then rm -f "${out}"; echo "sin respuesta del bundle en ${ORIGIN}"; return 2; fi
  echo "HTTP ${code}: $(head -c 1500 "${out}" | tr '\n' ' ')"
  rm -f "${out}"
  return 1
}

start() {
  if up; then echo "El servidor de desarrollo ya está en marcha: ${ORIGIN}"; return 0; fi
  if [ -n "$(pids)" ]; then echo "Hay un proceso de Expo arrancando o colgado; espera o usa «restart»."; return 1; fi
  cd "${ROOT}/mobile" || return 1
  # EXPO_PUBLIC_PREVIEW=1 → backend en navegador (datos de ejemplo de Sevilla) · EXPO_OFFLINE/NO_TELEMETRY → sin red
  # EXPO_NO_TYPESCRIPT_SETUP → Expo NO reescribe mobile/tsconfig.json · sin CI=1 (CI desactiva la recarga en caliente)
  EXPO_PUBLIC_PREVIEW=1 EXPO_NO_DOTENV=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_NO_TYPESCRIPT_SETUP=1 EXPO_NO_REDIRECT_PAGE=1 \
    NODE_OPTIONS=--max-old-space-size=3072 \
    setsid nohup nice -n 5 npx expo start --web --port "${PORT}" --host localhost > "${LOG}" 2>&1 < /dev/null &
  echo "Arrancando Metro en ${ORIGIN} (registro: ${LOG})…"
  local i
  for i in $(seq 1 90); do
    if up; then break; fi
    sleep 2
  done
  if ! up; then echo "No respondió en 3 min. Mira: tools/preview/dev-server.sh log"; return 1; fi
  echo "Calentando el bundle (la primera vez tarda 1–2 min)…"
  local why
  if why="$(bundle_check 420)"; then echo "Listo: el bundle compila. Compara con: node tools/design/compare.mjs --dev --screen <N>"; return 0; fi
  echo "El servidor responde pero el bundle NO compila: ${why}"
  return 1
}

stop() {
  local p
  p="$(pids)"
  if [ -z "${p}" ]; then echo "No hay servidor de desarrollo en marcha."; return 0; fi
  # shellcheck disable=SC2086
  kill ${p} 2>/dev/null
  sleep 2
  p="$(pids)"
  # shellcheck disable=SC2086
  if [ -n "${p}" ]; then kill -9 ${p} 2>/dev/null; fi
  echo "Servidor de desarrollo parado."
}

status() {
  if ! up; then echo "PARADO (arranca con: tools/preview/dev-server.sh start)"; return 1; fi
  local why
  if why="$(bundle_check 240)"; then echo "EN MARCHA en ${ORIGIN} · el bundle compila"; return 0; fi
  echo "EN MARCHA en ${ORIGIN} · pero el bundle NO compila: ${why}"
  return 1
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  log) tail -n "${2:-40}" "${LOG}" ;;
  *) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 2 ;;
esac
