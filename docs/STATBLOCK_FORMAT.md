# Stat block format

The Markdown grammar `statsblock-import` parses.

**The field-by-field reference lives in
[`STATBLOCK_GRAMMAR.md`](STATBLOCK_GRAMMAR.md).**
It is versioned in this repository precisely so it cannot drift away from
`scripts/features/statsblock-import/importer.js`. Do not duplicate it here — fix
it there.

This file records the parts that are architecture rather than syntax.

## Living documentation

Two things keep the format honest:

- `sampleStatBlock()` and `samplePhaseStatBlock()` in `importer.js` back the
  two **Load Sample** buttons. They are the only in-app documentation of the
  format, and they are exported through `api.samples`.
- `tools/parse-check.mjs` parses both of them headlessly:

  ```bash
  node tools/parse-check.mjs --samples
  ```

  It stubs the handful of globals the parser touches (`game.i18n`,
  `foundry.utils`, `CONFIG.PF2E`) and calls `api.parse`. No package.json, no
  dependencies — the same spirit as the `node --check` one-liners in CLAUDE.md.

  It also checks files directly:

  ```bash
  node tools/parse-check.mjs path/to/statblock.md
  ```

**If you change the parser, run the sample check.** If you add a section or a
field, add it to the grammar reference and to whichever sample demonstrates it.

The grammar was validated by rendering all 1,214 official Remaster creatures
(Monster Core, Monster Core 2, NPC Core, NPC Gallery) into it and parsing them
back: zero errors, zero warnings, zero dropped strikes, actions or spellcasting
entries.

## Retired grammar: `## Engine` and `Function:`

The `pf2e-ultimates` feature is gone, and the grammar that fed it went with it.
`## Engine`, its fourteen fields, and the per-ability `Function:` tag are no
longer parsed, no longer emitted, and no longer described in the grammar
reference.

Old stat blocks still import. Nothing errors:

- `## Engine` fields fall through to the generic ignored-field path, so the GM
  gets one advisory warning per dropped field, naming it.
- `Function:` raises `GLSBI.parse.functionRetired` on its block. That warning
  exists only because the field used to be documented — every other unknown
  block field is dropped without comment.

Actors imported before the removal keep their `ult.state`, `ult.functions` and
`ult.isUltimate` flags. They are inert: nothing reads them, and no migration
strips them, because deleting a GM's data to tidy up a namespace is worse than
leaving it. A re-import overwrites the actor without re-writing them.

What the removed grammar expressed is now prose. A boss with a resource
describes it in the ability that spends it, and the party-facing version of it
belongs in a clocks-tracker clock.

## Flags this feature owns

Every flag the importer writes lives under its own `sbi.` prefix. It writes no
flag owned by another feature, and reads none.

| Flag | Written by | From |
|---|---|---|
| `sbi.source` | `buildActorSource` | the submitted Markdown, verbatim |
| `sbi.parsed` | `buildActorSource` | the parsed NPC object |
| `sbi.phase` | `buildPhaseItem` | a `## Phases` block's ordinal |
| `sbi.phaseTrigger` | `buildPhaseItem` | that block's `Trigger:` field |

## Round-trip symmetry

`exportActorToMarkdown` is the inverse of the parser and must stay that way.
Every section the parser accepts, the emitter produces:

| Section | Parser | Emitter |
|---|---|---|
| head, `## Attacks`, `## Actions`, `## Spellcasting`, `## Inventory`, `## Effects` | yes | yes |
| `## Recall Knowledge` | `parseRecallKnowledgeLine` | `exportRecallKnowledge`, scraped back out of `privateNotes` |
| `## Phases` | `normalizeBlock` | `exportPhase`, selected by the `sbi.phase` flag |

Export → edit → re-import must not lose a section. When you add to one side,
add to the other in the same commit.

`features/statsblock-import/reflavor.js` rests entirely on this symmetry: it
exports a creature, has a model rewrite it, and imports the result. An emitter
that stops producing what the parser accepts breaks reflavouring silently. See
[`docs/REFLAVOR.md`](REFLAVOR.md).

Two asymmetries are intentional and worth knowing about:

- The Recall Knowledge ladder is stored as rendered HTML inside `privateNotes`,
  so the emitter recovers it by matching its own heading. Changing
  `GLSBI.notes.recallKnowledge` in the lang file changes what the emitter looks
  for; existing actors keep the old heading and will stop round-tripping. Treat
  that key as data, not as free-form copy.
- A phase's `Trigger:` is folded into the item description on import and peeled
  back off on export, using the `GLSBI.label.trigger` string. Same caveat.
