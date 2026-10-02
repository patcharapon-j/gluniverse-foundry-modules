# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

**Layout: single-context.** One `CONTEXT.md` at the repo root, one `docs/adr/`
directory for decisions. There is no `CONTEXT-MAP.md` and no per-context split —
this is one Foundry package, not a monorepo.

## Before exploring, read these

- **`CLAUDE.md`** at the repo root: the standing, binding guidance for this repo
  (architecture, lifecycle, conventions, and the per-feature validation commands).
  Always read it; it is not optional and not lazily created.
- **`docs/<AREA>.md`**: the per-feature design documents (`DESIGN_SYSTEM.md`,
  `FEATURE_CONTRACT.md`, `RESOURCE_BARS.md`, `STAGE_LIGHTING.md`, and so on).
  `CLAUDE.md` names the relevant one for each area you might touch. Read the ones
  that cover your area before changing it.
- **`CONTEXT.md`** at the repo root: the domain glossary, when it exists.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If `CONTEXT.md` or `docs/adr/` don't exist, **proceed silently**. Don't flag their
absence; don't suggest creating them upfront. The `/domain-modeling` skill
(reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them
lazily when terms or decisions actually get resolved.

`CLAUDE.md` and `docs/*.md` are different: those already exist and are the
authority. Nothing in a `CONTEXT.md` or an ADR overrides `CLAUDE.md`; where they
disagree, `CLAUDE.md` wins and the conflict is worth raising.

## File structure

```
/
├── CLAUDE.md                 ← binding repo guidance (authoritative)
├── AGENTS.md                 ← the Codex-facing mirror of it; do not edit from Claude
├── CONTEXT.md                ← domain glossary (created lazily)
├── docs/
│   ├── DESIGN_SYSTEM.md      ← and the other per-feature design docs
│   ├── adr/                  ← decisions (created lazily)
│   │   ├── 0001-….md
│   │   └── 0002-….md
│   └── agents/               ← this directory
├── scripts/                  ← the module source (core/ + features/)
├── styles/  templates/  lang/  assets/
├── tools/                    ← the per-feature check and preview harnesses
└── tests/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a
hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to
synonyms the glossary explicitly avoids.

This repo already has a strong, load-bearing vocabulary in `CLAUDE.md` —
*feature*, *adapter*, *sub-feature*, *promoted node*, *shed order*, *budget*,
*token*, *liquid*, *band*, *rung*, *dial*, *grade*, *look*. Use those words.
Inventing a synonym for one of them is a drift the design docs exist to prevent.

If the concept you need isn't in the glossary yet, that's a signal: either you're
inventing language the project doesn't use (reconsider) or there's a real gap
(note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0007 (…), but worth reopening because…_

The same applies, more strongly, to `CLAUDE.md` and the `docs/*.md` design
documents: many of their rules are written down precisely because breaking them
fails **silently**. Contradicting one is never a quiet decision.
