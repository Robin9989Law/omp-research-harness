---
description: Dispatch and register an independent iph V3/V4 review
---

Verify the current state is `INDEPENDENT_REVIEW` or `FINAL_VALIDITY_AUDIT`. Delegate the
exact current bundle to the `iph-reviewer` task agent. The parent must not write or repair
the review artifact. After the reviewer yields its actual agent and thread IDs, call
`iph_review` with those IDs and its PASS/FAIL verdict, then call `iph_validate` in strict
mode. If capability is unavailable, record BLOCKED_CAPABILITY; never synthesize a PASS.
