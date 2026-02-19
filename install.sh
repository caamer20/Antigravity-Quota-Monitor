#!/bin/bash

# Exit on any error
set -e

echo "🚀 Installing Antigravity Quota Watcher..."

# Define the target directory for Antigravity extensions
EXT_DIR="$HOME/.antigravity/extensions/antigravity-quota-watcher"

# Create the directory
mkdir -p "$EXT_DIR"

# Copy the required files
cp -R package.json out "$EXT_DIR/"
if [ -d "images" ]; then
    cp -R images "$EXT_DIR/" 2>/dev/null || true
fi

echo "✅ Installation complete!"
echo "🔄 Please restart Antigravity to see the Quota Watcher in your status bar."
