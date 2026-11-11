# DepShield AI

DepShield is a React dashboard and FastAPI API for checking dependency manifests and lockfiles
against OSV.dev. Vulnerability matching is deterministic; AI is used only to explain verified
advisory evidence during an investigation.

The authenticated workspace supports organizations, projects, saved scan and investigation
history, organization invitations, and member management. The public stateless scan endpoint is
also retained for compatibility.

The current architecture and implementation boundaries are documented in
[docs/architecture.md](./docs/architecture.md). Local tests cover the application behavior; live
sign-in/user flows and a DepShield-to-Bifrost request with a configured provider remain unverified.

The **Developer Integration Layer** CLI, shared preflight/inventory APIs, and foreground monitor
support npm and Python projects managed by uv as an early, locally testable milestone. GitHub/CI,
VS Code, pip/Poetry/Pipenv adapters, and automated remediation remain future work; details and
limits are in
[docs/developer-integration.md](./docs/developer-integration.md).
The implementation checklist and remaining release blockers are summarized in
[docs/developer-integration-status.md](./docs/developer-integration-status.md).

## Developer Integration Layer checklist

Status reflects implementation and local validation only; checked items are not a claim that the
hosted production flow has been verified. See the [full status report](./docs/developer-integration-status.md)
for details.

### Done locally

- [x] Architecture and security workflow documented in
  [docs/developer-integration.md](./docs/developer-integration.md).
- [x] Python-distributed `depshield` CLI package and commands: `init`, `add`, `scan`, `status`,
  `monitor`, `explain`, `fix`, and `report`.
- [x] npm adapter: lockfile inventory, metadata-only preflight, approval gate, script-disabled
  install, post-install verification, and inventory synchronization.
- [x] Python **uv** adapter: `uv.lock` inventory, PyPI metadata preflight, approval gate,
  post-install verification, and inventory synchronization.
- [x] Browser-consented CLI login with token storage in the OS credential store; project config
  contains no authentication token.
- [x] Authenticated backend inventory and preflight APIs, incremental OSV scans, persisted
  investigations, and dashboard visibility.
- [x] Foreground polling monitor for supported project files and lockfiles; detects external
  manager changes after they happen.
- [x] Local validation: 54 backend tests, 19 CLI tests, frontend build/lint, and a CLI wheel build.

### Still to do

- [ ] Fix hosted Neon tenant isolation: configure a restricted runtime role without `BYPASSRLS`,
  apply the inventory migration, and verify cross-tenant access controls before hosted CLI use.
- [ ] Validate browser login, OS credential storage, registry/OSV/Bifrost calls, and real npm/uv
  installs end to end on clean supported environments.
- [ ] Publish and test the CLI package on clean developer machines.
- [ ] Add Python adapters for pip, Poetry, and Pipenv; currently Python support is uv-only.
- [ ] Decide and test how to preflight newly resolved Python transitive dependencies before their
  first installation.
- [ ] Add private-registry support, scoped/refreshable/revocable authentication, and secure
  credential handling.
- [ ] Add durable offline queue/replay, stale-state reporting, and monitor recovery across restarts.
- [ ] Implement CI/CD lockfile gates, GitHub integration, and the VS Code extension.
- [ ] Add pnpm, Yarn, Rust, and Go adapters with independent security and install tests.
- [ ] Add configurable organization policy, approved overrides, and verified remediation workflows.
- [ ] Implement scheduled scans and durable background jobs using the shared backend runtime.

**Known boundary:** ordinary `npm install` and `uv add` commands cannot currently be intercepted.
Only `depshield add` provides the pre-install gate; the monitor detects external changes afterward.
The uv `sync` step can execute package build backends after user approval, and npm's script-disabled
installation can affect packages that need build scripts.

## Run locally

Use Python 3.12 for the backend environment:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --reload
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

The frontend expects the API at `http://localhost:8000` by default. Set
`VITE_API_BASE_URL` when the API is hosted elsewhere.

## Developer CLI

The CLI is not yet published. From the repository root, install the local package with `pipx`:

```powershell
pipx install .\cli
$env:DEPSHIELD_API_URL = "http://localhost:8000"
$env:DEPSHIELD_DASHBOARD_URL = "http://localhost:5173"
depshield init
```

For npm, `init` requires an existing `package-lock.json` or `npm-shrinkwrap.json`. For Python, it
requires both `pyproject.toml` and `uv.lock`. It will not install dependencies to create a lockfile.
It registers the project, saves non-secret IDs in the ignored
`.depshield/config.json`, sends a normalized package inventory, and triggers the first saved
assessment. Browser authorization requires a signed-in DepShield dashboard; its token is saved in
the operating-system credential store, never in project configuration. Use `depshield login` to
authorize again and `depshield logout` to remove the local token.

Use `depshield add lodash@4.17.21` in npm projects or
`depshield add requests==2.32.0` in uv projects. Candidate metadata is fetched without downloading
the package, then the backend checks OSV and policy. A verified active advisory blocks installation;
allow/warn decisions require interactive approval. npm installs suppress lifecycle scripts; Python
installs use `uv add --no-sync` followed by `uv sync` only after approval. Both adapters
verify the resulting project lock state before syncing inventory. Registry metadata is untrusted;
provenance and artifact hashes are signals, not independent proof of safety.

The Python adapter currently supports uv only, and preflights the requested release; newly resolved
transitive packages are added to the inventory and scanned after uv updates its lock. pip, Poetry,
Pipenv, private registries, and workspace/multi-ecosystem projects are not yet supported. Plain
`npm install`/`uv add` commands are not intercepted; `depshield monitor` detects their resulting
lockfile changes afterward. `depshield scan`, `status`, `explain`, and `report` use the same
authenticated backend and saved project history. `depshield fix` remains proposal-only/unavailable
until verified fix candidates exist.

Do **not** use CLI tenant endpoints against the current Neon runtime credentials yet: the
configured database owner role has `BYPASSRLS`, so PostgreSQL row-level tenant isolation is not
effective for that connection. Local SQLite tests verify application membership checks, not live
Neon isolation. Use a restricted runtime database role and verify RLS before enabling CLI traffic
to a hosted tenant database. The live browser callback, registry, OSV, and Bifrost path also has
not yet been exercised end to end.

## Neon Auth and database setup

The API uses Neon Managed Auth (Better Auth) for identity and PostgreSQL for organization,
project, scan, investigation, and event records. No Neon project is provisioned automatically.
Use a supported AWS project with IP Allow and Private Networking disabled; enable Managed Auth
before using sign-in.

1. Copy `.env.example` to the project root `.env` and enter values locally. Do not commit `.env`
   or send database credentials in chat.
2. Set `DATABASE_URL` to the pooled PostgreSQL connection string for application traffic, using
   a dedicated non-owner role without `BYPASSRLS`. Set `DATABASE_URL_UNPOOLED` to the direct
   connection string for migrations and maintenance. Keep the owner credential out of runtime
   application traffic. Never put either credential in source control.
3. Set `NEON_AUTH_BASE_URL` to the Managed Auth base URL shown in Neon Console. The backend
   derives `/.well-known/jwks.json` from it; set `NEON_AUTH_JWKS_URL` only when an explicit
   same-origin URL is needed.
4. Apply the versioned schema from the backend directory:

   ```powershell
   .\.venv\Scripts\alembic upgrade head
   ```

5. In `frontend`, set `VITE_NEON_AUTH_URL` to the same Managed Auth base URL in a local
   `.env.local`, then restart Vite:

   ```text
   VITE_NEON_AUTH_URL=https://your-managed-auth-base-url
   ```

Add the deployed frontend origin to Neon Auth's trusted domains. Localhost is currently allowed
for development. The browser sends the Auth bearer token
to the API; the API verifies the EdDSA signature, issuer, audience, expiry, and subject. CORS
allows the configured origins and the `Authorization` header; it does not enable credentialed
cookie requests. Verify sign-up, sign-in, sign-out, session restoration, and protected API access
in the target browsers.

DepShield's organization membership records, not client-supplied organization IDs or Auth role
claims, determine project access. Members can create organizations and projects; owners/admins
can invite users, manage membership roles, and revoke invitations. Invitation tokens are returned
once by the API, stored as hashes, expire after seven days, and must be shared manually out of
band; email delivery is not implemented.

The PostgreSQL migration enables and forces row-level security (RLS) on tenant tables. Policies
use transaction-local application context as defense in depth alongside API membership checks.
The live migration and policies are present, but both database URLs currently use an owner role
with `BYPASSRLS`; cross-tenant RLS is therefore not enforced for those connections. A restricted
runtime role is required before relying on RLS. Even with that role, RLS is not a boundary against
a holder of the database credential who can set the custom context values.

## Saved scans, lockfiles, and retention

Authenticated project scans are saved with their results and can be listed or opened from project
history. Supported inputs are:

- npm `package.json` manifests and `package-lock.json` lockfiles (versions 1, 2, and 3)
- Python `requirements.txt` manifests, Poetry/uv TOML lockfiles, and `Pipfile.lock` JSON

Lockfiles provide resolved package versions, including transitive entries where present. The
scanner does not build dependency-edge graphs. Manifest text is limited to 1 MB and 1,000
dependencies. Only exact package versions are queried against OSV.dev; ranges are reported as
unchecked. A successful lookup with no matches is not a guarantee that a package is safe. OSV
lookup failures return `502`, not a successful scan with missing results.

`POST /api/v1/scans` is a public, stateless scan endpoint; `POST /api/scans` remains as a
compatibility route. Authenticated saved scans use
`POST /api/v1/projects/{project_id}/scans`; project history is available from
`GET /api/v1/projects/{project_id}/scans`, and a saved result from `GET /api/v1/scans/{scan_id}`.
The API accepts manifest text, not filesystem paths or uploaded archives. Only package names and
versions are sent to OSV.dev; source code and full manifests are not.

An hourly maintenance loop marks investigations still running after 30 minutes as failed and
deletes scans and investigations older than 90 days. Expired invitations are eligible for deletion
90 days after their expiry. Deployments must ensure only one process runs scheduled maintenance
or otherwise account for concurrent workers.

## Investigations and Bifrost

An authenticated project investigation checks an exact package version against OSV.dev and then
asks Bifrost to explain any returned advisory evidence. The API persists investigation status,
evidence, response metadata, and ordered events. A zero-match lookup does not prove safety and does
not invoke the model. Investigation requests currently run synchronously; stale runs are marked
failed by maintenance but are not automatically retried or replayed.

For local evaluation, start Bifrost in a separate terminal:

```powershell
npx -y @maximhq/bifrost
```

Open `http://localhost:8080`, configure a provider in the Bifrost UI, and test that provider using
Bifrost's OpenAI-compatible chat-completions endpoint. DepShield's default OpenAI-compatible base
URL is `http://localhost:8080/openai`; the API client appends `/chat/completions`. Set
`BIFROST_VIRTUAL_KEY` only when the gateway requires one and update `BIFROST_MODEL` to a model
available in that Bifrost instance. Keep the local gateway bound to localhost; do not expose its
management UI/API to untrusted networks. A live DepShield-to-Bifrost/provider request remains
unverified until a provider is configured and an investigation succeeds.

The unpinned NPX command is for local evaluation, not production. For hosted use, pin a Bifrost
release, enable dashboard authentication and TLS, and use durable storage as recommended by the
current Bifrost deployment documentation.

## Tests

Run backend tests from `backend`:

```powershell
.\.venv\Scripts\python -m unittest discover -s tests
```

Run frontend checks from `frontend`:

```powershell
npm run build
npm run lint
```

SQLite migration checks and automated tests do not replace live PostgreSQL RLS, Neon Auth, or
Bifrost integration tests.
