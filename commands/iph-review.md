---
description: Dispatch and register an independent iph V3/V4 review
---

Verify the current state is `INDEPENDENT_REVIEW` or `FINAL_VALIDITY_AUDIT`. Delegate the
exact current bundle to the `iph-reviewer` task agent. The parent must not write or repair
the review artifact and must never call `iph_review`: the reviewer calls it inside its own
task session, and the extension binds the lifecycle agent ID plus session ID before the
authoritative strict validation. The parent may only call `iph_validate` afterward. If
capability is unavailable, record BLOCKED_CAPABILITY; never synthesize a PASS.
For a substantive FAIL, require `required_remediation` and treat the reviewer's
`EXPECTED_REVIEW_FAIL_COMMIT`/exit 1 as a successfully sealed INVALID+STOP gate. For
BLOCKED_CAPABILITY, the parent must commit one `iph_advance(to=BLOCKED)` transaction with
the exact operator recovery action; narration alone is not closure.
