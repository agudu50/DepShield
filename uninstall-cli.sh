#!/usr/bin/env bash
set -e

echo "Uninstalling DepShield CLI..."

# 1. Clear credentials
if command -v depshield >/dev/null 2>&1; then
    echo "Clearing stored credentials..."
    depshield github logout >/dev/null 2>&1 || true
    depshield logout >/dev/null 2>&1 || true
fi

# 2. Pip uninstall
if command -v pip3 >/dev/null 2>&1; then
    pip3 uninstall -y depshield >/dev/null 2>&1 || true
elif command -v pip >/dev/null 2>&1; then
    pip uninstall -y depshield >/dev/null 2>&1 || true
fi

# 3. Remove symlink from ~/.local/bin
if [ -L "${HOME}/.local/bin/depshield" ] || [ -f "${HOME}/.local/bin/depshield" ]; then
    rm -f "${HOME}/.local/bin/depshield"
    echo "Removed ${HOME}/.local/bin/depshield"
fi

echo "DepShield CLI has been uninstalled."
echo "If you cloned the repository, you can now safely delete the DepShield folder."

