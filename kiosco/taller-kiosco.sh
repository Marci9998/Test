#!/bin/sh
# ===================================================================
#  taller-kiosco.sh — lo mismo que el .bat, pero si el all-in-one
#  lleva Linux. Se pone en «Aplicaciones al inicio».
#
#    chmod +x taller-kiosco.sh
# ===================================================================

URL="${TALLER_URL:-http://192.168.1.50:8477/}"

# esperar a que el servidor conteste (hasta 2 minutos)
i=0
while [ "$i" -lt 60 ]; do
  if curl --silent --head --fail --max-time 3 "$URL" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 2
done

# que no salte el salvapantallas ni se apague la pantalla en el mostrador
if command -v xset >/dev/null 2>&1; then
  xset s off
  xset -dpms
fi

for nav in chromium chromium-browser google-chrome firefox; do
  if command -v "$nav" >/dev/null 2>&1; then
    case "$nav" in
      firefox) exec "$nav" --kiosk "$URL" ;;
      *)       exec "$nav" --kiosk --noerrdialogs --disable-infobars \
                    --disable-session-crashed-bubble "$URL" ;;
    esac
  fi
done

echo "No he encontrado ningún navegador instalado." >&2
exit 1
