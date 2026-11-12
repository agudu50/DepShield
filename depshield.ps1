$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PYTHONPATH = Join-Path $scriptDir "cli"
$python = Join-Path $scriptDir "backend\.venv\Scripts\python.exe"
& $python -m depshield_cli.main @args

