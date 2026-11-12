$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = (Resolve-Path "$scriptDir\..").ProviderPath

$env:PYTHONPATH = "$repoDir\cli;$env:PYTHONPATH"

$backendVenvPy = "$repoDir\backend\.venv\Scripts\python.exe"
$rootVenvPy = "$repoDir\.venv\Scripts\python.exe"

if (Test-Path $backendVenvPy) {
    & $backendVenvPy -m depshield_cli @args
} elseif (Test-Path $rootVenvPy) {
    & $rootVenvPy -m depshield_cli @args
} else {
    python -m depshield_cli @args
}
