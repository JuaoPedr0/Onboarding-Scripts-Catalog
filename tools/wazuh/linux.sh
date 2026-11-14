#!/usr/bin/env bash

# ============================================================
# WAZUH AGENT - PROVISIONAMENTO LINUX
# ============================================================

set -Eeuo pipefail

# ============================================================
# PARAMETROS
# ============================================================

# Parametros: variaveis de ambiente com default. Pelo webhook, o n8n
# injeta as atribuicoes logo apos o shebang. Listas chegam em CSV.
# Local: sudo WAZUH_MANAGER=<host> WAZUH_AGENT_GROUPS_CSV=a,b bash linux.sh
WAZUH_MANAGER="${WAZUH_MANAGER:-}"

WAZUH_AGENT_GROUPS_CSV="${WAZUH_AGENT_GROUPS_CSV:-}"
WAZUH_AGENT_GROUPS=()
IFS=',' read -r -a WAZUH_AGENT_GROUPS <<< "$WAZUH_AGENT_GROUPS_CSV"

WAZUH_VERSION="${WAZUH_VERSION:-latest}"

WAZUH_AGENT_NAME="${WAZUH_AGENT_NAME:-}"

WAZUH_MANAGER_PORT="${WAZUH_MANAGER_PORT:-1514}"

WAZUH_REGISTRATION_PORT="${WAZUH_REGISTRATION_PORT:-1515}"

WAZUH_PROTOCOL="${WAZUH_PROTOCOL:-tcp}"

FORCE_REINSTALL="${FORCE_REINSTALL:-false}"

PRESERVE_KEYS="${PRESERVE_KEYS:-false}"

SKIP_CONNECTIVITY="${SKIP_CONNECTIVITY:-false}"

# ============================================================
# CONSTANTES
# ============================================================

SERVICE_NAME='wazuh-agent'

INSTALL_ROOT='/var/ossec'

CONFIG_PATH='/var/ossec/etc/ossec.conf'

CLIENT_KEYS_PATH='/var/ossec/etc/client.keys'

AUTHD_PASS_PATH='/var/ossec/etc/authd.pass'

LOG_PATH='/tmp/wazuh-provisionamento.log'

PACKAGE_CACHE='/tmp/wazuh-agent-package'

REPOSITORY_FILE_APT='/etc/apt/sources.list.d/wazuh.list'

REPOSITORY_FILE_RPM='/etc/yum.repos.d/wazuh.repo'

GPG_KEY_URL='https://packages.wazuh.com/key/GPG-KEY-WAZUH'

APT_REPOSITORY='deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main'

# ============================================================
# SAIDA
# ============================================================

log() {
    echo "[..] $*"
}

ok() {
    echo "[ OK ] $*"
}

warn() {
    echo "[AVISO] $*"
}

fail() {
    echo "[FALHA] $*" >&2
}

step() {
    echo
    echo "============================================================"
    echo "$*"
    echo "============================================================"
}

# ============================================================
# ERROS
# ============================================================

on_error() {
    local exit_code=$?
    local line="${BASH_LINENO[0]:-unknown}"

    echo
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "[ERRO] Falha na linha $line"
    echo "[ERRO] Exit code: $exit_code"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo

    return "$exit_code"
}

trap on_error ERR

# ============================================================
# ROOT
# ============================================================

require_root() {

    if [[ "$EUID" -ne 0 ]]; then
        fail "Execute como root."
        return 1
    fi

    return 0
}

# ============================================================
# DISTRIBUICAO
# ============================================================

detect_os() {

    if [[ ! -f /etc/os-release ]]; then
        fail "/etc/os-release nao encontrado."
        return 1
    fi

    # shellcheck disable=SC1091
    source /etc/os-release

    DISTRO_ID="${ID:-unknown}"
    DISTRO_VERSION="${VERSION_ID:-unknown}"
    DISTRO_CODENAME="${VERSION_CODENAME:-}"

    ARCH="$(dpkg --print-architecture 2>/dev/null || true)"

    if [[ -z "$ARCH" ]]; then
        ARCH="$(uname -m)"
    fi

    echo
    echo "Distro     : ${PRETTY_NAME:-$DISTRO_ID}"
    echo "Versao     : $DISTRO_VERSION"
    echo "Arquitetura: $ARCH"
}

# ============================================================
# NORMALIZACAO DE ARQUITETURA
# ============================================================

normalize_arch() {

    case "$ARCH" in

        amd64|x86_64)
            PACKAGE_ARCH='amd64'
            ;;

        arm64|aarch64)
            PACKAGE_ARCH='arm64'
            ;;

        armhf|armv7l)
            PACKAGE_ARCH='armhf'
            ;;

        i386|i686)
            PACKAGE_ARCH='i386'
            ;;

        *)
            fail "Arquitetura nao suportada: $ARCH"
            return 1
            ;;

    esac

    ok "Arquitetura reconhecida: $PACKAGE_ARCH"
}

# ============================================================
# PACOTE INSTALADO
# ============================================================

get_installed_version() {

    if command -v dpkg-query >/dev/null 2>&1; then

        dpkg-query             -W             -f='${Version}'             wazuh-agent             2>/dev/null || true

        return 0
    fi

    if command -v rpm >/dev/null 2>&1; then

        rpm -q             --qf '%{VERSION}-%{RELEASE}'             wazuh-agent             2>/dev/null || true

        return 0
    fi

    return 0
}

# ============================================================
# SERVICO
# ============================================================

is_agent_running() {

    systemctl is-active         --quiet         "$SERVICE_NAME"         2>/dev/null
}

# ============================================================
# CONECTIVIDADE TCP
# ============================================================

test_tcp_port() {

    local host="$1"
    local port="$2"

    if command -v nc >/dev/null 2>&1; then

        nc             -z             -w 5             "$host"             "$port"             >/dev/null 2>&1

        return $?
    fi

    if command -v timeout >/dev/null 2>&1; then

        timeout 5             bash -c             "</dev/tcp/$host/$port"             >/dev/null 2>&1

        return $?
    fi

    return 2
}

test_manager_connectivity() {

    step "PRE-FLIGHT: CONECTIVIDADE"

    if [[ "$SKIP_CONNECTIVITY" == 'true' ]]; then
        warn "Teste de conectividade ignorado."
        return 0
    fi

    log "Testando $WAZUH_MANAGER:$WAZUH_MANAGER_PORT..."

    if test_tcp_port         "$WAZUH_MANAGER"         "$WAZUH_MANAGER_PORT"; then

        ok "$WAZUH_MANAGER_PORT/TCP acessivel."

    else

        fail             "$WAZUH_MANAGER_PORT/TCP inacessivel."

        return 1
    fi

    log "Testando $WAZUH_MANAGER:$WAZUH_REGISTRATION_PORT..."

    if test_tcp_port         "$WAZUH_MANAGER"         "$WAZUH_REGISTRATION_PORT"; then

        ok "$WAZUH_REGISTRATION_PORT/TCP acessivel."

    else

        fail             "$WAZUH_REGISTRATION_PORT/TCP inacessivel."

        return 1
    fi
}

# ============================================================
# REPOSITORIO APT
# ============================================================

configure_apt_repository() {

    step "CONFIGURANDO REPOSITORIO APT"

    export DEBIAN_FRONTEND=noninteractive

    log "Instalando dependencias..."

    apt-get update -qq

    apt-get install         -y         curl         gnupg         apt-transport-https         ca-certificates         >/dev/null

    log "Importando chave GPG do Wazuh..."

    mkdir -p         /usr/share/keyrings

    curl         -fsSL         "$GPG_KEY_URL" |
        gpg         --no-default-keyring         --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg         --import

    chmod 644         /usr/share/keyrings/wazuh.gpg

    echo "$APT_REPOSITORY"         > "$REPOSITORY_FILE_APT"

    apt-get update -qq

    ok "Repositorio APT configurado."
}

# ============================================================
# REPOSITORIO RPM
# ============================================================

configure_rpm_repository() {

    step "CONFIGURANDO REPOSITORIO RPM"

    if ! command -v rpm >/dev/null 2>&1; then

        fail "rpm nao encontrado."

        return 1
    fi

    log "Importando chave GPG..."

    rpm         --import         "$GPG_KEY_URL"

    cat > "$REPOSITORY_FILE_RPM" <<EOF
[wazuh]
gpgcheck=1
gpgkey=$GPG_KEY_URL
enabled=1
name=EL-\$releasever - Wazuh
baseurl=https://packages.wazuh.com/4.x/yum/
priority=1
EOF

    if command -v dnf >/dev/null 2>&1; then

        dnf             clean all             >/dev/null 2>&1 || true

        dnf             makecache             -q             >/dev/null 2>&1 || true

    elif command -v yum >/dev/null 2>&1; then

        yum             clean all             >/dev/null 2>&1 || true

    fi

    ok "Repositorio RPM configurado."
}

# ============================================================
# RESOLUCAO DE VERSAO
# ============================================================

resolve_version() {

    step "RESOLVENDO VERSAO"

    if [[ "$WAZUH_VERSION" == 'latest' ]]; then

        log "Usando a versao mais recente disponivel no repositorio."

        RESOLVED_VERSION='latest'

        return 0
    fi

    RESOLVED_VERSION="$WAZUH_VERSION"

    ok "Versao solicitada: $RESOLVED_VERSION"
}

# ============================================================
# VERIFICACAO DE INSTALACAO
# ============================================================

agent_already_conform() {

    local installed

    installed="$(get_installed_version)"

    if [[ -z "$installed" ]]; then
        return 1
    fi

    if ! is_agent_running; then
        return 1
    fi

    if [[ ! -s "$CLIENT_KEYS_PATH" ]]; then
        return 1
    fi

    if [[ ! -f "$CONFIG_PATH" ]]; then
        return 1
    fi

    if ! grep         -q         "<address>${WAZUH_MANAGER}</address>"         "$CONFIG_PATH"         2>/dev/null; then

        return 1
    fi

    if [[ "$WAZUH_VERSION" == 'latest' ]]; then

        ok "Agente ja instalado, registrado e em execucao."

        return 0
    fi

    local desired_base
    desired_base="${WAZUH_VERSION%%-*}"

    if [[ "$installed" == "$WAZUH_VERSION" ||
          "$installed" == "$desired_base"* ]]; then

        ok             "Agente ja esta na versao desejada: $installed"

        return 0
    fi

    return 1
}

# ============================================================
# PRESERVAR CLIENT.KEYS
# ============================================================

backup_client_keys() {

    if [[ "$PRESERVE_KEYS" != 'true' ]]; then
        return 0
    fi

    if [[ ! -s "$CLIENT_KEYS_PATH" ]]; then
        return 0
    fi

    local backup

    backup='/tmp/wazuh-client.keys.backup'

    cp         -f         "$CLIENT_KEYS_PATH"         "$backup"

    chmod 600         "$backup"

    echo "$backup"
}

# ============================================================
# REMOVER INSTALACAO
# ============================================================

remove_existing_agent() {

    step "REMOVENDO INSTALACAO EXISTENTE"

    local keys_backup=''

    keys_backup="$(backup_client_keys || true)"

    if is_agent_running; then

        log "Parando $SERVICE_NAME..."

        systemctl stop             "$SERVICE_NAME"             || true
    fi

    if command -v apt-get >/dev/null 2>&1 &&
       dpkg-query -W wazuh-agent >/dev/null 2>&1; then

        log "Removendo pacote wazuh-agent..."

        DEBIAN_FRONTEND=noninteractive             apt-get remove             -y             wazuh-agent             >/dev/null

    elif command -v rpm >/dev/null 2>&1 &&
         rpm -q wazuh-agent >/dev/null 2>&1; then

        log "Removendo pacote wazuh-agent..."

        if command -v dnf >/dev/null 2>&1; then
            dnf remove -y wazuh-agent
        else
            yum remove -y wazuh-agent
        fi
    fi

    if [[ -d "$INSTALL_ROOT" ]]; then

        log "Removendo $INSTALL_ROOT..."

        rm             -rf             "$INSTALL_ROOT"
    fi

    if [[ -n "$keys_backup" &&
          -s "$keys_backup" ]]; then

        mkdir             -p             "$INSTALL_ROOT/etc"

        cp             -f             "$keys_backup"             "$CLIENT_KEYS_PATH"

        chmod 640             "$CLIENT_KEYS_PATH"

        rm             -f             "$keys_backup"

        ok "client.keys preservado."
    fi

    ok "Limpeza concluida."
}

# ============================================================
# INSTALACAO APT
# ============================================================

install_apt() {

    step "INSTALANDO WAZUH AGENT - APT"

    configure_apt_repository

    local package='wazuh-agent'

    if [[ "$RESOLVED_VERSION" != 'latest' ]]; then

        package="wazuh-agent=${RESOLVED_VERSION}"

        log "Instalando versao especifica: $package"

    else

        log "Instalando ultima versao disponivel."

    fi

    if [[ -n "$WAZUH_AGENT_NAME" ]]; then

        export WAZUH_AGENT_NAME
    fi

    export WAZUH_MANAGER
    export WAZUH_MANAGER_PORT
    export WAZUH_PROTOCOL
    export WAZUH_REGISTRATION_SERVER="$WAZUH_MANAGER"
    export WAZUH_REGISTRATION_PORT

    if [[ "${WAZUH_AGENT_GROUPS[*]:-}" != '' ]]; then

        export             WAZUH_AGENT_GROUP="$(IFS=,; echo "${WAZUH_AGENT_GROUPS[*]}")"
    fi

    apt-get install         -y         "$package"

    ok "Pacote Wazuh instalado."
}

# ============================================================
# INSTALACAO RPM
# ============================================================

install_rpm() {

    step "INSTALANDO WAZUH AGENT - RPM"

    configure_rpm_repository

    local package='wazuh-agent'

    if [[ "$RESOLVED_VERSION" != 'latest' ]]; then

        package="wazuh-agent-${RESOLVED_VERSION}"

    fi

    export WAZUH_MANAGER
    export WAZUH_MANAGER_PORT
    export WAZUH_PROTOCOL
    export WAZUH_REGISTRATION_SERVER="$WAZUH_MANAGER"
    export WAZUH_REGISTRATION_PORT

    if [[ -n "$WAZUH_AGENT_NAME" ]]; then
        export WAZUH_AGENT_NAME
    fi

    if [[ "${WAZUH_AGENT_GROUPS[*]:-}" != '' ]]; then

        export             WAZUH_AGENT_GROUP="$(IFS=,; echo "${WAZUH_AGENT_GROUPS[*]}")"
    fi

    if command -v dnf >/dev/null 2>&1; then

        dnf             install             -y             "$package"

    else

        yum             install             -y             "$package"

    fi

    ok "Pacote Wazuh instalado."
}

# ============================================================
# CONFIGURACAO
# ============================================================

xml_escape() {

    printf '%s' "$1" |
        sed             -e 's/&/\&amp;/g'             -e 's/</\&lt;/g'             -e 's/>/\&gt;/g'             -e 's/"/\&quot;/g'             -e "s/'/\&apos;/g"
}

write_ossec_config() {

    step "VALIDANDO CONFIGURACAO"

    if [[ ! -f "$CONFIG_PATH" ]]; then

        fail             "ossec.conf nao encontrado: $CONFIG_PATH"

        return 1
    fi

    local manager_xml
    local port_xml
    local protocol_xml

    manager_xml="$(xml_escape "$WAZUH_MANAGER")"
    port_xml="$(xml_escape "$WAZUH_MANAGER_PORT")"
    protocol_xml="$(xml_escape "$WAZUH_PROTOCOL")"

    # --------------------------------------------------------
    # Nao substituimos todo o ossec.conf.
    #
    # O pacote oficial ja gera a configuracao adequada.
    # Apenas garantimos que os parametros fundamentais estejam
    # presentes.
    # --------------------------------------------------------

    if grep -q '<address>' "$CONFIG_PATH"; then

        sed -i             "s|<address>[^<]*</address>|<address>${manager_xml}</address>|"             "$CONFIG_PATH"

    else

        sed -i             "/<server>/a\\
      <address>${manager_xml}</address>"             "$CONFIG_PATH"

    fi

    if grep -q '<port>' "$CONFIG_PATH"; then

        sed -i             "0,/<port>[^<]*<\/port>/s||<port>${port_xml}</port>|"             "$CONFIG_PATH"

    fi

    if grep -q '<protocol>' "$CONFIG_PATH"; then

        sed -i             "0,/<protocol>[^<]*<\/protocol>/s||<protocol>${protocol_xml}</protocol>|"             "$CONFIG_PATH"

    fi

    if command -v xmllint >/dev/null 2>&1; then

        if ! xmllint             --noout             "$CONFIG_PATH"             >/dev/null 2>&1; then

            fail                 "ossec.conf nao e um XML valido."

            return 1
        fi

    fi

    ok "ossec.conf validado."
}

# ============================================================
# SERVICO
# ============================================================

start_agent() {

    step "INICIANDO AGENTE"

    systemctl daemon-reload

    systemctl enable         "$SERVICE_NAME"         >/dev/null 2>&1

    systemctl restart         "$SERVICE_NAME"

    sleep 5

    if is_agent_running; then

        ok "Wazuh Agent esta em execucao."

        return 0
    fi

    fail "Wazuh Agent nao iniciou."

    systemctl status         "$SERVICE_NAME"         --no-pager         -l         || true

    return 2
}

# ============================================================
# VALIDACAO DO ENROLLMENT
# ============================================================

validate_enrollment() {

    step "VALIDANDO ENROLLMENT"

    local timeout=120
    local elapsed=0

    while (( elapsed < timeout )); do

        if [[ -s "$CLIENT_KEYS_PATH" ]]; then

            local agent_id
            local agent_name

            agent_id="$(
                awk                     'NR==1 {print $1}'                     "$CLIENT_KEYS_PATH"
            )"

            agent_name="$(
                awk                     'NR==1 {print $2}'                     "$CLIENT_KEYS_PATH"
            )"

            if [[ -n "$agent_id" &&
                  -n "$agent_name" ]]; then

                ok                     "Enrollment concluido."

                echo                     "    ID   : $agent_id"

                echo                     "    Nome : $agent_name"

                return 0
            fi
        fi

        sleep 3

        elapsed=$((elapsed + 3))
    done

    warn         "Nao foi possivel confirmar o client.keys."

    if [[ -f "$INSTALL_ROOT/logs/ossec.log" ]]; then

        echo
        echo "Ultimos eventos do ossec.log:"

        tail             -n 30             "$INSTALL_ROOT/logs/ossec.log"             || true
    fi

    return 2
}

# ============================================================
# VALIDACAO FINAL
# ============================================================

show_result() {

    step "RESULTADO"

    local installed
    installed="$(get_installed_version)"

    echo "Versao       : ${installed:-desconhecida}"
    echo "Manager      : $WAZUH_MANAGER"
    echo "Porta        : $WAZUH_MANAGER_PORT"
    echo "Enrollment   : $WAZUH_REGISTRATION_PORT"
    echo "Protocolo    : $WAZUH_PROTOCOL"
    echo "Nome         : ${WAZUH_AGENT_NAME:-$(hostname)}"

    if [[ "${WAZUH_AGENT_GROUPS[*]:-}" != '' ]]; then
        echo             "Grupos       : ${WAZUH_AGENT_GROUPS[*]}"
    else
        echo "Grupos       : (nenhum)"
    fi

    echo "Install Path : $INSTALL_ROOT"

    if is_agent_running; then
        echo "Servico      : RUNNING"
    else
        echo "Servico      : STOPPED"
    fi

    if [[ -s "$CLIENT_KEYS_PATH" ]]; then
        echo "Registrado   : SIM"
    else
        echo "Registrado   : NAO"
    fi

    echo
    echo "[EXIT CODE] 0  (ok)"
}

# ============================================================
# MAIN
# ============================================================

main() {

    require_root

    detect_os

    normalize_arch

    # --------------------------------------------------------
    # Manager obrigatorio
    # --------------------------------------------------------

    if [[ -z "$WAZUH_MANAGER" ]]; then

        fail             "Manager nao informado."

        echo
        echo "Use:"
        echo
        echo "  ?script=wazuh&os=linux&manager=<HOST_DO_MANAGER>"

        return 1
    fi

    # --------------------------------------------------------
    # Pre-flight
    # --------------------------------------------------------

    test_manager_connectivity

    resolve_version

    # --------------------------------------------------------
    # Idempotencia
    # --------------------------------------------------------

    if [[ "$FORCE_REINSTALL" != 'true' ]]; then

        if agent_already_conform; then

            step "HOST JA CONFIGURADO"

            show_result

            return 0
        fi

        log             "Host fora do estado desejado. Prosseguindo."
    else

        warn             "Reinstalacao forcada."
    fi

    # --------------------------------------------------------
    # Instalacao
    # --------------------------------------------------------

    case "$DISTRO_ID" in

        ubuntu|debian|linuxmint|kali)

            remove_existing_agent

            install_apt

            ;;

        rhel|centos|rocky|almalinux|ol|fedora|amzn)

            remove_existing_agent

            install_rpm

            ;;

        *)

            fail                 "Distribuicao nao suportada: $DISTRO_ID"

            return 1

            ;;

    esac

    # --------------------------------------------------------
    # Configuracao
    # --------------------------------------------------------

    write_ossec_config

    # --------------------------------------------------------
    # Start
    # --------------------------------------------------------

    start_agent

    # --------------------------------------------------------
    # Enrollment
    # --------------------------------------------------------

    if ! validate_enrollment; then

        warn             "Agente instalado, mas enrollment nao foi confirmado."

        return 2
    fi

    # --------------------------------------------------------
    # Resultado
    # --------------------------------------------------------

    show_result

    return 0
}

# ============================================================
# EXECUCAO
# ============================================================

set +e

main

WAZUH_EXIT_CODE=$?

set -e

echo
echo "[EXIT CODE] $WAZUH_EXIT_CODE  (0=ok, 1=erro, 2=atencao)"

exit "$WAZUH_EXIT_CODE"
