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
    try {
        $userPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
        if ($userPath -notlike "*$binDir*") {
            $newPath = if ($userPath) { "$userPath;$binDir" } else { $binDir }
            [Environment]::SetEnvironmentVariable("Path", $newPath, [EnvironmentVariableTarget]::User)
            $env:Path = "$env:Path;$binDir"
            Write-Host "Added $binDir to User PATH." -ForegroundColor Green
        } else {
            Write-Host "$binDir is already registered in User PATH." -ForegroundColor Green
        }
    } catch {
        $env:Path = "$env:Path;$binDir"
        Write-Host "Configured $binDir in active PATH session." -ForegroundColor Green
    }
}

Write-Host "`n"
Write-Host "       /\      /\" -ForegroundColor Cyan
Write-Host "      /  \____/  \      ___             ___ _     _      _     _" -ForegroundColor Cyan
Write-Host "     /  /| || |\  \    |   \ ___ _ __  / __| |_  (_)___ | | __| |" -ForegroundColor Cyan
Write-Host "    |  o---||--(O)-o|  | |) / -_) '_ \ \__ \ ' \ | / -_)| |/ _' |" -ForegroundColor Cyan
Write-Host "    |  |/ \|/  /| \ |  |___/\___| .__/ |___/_||_||_\___||_|\__,_|" -ForegroundColor Cyan
Write-Host "    |  o---||---o--o|           |_|" -ForegroundColor Cyan
Write-Host "     \  \  ||  /  /    Autonomous Vulnerability Audit Agent" -ForegroundColor Green
Write-Host "      \  \ || /  /     Zero-Source-Code Ingestion | OSV-Verified" -ForegroundColor Gray
Write-Host "       \  \||/  /      Powered by Bifrost by Maxim AI" -ForegroundColor DarkCyan
Write-Host "        \  \/  /" -ForegroundColor Cyan
Write-Host "         \____/" -ForegroundColor Cyan
Write-Host "`nDepShield CLI installed and active!" -ForegroundColor Green
Write-Host "You can run commands from any directory across your system:" -ForegroundColor Gray
Write-Host "  depshield --help" -ForegroundColor White
Write-Host "  depshield github status" -ForegroundColor White
Write-Host "  depshield github login --token <YOUR_PAT>" -ForegroundColor White

