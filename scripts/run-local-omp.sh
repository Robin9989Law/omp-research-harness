#!/usr/bin/env bash
set -euo pipefail

plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec omp \
	--plugin-dir "$plugin_root" \
	--extension "$plugin_root/extensions/iph.ts" \
	"$@"
