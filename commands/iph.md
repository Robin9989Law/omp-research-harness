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
