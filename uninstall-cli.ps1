# DepShield CLI Uninstaller for Windows
# Usage: .\uninstall-cli.ps1

Write-Host "Uninstalling DepShield CLI..." -ForegroundColor Cyan

$repoDir = $PSScriptRoot
$binDir = Join-Path $repoDir "bin"

# 1. Clear credentials from OS keyring
try {
    $depshieldCmd = Get-Command depshield -ErrorAction SilentlyContinue
    if ($depshieldCmd) {
        Write-Host "Clearing stored credentials from OS keyring..." -ForegroundColor Gray
        & depshield github logout 2>$null | Out-Null
        & depshield logout 2>$null | Out-Null
    }
} catch {
    # Ignore if already unavailable
}

# 2. Pip uninstall if installed as a package
try {
    $pipCmd = Get-Command pip -ErrorAction SilentlyContinue
    if ($pipCmd) {
        Write-Host "Removing pip package..." -ForegroundColor Gray
        Start-Process pip -ArgumentList "uninstall", "-y", "depshield" -NoNewWindow -Wait -PassThru | Out-Null
    }
} catch {
    # Ignore
}

# 3. Remove bin\ from User PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
if ($userPath -and $userPath -like "*$binDir*") {
    Write-Host "Removing $binDir from User PATH..." -ForegroundColor Gray
    $parts = $userPath -split ';' | Where-Object { $_ -ne "" -and $_ -ne $binDir }
    $newPath = $parts -join ';'
    [Environment]::SetEnvironmentVariable("Path", $newPath, [EnvironmentVariableTarget]::User)
    Write-Host "Removed $binDir from User PATH." -ForegroundColor Green
}

# 4. Remove any shim from ~/.cargo/bin if created there
$cargoBin = Join-Path $HOME ".cargo\bin"
if (Test-Path (Join-Path $cargoBin "depshield.ps1")) {
    Remove-Item (Join-Path $cargoBin "depshield.ps1") -Force -ErrorAction SilentlyContinue
}
if (Test-Path (Join-Path $cargoBin "depshield.cmd")) {
    Remove-Item (Join-Path $cargoBin "depshield.cmd") -Force -ErrorAction SilentlyContinue
}

Write-Host "`nDepShield CLI has been completely removed from your machine." -ForegroundColor Green
Write-Host "If you cloned the repository, you can now safely delete the DepShield folder." -ForegroundColor Gray

