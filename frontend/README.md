# DepShield AI — Frontend Dashboard

DepShield's frontend is a React + TypeScript single-page application built on Vite and styled with a modern, flat, Seesaw-inspired developer tool design system (zero gradients, clean solid surfaces, high contrast, and crisp information density).

The dashboard connects to the DepShield FastAPI backend to audit dependency manifests, query authoritative OSV.dev advisories, and present evidence-grounded AI investigations from the Bifrost gateway.

---

## Design System & Principles

* **Seesaw-Inspired Flat Aesthetics**: Solid surface colors (`#090d16` canvas, `#0f172a` topbar, `#111827` cards and panels, `#1e293b` interactive rows and inputs).
* **Zero Gradients**: No gradient buttons, backgrounds, or text clips. Consistent solid states and borders provide clean, professional, enterprise-grade clarity.
* **Deterministic Risk Color Coding**:
  * `CRITICAL RISK`: Solid crimson badge (`#450a0a` / `#fca5a5`)
  * `HIGH RISK`: Solid orange badge (`#431407` / `#fdba74`)
  * `MEDIUM RISK`: Solid amber badge (`#422006` / `#fde047`)
  * `CLEAN`: Solid emerald badge (`#022c22` / `#6ee7b7`)
* **Responsive Layout**: Two-column master-detail split on desktop viewports, collapsing gracefully on tablets and mobile screens.

---

## Application Architecture

```
frontend/src/
├── components/
│   ├── GitHubLoginGate.tsx       # Landing page with Web vs CLI guide & zero-exfiltration proof
│   ├── GitHubAgentPanel.tsx      # Repository explorer, manifest detection, and agent audit report
│   └── LiveAuditMonitor.tsx      # Real-time CLI & Agent activity stream and privacy assurance
├── api.ts                        # Typed REST API client (GitHub, Scans, Manifests)
├── auth.ts                       # Neon Managed Auth client (Better Auth)
├── App.tsx                       # Main shell, dashboard stats ribbon, and modular tab navigation
├── WorkspacePanel.tsx            # Multi-tenant workspace, projects, and invitations
├── App.css                       # Solid flat design system & responsive styling
└── main.tsx                      # Vite React application entrypoint
```

### User Workflow

1. **Landing & Authentication Gate**:
   * Interactive **How to Use** guide comparing the **Web App (Browser)** vs **Developer CLI (Terminal)** workflows.
   * **Zero-Exfiltration Guarantee**: Explicitly verifies that only manifest files are read; proprietary source code (`.ts`, `.py`, `.js`, `.env`) is never opened, read into memory, or uploaded.
   * **Interactive Live Audit Preview**: Demonstrates timestamped telemetry events, verifying that zero code is leaked and only stateless `(package, version)` queries reach OSV.dev.
2. **Dashboard Overview**: Displays live stats for connected repositories, total audited dependencies, active OSV advisories, and exact verified versions.
3. **Six Modular Tabs**:
   * 🚀 **AI Agent & Repos**: Search and choose any GitHub repository, inspect discovered dependency manifests, specify agent prompts, and trigger one-click vulnerability audits.
   * 🛡️ **Verified Findings**: Expandable list of detected OSV advisories with CVE/GHSA aliases, severity ratings, and fix paths.
   * 📡 **Live Audit Stream**: Real-time telemetry feed of all file checks, OSV.dev queries, preflight blocks, and CLI monitor synchronization.
   * 📄 **Manual Scanner**: Paste raw npm `package.json` / `package-lock.json` or Python `requirements.txt` / `uv.lock` manifests for quick stateless checks.
   * 👥 **Workspace & Team**: Neon Auth organization management, member invitations, and CLI token authorization.
   * 📊 **Security Reports**: High-level posture indicators, exact version coverage percentage, and deterministic pipeline principles.

---

## Development & Build

### Prerequisites

* Node.js 18+ or 20+
* Backend API running at `http://localhost:8000` (or configured via `VITE_API_BASE_URL`)

### Running Locally

```powershell
npm install
npm run dev
```

The application will be accessible at `http://localhost:5173`.

### Environment Configuration

Create a `.env.local` file in the `frontend` directory if needed:

```env
# Optional override for the backend API URL (defaults to http://localhost:8000)
VITE_API_BASE_URL=http://localhost:8000

# Neon Managed Auth base URL (if using Neon organization accounts)
VITE_NEON_AUTH_URL=https://your-neon-auth-instance.neon.tech
```

### Linting & Production Build

```powershell
# Run Oxlint (0 warnings, 0 errors)
npm run lint

# Compile TypeScript and build production bundle
npm run build

# Preview production build locally
npm run preview
```
