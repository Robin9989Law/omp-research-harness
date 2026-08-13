---
description: Run an innovation-proposition-hunting workflow action
---

Treat the following as an iph workflow request: `$ARGUMENTS`.

If `workflow_state.json` is absent, stay in guided mode: confirm output type and workflow ID,
then call `iph_bootstrap`. Do not select an innovation path or advance automatically.

If state exists, read only the injected `active_state` and `next_required_action`. Call the
single matching `iph_*` tool. Never edit state, gates, decision logs or validation logs
directly. On non-READY exit, stop all other work and execute only the reported recovery
action.

When calling `iph_advance`, pass the post-transition `nextAction`. For every newly true gate,
pass each required top-level pointer as `stateArtifacts: ["key=relative/path"]`; separately
pass immutable files in `artifacts` so their SHA-256 values enter the decision log. A file hash
does not register its state pointer. If an older transition is STOP-locked only because those
pointers are missing, call `iph_clear_lock` with `stateArtifacts`, the corrected `nextAction`,
and an exact recovery note; never repeat the transition.
