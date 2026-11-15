#!/usr/bin/env bash
# @onboarding:begin
# {
#   "schemaVersion": 1,
#   "parameters": [
#     { "name": "zabbix_server", "variable": "ZABBIX_SERVER", "type": "host", "required": true, "description": "Endereço do servidor ou proxy Zabbix (SERVER e SERVERACTIVE)", "example": "zabbix.exemplo.local" },
#     { "name": "metadata", "variable": "ZABBIX_METADATA", "type": "string", "required": true, "description": "HostMetadata usado nas regras de autorregistro", "example": "Linux", "regex": "^[A-Za-z0-9 ._:,;=-]{1,255}$" },
#     { "name": "hostname", "variable": "ZABBIX_HOSTNAME", "type": "string", "required": false, "description": "Nome do host no Zabbix. Vazio usa o hostname da máquina", "example": "srv-app01", "regex": "^[A-Za-z0-9._-]{1,128}$" },
#     { "name": "version", "variable": "ZABBIX_VERSION", "type": "string", "required": false, "default": "7.4", "description": "Branch do repositório oficial do Zabbix (ex.: 7.4)", "regex": "^\\d+\\.\\d+$" }
#   ]
# }
# @onboarding:end

#
# Instalacao nao-interativa do Zabbix Agent 2 no Linux (servido via webhook n8n).
# Uso: curl -fsSL '<url>?script=zabbix&os=linux&zabbix_server=<IP>&metadata=<VALOR>' | sudo bash
#
set -euo pipefail

# Parametros: variaveis de ambiente (ZABBIX_SERVER, ZABBIX_METADATA,
# ZABBIX_HOSTNAME, ZABBIX_VERSION). Pelo webhook, o n8n injeta as atribuicoes
# logo apos o shebang. Argumentos posicionais continuam tendo prioridade:
# bash -s -- <SERVER> <METADATA> [HOSTNAME] [VERSAO]
URL_ZABBIX_SERVER="${ZABBIX_SERVER:-}"
URL_METADATA="${ZABBIX_METADATA:-}"
URL_HOSTNAME="${ZABBIX_HOSTNAME:-}"
URL_ZBX_MAJOR="${ZABBIX_VERSION:-7.4}"

ZABBIX_SERVER="${1:-$URL_ZABBIX_SERVER}"
METADATA="${2:-$URL_METADATA}"
HOSTNAME_AGENT="${3:-${URL_HOSTNAME:-$(hostname)}}"
ZBX_MAJOR="${4:-$URL_ZBX_MAJOR}"

if [[ -z "$ZABBIX_SERVER" || -z "$METADATA" ]]; then
    echo "[ERRO] Informe zabbix_server e metadata na URL (?zabbix_server=<IP>&metadata=<VALOR>)" >&2
    echo "       ou como argumentos: bash -s -- <ZABBIX_SERVER> <METADATA> [HOSTNAME] [VERSAO_MAJOR]" >&2
    exit 1
fi

if [[ $EUID -ne 0 ]]; then
    echo "[ERRO] Execute como root (ou via sudo)." >&2
    exit 1
fi

# --- Idempotencia ---
if systemctl is-active --quiet zabbix-agent2 2>/dev/null; then
    echo "[INFO] zabbix-agent2 ja instalado e rodando. Nada a fazer."
    exit 0
fi

# --- Deteccao da distro ---
. /etc/os-release
DISTRO_ID="${ID}"
DISTRO_VER="${VERSION_ID}"
echo "==> Distro detectada: ${PRETTY_NAME}"

baixar_primeira_url_valida() {
    # Tenta cada URL candidata em ordem; retorna na primeira que responder 200.
    local destino="$1"; shift
    local url
    for url in "$@"; do
        echo "    tentando: ${url}"
        if curl -fsSL -o "$destino" "$url" 2>/dev/null; then
            echo "    OK"
            return 0
        fi
    done
    echo "[ERRO] Nenhuma URL de repositorio respondeu. Verifique a versao '${ZBX_MAJOR}' e a distro." >&2
    return 1
}

install_debian() {
    local repo_deb="/tmp/zabbix-release.deb"
    echo "==> Configurando repositorio Zabbix ${ZBX_MAJOR} para ${DISTRO_ID} ${VERSION_CODENAME}..."

    # Formato atual (7.x) inclui o segmento /release/ e a versao no nome do arquivo.
    # O formato legado (sem /release/) ainda vale para branches mais antigos.
    baixar_primeira_url_valida "$repo_deb" \
        "https://repo.zabbix.com/zabbix/${ZBX_MAJOR}/release/${DISTRO_ID}/pool/main/z/zabbix-release/zabbix-release_latest_${ZBX_MAJOR}+${DISTRO_ID}${DISTRO_VER}_all.deb" \
        "https://repo.zabbix.com/zabbix/${ZBX_MAJOR}/${DISTRO_ID}/pool/main/z/zabbix-release/zabbix-release_latest_${ZBX_MAJOR}+${DISTRO_ID}${DISTRO_VER}_all.deb" \
        "https://repo.zabbix.com/zabbix/${ZBX_MAJOR}/${DISTRO_ID}/pool/main/z/zabbix-release/zabbix-release_latest+${DISTRO_ID}${DISTRO_VER}_all.deb"

    dpkg -i "$repo_deb"
    rm -f "$repo_deb"
    apt-get update -qq
    apt-get install -y zabbix-agent2
}

install_rhel() {
    local major_os repo_rpm
    major_os="${DISTRO_VER%%.*}"
    repo_rpm="/tmp/zabbix-release.rpm"
    echo "==> Configurando repositorio Zabbix ${ZBX_MAJOR} para RHEL-like ${major_os}..."

    baixar_primeira_url_valida "$repo_rpm" \
        "https://repo.zabbix.com/zabbix/${ZBX_MAJOR}/release/rhel/${major_os}/x86_64/zabbix-release-latest-${ZBX_MAJOR}.el${major_os}.noarch.rpm" \
        "https://repo.zabbix.com/zabbix/${ZBX_MAJOR}/rhel/${major_os}/x86_64/zabbix-release-latest-${ZBX_MAJOR}.el${major_os}.noarch.rpm" \
        "https://repo.zabbix.com/zabbix/${ZBX_MAJOR}/rhel/${major_os}/x86_64/zabbix-release-latest.el${major_os}.noarch.rpm"

    rpm -Uvh --force "$repo_rpm"
    rm -f "$repo_rpm"

    if command -v dnf >/dev/null 2>&1; then
        dnf clean all -q && dnf install -y zabbix-agent2
    else
        yum clean all -q && yum install -y zabbix-agent2
    fi
}

case "$DISTRO_ID" in
    ubuntu|debian) install_debian ;;
    rhel|centos|rocky|almalinux|ol) install_rhel ;;
    *) echo "[ERRO] Distro nao suportada por este script: $DISTRO_ID" >&2; exit 1 ;;
esac

# Confirma que o pacote realmente chegou antes de tentar configurar
if ! command -v zabbix_agent2 >/dev/null 2>&1 && [[ ! -f /etc/zabbix/zabbix_agent2.conf ]]; then
    echo "[ERRO] zabbix-agent2 nao foi instalado. Abortando antes da configuracao." >&2
    exit 1
fi

# --- Configuracao ---
CONF="/etc/zabbix/zabbix_agent2.conf"
echo "==> Configurando ${CONF}..."

set_conf() {
    local key="$1" value="$2"
    if grep -qE "^\s*${key}=" "$CONF"; then
        sed -i "s|^\s*${key}=.*|${key}=${value}|" "$CONF"
    else
        echo "${key}=${value}" >> "$CONF"
    fi
}

set_conf "Server"       "$ZABBIX_SERVER"
set_conf "ServerActive" "$ZABBIX_SERVER"
set_conf "Hostname"     "$HOSTNAME_AGENT"
set_conf "HostMetadata" "$METADATA"

# --- Firewall (best effort) ---
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port=10050/tcp >/dev/null && firewall-cmd --reload >/dev/null
    echo "==> Porta 10050 liberada no firewalld."
elif command -v ufw >/dev/null 2>&1 && ufw status | grep -qi active; then
    ufw allow 10050/tcp >/dev/null
    echo "==> Porta 10050 liberada no ufw."
fi

# --- Servico ---
systemctl enable zabbix-agent2 >/dev/null 2>&1
systemctl restart zabbix-agent2

sleep 3
if systemctl is-active --quiet zabbix-agent2; then
    echo "[SUCESSO] zabbix-agent2 instalado e rodando. Hostname=${HOSTNAME_AGENT} Metadata=${METADATA}"
    exit 0
else
    echo "[ERRO] Servico nao iniciou. Veja: journalctl -u zabbix-agent2 -n 50" >&2
    exit 2
fi
