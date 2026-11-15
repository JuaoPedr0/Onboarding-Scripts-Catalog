<#
.SYNOPSIS
    Checagens de PowerShell do CI: sintaxe dos scripts, sintaxe do que o
    webhook entrega e semantica do wrapper (splat + @args).
.NOTES
    Requer Node no PATH e catalog.json gerado (npm run build). Uso: pwsh tests/ps-check.ps1
#>
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$falhas = 0
$env:RENDER_QUIET = '1'   # sem avisos no stderr (no PS 5.1, stderr de nativo + Stop vira erro)

function Test-Sintaxe([string]$Nome, [string]$Texto) {
    $erros = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($Texto, [ref]$null, [ref]$erros)
    if ($erros.Count) {
        $script:falhas++
        Write-Host "[FALHA] $Nome" -ForegroundColor Red
        $erros | ForEach-Object { Write-Host "    L$($_.Extent.StartLineNumber): $($_.Message)" }
    } else {
        Write-Host "[ ok ] $Nome"
    }
}

# 1) Cada script do repositorio e cada script renderizado tem sintaxe valida.
$catalogo = Get-Content (Join-Path $raiz 'catalog.json') -Raw | ConvertFrom-Json
foreach ($item in $catalogo.itens | Where-Object os -eq 'windows') {
    Test-Sintaxe $item.arquivo (Get-Content (Join-Path $raiz $item.arquivo) -Raw)
    $render = (& node (Join-Path $raiz 'scripts/render.js') $item.slug 'windows' "variante=$($item.variante)") -join "`n"
    Test-Sintaxe "$($item.slug)/$($item.variante) (renderizado)" $render
}

# 2) Wrapper: valores da URL entram por splat; a chamada ainda aceita parametros extras.
$eco = Join-Path $PSScriptRoot 'fixtures/render-eco.js'
function Get-Eco { (& node $eco @args) -join "`n" }
function Assert-Eco([string]$Nome, $Saida, [string]$Esperado) {
    if ($Saida -eq $Esperado) { Write-Host "[ ok ] wrapper: $Nome" }
    else { $script:falhas++; Write-Host "[FALHA] wrapper: $Nome -> '$Saida' (esperado '$Esperado')" -ForegroundColor Red }
}

$s = Get-Eco
Assert-Eco 'defaults do script' (& ([ScriptBlock]::Create($s))) 'padrao|0|1|False|'

$s = Get-Eco "texto=it's" 'lista=a,b' 'flag=1'
Assert-Eco 'valores da URL' (& ([ScriptBlock]::Create($s))) "it's|2|1|True|"

$s = Get-Eco 'texto=url'
Assert-Eco 'parametro extra na chamada' (& ([ScriptBlock]::Create($s)) -Porta 9 -Flag) 'url|0|9|True|'

# 3) Credencial temporaria: o script troca a referencia pela senha, uma unica vez.
$porta = 39871
$ref = 'b' * 48
$servidor = Start-Process node -ArgumentList @((Join-Path $PSScriptRoot 'fixtures/servidor-cred.js'), $porta, $ref, 'senha=S3nha-do-teste') -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
try {
    $s = Get-Eco 'texto=url' "cred=$ref" "--resgate=http://127.0.0.1:$porta/resgatar"
    if ($s -match 'S3nha-do-teste') { $falhas++; Write-Host '[FALHA] segredo: a senha aparece no script entregue' -ForegroundColor Red }
    Assert-Eco 'segredo chega pela credencial temporaria' (& ([ScriptBlock]::Create($s))) 'url|0|1|False|S3nha-do-teste'
    $global:OnboardingExitCode = 0
    $de_novo = & ([ScriptBlock]::Create($s))
    Assert-Eco 'referencia nao pode ser usada duas vezes' "$de_novo|$global:OnboardingExitCode" '|1'
} finally {
    Stop-Process -Id $servidor.Id -Force -ErrorAction SilentlyContinue
}

if ($falhas) { Write-Host "$falhas falha(s)." -ForegroundColor Red; exit 1 }
Write-Host 'PowerShell: tudo certo.'
