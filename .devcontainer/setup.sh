#!/usr/bin/env bash
# Devcontainer setup: everything the agents need to build and test Personal Space.
set -euo pipefail

echo "Installing OpenCode and agent-browser..."
npm install -g opencode-ai agent-browser

echo "Installing Chrome for Testing and its system libraries..."
agent-browser install --with-deps

echo "Adding the agent-browser skill for OpenCode..."
npx -y skills add vercel-labs/agent-browser -a opencode -y

echo "Verifying the browser can launch..."
agent-browser doctor

echo "Setup complete."
