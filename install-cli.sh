#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="${REPO_DIR}/cli"
BIN_DIR="${REPO_DIR}/bin"

chmod +x "${BIN_DIR}/depshield"

echo "Installing DepShield CLI..."

INSTALLED=false

# 1. Try pip3 or pip install
if command -v pip3 >/dev/null 2>&1; then
    if pip3 install -e "${CLI_DIR}"; then
        INSTALLED=true
        echo "DepShield CLI installed via pip3!"
    fi
elif command -v pip >/dev/null 2>&1; then
    if pip install -e "${CLI_DIR}"; then
        INSTALLED=true
        echo "DepShield CLI installed via pip!"
    fi
fi

# 2. Fallback: Symlink to ~/.local/bin
if [ "$INSTALLED" = false ]; then
    mkdir -p "${HOME}/.local/bin"
    ln -sf "${BIN_DIR}/depshield" "${HOME}/.local/bin/depshield"
    echo "Linked depshield to ${HOME}/.local/bin/depshield"
    echo "Ensure ~/.local/bin is in your PATH."
fi

echo "Installation complete! Verify with: depshield --version"

