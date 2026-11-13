# DepShield Developer CLI (`depshield`)

The command-line interface for the **DepShield Vulnerability Detection Agent**, powered by **Bifrost by Maxim AI**.

---

## Why Clone the Repository to Use the CLI?

DepShield requires cloning the repository (or installing via GitHub git URL) because:

1. **Not Published to PyPI Yet**: DepShield is currently an open-source project distributed directly via GitHub and has not been published to the public PyPI registry (`pip install depshield` is not available on PyPI). Cloning the repository provides the full source package on your machine.
2. **Self-Contained Native Launchers**: The repository includes dedicated native launchers in `bin/` (`depshield.ps1`, `depshield.cmd`, and POSIX `depshield`) and one-line installers (`install-cli.ps1` and `install-cli.sh`) that dynamically resolve the local Python virtual environment without requiring root permissions or polluting system-wide Python environments.
3. **Full Auditability & Clean Teardown**: Having the cloned repository locally allows you to audit the sandbox boundary (`cli/depshield_cli/`), verify that application source files (`.ts`, `.py`, `.env`) are never opened or read, run the test suite locally (`backend/.venv/Scripts/python -m unittest discover -s cli/tests`), and cleanly uninstall at any time with `.\uninstall-cli.ps1` or `./uninstall-cli.sh`.

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

# Run the autonomous DepShield AI agent vulnerability audit on a repository
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

---

## Stopping & Uninstalling

### 1. Stopping Active Operations

- **Foreground Monitor (`depshield monitor`)**: Press `Ctrl + C` in your terminal to cleanly terminate the file-watching daemon.
- **Single-Run Commands (`depshield audit`, `depshield github analyze`, `depshield add`)**: These execute synchronously and terminate automatically upon completion. No background processes remain active.

### 2. Clearing Stored Credentials

To remove your credentials from the operating system's native keychain:

```bash
# Remove stored GitHub Personal Access Token
depshield github logout

# Remove stored web dashboard session token
depshield logout
```

### 3. Uninstalling the CLI

To completely remove the DepShield CLI executable from your system:

- **Windows PowerShell:**
  ```powershell
  .\uninstall-cli.ps1
  ```
  *(Or if installed via pip: `pip uninstall depshield`)*

- **macOS & Linux:**
  ```bash
  ./uninstall-cli.sh
  ```
  *(Or if installed via pip: `pip uninstall depshield`)*

- **Direct GitHub Pip Install (Zero-Clone Users):**
  ```bash
  pip uninstall depshield
  ```

Once uninstalled, you can safely remove the cloned `DepShield` repository folder if you no longer need it.


