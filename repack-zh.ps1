param([Parameter(Mandatory = $true)][string]$Publisher)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
# 用 node 注入 publisher（UTF-8 安全，避开 PowerShell 编码问题）
node (Join-Path $dir 'set-publisher.js') $Publisher
if ($LASTEXITCODE -ne 0) { Write-Host 'SET PUBLISHER FAILED'; exit 1 }
Push-Location $dir
npx --yes @vscode/vsce package --allow-missing-repository
$code = $LASTEXITCODE
Pop-Location
if ($code -eq 0) {
    $vsix = Get-ChildItem $dir -Filter '*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Write-Host ('VSIX: ' + $vsix.FullName)
} else {
    Write-Host ('PACKAGING FAILED exit=' + $code)
}
