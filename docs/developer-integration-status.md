# DepShield Developer Integration Layer — Status Report

**Report date:** 2026-11-11  
**Status:** Early implementation milestone complete for local npm and Python/uv workflows; not production-ready  
**Detailed architecture:** [Developer Integration Layer design](./developer-integration.md)

## Executive summary

DepShield now has a Python-distributed CLI foundation and local project workflows for npm and
Python projects managed by uv. Developers can register a supported project, synchronize a
dependency inventory, request a persisted pre-install assessment for one exact package version,
and install only after an allow/warn decision and explicit interactive approval. Verified active
OSV advisories block the requested installation. Bifrost is used to explain verified advisory
evidence; it does not determine policy.

The backend persists inventory snapshots, incremental scans, preflight investigations, and
dashboard-visible evidence. Local tests cover the principal API and CLI paths. This is an early
milestone, not a production release: live authentication, hosted database isolation, real provider
and registry flows, and real package installation have not been validated end to end.

## Delivered

### CLI and project setup

- Added the installable `depshield` Python package, command entrypoint, and `pipx` installation
  instructions.
- Implemented `init`, `add`, `scan`, `status`, `monitor`, `explain`, `fix`, and `report`, plus
  browser-based `login` and `logout`.
- `init` detects supported npm or uv projects, requires their existing lockfile, registers or reuses
  a DepShield project, writes non-secret project configuration, and synchronizes the initial
  inventory. It does not install dependencies.
- Project configuration stores identifiers and the API URL only. Authentication tokens are stored
  via the OS credential store. Backend settings use secret-typed database and Bifrost values; no
  credentials are included in this report.

### npm pre-install workflow

- Parses npm lockfile v1, v2, and v3 inventories, including nested and scoped packages.
- Resolves an exact candidate from bounded npm registry metadata requests; preflight does not
  download candidate tarballs or invoke npm.
- Treats registry metadata as untrusted and displays lifecycle scripts, deprecation, provenance
  URL, and integrity separately from verified advisory evidence.
- Calls backend preflight before installation. Active OSV matches block; allow and warn require
  interactive approval.
- After approval, uses argument-array subprocess invocation with `--ignore-scripts`, `--save-exact`,
  and `--global=false`; verifies manifest, installed path, lockfile version, and integrity before
  syncing the resulting inventory.

### Python/uv pre-install workflow

- Detects supported `pyproject.toml` plus `uv.lock` projects, rejecting competing manager files and
  mixed npm/Python roots rather than guessing.
- Reads exact locked versions and excludes editable, directory, and virtual workspace packages
  from external dependency inventory.
- Resolves exact package metadata from PyPI without downloading distributions or running build
  backends during preflight. It records release artifact hashes, upload times, source URL, and
  yanked status as untrusted metadata.
- Uses the same persisted backend policy as npm. Active OSV advisories block; yanked releases warn.
- Only after approval, runs `uv add --no-sync` followed by `uv sync`, then verifies the project pin,
  lockfile artifact hash/version, and installed distribution version before inventory sync.

### Backend, persistence, and dashboard

- Added authenticated inventory synchronization and retrieval APIs with duplicate checks,
  project-membership checks, persisted snapshots/revisions/digests, and incremental scans for
  added or changed package versions.
- Extended inventory assessment to npm and Python package ecosystems.
- Added a persisted preflight API that checks exact versions against OSV, excludes withdrawn
  advisories, records evidence and decisions, and preserves verified evidence when Bifrost is
  unavailable.
- Kept OSV evidence authoritative: AI explanations do not override the decision.
- Added dashboard consent for CLI authorization and views for synchronized inventory and
  preflight results.
- Added migration `0003_project_inventory` for inventory storage and tenant policies. It has not
  been applied or verified against the hosted Neon database.

### Monitoring and documentation

- Added an opt-in foreground monitor that polls relevant project and lock files, debounces changes,
  and synchronizes stable inventory snapshots. The backend avoids rescanning unchanged versions.
- Documented the architecture, setup, command behavior, failure handling, and current limitations
  in the [design document](./developer-integration.md) and [README](../README.md).

## Validation completed

| Area | Result |
|---|---|
| Backend unit tests | **54 passed** |
| CLI unit tests | **19 passed** |
| Frontend production build | Passed; emitted non-blocking dependency comment warnings |
| Frontend lint | Passed; no warnings or errors |
| CLI wheel | Built successfully; verified npm, uv, and PyPI adapters were packaged |
| Pylance checks | No diagnostics in the reviewed implementation modules |

These are local tests and build checks. They do **not** establish that the production database,
Neon Auth, browser callback, registry, OSV, Bifrost provider, or package-manager install works
end to end.

## Not done / known limitations

### Release and deployment blockers

1. **Hosted tenant isolation:** the configured Neon owner role has `BYPASSRLS`. Do not send hosted
   CLI tenant traffic until a restricted runtime role is configured and cross-tenant RLS behavior
   is verified. The inventory migration also still needs a controlled hosted migration test.
2. **Live end-to-end tests:** browser consent/login, OS credential-store behavior on supported
   operating systems, npm/PyPI metadata, OSV lookup, Bifrost explanation, and real install/verify
   flows have not been exercised against live services.
3. **CLI distribution:** the wheel builds locally, but the package is not published and the
   installation experience has not been validated on clean developer machines.

### Security and workflow gaps

- `depshield add` gates only installations routed through the CLI. Ordinary `npm install`, `uv add`,
  IDE integrations, scripts, and other package managers are not intercepted. Monitoring detects
  resulting file changes after the fact; it does not prevent them.
- Python support is **uv-only**. The requested pip, Poetry, and Pipenv adapters are not implemented.
- The Python preflight checks the requested direct release. Newly resolved transitive packages are
  added to inventory and scanned after `uv sync`, so they are not all individually preflighted
  before that first installation.
- `uv sync` may run package build backends after user approval. Dynamic analysis is not implemented;
  no isolated package-analysis environment is provided.
- npm lifecycle scripts are suppressed during `depshield add`, which can break packages that need
  native build steps. This needs explicit UX and compatibility testing.
- Private registry/index authentication is unsupported. npm registry provenance is displayed but
  not cryptographically verified; PyPI metadata and hashes are signals, not proof that software is
  safe.
- Offline mode has no durable queue, replay/reconciliation cursor, or explicit stale-state workflow.
  The monitor is foreground polling, not a filesystem watcher or background service.
- Login uses a browser-consented loopback callback and OS keyring storage; scoped device credentials,
  token refresh, expiry handling, and revocation are not implemented.
- `fix` is intentionally unavailable/proposal-only because verified remediation candidates and an
  approval workflow do not exist.
- Policy is fixed: active OSV matches block, selected metadata indicators warn, and AI never decides.
  Organization-configurable rules, audited overrides, and additional authoritative malware feeds
  are not implemented.

### Integrations not started

- GitHub App/webhook ingestion and GitHub repository/project binding.
- CI/CD lockfile gates and reusable workflow/action.
- VS Code extension.
- pnpm, Yarn, Rust, and Go adapters.
- Scheduled scans and shared durable worker/job processing.
- Automated dependency remediation.

## Recommended remaining work, in order

### P0 — Make hosted use safe

1. Configure a dedicated pooled runtime database role without `BYPASSRLS`; keep owner access for
   migrations/maintenance only.
2. Apply migration `0003_project_inventory` through a reviewed deployment process.
3. Verify tenant isolation using the restricted role, including reads, writes, inventory, scans,
   and investigations across two different tenants.
4. Only then enable hosted CLI traffic.

### P1 — Prove complete supported flows

1. Run browser login and token storage on clean Windows, macOS, and Linux environments; document
   re-authentication and logout behavior.
2. Add controlled end-to-end tests for npm and uv using mocked or disposable registries, OSV, API,
   and Bifrost; include blocked, warned, allowed, declined, timeout, partial install, and verification
   mismatch cases.
3. Test the actual `npm install --ignore-scripts` and uv install behavior, particularly build
   backends, native dependencies, and package hash verification.
4. Test migration and inventory synchronization on PostgreSQL after the tenant role is fixed.

### P1 — Close Python dependency coverage

1. Decide and document the intended project isolation model for uv installs and build backends.
2. Improve the preflight/install contract so every newly resolved transitive package is assessed
   before it is installed, or explicitly make the limitation a user-approved policy.
3. Add pip support only with separately tested resolver, lock, hash, and install semantics; follow
   with Poetry and Pipenv as separately scoped adapters.

### P2 — Improve reliability and auth lifecycle

1. Add durable offline queueing, safe replay/idempotency, stale status, and monitor recovery across
   restarts.
2. Add scoped credentials, expiry/refresh, revocation, and an auditable token lifecycle.
3. Add private-registry support without logging or persisting registry secrets in project config.
4. Clarify npm install-script suppression consequences and provide tested handling for legitimate
   native builds.
5. Add configurable organization policy, approved overrides, and additional trusted intelligence
   sources.

### P3 — Expand developer integrations

1. Add a CI lockfile gate that runs before normal dependency installation.
2. Add GitHub integration with signed webhook validation, repository binding, least-privilege
   credentials, idempotency, and shared persisted investigations.
3. Add the VS Code client over the same CLI/API contracts.
4. Add pnpm/Yarn, Rust, and Go adapters with independent lockfile, execution, and verification
   tests.
5. Add scheduled monitoring and durable background jobs through the shared backend runtime.

## Completion criteria for a production-ready first release

- Hosted PostgreSQL migration and cross-tenant RLS tests pass with a restricted runtime role.
- A clean-machine install and browser login work on supported operating systems.
- npm and uv blocked/allow/warn/decline and failure paths pass end-to-end tests.
- No package is downloaded or package-controlled code run during pre-install assessment.
- The exact direct candidate is verified after installation; transitive dependency coverage is
  explicitly designed and tested.
- Ordinary package-manager bypasses and the monitor's post-install-only detection are clearly
  communicated to developers.
- Offline/retry behavior, credential lifecycle, registry support, and release distribution are
  documented and operationally tested.

## Related resources

- [Developer Integration Layer architecture and detailed contracts](./developer-integration.md)
- [Project README and local setup](../README.md)
