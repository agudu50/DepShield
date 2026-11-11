Set-Location -Path (Join-Path $PSScriptRoot "backend")
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

