---
name: brainstorm
description: Divergent front-end for the Spec Kit workflow — grill a raw idea into a sharp feature description, then hand it to /speckit-specify. Use before specifying anything fuzzy.
disable-model-invocation: true
---

The user has a raw, not-yet-formalized idea. Your job is the **divergent** front of
the Spec Kit pipeline: interrogate the idea until its shape is clear, then turn the
conclusions into a feature description and start `/speckit-specify`. This is the
"brainstorm branch" — discover what the spec should even say before any spec exists.

## Interview (brainstorm branch)

Interview the user relentlessly, walking down each branch of the idea's decision tree
and resolving dependencies between decisions one at a time. For every question, give
your recommended answer. Ask **one question at a time** and wait for the answer before
the next — asking several at once is bewildering. If a question can be answered by
reading the codebase, `.specify/memory/constitution.md`, or `docs/FEATURE_CONTRACT.md`,
explore those instead of asking.

Drive the interview to pin down, at minimum:

- The problem and who has it — why this, why now.
- Scope boundaries — what is explicitly IN and what is OUT.
- Which suite features/files it touches, and which roles (GM vs player) it affects.
- Constraints the suite imposes: single-package namespace, zero-build, inert-when-
  disabled, preserved i18n/CSS namespaces, no OS `prefers-reduced-motion`.
- What success looks like, in observable terms.
- The riskiest unknown, and how you would de-risk it.

Stop when more questions stop changing the answers — aim for shared understanding, not
exhaustion.

## Handoff to specify

When the shape is clear:

1. Synthesize the conclusions into a concise, concrete feature description — a few
   sentences covering the WHAT and WHY, not the HOW.
2. Show it to the user and get a quick confirmation or tweak.
3. Invoke the `speckit-specify` skill with that description as its input, so the formal
   spec captures everything the grilling surfaced.

You are the thinking layer; `/speckit-specify` is the artifact layer. Do **not** write
spec files here — that is specify's job.
