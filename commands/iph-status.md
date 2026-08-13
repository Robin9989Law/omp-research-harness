---
description: Validate and report the current iph machine state
---

Call `iph_status` first for a read-only snapshot, then call `iph_validate` with strict checks
and `iph_handover`. Report the machine-derived
contract, lifecycle stage, active state, N/V level, profile, epoch, bundle hash, evidence
counts, reviewer provenance, exact exit status, blocked reasons and the one
`next_required_action`. Do not use approximate completion language.
