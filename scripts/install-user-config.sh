#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bun "${project_dir}/scripts/manage-user-config.ts" "$@"
