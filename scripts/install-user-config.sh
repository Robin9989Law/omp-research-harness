#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agent_dir="${PI_CODING_AGENT_DIR:-${HOME}/.omp/agent}"
system_target="${agent_dir}/SYSTEM.md"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dry_run=false

if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=true
elif [[ $# -gt 0 ]]; then
  printf 'Usage: %s [--dry-run]\n' "$0" >&2
  exit 64
fi

command -v omp >/dev/null 2>&1 || {
  printf '%s\n' "omp is required" >&2
  exit 1
}

existing_roles="$(omp config get modelRoles --json)"
merged_roles="$(printf '%s' "${existing_roles}" | bun -e '
  const current = await Bun.stdin.json();
  process.stdout.write(JSON.stringify({
    ...(current.value ?? {}),
    default: "minimax-code-cn/MiniMax-M3:high",
    atomic: "openai/gpt-5.6-sol:high",
    collision: "openai/gpt-5.6-sol:high",
    review: "deepseek/deepseek-v4-pro:high",
    commit: "deepseek/deepseek-v4-flash:high",
  }));
')"

if [[ "${dry_run}" == true ]]; then
  printf 'Would install %s to %s\n' "${project_dir}/SYSTEM.md" "${system_target}"
  printf 'Would set modelRoles to %s\n' "${merged_roles}"
  exit 0
fi

mkdir -p "${agent_dir}"
if [[ -e "${system_target}" ]]; then
  cp -p "${system_target}" "${system_target}.backup-${timestamp}"
  printf 'Backed up %s\n' "${system_target}.backup-${timestamp}"
fi
install -m 0644 "${project_dir}/SYSTEM.md" "${system_target}"

omp config set modelRoles "${merged_roles}"

printf '%s\n' "Installed research SYSTEM.md and model roles. Install/link the plugin separately."
