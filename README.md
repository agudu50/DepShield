# DepShield AI 🛡️

### An Agent Powered by Bifrost by Maxim AI

---

## 💡 What is DepShield AI?

When developers build apps, they use hundreds of open-source packages (libraries like `express`, `requests`, or `lodash`). But hackers frequently hide dangerous bugs, security holes, and backdoors inside these packages to break into servers, steal data, or crash systems.

**DepShield AI** is an autonomous security agent that tests projects for vulnerabilities on its own.

You give it a target repository or a list of packages, and the agent:

1. **Picks the target** and maps out every building block the project relies on.
2. **Pentests the target on its own** by matching exact package versions against global vulnerability feeds.
3. **Uses Bifrost by Maxim AI** as its intelligent gateway to analyze the risk, measure how dangerous the bug is, test if attackers can reach it, and write a clear fix plan.
4. **Guarantees zero data theft**: It only reads package names and version numbers. It never reads or steals your private code or passwords.

---

## 🎯 The Theme: Build an Agent That Pentests a Target on Its Own

Traditional security scanners simply give you long, confusing lists of errors. They don't think, prioritize, or explain how a hacker could actually exploit your project.

DepShield acts like a friendly, automated security expert:

- **Autonomous Target Discovery**: Select any GitHub repository or point the CLI to a folder. The agent independently finds and inspects the dependency files (like `package.json` or `requirements.txt`).
- **Automated Risk Probing**: It probes every package against the official Open Source Vulnerabilities database (OSV.dev) to find known security flaws (CVEs).
- **AI Attack & Defense Reasoning with Bifrost**: The agent asks Bifrost by Maxim AI to evaluate the findings:
  - _Can a hacker use this bug to attack my specific app?_
  - _What is the blast radius if someone exploits it?_
  - _What is the safest upgrade that won't break my app?_
- **Pre-Install Defense Gate**: Before you install any new package on your computer, DepShield's CLI intercepts the command, checks the package first, and stops dangerous code before it touches your hard drive.

---

## ⚡ Why Bifrost by Maxim AI is the Core Engine

**Bifrost by Maxim AI** serves as the central brain and gateway for all AI investigations:

```
+---------------------+         +----------------------------+         +-----------------------+
|   Target Project    |  -----> |   DepShield Security Agent |  -----> | Bifrost AI Gateway    |
| (GitHub Repo / CLI) |         | (Finds Descriptors & OSV)  |         | (Maxim AI Intelligence)
+---------------------+         +----------------------------+         +-----------------------+
                                                                                  |
                                                                       Evaluates attack reach,
                                                                       blast radius & safe fixes
                                                                                  |
                                                                                  v
                                                                       +-----------------------+
                                                                       | Clean Pentest Report  |
                                                                       | & 1-Click Upgrade Plan|
                                                                       +-----------------------+
```

1. **Intelligent Security Analysis**: Instead of raw computer error codes, Bifrost translates vulnerabilities into plain explanations of how an attack works.
2. **Reliable & Grounded**: Bifrost is instructed to stick strictly to real, verified facts. It never invents fake security bugs or makes false claims.
3. **Flexible Gateway**: Bifrost lets DepShield connect to modern language models smoothly while keeping security checks fast and responsive.

---

## 🔒 The Zero-Exfiltration Promise: No Code Theft

Developers are often afraid that AI tools will steal their private code or secret keys. DepShield is built with strict safety boundaries:

| What DepShield Checks ✅                                           | What DepShield NEVER Touches ❌                           |
| :----------------------------------------------------------------- | :-------------------------------------------------------- |
| **Package Names & Version Numbers** (`lodash: 4.17.15`)            | **Your Private Source Code** (`.js`, `.ts`, `.py`, `.go`) |
| **Manifest Files** (`package.json`, `uv.lock`, `requirements.txt`) | **Passwords & Secrets** (`.env`, `.pem`, API keys)        |
| **Public Registry Checksums** (SHA-256 integrity hashes)           | **Your Git History & Database Records**                   |

When checking security risks, DepShield sends **only** the package name and version number to public security feeds. **Zero lines of your app code ever leave your machine.**

---

## 🛠️ Technologies Used

- **Bifrost by Maxim AI (`@maximhq/bifrost`)**: The high-performance AI gateway that coordinates the security agent's reasoning.
- **FastAPI (Python 3.12)**: Fast, lightweight backend service that orchestrates target scans and connects to Bifrost.
- **React 19 & Vite**: Clean, modern web dashboard inspired by Seesaw and Linear with solid colors and zero gradients.
- **OSV.dev**: Open Source Vulnerability database maintained by Google and the open-source community.
- **DepShield CLI**: A terminal tool for developers to protect projects right from their command line.
- **Neon Auth & PostgreSQL**: Simple, secure account and team workspace management.

---

## 🚀 Quick Start & Installation

You can get the entire project running locally in just a few minutes.

### Prerequisites

- **Python 3.12** installed
- **Node.js (v18+)** and `npm` installed
- **Git** installed

---

### Step 1: Start the Bifrost AI Gateway (Maxim AI)

In your first terminal, start the Bifrost gateway:

```powershell
npx -y @maximhq/bifrost
```

- Bifrost will open on `http://localhost:8080`.
- Enter your preferred AI model provider key in the Bifrost dashboard.
- _(Note: If Bifrost is not running, DepShield still works and reports verified vulnerabilities deterministically!)_

---

### Step 2: Start the Backend Server

In your second terminal, run our quick start command from the project root:

```powershell
.\backend
```

_(Or use `.\run-backend.ps1`, or navigate to `cd backend` and run `.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000`)_.

The backend starts at **`http://localhost:8000`**.  
You can view interactive documentation at [http://localhost:8000/docs](http://localhost:8000/docs).

---

### Step 3: Start the Web Dashboard

In your third terminal:

```powershell
cd frontend
npm install
npm run dev
```

The web dashboard will start at **`http://localhost:5173`**.

---

## 🖥️ How to Use DepShield

### Option A: Using the Web App

1. **Open the Dashboard**: Visit `http://localhost:5173` in your browser.
2. **Connect with GitHub**: Enter a GitHub Personal Access Token (with read-only `repo` permission). Your token is stored safely in your browser only.
3. **Choose Your Target**: Search and select any repository from your account.
4. **Run Autonomous Pentest**:
   - The agent automatically spots package files (`package.json`, `uv.lock`, etc.).
   - Click **"Run AI Security Audit"**.
   - The agent probes for known weaknesses, queries Bifrost by Maxim AI, and shows you a clean, prioritized report with safe upgrade steps.
5. **Watch the Live Audit Stream**: Click the **Live Audit Stream** tab to watch every file the agent checks in real time and verify that **0 bytes** of your private source code were read.

---

### Option B: Using the Developer CLI (Terminal)

You can also use DepShield as your personal bodyguard directly in the command line:

```powershell
# 1. Connect your GitHub token to your secure computer keychain
depshield github login --token <YOUR_GITHUB_TOKEN>

# 2. Check your connection status
depshield github status

# 3. Pentest any repository directly from your terminal
depshield github analyze owner/repository

# 4. Safely check and add a package before downloading it
depshield add express@4.18.2

# 5. Turn on background monitoring to watch for new vulnerabilities
depshield monitor
```

---

## 📡 Live Real-Time Activity Monitoring

Both the landing page and the dashboard feature a **Live Activity Monitor**.

Whenever an audit runs, you can see a transparent log of every action:

- `[DESCRIPTOR_READ]` Shows the exact file checked (e.g. `package.json`).
- `[OSV_QUERY]` Shows the exact package name sent to the security feed.
- `[BIFROST_AGENT]` Shows when Bifrost evaluates an exploit or remediation path.
- `[EXFILTRATION_PROOF]` Confirms that **0 lines of source code** were touched.

---

## 🧪 Testing the Project

You can verify that everything works properly with our built-in test suites:

```powershell
# 1. Run all CLI unit tests (24 tests)
$env:PYTHONPATH = "cli"
.\backend\.venv\Scripts\python -m unittest discover -s cli/tests

# 2. Check frontend code quality (Oxlint)
npm run lint --prefix frontend

# 3. Verify the frontend production build
npm run build --prefix frontend
```

---

## 📁 Project Structure

```
DepShield/
├── backend/                  # FastAPI Python backend
│   ├── app/
│   │   ├── agents/bifrost.py # Bifrost by Maxim AI client integration
│   │   ├── api/routes/       # API endpoints (github, scans, agent, health)
│   │   ├── domain/           # Core scanning and repository logic
│   │   └── main.py           # Application entrypoint
├── frontend/                 # React 19 + Vite web dashboard
│   ├── src/
│   │   ├── components/
│   │   │   ├── GitHubLoginGate.tsx  # Landing page, guides, and zero-leak proof
│   │   │   ├── GitHubAgentPanel.tsx # Target selection and autonomous audit
│   │   │   └── LiveAuditMonitor.tsx # Real-time agent activity & telemetry stream
│   │   ├── App.tsx                  # Main application shell and tabs
│   │   └── App.css                  # Modern Seesaw-inspired flat design (zero gradients)
├── cli/                      # Developer command-line tool (`depshield`)
│   ├── depshield_cli/
│   │   ├── github.py         # Terminal GitHub integration & audit commands
│   │   └── main.py           # Preflight installation gates and background monitor
├── backend.cmd               # Quick-start script for Windows
├── run-backend.ps1           # Quick-start PowerShell script
└── README.md                 # Project documentation
```

---

## 🏆 Summary

DepShield AI turns vulnerability management into an autonomous, transparent security experience:

- **Target**: Any project or GitHub repository.
- **Agent**: Discovers packages, probes attack surfaces, and verifies vulnerabilities.
- **Brain**: **Bifrost by Maxim AI** analyzes risks, evaluates reachability, and builds safe upgrade plans.
- **Promise**: 100% deterministic security facts, zero code theft, and clear, simple answers.
