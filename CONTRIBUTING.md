# Contributing to DepShield

Thank you for your interest in contributing to DepShield! We welcome contributions, bug fixes, feature proposals, and improvements.

## Code of Conduct

DepShield is an open, welcoming, and inclusive project. All contributors are expected to treat others with respect and professionalism.

## Architecture Overview

DepShield consists of three main modules:
- `backend/`: Python 3.12 FastAPI service handling dependency resolution, OSV queries, and the Bifrost LLM gateway client.
- `frontend/`: React 19 + TypeScript web application built with Vite and pure CSS.
- `cli/`: Python-based terminal client providing safe install gates, offline audits, and file monitoring.

## Development Setup

### 1. Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

### 3. CLI
```bash
cd cli
pip install -e .
depshield --help
```

## Running Tests

All pull requests must pass automated checks:

```bash
# Run CLI test suite
python -m unittest discover -s cli/tests

# Run frontend linter
cd frontend
npm run lint

# Run frontend production build
npm run build
```

## Pull Request Guidelines

1. Fork the repository and create your branch from `main`.
2. Ensure new features include unit tests.
3. Keep dependency queries privacy-preserving: never inspect or transmit application source code or secret credentials.
4. Open a pull request with a clear description of the problem solved and test coverage.

