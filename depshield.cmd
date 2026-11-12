@echo off
setlocal
set "PYTHONPATH=%~dp0cli"
"%~dp0backend\.venv\Scripts\python.exe" -m depshield_cli.main %*

