# DepShield AI

DepShield is a modern React security dashboard and FastAPI service for checking dependency manifests and lockfiles
against OSV.dev. Vulnerability matching is deterministic; AI is used only to explain verified
advisory evidence during an investigation.

The platform provides:
1. **Autonomous GitHub Repository Auditing**: Connect GitHub, choose any repository, auto-discover package manifests (`package.json`, `package-lock.json`, `requirements.txt`, `pyproject.toml`, etc.), and trigger the AI Security Agent to evaluate risk, blast radius, and upgrade paths.
2. **Developer CLI (`depshield`)**: Preflight package checks, interactive approval gates before `npm` and `uv` installations, repository analysis from the terminal, and lockfile synchronization.
3. **Multi-Tenant Workspace**: Neon Auth (Better Auth) sessions, PostgreSQL persistence, organizations, projects, scan history, invitations, and member role management.
4. **Modern UI Architecture**: Seesaw-inspired, flat developer-tool design system with solid color surfaces, zero gradients, and high-density data visualizations.

The current architecture and implementation boundaries are documented in
[docs/architecture.md](./docs/architecture.md). Details on CLI adapters and security guarantees are in
[docs/developer-integration.md](./docs/developer-integration.md).

## Developer Integration Layer checklist

Status reflects implementation and local validation only. See [docs/developer-integration-status.md](./docs/developer-integration-status.md) for details.

### Done locally

- [x] Architecture and security workflow documented in [docs/developer-integration.md](./docs/developer-integration.md).
- [x] Python-distributed `depshield` CLI package and commands: `init`, `add`, `scan`, `status`, `monitor`, `explain`, `fix`, `report`, `login`, and `logout`.
- [x] **GitHub CLI suite (`depshield github`)**: `login`, `status`, `repos`, `manifests`, `analyze`, and `logout` with secure OS keyring storage.
- [x] **GitHub Dashboard Integration**: Full frontend workflow with Login Gate, repository selection, manifest detection, and interactive AI Agent Audit reports.
- [x] **Backend GitHub APIs**: `/api/v1/github/user`, `/repos`, `/repos/{owner}/{repo}/manifests`, and `/repos/{owner}/{repo}/analyze` with SSRF and path-traversal validation.
- [x] npm adapter: lockfile inventory, metadata-only preflight, approval gate, script-disabled install (`--ignore-scripts`), post-install verification, and inventory synchronization.
- [x] Python **uv** adapter: `uv.lock` inventory, PyPI metadata preflight, approval gate, post-install verification, and inventory synchronization.
- [x] Browser-consented CLI login with token storage in the OS credential store; project config contains no authentication token.
- [x] Authenticated backend inventory and preflight APIs, incremental OSV scans, persisted investigations, and dashboard visibility.
- [x] Foreground polling monitor for supported project files and lockfiles; detects external manager changes after they happen.
- [x] Local validation: 24 CLI unit tests, backend test suite, frontend Oxlint (0 warnings, 0 errors), and production Vite build.

### Still to do

- [ ] Fix hosted Neon tenant isolation: configure a restricted runtime role without `BYPASSRLS`, apply the inventory migration, and verify cross-tenant access controls before hosted CLI use.
- [ ] Validate browser login, OS credential storage, registry/OSV/Bifrost calls, and real npm/uv installs end to end on clean supported environments.
- [ ] Publish and test the CLI package on clean developer machines.
- [ ] Add Python adapters for pip, Poetry, and Pipenv; currently Python support is uv-only.
- [ ] Decide and test how to preflight newly resolved Python transitive dependencies before their first installation.
- [ ] Add private-registry support, scoped/refreshable/revocable authentication, and secure credential handling.
- [ ] Add durable offline queue/replay, stale-state reporting, and monitor recovery across restarts.
- [ ] Implement CI/CD lockfile gates, GitHub Actions workflow, and VS Code extension.
- [ ] Add pnpm, Yarn, Rust (Cargo), and Go adapters with independent security and install tests.
- [ ] Add configurable organization policy, approved overrides, and verified remediation workflows.
- [ ] Implement scheduled scans and durable background jobs using the shared backend runtime.

---

## GitHub Integration & AI Agent Analysis

DepShield integrates with GitHub to enable autonomous repository audits both in the browser dashboard and via the CLI.

### Web Dashboard Workflow

The frontend features a clean Seesaw-inspired, flat UI architecture (no gradients):
1. **Login Gate**: Connect with a GitHub Personal Access Token (classic or fine-grained with `repo` or `public_repo` scope). Tokens are stored client-side in the browser's credential storage and used strictly for read-only manifest inspection.
2. **Dashboard Overview**: Once connected, the user enters the intelligence dashboard with live stats (connected repositories, audited dependencies, active OSV advisories, and exact checked pins).
3. **Five Modular Sections**:
   - **AI Agent & Repos**: Search/filter repositories, discover manifests, set custom agent investigation prompts, and trigger one-click audits.
   - **Findings**: Explore active CVE/GHSA advisories, affected package versions, and fix paths.
   - **Manual Scanner**: Paste raw npm `package.json` / `package-lock.json` or Python `requirements.txt` / `uv.lock` manifests for stateless checks.
   - **Workspace & Team**: Manage organizations, project inventories, invitations, and member roles via Neon Auth.
   - **Reports**: Executive security posture, exact-version coverage metrics, and export options.

### CLI GitHub Workflow

The `depshield github` command suite brings full repository auditing to the terminal:

```powershell
# Authenticate and store your GitHub token in the OS credential store
depshield github login --token <YOUR_GITHUB_PAT>

# Check current connected user profile
depshield github status

# List your accessible repositories
depshield github repos --page 1 --per-page 30

# Inspect discovered manifests in a repository
depshield github manifests expressjs/express

# Run an AI Security Agent audit on a repository
depshield github analyze expressjs/express
depshield github analyze octocat/hello-world --manifest package.json --question "Check remote code execution risk"

# Remove the stored GitHub token
depshield github logout
```

Add `--json` to any command for structured, machine-readable output.

---

## Run locally

### Backend

### Backend

From the project root:

```powershell
.\backend
```
*(or `.\run-backend.ps1`)*

Alternatively, using python directly:

```powershell
cd backend
.\.venv\Scripts\python -m uvicorn app.main:app --reload
```

The API starts on `http://localhost:8000`.

### Frontend

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

The dashboard starts on `http://localhost:5173`. Set `VITE_API_BASE_URL` when the backend is hosted elsewhere.

### Local Bifrost AI Gateway (Optional)

To enable AI explanations for verified advisory evidence during investigations:

```powershell
npx -y @maximhq/bifrost
```

Open `http://localhost:8080`, configure an LLM provider, and ensure `BIFROST_BASE_URL` in `.env` points to `http://localhost:8080/openai`. When Bifrost is unavailable, DepShield continues to report verified OSV advisories with deterministic summaries.

---

## Developer CLI (Local Project Management)

Install the local package with `pipx`:

```powershell
pipx install .\cli
$env:DEPSHIELD_API_URL = "http://localhost:8000"
$env:DEPSHIELD_DASHBOARD_URL = "http://localhost:5173"
depshield init
```

* **npm**: Requires `package-lock.json` or `npm-shrinkwrap.json`.
* **Python**: Requires both `pyproject.toml` and `uv.lock`.
* **Safe Installation Gate**: `depshield add <package>@<version>` checks candidate metadata against OSV.dev before downloading. Active advisories block installation. Installs run with lifecycle scripts disabled (`--ignore-scripts`) for npm and `uv add --no-sync` followed by `uv sync` after approval for Python.
* **Monitor**: `depshield monitor` polls dependency files and syncs inventory changes.

---

## Testing

Run CLI unit tests:

```powershell
$env:PYTHONPATH = "cli"
.\backend\.venv\Scripts\python -m unittest discover -s cli/tests
```

Run frontend lint and production build:

```powershell
npm run lint --prefix frontend
npm run build --prefix frontend
```
