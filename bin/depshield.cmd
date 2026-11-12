@echo off
setlocal
:: Dynamically resolve the canonical repository root (parent of bin/)
pushd "%~dp0.."
set "REPO_DIR=%CD%"
popd

set "PYTHONPATH=%REPO_DIR%\cli;%PYTHONPATH%"

:: 1. Check for backend venv
if exist "%REPO_DIR%\backend\.venv\Scripts\python.exe" (
    "%REPO_DIR%\backend\.venv\Scripts\python.exe" -m depshield_cli %*
    goto :done
)

:: 2. Check for root venv
if exist "%REPO_DIR%\.venv\Scripts\python.exe" (
    "%REPO_DIR%\.venv\Scripts\python.exe" -m depshield_cli %*
    goto :done
)

:: 3. Fallback to system python
python -m depshield_cli %*

:done
endlocal
