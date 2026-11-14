@{
    Severity     = @('Error', 'Warning')
    ExcludeRules = @(
        # Scripts de console: Write-Host e a saida pretendida.
        'PSAvoidUsingWriteHost'
    )
}
