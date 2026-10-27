$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$reportRoot = Join-Path $projectRoot '.tmp'
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
$report = Join-Path $reportRoot ('desktop-verification-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.txt')
$failed = $false
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$runtimePath = Join-Path $projectRoot ('release/GoStreams-' + $version + '/runtime/win32-x64')
$bundledNode = Join-Path $runtimePath 'node.exe'
if (Test-Path -LiteralPath $bundledNode) {
    $nodeCommand = $bundledNode
} else {
    $runtimePath = $null
    $nodeCommand = (Get-Command node -ErrorAction Stop).Source
}
# Decode Node output explicitly; Windows PowerShell otherwise uses the OEM codepage
# and wraps stderr lines in NativeCommandError records.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Write-ReportLine([string] $Line) {
    Write-Host $Line
    Add-Content -LiteralPath $report -Value $Line -Encoding UTF8
}
function Invoke-NodeCheck([string] $Arguments) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodeCommand
    $startInfo.Arguments = $Arguments
    $startInfo.WorkingDirectory = $projectRoot
    if ($runtimePath) { $startInfo.EnvironmentVariables['PATH'] = $runtimePath + ';' + $env:PATH }
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        [void] $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $outputText = $stdout.GetAwaiter().GetResult()
        $errorText = $stderr.GetAwaiter().GetResult()
        if ($outputText) { Write-ReportLine $outputText.TrimEnd() }
        if ($errorText) { Write-ReportLine $errorText.TrimEnd() }
        return $process.ExitCode
    } finally { $process.Dispose() }
}
Write-ReportLine 'Go Streams: verificacao local HTTP/RTMP e interface. Nao transmite para plataformas externas.'
$wireExit = Invoke-NodeCheck '--test --test-reporter=tap --test-concurrency=1 test/optional/wire.test.mjs'
if ($wireExit -ne 0) { $failed = $true }
if (-not $env:GO_STREAMS_PLAYWRIGHT_PACKAGE) {
    $playwrightPackage = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'
    if (Test-Path -LiteralPath $playwrightPackage) { $env:GO_STREAMS_PLAYWRIGHT_PACKAGE = $playwrightPackage }
}
if ($env:GO_STREAMS_PLAYWRIGHT_PACKAGE) {
    $uiExit = Invoke-NodeCheck 'scripts/ui-check.mjs'
    if ($uiExit -ne 0) { $failed = $true }
} else {
    Write-ReportLine 'Interface nao testada: defina GO_STREAMS_PLAYWRIGHT_PACKAGE para uma instalacao com Playwright.'
    $failed = $true
}
Write-ReportLine ('Resultado: ' + $report)
if ($failed) { exit 1 }
exit 0
