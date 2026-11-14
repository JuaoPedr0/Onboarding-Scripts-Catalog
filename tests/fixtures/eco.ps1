param(
    [string]   $Texto = 'padrao',
    [string[]] $Lista = @(),
    [int]      $Porta = 1,
    [switch]   $Flag
)
'{0}|{1}|{2}|{3}' -f $Texto, $Lista.Count, $Porta, [bool]$Flag
