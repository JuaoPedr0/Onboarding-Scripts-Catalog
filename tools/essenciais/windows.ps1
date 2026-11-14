<#
.SYNOPSIS
    Servicos essenciais / baseline de onboarding no Windows (servido via webhook n8n).
.NOTES
    A lista padrao de pacotes e o default do parametro abaixo (espelhado em tool.json).
    Usa winget quando disponivel (Windows 10 1809+ / Server 2022+).
#>

# Parametros nativos: o script roda sozinho. Pelo webhook, o n8n injeta
# os valores da URL (?pacotes=A,B&habilitar_rdp=true); tambem valem na chamada: & ([ScriptBlock]::Create($s)) -Pacotes ... -HabilitarRDP
param (
    [string[]]$Pacotes      = @('7zip.7zip', 'Google.Chrome', 'Notepad++.Notepad++', 'AnyDeskSoftwareGmbH.AnyDesk'),
    [switch]  $HabilitarRDP
)

# O corpo fica dentro de uma funcao para que 'return' substitua 'exit'.
# Assim o script pode ser executado via [ScriptBlock]::Create() sem
# encerrar a janela do PowerShell que o chamou.
function Invoke-OnboardingTask {

    $IsElevated = ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $IsElevated) {
        Write-Host "[ERRO] Execute como Administrador." -ForegroundColor Red
        return 1
    }

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host "[ERRO] winget nao encontrado. Instale o App Installer da Microsoft Store ou use outro gerenciador." -ForegroundColor Red
        return 1
    }

    $Falhas = @()

    foreach ($Pacote in $Pacotes) {
        Write-Host "==> Instalando $Pacote..." -ForegroundColor Yellow
        try {
            $null = winget install --id $Pacote --silent --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "    [OK] $Pacote" -ForegroundColor Green
            } elseif ($LASTEXITCODE -eq -1978335189) {
                Write-Host "    [JA INSTALADO] $Pacote" -ForegroundColor Gray
            } else {
                Write-Host "    [FALHA] $Pacote (exit $LASTEXITCODE)" -ForegroundColor Red
                $Falhas += $Pacote
            }
        } catch {
            Write-Host "    [FALHA] $Pacote : $_" -ForegroundColor Red
            $Falhas += $Pacote
        }
    }

    if ($HabilitarRDP) {
        Write-Host "==> Habilitando RDP..." -ForegroundColor Yellow
        Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name 'fDenyTSConnections' -Value 0
        Enable-NetFirewallRule -DisplayGroup "Area de Trabalho Remota" -ErrorAction SilentlyContinue
        Enable-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue
    }

    Write-Host "==> Definindo fuso horario para E. South America Standard Time..." -ForegroundColor Yellow
    Set-TimeZone -Id "E. South America Standard Time" -ErrorAction SilentlyContinue

    if ($Falhas.Count -gt 0) {
        Write-Host "[ATENCAO] Concluido com falhas em: $($Falhas -join ', ')" -ForegroundColor Yellow
        return 2
    }

    Write-Host "[SUCESSO] Baseline de servicos essenciais aplicado." -ForegroundColor Green
    return 0

    return 0
}

# @(...)[-1] garante que saidas nao capturadas dentro da funcao nao
# transformem o retorno num array e quebrem o codigo de saida.
$OnboardingExitCode = @(Invoke-OnboardingTask)[-1]
$global:OnboardingExitCode = $OnboardingExitCode
Write-Host ""
Write-Host "[EXIT CODE] $OnboardingExitCode  (0=ok, 1=erro, 2=atencao)" -ForegroundColor DarkGray
