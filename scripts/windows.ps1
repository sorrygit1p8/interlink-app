[CmdletBinding()]
param(
    [ValidateSet('Doctor', 'Install', 'Preview', 'Dev', 'Web', 'Check', 'Build')]
    [string]$Command = 'Preview',
    [switch]$Install
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$originalPath = $env:PATH
$demoVariables = @{
    EXPO_PUBLIC_DATA_MODE = 'demo'
    EXPO_PUBLIC_APP_ENV = 'development'
    INTERLINK_DATA_MODE = 'demo'
    INTERLINK_APP_ENV = 'development'
    EXPO_NO_TELEMETRY = '1'
    NEXT_TELEMETRY_DISABLED = '1'
}
$originalVariables = @{}
$shimDirectory = $null

function Format-PrivateLog {
    param([string]$Text)
    if ($env:USERPROFILE) {
        $profilePath = $env:USERPROFILE.TrimEnd([char[]]'\/')
        foreach ($prefix in @($profilePath, $profilePath.Replace('\', '/'))) {
            if ($prefix) {
                $Text = [regex]::Replace($Text, [regex]::Escape($prefix), '~', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
            }
        }
    }
    return $Text
}

function Invoke-Npm {
    param([string[]]$Arguments)
    & $script:nodeExecutable $script:npmCli @Arguments
    if ($LASTEXITCODE -ne 0) { throw "npm failed with exit code $LASTEXITCODE." }
}

function Require-Dependencies {
    if (-not (Test-Path (Join-Path $projectRoot 'node_modules/.package-lock.json'))) {
        throw 'Dependencies are missing. Run START-DEMO.cmd Install, or START-DEMO.cmd Preview -Install.'
    }
}

function Require-FreePort {
    param([int]$Port)
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        throw "Port $Port is already in use. Close the server you started, or open http://127.0.0.1:$Port if it is Inter-Link. No process was stopped."
    }
}

Push-Location $projectRoot
try {
    $candidates = @()
    if ($env:INTERLINK_NODE) { $candidates += $env:INTERLINK_NODE }
    $candidates += @((Get-Command node.exe -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source }))
    $nodeExecutable = $null
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        $versionOutput = & $candidate --version
        if ($LASTEXITCODE -ne 0) { continue }
        $version = [version]($versionOutput.TrimStart('v'))
        if ($version.Major -eq 24 -and $version -ge [version]'24.3.0') {
            $nodeExecutable = $candidate
            break
        }
    }
    if (-not $nodeExecutable) { throw 'Node.js 24.3 or newer within version 24 is required. Install Node.js 24 LTS with npm, then reopen this launcher.' }

    $nodeDirectory = Split-Path -Parent $nodeExecutable
    $npmCandidates = @(
        (Join-Path $nodeDirectory 'node_modules/npm/bin/npm-cli.js'),
        (Join-Path (Split-Path -Parent $nodeDirectory) 'lib/node_modules/npm/bin/npm-cli.js')
    )
    foreach ($npmCommand in @(Get-Command npm.cmd -All -ErrorAction SilentlyContinue)) {
        $npmCandidates += Join-Path (Split-Path -Parent $npmCommand.Source) 'node_modules/npm/bin/npm-cli.js'
    }
    $npmCli = $npmCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $npmCli) { throw 'npm could not be found. Install Node.js 24 LTS with its npm option enabled.' }

    # npm.cmd normally prefers its sibling node.exe. Use a temporary shim so
    # nested workspace commands use the same supported Node as this launcher.
    $shimDirectory = Join-Path ([IO.Path]::GetTempPath()) ('interlink-launcher-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $shimDirectory | Out-Null
    foreach ($name in @('INTERLINK_LAUNCHER_NODE', 'INTERLINK_LAUNCHER_NPM')) {
        $originalVariables[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $env:INTERLINK_LAUNCHER_NODE = $nodeExecutable
    $env:INTERLINK_LAUNCHER_NPM = $npmCli
    $npmShim = '@"%INTERLINK_LAUNCHER_NODE%" "%INTERLINK_LAUNCHER_NPM%" %*'
    Set-Content -LiteralPath (Join-Path $shimDirectory 'npm.cmd') -Value $npmShim -Encoding ASCII
    $env:PATH = "$shimDirectory;$nodeDirectory;$originalPath"
    foreach ($name in $demoVariables.Keys) {
        $originalVariables[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $demoVariables[$name], 'Process')
    }

    Write-Host "Inter-Link / $Command / local fictional demo"
    Write-Host (Format-PrivateLog "Node: $nodeExecutable ($version)")
    Write-Host (Format-PrivateLog "npm:  $npmCli")
    if ($Install -or $Command -eq 'Install') { Invoke-Npm -Arguments @('ci') }

    switch ($Command) {
        'Doctor' {
            Invoke-Npm -Arguments @('--version')
            Write-Host ('Dependencies installed: ' + (Test-Path 'node_modules/.package-lock.json'))
            Write-Host ('Mobile export exists: ' + (Test-Path 'apps/mobile/dist/index.html'))
            Write-Host 'Child Node resolved through the temporary PATH:'
            & node.exe --version
            if ($LASTEXITCODE -ne 0) { throw 'Child Node check failed.' }
            Write-Host 'Nested npm shim:'
            & (Join-Path $shimDirectory 'npm.cmd') --version
            if ($LASTEXITCODE -ne 0) { throw 'Nested npm check failed.' }
            Write-Host 'npm installation prefix:'
            $prefixOutput = & $nodeExecutable $npmCli config get prefix
            if ($LASTEXITCODE -ne 0) { throw "npm failed with exit code $LASTEXITCODE." }
            $prefixOutput | ForEach-Object { Write-Host (Format-PrivateLog ([string]$_)) }
        }
        'Install' { Write-Host 'Dependencies installed. Next: START-DEMO.cmd' }
        'Preview' {
            Require-FreePort 8081
            if (-not (Test-Path 'apps/mobile/dist/index.html')) {
                Require-Dependencies
                Invoke-Npm -Arguments @('run', 'build:mobile')
            }
            Write-Host 'Open http://127.0.0.1:8081 in your browser. Keep this window open; Ctrl+C stops the server.'
            & $nodeExecutable 'scripts/serve-mobile-export.mjs'
            if ($LASTEXITCODE -ne 0) { throw 'The preview server stopped with an error.' }
        }
        'Dev' {
            Require-Dependencies
            Require-FreePort 8081
            Invoke-Npm -Arguments @('run', 'web', '--workspace', '@interlink/mobile', '--', '--localhost')
        }
        'Web' {
            Require-Dependencies
            Require-FreePort 3000
            Invoke-Npm -Arguments @('run', 'dev:web')
        }
        'Check' {
            Require-Dependencies
            foreach ($task in @('check:config', 'typecheck', 'lint', 'test')) { Invoke-Npm -Arguments @('run', $task) }
        }
        'Build' {
            Require-Dependencies
            Invoke-Npm -Arguments @('run', 'build:mobile')
            Invoke-Npm -Arguments @('run', 'build:web')
        }
    }
}
catch {
    Write-Host (Format-PrivateLog $_.Exception.Message) -ForegroundColor Red
    exit 1
}
finally {
    $env:PATH = $originalPath
    foreach ($name in $originalVariables.Keys) { [Environment]::SetEnvironmentVariable($name, $originalVariables[$name], 'Process') }
    if ($shimDirectory -and (Test-Path -LiteralPath $shimDirectory)) {
        # Delete only the exact file and empty directory created by this invocation.
        Remove-Item -LiteralPath (Join-Path $shimDirectory 'npm.cmd') -Force
        Remove-Item -LiteralPath $shimDirectory
    }
    Pop-Location
}
