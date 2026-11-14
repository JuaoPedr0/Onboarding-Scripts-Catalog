<#
.SYNOPSIS
    Instalacao nao-interativa do Zabbix Agent 2 no Windows (servido via webhook n8n).
.NOTES
    Versao NAO-INTERATIVA: sem Read-Host, para uso em automacao/onboarding.
    -VersionAgent aceita major.minor (7.4 -> latest do branch) ou completa (7.4.13).
#>

# Parametros nativos: o script roda sozinho. Pelo webhook, o n8n injeta
# os valores da URL (?zabbix_server=...&metadata=...); tambem valem na chamada: & ([ScriptBlock]::Create($s)) -ZabbixServer ... -Metadata ...
param (
    [string]$ZabbixServer = '',
    [string]$Metadata     = '',
    [string]$Hostname     = '',
    [string]$VersionAgent = '7.4',
    [int]   $ListenPort   = 10050
)

# Aguarda o mutex global do Windows Installer ficar livre.
# O Windows so permite UMA instalacao MSI por vez; se outra estiver em curso
# (tipicamente Windows Update), o msiexec falha com 1618 apos poucos segundos.
function Wait-MsiDisponivel {
    param([int]$TimeoutSegundos = 900)

    $Limite = (Get-Date).AddSeconds($TimeoutSegundos)
    $Avisou = $false

    while ((Get-Date) -lt $Limite) {
        try {
            $Mutex = [System.Threading.Mutex]::OpenExisting("Global\_MSIExecute")
            $Mutex.Dispose()
            if (-not $Avisou) {
                Write-Host "==> Outra instalacao MSI em andamento (provavelmente Windows Update). Aguardando..." -ForegroundColor Yellow
                $Avisou = $true
            }
            Start-Sleep -Seconds 15
        }
        catch [System.Threading.WaitHandleCannotBeOpenedException] {
            # Mutex nao existe = nenhuma instalacao em curso
            if ($Avisou) { Write-Host "==> Windows Installer liberado." -ForegroundColor Green }
            return $true
        }
        catch {
            # Mutex existe mas sem permissao de abrir: tratar como ocupado
            Start-Sleep -Seconds 15
        }
    }

    Write-Host "[ERRO] Timeout aguardando o Windows Installer liberar apos $TimeoutSegundos s." -ForegroundColor Red
    return $false
}

# O corpo fica dentro de uma funcao para que 'return' substitua 'exit'.
# Assim o script pode ser executado via [ScriptBlock]::Create() sem
# encerrar a janela do PowerShell que o chamou.
function Invoke-OnboardingTask {

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    # --- Parametros obrigatorios (vindos da URL ou da chamada) ---
    if (-not $ZabbixServer) {
        Write-Host "[ERRO] Informe o servidor Zabbix: ?zabbix_server=<IP> na URL ou -ZabbixServer na chamada." -ForegroundColor Red
        return 1
    }
    if (-not $Metadata) {
        Write-Host "[ERRO] Informe o metadata: ?metadata=<VALOR> na URL ou -Metadata na chamada." -ForegroundColor Red
        return 1
    }
    if (-not $Hostname) { $Hostname = $env:COMPUTERNAME }

    $BaseCdnUrl = "https://cdn.zabbix.com/zabbix/binaries/stable/"
    $UserAgent  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    # --- Pre-flight: elevacao e politica do Windows Installer ---
    $IsElevated = ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $IsElevated) {
        Write-Host "[ERRO] Este script precisa ser executado como Administrador." -ForegroundColor Red
        return 1
    }

    $DisableMsiValue = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Installer' -Name 'DisableMSI' -ErrorAction SilentlyContinue).DisableMSI
    if ($DisableMsiValue -eq 1 -or $DisableMsiValue -eq 2) {
        Write-Host "[AVISO] Politica 'DisableMSI' ativa (valor=$DisableMsiValue). O msiexec provavelmente retornara erro 1625." -ForegroundColor Yellow
    }

    # --- Resolucao da versao ---
    if ($VersionAgent -match '^\d+\.\d+$') {
        $DownloadUrl  = "$BaseCdnUrl$VersionAgent/latest/zabbix_agent2-$VersionAgent-latest-windows-amd64-openssl.msi"
        $VersionLabel = "$VersionAgent-latest"
    }
    elseif ($VersionAgent -match '^\d+\.\d+\.\d+$') {
        $MajorVersion = ($VersionAgent -split '\.')[0..1] -join '.'
        $DownloadUrl  = "$BaseCdnUrl$MajorVersion/$VersionAgent/zabbix_agent2-$VersionAgent-windows-amd64-openssl.msi"
        $VersionLabel = $VersionAgent
    }
    else {
        Write-Host "[ERRO] Formato de versao invalido: '$VersionAgent'. Use 7.4 ou 7.4.13." -ForegroundColor Red
        return 1
    }

    # --- Idempotencia: nao reinstala se ja estiver rodando ---
    $Existing = Get-Service -Name "Zabbix Agent 2" -ErrorAction SilentlyContinue
    if ($Existing -and $Existing.Status -eq 'Running') {
        Write-Host "[INFO] Zabbix Agent 2 ja instalado e rodando. Nada a fazer." -ForegroundColor Green
        return 0
    }

    # --- Download e instalacao ---
    $InstallerPath  = "$env:TEMP\zabbix_agent2_$VersionLabel.msi"
    $InstallLogPath = "$env:TEMP\zabbix_agent2_$VersionLabel-install.log"

    try {
        Write-Host "==> Baixando Zabbix Agent 2 v$VersionLabel..." -ForegroundColor Yellow
        Write-Host "    $DownloadUrl" -ForegroundColor Gray
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $InstallerPath -UserAgent $UserAgent -UseBasicParsing -ErrorAction Stop

        Write-Host "==> Executando instalador silencioso..." -ForegroundColor Yellow
        $InstallArgs = "/i `"$InstallerPath`" /qn /l*v `"$InstallLogPath`" SERVER=`"$ZabbixServer`" SERVERACTIVE=`"$ZabbixServer`" HOSTNAME=`"$Hostname`" HOSTMETADATA=`"$Metadata`" LISTENPORT=$ListenPort ENABLEPATH=1"

        # Retry em caso de 1618 (ERROR_INSTALL_ALREADY_RUNNING): outra instalacao
        # MSI concorrente, comum em maquina recem-provisionada baixando updates.
        $MaxTentativas = 5
        $Process = $null

        for ($Tentativa = 1; $Tentativa -le $MaxTentativas; $Tentativa++) {

            if (-not (Wait-MsiDisponivel)) { return 1 }

            $Process = Start-Process -FilePath "msiexec.exe" -ArgumentList $InstallArgs -Wait -NoNewWindow -PassThru

            if ($Process.ExitCode -ne 1618) { break }

            if ($Tentativa -lt $MaxTentativas) {
                $Espera = 30 * $Tentativa
                Write-Host "[AVISO] MSI ocupado (1618). Tentativa $Tentativa/$MaxTentativas. Nova tentativa em ${Espera}s..." -ForegroundColor Yellow
                Start-Sleep -Seconds $Espera
            }
        }

        if ($Process.ExitCode -ne 0) {
            Write-Host "[ERRO] Falha na instalacao do MSI. Codigo: $($Process.ExitCode)" -ForegroundColor Red
            if ($Process.ExitCode -eq 1625) {
                Write-Host "       -> Bloqueado por politica do Windows (GPO/AppLocker), nao e problema do pacote." -ForegroundColor Red
            }
            if ($Process.ExitCode -eq 1618) {
                Write-Host "       -> Outra instalacao MSI seguiu ocupando o Windows Installer apos $MaxTentativas tentativas." -ForegroundColor Red
                Write-Host "       -> Aguarde o Windows Update terminar e execute novamente." -ForegroundColor Red
            }
            Write-Host "       -> Log: $InstallLogPath" -ForegroundColor Gray
            return 1
        }

        Write-Host "==> Liberando porta $ListenPort no Firewall..." -ForegroundColor Yellow
        if (-not (Get-NetFirewallRule -DisplayName "Zabbix Agent" -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName "Zabbix Agent" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ListenPort | Out-Null
        }

        Start-Sleep -Seconds 3
        $Service = Get-Service -Name "Zabbix Agent 2" -ErrorAction SilentlyContinue

        if ($Service.Status -eq 'Running') {
            Write-Host "[SUCESSO] Zabbix Agent 2 v$VersionLabel instalado. Hostname=$Hostname Metadata=$Metadata" -ForegroundColor Green
            return 0
        } else {
            Write-Host "[ATENCAO] Instalado, mas o servico nao iniciou." -ForegroundColor Yellow
            return 2
        }

    } catch {
        Write-Host "[ERRO CRITICO] Falha ao baixar ou instalar: $_" -ForegroundColor Red
        return 1
    } finally {
        if (Test-Path $InstallerPath) { Remove-Item -Path $InstallerPath -Force }
    }

    return 0
}

# @(...)[-1] garante que saidas nao capturadas dentro da funcao nao
# transformem o retorno num array e quebrem o codigo de saida.
$OnboardingExitCode = @(Invoke-OnboardingTask)[-1]
$global:OnboardingExitCode = $OnboardingExitCode
Write-Host ""
Write-Host "[EXIT CODE] $OnboardingExitCode  (0=ok, 1=erro, 2=atencao)" -ForegroundColor DarkGray
