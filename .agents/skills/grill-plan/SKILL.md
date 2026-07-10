---
name: grill-plan
description: Stress-test the active feature's design (plan.md/research.md) with a relentless interview before decomposing into tasks. Use between /speckit-plan and /speckit-tasks.
disable-model-invocation: true
---

This is the **implementation-branch** grill — the seam between `/speckit-plan` and
`/speckit-tasks`. Pressure-test the design while changing your mind is still cheap,
before it fans out into a dozen tasks.

## Load the design

Find the active feature directory from `.specify/feature.json` (`feature_directory`),
then read its `plan.md` and `research.md` (and `contracts/` if present). Also load
`.specify/memory/constitution.md` and `docs/FEATURE_CONTRACT.md` so you can grill the
design against the project's own rules.

## Interview (implementation branch)

Interview the user relentlessly about the design **decisions**, one question at a time,
recommending an answer for each and waiting for feedback before the next. Walk each
branch of the design tree, resolving dependencies between decisions. Where a question
can be settled by reading the codebase, do that instead of asking.

Focus on what the tasks will lock in:

- Each "Decision / Alternatives considered" in `research.md` — is the chosen option
  still right? What concrete fact would change it?
- Every item flagged for manual verification or marked as a risk (e.g. runtime
  assumptions that can't be tested from here).
- Constitution conflicts — does any decision strain a principle? Is the deviation
  justified, or is there a simpler compliant alternative?
- Interfaces/contracts — are the boundaries in `contracts/` the ones the tasks should
  commit to?
- The cheapest thing that could go wrong after ten tasks are already written.

## Resolve

As decisions settle, update `plan.md` and `research.md` in place to reflect the resolved
choices and any newly surfaced ones, keeping their existing structure. When the design
is sound, tell the user it is ready for `/speckit-tasks`.
