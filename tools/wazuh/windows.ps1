# ============================================================
#  WAZUH AGENT - PROVISIONAMENTO WINDOWS
#  Codigos: 0 = ok | 1 = erro | 2 = atencao (verificar)
# ============================================================

# Parametros nativos: o script roda sozinho. Pelo webhook, o n8n injeta
# os valores da URL (?manager=...&group=...); tambem valem na chamada: & ([ScriptBlock]::Create($s)) -Manager ... -AgentGroup ...
param(
    [string]   $Manager               = '',
    [string[]] $AgentGroup            = @(),
    [string]   $WazuhVersion          = 'latest',
    [string]   $AgentName             = '',
    [string]   $RegistrationPassword  = '',
    [int]      $ManagerPort           = 1514,
    [int]      $EnrollPort            = 1515,
    [ValidateSet('tcp','udp')]
    [string]   $Protocol              = 'tcp',
    [switch]   $Force,
    [switch]   $PreserveKeys,
    [switch]   $SkipConnectivityCheck,
    [switch]   $SkipSignatureCheck
)

# ============================================================
#  NORMALIZACAO DOS PARAMETROS
#
#  Os valores vem dos parametros do script (direto ou injetados pelo
#  webhook de onboarding a partir da query string).
# ============================================================

$WazuhManager = "$Manager".Trim()

$AgentGroups = @(
    $AgentGroup |
        ForEach-Object { "$_" -split ',' } |
        ForEach-Object { $_.Trim() } |
        Where-Object   { $_ } |
        Select-Object  -Unique
)

$AgentName            = "$AgentName".Trim()
$RegistrationPassword = "$RegistrationPassword"
$ForceReinstall       = [bool]$Force

# ============================================================
#  CONSTANTES
# ============================================================

$ServiceName              = 'WazuhSvc'
$InstallRoot              = Join-Path ${env:ProgramFiles(x86)} 'ossec-agent'
$ConfigPath               = Join-Path $InstallRoot 'ossec.conf'
$ClientKeysPath           = Join-Path $InstallRoot 'client.keys'
$AuthdPassFile            = 'authd.pass'
$PackageBaseUrl           = 'https://packages.wazuh.com/4.x/windows'
$FallbackVersion          = '4.14.7-1'
$EnrollmentTimeoutSeconds = 120
$LogPath                  = Join-Path $env:TEMP 'wazuh-provisionamento.log'

# ============================================================
# SAIDA
# ============================================================

function Write-Step {
    param([Parameter(Mandatory)][string]$Message)

    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor Cyan
}

function Write-Ok      { param([string]$Message) Write-Host "  [ OK ] $Message"    -ForegroundColor Green }
function Write-Info    { param([string]$Message) Write-Host "  [ .. ] $Message" }
function Write-Problem { param([string]$Message) Write-Host "  [AVISO] $Message"   -ForegroundColor Yellow }
function Write-Fail    { param([string]$Message) Write-Host "  [FALHA] $Message"   -ForegroundColor Red }

# ============================================================
# UTILITARIOS
# ============================================================

function ConvertTo-XmlSafe {
    param([string]$Value)

    return [System.Security.SecurityElement]::Escape($Value)
}

function Set-ContentNoBom {
    # O parser do agente e sensivel a BOM em alguns cenarios e
    # Set-Content -Encoding UTF8 no PowerShell 5.1 SEMPRE grava BOM.
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Value
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Initialize-Tls {
    try {
        $protocols = [Net.SecurityProtocolType]::Tls12

        if ([enum]::GetNames([Net.SecurityProtocolType]) -contains 'Tls13') {
            $protocols = $protocols -bor [Net.SecurityProtocolType]::Tls13
        }

        [Net.ServicePointManager]::SecurityProtocol = $protocols
    }
    catch {
        Write-Problem "Nao foi possivel ajustar o TLS: $($_.Exception.Message)"
    }
}

function Test-Elevation {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)

    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ============================================================
# WINDOWS INSTALLER
# ============================================================

function Wait-MsiDisponivel {
    # O Windows so permite UMA instalacao MSI por vez. Se outra estiver
    # em curso (tipicamente Windows Update), o msiexec falha com 1618.
    param([int]$TimeoutSegundos = 900)

    $limite = (Get-Date).AddSeconds($TimeoutSegundos)
    $avisou = $false

    while ((Get-Date) -lt $limite) {

        try {
            $mutex = [System.Threading.Mutex]::OpenExisting('Global\_MSIExecute')
            $mutex.Dispose()

            if (-not $avisou) {
                Write-Problem 'Outra instalacao MSI em andamento (provavelmente Windows Update). Aguardando...'
                $avisou = $true
            }

            Start-Sleep -Seconds 15
        }
        catch [System.Threading.WaitHandleCannotBeOpenedException] {
            # Mutex nao existe = nenhuma instalacao em curso
            if ($avisou) { Write-Ok 'Windows Installer liberado.' }
            return $true
        }
        catch {
            # Mutex existe mas sem permissao de abrir: tratar como ocupado
            Start-Sleep -Seconds 15
        }
    }

    return $false
}

function Invoke-MsiExec {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [int]$MaxTentativas = 5
    )

    for ($tentativa = 1; $tentativa -le $MaxTentativas; $tentativa++) {

        if (-not (Wait-MsiDisponivel)) {
            throw 'Timeout aguardando o Windows Installer ficar livre.'
        }

        $process = Start-Process -FilePath 'msiexec.exe' `
                                 -ArgumentList $Arguments `
                                 -Wait -PassThru -WindowStyle Hidden

        if ($process.ExitCode -ne 1618) {
            return $process.ExitCode
        }

        if ($tentativa -lt $MaxTentativas) {
            $espera = 30 * $tentativa
            Write-Problem "MSI ocupado (1618). Tentativa $tentativa/$MaxTentativas. Nova tentativa em $espera s..."
            Start-Sleep -Seconds $espera
        }
    }

    throw 'O msiexec permaneceu ocupado (1618) apos todas as tentativas.'
}

# ============================================================
# RESOLUCAO DE VERSAO
# ============================================================

function Test-PackageUrl {
    param([Parameter(Mandatory)][string]$Url)

    try {
        $null = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 20
        return $true
    }
    catch {
        # Alguns edges rejeitam HEAD; tenta um GET de 1 byte antes de desistir.
        try {
            $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20 `
                                      -Headers @{ Range = 'bytes=0-0' }
            return $true
        }
        catch {
            return $false
        }
    }
}

function Get-LatestWazuhVersion {
    # Cascata: documentacao oficial -> GitHub Releases -> fallback embutido.

    $docUrl = 'https://documentation.wazuh.com/current/installation-guide/wazuh-agent/wazuh-agent-package-windows.html'

    try {
        Write-Info 'Consultando documentacao oficial...'

        $page  = Invoke-WebRequest -Uri $docUrl -UseBasicParsing -TimeoutSec 25
        $match = [regex]::Match($page.Content, 'wazuh-agent-(\d+\.\d+\.\d+-\d+)\.msi')

        if ($match.Success) { return $match.Groups[1].Value }
    }
    catch {
        Write-Info "Documentacao indisponivel: $($_.Exception.Message)"
    }

    try {
        Write-Info 'Consultando GitHub Releases...'

        $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/wazuh/wazuh/releases/latest' `
                                     -Headers @{ 'User-Agent' = 'wazuh-provisioning' } `
                                     -TimeoutSec 25

        $match = [regex]::Match([string]$release.tag_name, '(\d+\.\d+\.\d+)')

        if ($match.Success) { return $match.Groups[1].Value }
    }
    catch {
        Write-Info "GitHub indisponivel: $($_.Exception.Message)"
    }

    Write-Problem "Nao foi possivel resolver a versao mais recente. Usando fallback: $FallbackVersion"

    return $FallbackVersion
}

function Resolve-WazuhPackage {
    param([Parameter(Mandatory)][string]$RequestedVersion)

    Write-Step '1. RESOLVENDO PACOTE'

    $version = $RequestedVersion

    if ($version -eq 'latest') {
        $version = Get-LatestWazuhVersion
        Write-Ok "Versao mais recente identificada: $version"
    }
    else {
        Write-Info "Versao solicitada: $version"
    }

    $candidatos = if ($version -match '-\d+$') { @($version) }
                  else { 1..3 | ForEach-Object { "$version-$_" } }

    foreach ($candidato in $candidatos) {

        $url = "$PackageBaseUrl/wazuh-agent-$candidato.msi"

        Write-Info "Validando $url"

        if (Test-PackageUrl -Url $url) {

            Write-Ok "Pacote disponivel: wazuh-agent-$candidato.msi"

            return [pscustomobject]@{
                Version = $candidato
                Url     = $url
            }
        }
    }

    throw "Nenhum pacote encontrado para a versao '$RequestedVersion' em $PackageBaseUrl."
}

# ============================================================
# ESTADO ATUAL DO HOST
# ============================================================

function Get-InstalledWazuh {
    # Evitamos Win32_Product porque ele pode disparar
    # validacoes/reconfiguracoes de MSI no Windows.

    $uninstallPaths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )

    return @(
        foreach ($path in $uninstallPaths) {
            Get-ItemProperty -Path $path -ErrorAction SilentlyContinue |
                Where-Object { $_.DisplayName -like 'Wazuh Agent*' }
        }
    )
}

function Test-AgentConforme {
    # Idempotencia: se o host ja esta no estado desejado, nao mexe em nada.
    param([Parameter(Mandatory)][string]$TargetVersion)

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

    if ($null -eq $service -or $service.Status -ne 'Running') { return $false }

    $instalado = Get-InstalledWazuh | Select-Object -First 1

    if ($null -eq $instalado) { return $false }

    $alvo = ($TargetVersion -split '-')[0]

    if ([string]$instalado.DisplayVersion -ne $alvo) {
        Write-Info "Versao instalada ($($instalado.DisplayVersion)) difere da desejada ($alvo)."
        return $false
    }

    if (-not (Test-Path $ClientKeysPath)) { return $false }

    $keys = Get-Content -Path $ClientKeysPath -Raw -ErrorAction SilentlyContinue

    if (-not $keys -or -not $keys.Trim()) { return $false }

    if (-not (Test-Path $ConfigPath)) { return $false }

    $conf = Get-Content -Path $ConfigPath -Raw -ErrorAction SilentlyContinue

    if ($conf -notmatch [regex]::Escape($WazuhManager)) {
        Write-Info 'O ossec.conf aponta para outro manager.'
        return $false
    }

    return $true
}

# ============================================================
# CONECTIVIDADE
# ============================================================

function Test-ManagerConnectivity {
    param(
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][int[]]$Ports
    )

    $tudoOk = $true

    foreach ($port in $Ports) {

        $resultado = Test-NetConnection -ComputerName $Target `
                                        -Port $port `
                                        -WarningAction SilentlyContinue

        if ($resultado.TcpTestSucceeded) {
            Write-Ok "$port/TCP acessivel"
        }
        else {
            Write-Fail "$port/TCP inacessivel"
            $tudoOk = $false
        }
    }

    return $tudoOk
}

# ============================================================
# REMOCAO
# ============================================================

function Remove-WazuhInstallation {

    Write-Step '3. REMOVENDO INSTALACAO EXISTENTE'

    # --------------------------------------------------------
    # Parar servico
    # --------------------------------------------------------

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

    if ($null -ne $service) {

        Write-Info "Parando servico $ServiceName..."

        try   { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue }
        catch { Write-Problem 'Nao foi possivel parar o servico normalmente.' }

        Start-Sleep -Seconds 3
    }
    else {
        Write-Info 'Servico nao encontrado (host sem agente instalado).'
    }

    # --------------------------------------------------------
    # Preservar a chave de registro, quando solicitado
    # --------------------------------------------------------

    $keysBackup = $null

    if ($PreserveKeys -and (Test-Path $ClientKeysPath)) {

        $keysBackup = Join-Path $env:TEMP 'wazuh-client.keys.bak'

        Copy-Item -Path $ClientKeysPath -Destination $keysBackup -Force -ErrorAction SilentlyContinue

        Write-Info 'client.keys preservado para reaproveitar o registro atual.'
    }

    # --------------------------------------------------------
    # Desinstalar MSI
    # --------------------------------------------------------

    foreach ($produto in (Get-InstalledWazuh)) {

        Write-Info "Encontrado: $($produto.DisplayName) [$($produto.PSChildName)]"

        if ($produto.PSChildName -notmatch '^\{[0-9A-Fa-f-]+\}$') { continue }

        $exitCode = Invoke-MsiExec -Arguments @('/x', $produto.PSChildName, '/qn', '/norestart')

        if ($exitCode -notin @(0, 1605, 3010)) {
            throw "Falha na desinstalacao do Wazuh. ExitCode: $exitCode"
        }

        Write-Ok "Desinstalado (ExitCode: $exitCode)"
    }

    # --------------------------------------------------------
    # Limpar servico residual
    # --------------------------------------------------------

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

    if ($null -ne $service) {

        Write-Problem 'Servico persistiu apos o MSI. Removendo registro residual...'

        & sc.exe delete $ServiceName | Out-Null

        Start-Sleep -Seconds 2
    }

    # --------------------------------------------------------
    # Remover diretorio completo
    # --------------------------------------------------------

    if (Test-Path $InstallRoot) {

        Write-Info "Removendo diretorio: $InstallRoot"

        Remove-Item -Path $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    # --------------------------------------------------------
    # Limpar instaladores antigos
    # --------------------------------------------------------

    Get-ChildItem -Path $env:TEMP -Filter 'wazuh-agent-*.msi' -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Write-Ok 'Limpeza concluida.'

    return $keysBackup
}

# ============================================================
# DOWNLOAD E INSTALACAO
# ============================================================

function Get-WazuhInstaller {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Destination
    )

    Write-Step '4. BAIXANDO O PACOTE'

    Write-Info $Url

    Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing

    if (-not (Test-Path $Destination)) {
        throw 'O instalador do Wazuh nao foi baixado.'
    }

    $tamanhoMb = [math]::Round((Get-Item $Destination).Length / 1MB, 2)

    Write-Ok "Download concluido ($tamanhoMb MB)"

    # --------------------------------------------------------
    # Assinatura Authenticode
    # --------------------------------------------------------

    if ($SkipSignatureCheck) {
        Write-Problem 'Validacao de assinatura ignorada por parametro.'
        return
    }

    $assinatura = Get-AuthenticodeSignature -FilePath $Destination

    if ($assinatura.Status -ne 'Valid') {
        throw "Assinatura do MSI invalida (Status: $($assinatura.Status)). Abortando."
    }

    Write-Ok "Assinatura valida: $($assinatura.SignerCertificate.Subject.Split(',')[0])"
}

function Install-WazuhAgent {
    param(
        [Parameter(Mandatory)][string]$InstallerPath,
        [string]$GroupString
    )

    Write-Step '5. INSTALANDO O AGENTE'

    $msiLog = Join-Path $env:TEMP 'wazuh-agent-install.log'

    $argumentos = [System.Collections.Generic.List[string]]::new()

    $argumentos.Add('/i')
    $argumentos.Add("`"$InstallerPath`"")
    $argumentos.Add('/qn')
    $argumentos.Add('/norestart')
    $argumentos.Add("WAZUH_MANAGER=`"$WazuhManager`"")
    $argumentos.Add("WAZUH_REGISTRATION_SERVER=`"$WazuhManager`"")
    $argumentos.Add("WAZUH_MANAGER_PORT=`"$ManagerPort`"")
    $argumentos.Add("WAZUH_REGISTRATION_PORT=`"$EnrollPort`"")
    $argumentos.Add("WAZUH_PROTOCOL=`"$($Protocol.ToUpper())`"")

    if ($GroupString) {
        $argumentos.Add("WAZUH_AGENT_GROUP=`"$GroupString`"")
        Write-Info "Grupo(s): $GroupString"
    }
    else {
        Write-Info 'Nenhum grupo informado: o agente fica apenas no grupo padrao do manager.'
    }

    if ($AgentName) {
        $argumentos.Add("WAZUH_AGENT_NAME=`"$AgentName`"")
        Write-Info "Nome do agente: $AgentName"
    }

    if ($RegistrationPassword) {
        $argumentos.Add("WAZUH_REGISTRATION_PASSWORD=`"$RegistrationPassword`"")
    }

    $argumentos.Add('/l*v')
    $argumentos.Add("`"$msiLog`"")

    $exitCode = Invoke-MsiExec -Arguments $argumentos

    if ($exitCode -notin @(0, 3010)) {
        throw "Falha na instalacao do Wazuh. ExitCode: $exitCode. Log: $msiLog"
    }

    Write-Ok "Instalacao concluida (ExitCode: $exitCode)"

    return $exitCode
}

# ============================================================
# CONFIGURACAO
# ============================================================

function Write-MinimalOssecConfig {
    param(
        [string]$GroupString,
        [string]$KeysBackup
    )

    Write-Step '6. GRAVANDO OSSEC.CONF MINIMALISTA'

    if (-not (Test-Path $InstallRoot)) {
        throw "Diretorio do Wazuh nao encontrado: $InstallRoot"
    }

    # --------------------------------------------------------
    # O servico e parado antes de reescrever a configuracao,
    # evitando que o agente registre com o ossec.conf gerado
    # pelo MSI e seja reiniciado no meio do processo.
    # --------------------------------------------------------

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

    if ($service -and $service.Status -eq 'Running') {
        Write-Info 'Parando o servico para reescrever a configuracao...'
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    if (Test-Path $ConfigPath) {
        Copy-Item -Path $ConfigPath -Destination "$ConfigPath.before-clean" -Force -ErrorAction SilentlyContinue
    }

    # --------------------------------------------------------
    # Restaurar a chave anterior, quando preservada
    # --------------------------------------------------------

    if ($KeysBackup -and (Test-Path $KeysBackup)) {

        Copy-Item -Path $KeysBackup -Destination $ClientKeysPath -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $KeysBackup -Force -ErrorAction SilentlyContinue

        Write-Ok 'client.keys restaurado (sem novo registro no manager).'
    }

    # --------------------------------------------------------
    # Senha de enrollment, quando aplicavel
    # --------------------------------------------------------

    $usarArquivoSenha = $false

    if ($RegistrationPassword) {

        $passPath = Join-Path $InstallRoot $AuthdPassFile

        Set-ContentNoBom -Path $passPath -Value $RegistrationPassword

        try {
            & icacls.exe $passPath /inheritance:r /grant:r 'SYSTEM:(R)' 'Administrators:(R)' | Out-Null
        }
        catch {
            Write-Problem 'Nao foi possivel ajustar a ACL do authd.pass.'
        }

        $usarArquivoSenha = $true

        Write-Ok "Senha de enrollment gravada em $AuthdPassFile"
    }

    # --------------------------------------------------------
    # Bloco de enrollment montado dinamicamente
    # --------------------------------------------------------

    $enrollmentLines = [System.Collections.Generic.List[string]]::new()

    $enrollmentLines.Add('      <enabled>yes</enabled>')
    $enrollmentLines.Add("      <manager_address>$(ConvertTo-XmlSafe $WazuhManager)</manager_address>")
    $enrollmentLines.Add("      <port>$EnrollPort</port>")

    if ($AgentName) {
        $enrollmentLines.Add("      <agent_name>$(ConvertTo-XmlSafe $AgentName)</agent_name>")
    }

    if ($GroupString) {
        $enrollmentLines.Add("      <groups>$(ConvertTo-XmlSafe $GroupString)</groups>")
    }

    if ($usarArquivoSenha) {
        $enrollmentLines.Add("      <authorization_pass_path>$AuthdPassFile</authorization_pass_path>")
    }

    $enrollmentBlock = $enrollmentLines -join "`r`n"

    # --------------------------------------------------------
    # CONFIGURACAO MINIMA
    #
    # Nao entram aqui: localfile, syscheck, syscollector, SCA,
    # PowerShell, Sysmon, Defender, etc.
    # Tudo isso e centralizado nos grupos do manager.
    # --------------------------------------------------------

    $config = @"
<!--
  Gerado pelo provisionamento (n8n) em $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  Configuracao minima: apenas conectividade e enrollment.
  A configuracao operacional e distribuida pelos grupos do manager.
-->
<ossec_config>

  <client>
    <server>
      <address>$(ConvertTo-XmlSafe $WazuhManager)</address>
      <port>$ManagerPort</port>
      <protocol>$Protocol</protocol>
    </server>

    <notify_time>20</notify_time>
    <time-reconnect>60</time-reconnect>
    <auto_restart>yes</auto_restart>

    <enrollment>
$enrollmentBlock
    </enrollment>
  </client>

</ossec_config>
"@

    Set-ContentNoBom -Path $ConfigPath -Value $config

    try {
        $null = [xml](Get-Content -Path $ConfigPath -Raw)
    }
    catch {
        throw "O ossec.conf gerado nao e um XML valido: $($_.Exception.Message)"
    }

    Write-Ok "Configuracao gravada e validada: $ConfigPath"
}

# ============================================================
# START E VALIDACAO
# ============================================================

function Start-AndValidateWazuh {

    Write-Step '7. INICIANDO E VALIDANDO'

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

    if ($null -eq $service) {
        throw "Servico $ServiceName nao encontrado apos a instalacao."
    }

    Set-Service -Name $ServiceName -StartupType Automatic -ErrorAction SilentlyContinue

    if ($service.Status -ne 'Running') {
        Write-Info "Iniciando $ServiceName..."
        Start-Service -Name $ServiceName
        Start-Sleep -Seconds 5
    }

    $service = Get-Service -Name $ServiceName

    if ($service.Status -ne 'Running') {
        throw 'O servico Wazuh nao iniciou corretamente.'
    }

    Write-Ok "Servico em execucao (StartType: $($service.StartType))"

    # --------------------------------------------------------
    # Aguardar o enrollment concluir
    # --------------------------------------------------------

    Write-Info "Aguardando registro no manager (timeout: $EnrollmentTimeoutSeconds s)..."

    $limite    = (Get-Date).AddSeconds($EnrollmentTimeoutSeconds)
    $registrado = $false
    $conteudo   = $null

    while ((Get-Date) -lt $limite) {

        if (Test-Path $ClientKeysPath) {

            $conteudo = Get-Content -Path $ClientKeysPath -Raw -ErrorAction SilentlyContinue

            if ($conteudo -and $conteudo.Trim()) {
                $registrado = $true
                break
            }
        }

        Start-Sleep -Seconds 3
    }

    if ($registrado) {
        $campos = ($conteudo.Trim() -split "`n")[0] -split '\s+'
        Write-Ok "Agente registrado -> ID: $($campos[0]) | Nome: $($campos[1])"
    }
    else {
        Write-Fail 'O agente nao concluiu o registro. Verifique o ossec.log e o authd no manager.'
    }

    # --------------------------------------------------------
    # Erros recentes no ossec.log
    # --------------------------------------------------------

    $ossecLog = Join-Path $InstallRoot 'ossec.log'

    if (Test-Path $ossecLog) {

        $erros = Get-Content -Path $ossecLog -Tail 200 -ErrorAction SilentlyContinue |
                    Where-Object { $_ -match 'ERROR|CRITICAL' } |
                    Select-Object -Last 5

        if ($erros) {
            Write-Problem 'Erros recentes no ossec.log:'
            $erros | ForEach-Object { Write-Host "         $_" -ForegroundColor Yellow }
        }
        else {
            Write-Ok 'Nenhum erro recente no ossec.log.'
        }
    }

    return $registrado
}

function Show-Result {
    param(
        [Parameter(Mandatory)][string]$Version,
        [string]$GroupString,
        [bool]$Registrado
    )

    Write-Step '8. RESULTADO'

    $nome = if ($AgentName) { $AgentName } else { $env:COMPUTERNAME }

    [pscustomobject]@{
        'Versao'       = $Version
        'Manager'      = $WazuhManager
        'Porta agente' = $ManagerPort
        'Porta enroll' = $EnrollPort
        'Protocolo'    = $Protocol
        'Grupos'       = if ($GroupString) { $GroupString } else { '(nenhum)' }
        'Nome'         = $nome
        'Install Path' = $InstallRoot
        'Registrado'   = if ($Registrado) { 'Sim' } else { 'Nao (verificar)' }
    } | Format-List | Out-Host

    Get-Service -Name $ServiceName |
        Select-Object Name, Status, StartType |
        Format-Table -AutoSize | Out-Host

    Write-Host 'A configuracao operacional e aplicada pelos grupos do Wazuh.' -ForegroundColor Cyan
}

# ============================================================
# ORQUESTRACAO
# ============================================================

function Invoke-WazuhProvisioning {

    $ErrorActionPreference = 'Stop'
    $ProgressPreference    = 'SilentlyContinue'   # acelera muito o Invoke-WebRequest

    $installerPath = $null
    $transcriptOn  = $false

    try {
        try {
            Start-Transcript -Path $LogPath -Force | Out-Null
            $transcriptOn = $true
        }
        catch {
            Write-Problem "Transcript indisponivel: $($_.Exception.Message)"
        }

        Write-Host ''
        Write-Host '############################################################' -ForegroundColor White
        Write-Host '#          WAZUH AGENT - PROVISIONAMENTO CONASA            #' -ForegroundColor White
        Write-Host '############################################################' -ForegroundColor White

        if (-not (Test-Elevation)) {
            Write-Fail 'Execute como Administrador.'
            return 1
        }

        if (-not $WazuhManager) {
            Write-Fail 'Manager nao informado.'
            Write-Info 'Use ?manager=<ip-ou-fqdn> na URL ou -Manager na chamada do ScriptBlock.'
            return 1
        }

        Initialize-Tls

        $groupString = $AgentGroups -join ','

        # ----------------------------------------------------
        # 1. Resolver o pacote antes de tocar no host
        # ----------------------------------------------------

        $pacote        = Resolve-WazuhPackage -RequestedVersion $WazuhVersion
        $installerPath = Join-Path $env:TEMP "wazuh-agent-$($pacote.Version).msi"

        # ----------------------------------------------------
        # 2. Idempotencia
        # ----------------------------------------------------

        Write-Step '2. AVALIANDO O ESTADO ATUAL'

        if (-not $ForceReinstall) {

            if (Test-AgentConforme -TargetVersion $pacote.Version) {
                Write-Ok 'O host ja esta no estado desejado. Nada a fazer.'
                Write-Info 'Use force=true na chamada para forcar a reinstalacao limpa.'
                return 0
            }

            Write-Info 'Host fora do estado desejado. Prosseguindo com a reinstalacao limpa.'
        }
        else {
            Write-Info 'Reinstalacao forcada por parametro (force=true).'
        }

        # ----------------------------------------------------
        # 3. Pre-voo: nao destroi uma instalacao funcional se
        #    o manager estiver inacessivel
        # ----------------------------------------------------

        if (-not $SkipConnectivityCheck) {

            Write-Info "Testando conectividade com $WazuhManager..."

            if (-not (Test-ManagerConnectivity -Target $WazuhManager -Ports @($ManagerPort, $EnrollPort))) {
                Write-Fail "O manager '$WazuhManager' nao esta acessivel. Nada foi alterado no host."
                return 1
            }
        }

        # ----------------------------------------------------
        # 4. Execucao
        # ----------------------------------------------------

        $keysBackup = Remove-WazuhInstallation

        Get-WazuhInstaller -Url $pacote.Url -Destination $installerPath

        $msiExit = Install-WazuhAgent -InstallerPath $installerPath -GroupString $groupString

        Write-MinimalOssecConfig -GroupString $groupString -KeysBackup $keysBackup

        $registrado = Start-AndValidateWazuh

        Show-Result -Version $pacote.Version -GroupString $groupString -Registrado $registrado

        if ($msiExit -eq 3010) {
            Write-Problem 'O instalador sinalizou reinicializacao pendente.'
            return 2
        }

        if (-not $registrado) { return 2 }

        return 0
    }
    catch {
        Write-Host ''
        Write-Host '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' -ForegroundColor Red
        Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Origem: linha $($_.InvocationInfo.ScriptLineNumber)" -ForegroundColor Red
        Write-Host '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' -ForegroundColor Red

        return 1
    }
    finally {
        if ($installerPath -and (Test-Path $installerPath)) {
            Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
        }

        if ($transcriptOn) {
            Write-Host ''
            Write-Host "Log completo: $LogPath"
            try { Stop-Transcript | Out-Null } catch { }
        }
    }
}

# ============================================================
# EXECUCAO
#
# @(...)[-1] garante que saidas nao capturadas dentro da funcao
# nao transformem o retorno num array e quebrem o codigo de saida.
# ============================================================

$WazuhExitCode = @(Invoke-WazuhProvisioning)[-1]

$global:WazuhExitCode     = $WazuhExitCode
$global:OnboardingExitCode = $WazuhExitCode

Write-Host ''
Write-Host "[EXIT CODE] $WazuhExitCode  (0=ok, 1=erro, 2=atencao)" -ForegroundColor DarkGray
