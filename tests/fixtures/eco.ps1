param(
    [string]   $Texto = 'padrao',
    [string[]] $Lista = @(),
    [int]      $Porta = 1,
    [switch]   $Flag,
    [string]   $Senha = ''
)
'{0}|{1}|{2}|{3}|{4}' -f $Texto, $Lista.Count, $Porta, [bool]$Flag, $Senha
