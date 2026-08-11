#!/usr/bin/env bash
#
# Instalador del Taller (fichas de reparación y venta de móviles).
#
#   curl -fsSL https://raw.githubusercontent.com/Marci9998/Test/claude/mobile-repair-ticket-app-rz2jfm/install.sh | sudo bash
#
# Se puede ajustar con variables de entorno:
#
#   TALLER_PORT=9000   puerto donde escucha        (por defecto 8477)
#   TALLER_DIR=/opt/…  dónde se instala            (por defecto /opt/taller)
#   TALLER_DATA=/var/… dónde van las fichas        (por defecto /var/lib/taller)
#   TALLER_BRANCH=…    rama del repo a instalar
#
# Para desinstalar:  sudo bash install.sh --uninstall
#
set -euo pipefail

REPO_OWNER="Marci9998"
REPO_NAME="Test"
BRANCH="${TALLER_BRANCH:-claude/mobile-repair-ticket-app-rz2jfm}"

APP_DIR="${TALLER_DIR:-/opt/taller}"
DATA_DIR="${TALLER_DATA:-/var/lib/taller}"
PORT="${TALLER_PORT:-8477}"
SERVICE="taller"
USER_NAME="taller"

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'

WORK_DIR=""
cleanup() { [ -n "$WORK_DIR" ] && rm -rf "$WORK_DIR"; }
trap cleanup EXIT

say()  { printf '%s\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$OFF" "$*"; }
die()  { printf '%s✗%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }

# ─────────────────────────── comprobaciones ───────────────────────────

need_root() {
  [ "$(id -u)" -eq 0 ] || die "Hace falta root. Prueba otra vez con: sudo bash"
}

check_port() {
  case "$PORT" in
    ''|*[!0-9]*) die "El puerto '$PORT' no es un número" ;;
  esac
  [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "El puerto $PORT está fuera de rango"
  [ "$PORT" -ne 8083 ] || die "El puerto 8083 está reservado para otros paneles. Usa TALLER_PORT=otro"

  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE "[:.]${PORT}[[:space:]]"; then
    # si ya lo tenemos nosotros no pasa nada: es una reinstalación
    if ! systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
      die "El puerto $PORT ya lo está usando otro programa. Prueba con TALLER_PORT=otro"
    fi
  fi
}

find_python() {
  for candidate in python3 /usr/bin/python3 /usr/local/bin/python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON="$(command -v "$candidate")"
      return 0
    fi
  done
  return 1
}

install_python() {
  warn "No hay Python 3; intentando instalarlo…"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq python3
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q python3
  elif command -v apk >/dev/null 2>&1; then
    apk add --quiet python3
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm python
  else
    die "Instala Python 3 a mano y vuelve a lanzar esto"
  fi
  find_python || die "Sigue sin haber Python 3"
}

# ─────────────────────────── descarga ───────────────────────────

download() {
  local tmp="$1"
  local url="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/refs/heads/${BRANCH}"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmp/taller.tar.gz" || die "No se pudo descargar desde GitHub ($url)"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp/taller.tar.gz" "$url" || die "No se pudo descargar desde GitHub ($url)"
  else
    die "Hace falta curl o wget"
  fi

  mkdir -p "$tmp/src"
  tar -xzf "$tmp/taller.tar.gz" -C "$tmp/src" --strip-components=1 \
    || die "El fichero descargado no se pudo descomprimir"
  [ -f "$tmp/src/server.py" ] || die "La descarga no trae server.py; ¿rama equivocada?"
}

# ─────────────────────────── instalación ───────────────────────────

install_files() {
  local src="$1"
  mkdir -p "$APP_DIR"
  # se borra sólo lo de la aplicación; los datos viven en otra carpeta
  rm -rf "${APP_DIR:?}/assets"
  cp -a "$src/server.py" "$src/index.html" "$APP_DIR/"
  cp -a "$src/assets" "$APP_DIR/"
  [ -f "$src/README.md" ] && cp -a "$src/README.md" "$APP_DIR/" || true
  chmod +x "$APP_DIR/server.py"
}

make_user() {
  if ! id -u "$USER_NAME" >/dev/null 2>&1; then
    useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$USER_NAME" 2>/dev/null \
      || useradd --system --home-dir "$DATA_DIR" --shell /sbin/nologin "$USER_NAME" 2>/dev/null \
      || warn "No se pudo crear el usuario $USER_NAME; el servicio irá como root"
  fi
  mkdir -p "$DATA_DIR"
  chown -R "$USER_NAME:$USER_NAME" "$DATA_DIR" 2>/dev/null || true
}

# systemctl puede estar instalado sin ser el init del sistema (contenedores, WSL…)
has_systemd() {
  command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]
}

write_service() {
  local run_as="$USER_NAME"
  id -u "$USER_NAME" >/dev/null 2>&1 || run_as="root"

  cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=Taller - fichas de reparacion y venta de moviles
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${run_as}
Environment=TALLER_PORT=${PORT}
Environment=TALLER_DATA=${DATA_DIR}
ExecStart=${PYTHON} ${APP_DIR}/server.py
WorkingDirectory=${APP_DIR}
Restart=always
RestartSec=3

# El servicio sólo necesita leer su carpeta y escribir en la de datos
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload || return 1
  systemctl enable "$SERVICE" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE" || return 1
}

lan_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"
  fi
  [ -n "$ip" ] || ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$ip" ] || ip="localhost"
  printf '%s' "$ip"
}

# ─────────────────────────── desinstalar ───────────────────────────

uninstall() {
  need_root
  say "${BOLD}Desinstalando el Taller…${OFF}"
  if has_systemd; then
    systemctl stop "$SERVICE" 2>/dev/null || true
    systemctl disable "$SERVICE" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE}.service"
    systemctl daemon-reload 2>/dev/null || true
  else
    rm -f "/etc/systemd/system/${SERVICE}.service"
  fi
  rm -rf "$APP_DIR"
  ok "Programa borrado."
  info "Tus fichas siguen en ${DATA_DIR} (bórralas a mano si quieres: rm -rf ${DATA_DIR})"
  exit 0
}

# ─────────────────────────── principal ───────────────────────────

main() {
  [ "${1:-}" = "--uninstall" ] && uninstall

  need_root
  say ""
  say "${BOLD}Taller${OFF} ${DIM}— fichas de reparación y venta de móviles${OFF}"
  say ""

  check_port
  find_python || install_python
  ok "Python: $PYTHON"

  WORK_DIR="$(mktemp -d)"

  info "Descargando la última versión (rama ${BRANCH})…"
  download "$WORK_DIR"
  ok "Descargado"

  install_files "$WORK_DIR/src"
  ok "Instalado en $APP_DIR"

  make_user
  ok "Datos en $DATA_DIR"

  if has_systemd; then
    if write_service; then
      sleep 1
      if systemctl is-active --quiet "$SERVICE"; then
        ok "Servicio en marcha (arranca solo al encender el equipo)"
      else
        warn "El servicio no arrancó. Mira qué pasa con: journalctl -u ${SERVICE} -n 30"
      fi
    else
      warn "No se pudo registrar el servicio; arráncalo a mano cuando quieras:"
      info "sudo TALLER_PORT=${PORT} TALLER_DATA=${DATA_DIR} ${PYTHON} ${APP_DIR}/server.py"
    fi
  else
    warn "Este sistema no arranca con systemd; el programa está instalado, pero hay"
    warn "que arrancarlo a mano (o con lo que use tu sistema):"
    info "sudo TALLER_PORT=${PORT} TALLER_DATA=${DATA_DIR} ${PYTHON} ${APP_DIR}/server.py"
  fi

  # Al final, porque algún fichero puede haberlo creado root al probar a mano
  if id -u "$USER_NAME" >/dev/null 2>&1; then
    chown -R "$USER_NAME:$USER_NAME" "$DATA_DIR" 2>/dev/null || true
  fi

  local ip; ip="$(lan_ip)"
  say ""
  say "${BOLD}Ya está.${OFF}"
  say "  En este equipo : ${BOLD}http://localhost:${PORT}${OFF}"
  say "  Desde el móvil : ${BOLD}http://${ip}:${PORT}${OFF}"
  say ""
  if has_systemd; then
    say "${DIM}  Parar/arrancar : sudo systemctl stop|start ${SERVICE}"
    say "  Ver el registro: sudo journalctl -u ${SERVICE} -f"
    say "  Desinstalar    : curl -fsSL <esta misma url> | sudo bash -s -- --uninstall${OFF}"
  else
    say "${DIM}  Desinstalar    : curl -fsSL <esta misma url> | sudo bash -s -- --uninstall${OFF}"
  fi
  say ""
  warn "Cualquiera de tu red puede abrir esa dirección: no lleva contraseña."
  say ""
}

main "$@"
