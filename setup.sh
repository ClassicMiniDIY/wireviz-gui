#!/bin/bash

# WireViz GUI Setup Script
# This script helps set up dependencies for WireViz GUI

set -e

echo "=== WireViz GUI Setup ==="
echo ""

# Detect OS
OS="$(uname -s)"
case "${OS}" in
    Darwin*)    PLATFORM=macOS;;
    Linux*)     PLATFORM=Linux;;
    *)          PLATFORM="UNKNOWN:${OS}"
esac

echo "Detected platform: $PLATFORM"
echo ""

# Check for Homebrew on macOS
if [ "$PLATFORM" = "macOS" ]; then
    if ! command -v brew &> /dev/null; then
        echo "❌ Homebrew not found. Please install it from https://brew.sh"
        exit 1
    fi
    echo "✓ Homebrew found"
fi

# Check for Python
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo "✓ Python found: $PYTHON_VERSION"
else
    echo "❌ Python 3 not found. Please install Python 3.8 or later"
    exit 1
fi

# Check for GraphViz
if command -v dot &> /dev/null; then
    GRAPHVIZ_VERSION=$(dot -V 2>&1)
    echo "✓ GraphViz found: $GRAPHVIZ_VERSION"
else
    echo "⚠️  GraphViz not found"

    if [ "$PLATFORM" = "macOS" ]; then
        echo "Installing GraphViz via Homebrew..."
        brew install graphviz
        echo "✓ GraphViz installed"
    elif [ "$PLATFORM" = "Linux" ]; then
        echo "Please install GraphViz:"
        echo "  Ubuntu/Debian: sudo apt install graphviz"
        echo "  Fedora/RHEL:   sudo dnf install graphviz"
        exit 1
    fi
fi

# Check for WireViz
if command -v wireviz &> /dev/null; then
    echo "✓ WireViz found (system installation)"
else
    echo "⚠️  WireViz not found in PATH"
    echo "Note: WireViz will be bundled during release build"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "You can now build and run WireViz GUI:"
echo "  cargo run          # Run in development mode"
echo "  cargo build --release  # Build release with bundled Python"
echo ""
