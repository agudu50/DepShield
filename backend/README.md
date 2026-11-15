# DepShield AI - Backend Service

FastAPI Python backend for DepShield AI, an autonomous vulnerability detection agent powered by Bifrost by Maxim AI.

The backend exposes REST endpoints for GitHub repository inspection, dependency manifest parsing, deterministic OSV.dev querying, fail-closed Bifrost AI explanations, and anonymous public site metrics.

---

## Deployed Services & Live Links

- **Production Frontend:** [https://depshield-27ul.onrender.com](https://depshield-27ul.onrender.com)
- **GitHub Repository:** [https://github.com/agudu50/DepShield](https://github.com/agudu50/DepShield)
- **Live Health Endpoint:** `https://<your-backend-slug>.onrender.com/health`
- **Interactive OpenAPI Documentation:** `https://<your-backend-slug>.onrender.com/docs`
- **OSV.dev Vulnerability Feeds:** [https://osv.dev](https://osv.dev)
- **Maxim AI Bifrost Gateway:** [https://github.com/maximhq/bifrost](https://github.com/maximhq/bifrost)

---

## Architecture Overview

```
backend/
├── app/
│   ├── agents/
│   │   └── bifrost.py         # Bifrost client, anti-hallucination guardrails, and model failover
│   ├── api/
│   │   ├── deps.py            # Dependency injection (database sessions, auth tokens)
│   │   └── routes/
│   │       ├── agent.py       # Direct Bifrost interaction endpoints
│   │       ├── auth.py        # Authentication & token verification
│   │       ├── github.py      # GitHub repository tree discovery, manifests, and audit runs
│   │       ├── health.py      # Liveness and readiness probes (/health)
│   │       ├── members.py     # Team workspace member management
│   │       ├── metrics.py     # Public anonymous visit tracking and aggregate metrics
│   │       ├── organizations.py # Multi-tenant organization scopes
│   │       ├── projects.py    # Saved target repositories and inventory
│   │       └── scans.py       # Stateless manual scan endpoints
│   ├── domain/
│   │   ├── audit.py           # Core vulnerability audit coordinator
│   │   ├── github/            # GitHub REST client and manifest extractors
│   │   ├── osv/               # Batch and single query client for OSV.dev
│   │   └── parser/            # Parsers for package.json, requirements.txt, uv.lock, etc.
│   ├── config.py              # Pydantic Settings (env vars, CORS, Bifrost models)
│   ├── database.py            # SQLAlchemy engine, session factories, and Base metadata
│   ├── models.py              # Database ORM models (Tenant, User, Project, Scan, Finding)
│   ├── site_metrics.py        # Anonymous visit recorder and product counters
│   └── main.py                # FastAPI application definition and middleware
├── alembic/                   # Database schema migrations
│   └── versions/
│       ├── 0001_initial_schema.py
│       ├── 0002_user_preferences.py
│       ├── 0003_project_inventory.py
│       └── 0004_site_metrics.py
├── tests/                     # Unit and integration test suites
│   ├── test_bifrost_grounding.py
│   ├── test_site_metrics.py
│   └── ...
├── requirements.txt           # Production dependencies
└── alembic.ini                # Alembic configuration
```

---

## Key Features & Safety Guardrails

1. **Deterministic OSV.dev Grounding**:
   - Queries Google's official OSV.dev database with exact package versions.
   - If 0 vulnerabilities are reported, clean packages bypass AI inference entirely.
2. **Fail-Closed Bifrost Reasoning**:
   - Inferences use near-zero temperature (`0.1`) anchored strictly to verified JSON evidence.
   - Evidence is treated as untrusted data to mitigate prompt injection.
   - Never fabricates CVEs or CVSS scores. If details are not established by upstream records, the agent explicitly marks them unknown.
3. **Zero Code Exfiltration**:
   - Only manifest names and versions are inspected. Application source files (`.py`, `.ts`, `.env`) are never read or transmitted.
4. **Anonymous Public Metrics**:
   - Tracks aggregate product statistics without collecting IP addresses, cookies, or personal identifiers.
   - Respects Global Privacy Control (GPC) and Do Not Track (DNT).

---

## Configuration & Environment Variables

Settings are managed via `pydantic-settings` in `app/config.py`:

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | string | `""` | PostgreSQL pooled connection URL (Neon or standard Postgres). |
| `DATABASE_URL_UNPOOLED` | string | `""` | Direct PostgreSQL connection string for Alembic migrations. |
| `CORS_ORIGINS` | string or list | `["http://localhost:5173", "http://127.0.0.1:5173"]` | Allowed origins. Accepts single URL, comma-separated list, or `*`. |
| `ENVIRONMENT` | string | `"development"` | Set to `production` in live environments. |
| `BIFROST_BASE_URL` | string | `"http://localhost:8080/openai"` | Bifrost AI gateway endpoint. |
| `BIFROST_MODEL` | string | `"openai/gpt-4o-mini"` | Default reasoning model. |
| `BIFROST_MODELS` | string or list | Standard allowlist | Models allowed through the gateway. |
| `BIFROST_FALLBACK_MODELS` | string or list | `[]` | Ordered failover models if primary errors. |
| `BIFROST_VIRTUAL_KEY` | string | `""` | Virtual API key for Bifrost authentication. |

---

## Running Locally

### 1. Virtual Environment Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Database Migrations

```powershell
alembic upgrade head
```

### 3. Start the Development Server

```powershell
python -m uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive OpenAPI documentation is hosted at `http://localhost:8000/docs`.

---

## Running Tests

```powershell
$env:PYTHONPATH = "backend"
python -m unittest discover -s backend/tests
```

---

## Deploying to Render (Web Service)

The backend is configured for deployment as a Python Web Service on Render:

- **Build Command**: `pip install -r requirements.txt`
- **Start Command**:
  ```bash
  sh -c 'if [ -n "$DATABASE_URL" ]; then alembic upgrade head; fi && uvicorn app.main:app --host 0.0.0.0 --port $PORT'
  ```
- **Health Check Path**: `/health`
- **Environment Variables**:
  - `PYTHON_VERSION`: `3.12.0`
  - `ENVIRONMENT`: `production`
  - `DATABASE_URL`: Your PostgreSQL connection string.
  - `CORS_ORIGINS`: `https://depshield-27ul.onrender.com` (or `*`).

