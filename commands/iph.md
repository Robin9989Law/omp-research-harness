---
description: Run an innovation-proposition-hunting workflow action
---

Treat the following as an iph workflow request: `$ARGUMENTS`.

If `workflow_state.json` is absent, stay in guided mode: confirm output type and workflow ID,
then call `iph_bootstrap`. Do not select an innovation path or advance automatically.

If state exists, this request covers the E2/E3 path through `DIRECTION_LOCK` (or an honest
N0-1/N0-2 terminal). Read only the injected `active_state` and `next_required_action`. Call
`iph_status`, then `iph_transition_plan`, then the single matching `iph_*` tool for the
current adjacent edge. After a READY commit, immediately plan the next adjacent edge in this
same turn. Do not yield because one node finished. Stop the turn only on DIRECTION_LOCK,
honest N0-1/N0-2, STOP, or BLOCKED. Never edit state, gates, decision logs, validation logs
or `harness_run.json` directly. On non-READY exit, stop all other work and execute only the
reported recovery action.

The journal 45-minute / doctoral 3-hour clock is a soft SLA to DIRECTION_LOCK and excludes
COMPUTE. Treat `budgetOverrun` as a warning. Do not skip coverage axes, bulk-register an old
project bibliography, or fabricate N0-4C to beat the clock. Journal labor is one M claim and
K=3–8; doctoral labor expands across A/B/C.

Before drafting or advancing, call `iph_transition_plan`. If it names a specialist, dispatch
that exact task agent and pass the completed task ID back as `specialistAgentId`. Include the
node timebox and evidence-labor bounds in the task text. M3 remains the coordinator and must
not inline frontier, layer, atomic-claim or collision judgments.
Call `task` with only `context` plus each item's `name`, `agent`, and `task`; omit
`outputSchema` and `schemaMode` for these specialists. Call every `iph_*` tool directly by
its exact name; never invent `ipc_call` or another wrapper.

When calling `iph_advance`, pass the post-transition `nextAction`. For every newly true gate,
pass each required top-level pointer as `stateArtifacts: ["key=relative/path"]`; separately
pass immutable files in `artifacts` so their SHA-256 values enter the decision log. A file hash
does not register its state pointer. If an older transition is STOP-locked only because those
pointers are missing, call `iph_clear_lock` with `stateArtifacts`, the corrected `nextAction`,
and an exact recovery note; never repeat the transition.

Treat `stopLockActive` from `iph_status` / `iph_transition_plan` as the physical-lock truth.
When `active_state=BLOCKED`, stop at the operator boundary. After the recorded external
blocker has actually been repaired, call `iph_clear_lock` once with `resumeBlocked: true`, a
new `nextAction`, and an exact `recoveryNote`; never loop validate or clear-lock.

If target-state validation fails after the authoritative CLI writes a candidate transition,
the harness restores the pre-transition workflow/lifecycle/validation/STOP-lock snapshot.
Treat `transition_rolled_back=true` as proof that no state progress was committed; repair the
reported artifacts and retry from the unchanged source state.
