#!/bin/bash
cd "$(dirname "$0")"
echo "Starting HireFree..."
if [ ! -d node_modules ]; then
  echo "Installing dependencies. This may take a few minutes..."
  npm install
fi
npm start
