#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -f ".env.prod.example" ]]; then cp .env.prod.example .env; fi
npm ci || npm install
npm run register || true
npm run start
