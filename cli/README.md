# DepShield Developer CLI (`depshield`)

The command-line interface for the **DepShield AI Security Agent**, powered by **Bifrost by Maxim AI**.

---

## Installation

> **Note**: Run installation commands from within your cloned `DepShield` repository root. Once installed, the `depshield` command is globally available from any directory across your system (e.g. `C:\Testing`, other projects, etc.).

### Method 1: Universal Python Package (Recommended)

From the `DepShield` project root:

```bash
cd DepShield
pip install -e ./cli
```

Or globally via `pipx`:

```bash
pipx install ./cli
```

This registers the `depshield` binary globally in your system `PATH`.

---

### Method 2: One-Command Platform Installers

From the repository root:

- **Windows PowerShell**:
  ```powershell
  .\install-cli.ps1
  ```

- **macOS / Linux**:
  ```bash
  chmod +x ./install-cli.sh && ./install-cli.sh
  ```

---

### Method 3: In-Repository Launchers (Zero Global Installation)

If you do not wish to install packages into your global environment, run the standalone wrappers in `bin/`:

- **Windows Command Prompt**:
  ```cmd
  .\bin\depshield.cmd --help
  ```

- **Windows PowerShell**:
  ```powershell
  .\bin\depshield.ps1 --help
  ```

- **macOS / Linux**:
  ```bash
  ./bin/depshield --help
  ```

---

## Core Commands & Usage

### 1. GitHub Integration

```bash
# Connect and store your GitHub PAT in your OS secure keyring
depshield github login --token <YOUR_GITHUB_TOKEN>

# Verify connection and display profile information
depshield github status

# List your accessible repositories
depshield github repos

# Inspect detected dependency manifests for a repository
depshield github manifests owner/repo

# Run the autonomous DepShield AI agent pentest on a repository
depshield github analyze owner/repo

# Remove stored credentials
depshield github logout
```

### 2. Preflight Installation Gate

Intercept and inspect package versions against real-time OSV.dev feeds before downloading them to disk:

```bash
# Check safety and lifecycle scripts before installation
depshield add express@4.18.2
depshield add requests@2.31.0
```

### 3. Live File System Monitor

Watch dependency manifests (`package.json`, `uv.lock`, `requirements.txt`) in the foreground and stream deterministic audit telemetry to your live dashboard:

```bash
depshield monitor
```

### 4. Offline Local Audit

Audit dependency manifests strictly against local pinned datasets without egress:

```bash
depshield audit --offline
```

---

## Security & Isolation

- **OS Keyring Integration**: Tokens are stored via the Python `keyring` library using native OS credentials (Windows Credential Locker, macOS Keychain, Linux Secret Service).
- **Zero Source Code Ingestion**: The CLI opens only manifest and lockfile descriptors. Application logic (`.ts`, `.py`, `.js`, `.go`, `.env`) is never opened, read into memory, or transmitted.
- **Stateless Queries**: Outbound checks send only exact `(package_name, version)` pairs to authoritative OSV.dev feeds.

