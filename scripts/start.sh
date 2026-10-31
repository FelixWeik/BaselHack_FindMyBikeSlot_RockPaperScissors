#!/usr/bin/env bash
# Starts the whole system on this laptop: backend :8000, vision :8001, web app :3000. Ctrl+C stops everything.
#
#   scripts/start.sh              # live mode, presenter view on
#   scripts/start.sh --demo       # the same, plus the simulated cameras (code/vision/demo)
#   DEMO_VIEW=0 scripts/start.sh  # without the presenter view
#
# Linux and macOS. On Windows use WSL, but a camera node can't reach WSL's NAT: see documentation/team-setup.md.
set -euo pipefail

demo=false
case "${1:-}" in
  "") ;;
  --demo) demo=true ;;
  *) echo "Usage: $0 [--demo]" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The presenter view shows what the cameras see (faces masked): that's what a test on a laptop is about.
DEMO_VIEW="${DEMO_VIEW:-1}"
# Camera nodes send to 8001 (code/firmware/include/config.h): change the ports only to run a second copy.
BACKEND_PORT="${BACKEND_PORT:-8000}" VISION_PORT="${VISION_PORT:-8001}" WEB_PORT="${WEB_PORT:-3000}"

die() { echo "error: $*" >&2; exit 1; }
in_use() { (echo >"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

command -v uv >/dev/null || die "uv is missing: https://docs.astral.sh/uv/getting-started/installation/"
if command -v bun >/dev/null; then JS=bun; elif command -v npm >/dev/null; then JS=npm; else
  die "bun (or npm) is missing: https://bun.sh/"
fi
for port in "$BACKEND_PORT" "$VISION_PORT" "$WEB_PORT"; do
  in_use "$port" && die "port $port is already in use: stop what runs there first (e.g. an old start.sh or test_receiver.py)"
done

# The address a camera node or a phone on the same WiFi uses to reach this laptop.
if [[ "$(uname)" == Darwin ]]; then
  IP="$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || true)"
  HOST="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
else
  IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
  HOST="$(uname -n)"
fi
IP="${IP:-localhost}"

echo "Installing dependencies (fast after the first run; the first vision install downloads PyTorch)..."
(cd "$ROOT/code/backend" && uv sync -q)
(cd "$ROOT/code/vision" && uv sync -q --group model)
(cd "$ROOT/code/frontend" && $JS install --silent >/dev/null)

trap 'trap - INT TERM EXIT; echo; echo "Stopping..."; kill 0' INT TERM EXIT
run() {  # name, directory, command...: runs in the background, each log line prefixed with the name
  local name="$1" dir="$2"
  shift 2
  (cd "$dir" && "$@" 2>&1 | awk -v p="[$name] " '{ print p $0; fflush() }') &
}

run backend "$ROOT/code/backend" env VISION_URL="http://localhost:$VISION_PORT" \
  uv run uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT"
# Camera nodes look for bikeslot.local. MDNS_HOSTNAME= turns the announcement off, when another laptop already holds it.
run vision "$ROOT/code/vision" env DEMO_VIEW="$DEMO_VIEW" BACKEND_URL="http://localhost:$BACKEND_PORT" \
  MDNS_HOSTNAME="${MDNS_HOSTNAME-bikeslot}" PORT="$VISION_PORT" \
  uv run --group model uvicorn app.main:create_app --factory --host 0.0.0.0 --port "$VISION_PORT"
run web "$ROOT/code/frontend" env MOCK_MODE=false NEXT_PUBLIC_API_URL="http://$IP:$BACKEND_PORT" \
  $JS run dev -- --port "$WEB_PORT"

for _ in $(seq 60); do
  in_use "$BACKEND_PORT" && in_use "$VISION_PORT" && break
  sleep 1
done

if "$demo"; then
  run cameras "$ROOT/code/vision" uv run --group model python demo/demo_cameras.py --vision-url "http://localhost:$VISION_PORT"
fi

cat <<EOF

================================================================================
 Find my Bike Slot is running on this laptop ($HOST, $IP)

 Web app         http://localhost:$WEB_PORT       phones on this WiFi: http://$IP:$WEB_PORT
 Admin           http://localhost:$WEB_PORT/admin  calibrate cameras here
 Camera view     http://localhost:$VISION_PORT/demo   $([[ "$DEMO_VIEW" == 1 ]] && echo "what each camera sees" || echo "off (DEMO_VIEW=0)")
 Backend API     http://localhost:$BACKEND_PORT/docs

 Camera node: flash it once. It finds bikeslot.local on this network, names itself after its MAC address and
 shows up in the admin. In case mDNS is blocked here, put this in code/firmware/include/secrets.h first:
   #define VISION_FALLBACK_IP "$IP"

 No camera? Restart with --demo for simulated ones, or to send your own photos, in another terminal:
   cd code/vision && uv run python tools/fake_camera.py

 Ctrl+C stops everything.
================================================================================

EOF
wait
