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

echo ""
echo -e "\033[36m       /\\      /\\"
echo -e "      /  \\____/  \\      ___             ___ _     _      _     _"
echo -e "     /  /| || |\\  \\    |   \\ ___ _ __  / __| |_  (_)___ | | __| |"
echo -e "    |  o---||--(O)-o|  | |) / -_) '_ \\ \\__ \\ ' \\ | / -_)| |/ _' |"
echo -e "    |  |/ \\|/  /| \\ |  |___/\\___| .__/ |___/_||_||_\\___||_|\\__,_|"
echo -e "    |  o---||---o--o|           |_|"
echo -e "     \\  \\  ||  /  /    \033[32mAutonomous Vulnerability Audit Agent\033[36m"
echo -e "      \\  \\ || /  /     \033[90mZero-Source-Code Ingestion | OSV-Verified\033[36m"
echo -e "       \\  \\||/  /      \033[36mPowered by Bifrost by Maxim AI"
echo -e "        \\  \\/  /"
echo -e "         \\____/\033[0m"
echo ""
echo -e "\033[32mDepShield CLI installed and active!\033[0m"
echo "You can run commands from any directory across your system:"
echo "  depshield --help"
echo "  depshield github status"
echo "  depshield github login --token <YOUR_PAT>"

