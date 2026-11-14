#!/usr/bin/env bash
#
# Servicos essenciais / baseline de onboarding no Linux (servido via webhook n8n).
#
# A lista padrao de pacotes e o default do parametro abaixo (espelhado em tool.json).
#
set -euo pipefail

# Parametros: variaveis de ambiente com default. Pelo webhook, o n8n
# injeta as atribuicoes logo apos o shebang. Listas chegam em CSV.
# Local: sudo PACOTES_CSV=curl,vim TIMEZONE=UTC bash linux.sh
PACOTES_CSV="${PACOTES_CSV:-curl,wget,vim,htop,net-tools,chrony,unzip,ca-certificates}"
PACOTES=()
IFS=',' read -r -a PACOTES <<< "$PACOTES_CSV"
TIMEZONE="${TIMEZONE:-America/Sao_Paulo}"

if [[ $EUID -ne 0 ]]; then
    echo "[ERRO] Execute como root (ou via sudo)." >&2
    exit 1
fi

. /etc/os-release
echo "==> Distro detectada: ${PRETTY_NAME}"

case "$ID" in
    ubuntu|debian)
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq
        apt-get install -y "${PACOTES[@]}"
        NTP_SVC="chrony"
        ;;
    rhel|centos|rocky|almalinux|ol)
        if command -v dnf >/dev/null 2>&1; then
            dnf install -y "${PACOTES[@]}"
        else
            yum install -y "${PACOTES[@]}"
        fi
        NTP_SVC="chronyd"
        ;;
    *)
        echo "[ERRO] Distro nao suportada: $ID" >&2
        exit 1
        ;;
esac

echo "==> Definindo fuso horario para ${TIMEZONE}..."
timedatectl set-timezone "$TIMEZONE" || echo "[AVISO] Falha ao definir timezone."

echo "==> Habilitando sincronizacao de horario (${NTP_SVC})..."
systemctl enable --now "$NTP_SVC" >/dev/null 2>&1 || echo "[AVISO] Falha ao habilitar ${NTP_SVC}."

echo "[SUCESSO] Baseline de servicos essenciais aplicado."
exit 0
