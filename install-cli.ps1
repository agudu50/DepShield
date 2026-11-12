# DepShield CLI Installer for Windows
# Usage: .\install-cli.ps1

Write-Host "Installing DepShield CLI..." -ForegroundColor Cyan

$repoDir = $PSScriptRoot
$cliDir = Join-Path $repoDir "cli"
$binDir = Join-Path $repoDir "bin"

$installed = $false

# 1. Try pip editable install
try {
    $pipCmd = Get-Command pip -ErrorAction SilentlyContinue
    if ($pipCmd) {
        Write-Host "Attempting pip install -e ./cli..." -ForegroundColor Gray
        $process = Start-Process pip -ArgumentList "install", "-e", "`"$cliDir`"" -NoNewWindow -Wait -PassThru
        if ($process.ExitCode -eq 0) {
            $installed = $true
            Write-Host "DepShield CLI installed successfully via pip!" -ForegroundColor Green
        }
    }
} catch {
    # Fallback to PATH registration
}

# 2. Fallback: Register bin\ to User PATH
if (-not $installed) {
    Write-Host "Registering $binDir to User PATH..." -ForegroundColor Yellow
    $userPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
    if ($userPath -notlike "*$binDir*") {
        $newPath = if ($userPath) { "$userPath;$binDir" } else { $binDir }
        [Environment]::SetEnvironmentVariable("Path", $newPath, [EnvironmentVariableTarget]::User)
        $env:Path = "$env:Path;$binDir"
        Write-Host "Added $binDir to User PATH." -ForegroundColor Green
    } else {
        Write-Host "$binDir is already registered in User PATH." -ForegroundColor Green
    }
}

Write-Host "`nSetup complete! You can now run:" -ForegroundColor Cyan
Write-Host "  depshield --version" -ForegroundColor White
Write-Host "  depshield github status" -ForegroundColor White

