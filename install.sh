#!/bin/bash
# Tomodachi POS — One-command installer
# curl -fsSL https://tomodachiproject.tabtap.dev/install.sh | bash

set -euo pipefail

REPO="AngelDAL/Tomodachi"
BRANCH="community-edition"
INSTALL_DIR="${HOME}/tomodachi"
PORT="${1:-8080}"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   Tomodachi POS — Instalación automática                    ║"
echo "║   Software de punto de venta open source                    ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Verificar dependencias ─────────────────────────────────────
if ! command -v docker &>/dev/null; then
    echo "Docker no está instalado. Instalando..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "${USER}" 2>/dev/null || true
fi

if ! command -v docker compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
    echo "Docker Compose no está instalado. Instalando..."
    sudo apt-get update && sudo apt-get install -y docker-compose-plugin
fi

# ── Clonar o actualizar ────────────────────────────────────────
if [ -d "${INSTALL_DIR}/.git" ]; then
    echo "Actualizando instalación existente..."
    cd "${INSTALL_DIR}"
    git pull origin "${BRANCH}" --ff-only
else
    echo "Clonando repositorio..."
    git clone --branch "${BRANCH}" "https://github.com/${REPO}.git" "${INSTALL_DIR}"
    cd "${INSTALL_DIR}"
fi

# ── Configurar puerto ──────────────────────────────────────────
export PORT="${PORT}"

# ── Levantar ───────────────────────────────────────────────────
echo ""
echo "Construyendo contenedores (esto puede tardar unos minutos)..."
docker compose up -d --build

# ── Esperar a que la base de datos esté lista ──────────────────
echo ""
echo "Esperando a que la base de datos esté lista..."
for i in $(seq 1 30); do
    if docker compose exec -T db healthcheck.sh --connect --innodb_initialized &>/dev/null 2>&1; then
        echo "Base de datos lista."
        break
    fi
    sleep 2
done

# ── Mostrar credenciales ───────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                  ¡Instalación completa!                     ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                              ║"
echo "║   Accede en tu navegador:                                   ║"
echo "║   http://localhost:${PORT}                                      ║"
echo "║                                                              ║"
echo "║   Credenciales iniciales:                                   ║"
echo "║   Usuario: admin                                             ║"
echo "║   Contraseña: admin123                                       ║"
echo "║                                                              ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║   Comandos útiles:                                          ║"
echo "║   cd ${INSTALL_DIR} && docker compose logs -f                 ║"
echo "║   cd ${INSTALL_DIR} && docker compose down                   ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
