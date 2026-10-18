param([ValidateSet('codex', 'claude')][string]$Provider)

# Shared by the Tauri desktop and the Node Host. Only inspect known CLI payload
# locations: app/Codex.exe and app/claude.exe are GUI launchers, not CLIs.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Find-Cli($Candidates) {
    foreach ($Candidate in $Candidates) {
        if ($Candidate -and (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
            return $Candidate
        }
    }
}

function Get-VersionDirectories($Root) {
    Get-ChildItem -LiteralPath $Root -Directory | Where-Object {
        $_.Name -match '^(?:app-)?\d+\.\d+\.\d+(?:\.\d+)?$'
    } | Sort-Object { [version]($_.Name -replace '^app-', '') } -Descending
}

if ($Provider -eq 'codex') {
    # Ask Windows for the current user's registered package, including installs
    # on other drives. Do not enumerate the protected WindowsApps directory.
    $Packages = @(Get-AppxPackage -Name OpenAI.Codex | Sort-Object { [version]$_.Version } -Descending)
    foreach ($Package in $Packages) {
        $Found = Find-Cli @(
            (Join-Path $Package.InstallLocation 'app/resources/codex.exe'),
            (Join-Path $Package.InstallLocation 'resources/codex.exe')
        )
        if ($Found) { $Found; return }
    }
    $Roots = @()
    if ($env:LOCALAPPDATA) {
        $Roots += Join-Path $env:LOCALAPPDATA 'Programs/Codex'
        $Roots += Join-Path $env:LOCALAPPDATA 'Codex'
    }
    if ($env:ProgramFiles) { $Roots += Join-Path $env:ProgramFiles 'Codex' }
    foreach ($Root in $Roots) {
        $AppRoots = @($Root) + @(Get-VersionDirectories $Root | ForEach-Object FullName)
        foreach ($AppRoot in $AppRoots) {
            $Found = Find-Cli @(
                (Join-Path $AppRoot 'resources/codex.exe'),
                (Join-Path $AppRoot 'app/resources/codex.exe')
            )
            if ($Found) { $Found; return }
        }
    }
    # Recent desktop releases also extract their CLI into a hash directory.
    if ($env:LOCALAPPDATA) {
        $Root = Join-Path $env:LOCALAPPDATA 'OpenAI/Codex/bin'
        foreach ($Directory in @(Get-ChildItem -LiteralPath $Root -Directory | Sort-Object LastWriteTimeUtc -Descending)) {
            $Found = Find-Cli @((Join-Path $Directory.FullName 'codex.exe'))
            if ($Found) { $Found; return }
        }
    }
} else {
    # Claude Desktop downloads native Claude Code into its user data, including
    # the MSIX-redirected Roaming directory. Never select the desktop launcher.
    $Roots = @()
    if ($env:APPDATA) { $Roots += Join-Path $env:APPDATA 'Claude/claude-code' }
    if ($env:LOCALAPPDATA) {
        $PackagesRoot = Join-Path $env:LOCALAPPDATA 'Packages'
        foreach ($Package in @(Get-ChildItem -LiteralPath $PackagesRoot -Directory -Filter 'Claude_*')) {
            $Roots += Join-Path $Package.FullName 'LocalCache/Roaming/Claude/claude-code'
        }
    }
    # Sort all roots together, numerically (2.1.100 must beat 2.1.99).
    $Versions = @($Roots | ForEach-Object { Get-VersionDirectories $_ }) |
        Sort-Object { [version]$_.Name } -Descending
    foreach ($Version in $Versions) {
        $Candidates = @((Join-Path $Version.FullName 'claude.exe'))
        $Candidates += @(Get-ChildItem -LiteralPath $Version.FullName -Directory |
            Sort-Object LastWriteTimeUtc -Descending |
            ForEach-Object { Join-Path $_.FullName 'claude.exe' })
        $Found = Find-Cli $Candidates
        if ($Found) { $Found; return }
    }
}
