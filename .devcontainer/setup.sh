#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "🚀 Setting up Team Rocket Codespaces Environment"
echo "=================================================="

# 1. Verify Python 3.12
echo "🔍 Checking Python version..."
if command -v python3.12 &>/dev/null; then
    PYTHON_BIN="python3.12"
elif command -v python3 &>/dev/null; then
    PYTHON_BIN="python3"
else
    PYTHON_BIN="python"
fi
$PYTHON_BIN --version

# 2. Verify Node / npm
echo "🔍 Checking Node and npm..."
node --version
npm --version

# 3. Install Bun if not available
echo "🔍 Checking Bun..."
if ! command -v bun &>/dev/null; then
    echo "📦 Installing Bun..."
    curl -fsSL https://bun.sh/install | bash || true
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi
if command -v bun &>/dev/null; then
    bun --version
else
    echo "⚠️ Bun install finished (restart shell or source ~/.bashrc for Bun PATH)."
fi

# 4. Verify Terraform
echo "🔍 Checking Terraform..."
if command -v terraform &>/dev/null; then
    terraform --version | head -n 1
else
    echo "⚠️ Terraform command not found in PATH."
fi

# 5. Verify Azure CLI
echo "🔍 Checking Azure CLI..."
if command -v az &>/dev/null; then
    az --version | head -n 1
else
    echo "⚠️ Azure CLI command not found in PATH."
fi

# 6. Verify GitHub CLI
echo "🔍 Checking GitHub CLI..."
if command -v gh &>/dev/null; then
    gh --version | head -n 1
else
    echo "⚠️ GitHub CLI command not found in PATH."
fi

# 7. Set up Backend Python Virtual Environment
echo "🐍 Setting up Backend Python virtual environment (backend/.venv)..."
if [ ! -d "backend/.venv" ]; then
    $PYTHON_BIN -m venv backend/.venv
fi
backend/.venv/bin/pip install --upgrade pip setuptools wheel
if [ -f "backend/requirements.txt" ]; then
    echo "📦 Installing backend requirements..."
    backend/.venv/bin/pip install -r backend/requirements.txt
fi

# 8. Set up Frontend dependencies
echo "⚡ Installing Frontend dependencies..."
if [ -d "frontend" ] && [ -f "frontend/package.json" ]; then
    npm --prefix frontend install
fi

# 9. Set up Copilot dependencies if present
echo "🤖 Checking Copilot service dependencies..."
if [ -d "copilot" ]; then
    if [ -f "copilot/requirements.txt" ]; then
        echo "📦 Installing Copilot requirements..."
        backend/.venv/bin/pip install -r copilot/requirements.txt || true
    elif [ -f "copilot/pyproject.toml" ]; then
        echo "📦 Installing Copilot package in editable mode..."
        backend/.venv/bin/pip install -e copilot || true
    fi
fi

echo "=================================================="
echo "✅ Codespaces Environment Setup Complete!"
echo "=================================================="
echo "Tools Installed Summary:"
$PYTHON_BIN --version 2>&1 || true
node --version 2>&1 | sed 's/^/Node.js /' || true
npm --version 2>&1 | sed 's/^/npm /' || true
if command -v bun &>/dev/null; then bun --version 2>&1 | sed 's/^/Bun /'; fi
if command -v terraform &>/dev/null; then terraform --version 2>&1 | head -n 1; fi
if command -v az &>/dev/null; then az --version 2>&1 | head -n 1; fi
if command -v gh &>/dev/null; then gh --version 2>&1 | head -n 1; fi
echo "=================================================="
