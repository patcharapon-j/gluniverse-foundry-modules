# Stat block format

The Markdown grammar `statsblock-import` parses, and the contract between that
feature and `pf2e-ultimates`.

**The field-by-field reference lives in
[`skills/pf2e-statblock/references/grammar.md`](../skills/pf2e-statblock/references/grammar.md).**
It is versioned in this repository precisely so it cannot drift away from
`scripts/features/statsblock-import/importer.js`. Do not duplicate it here — fix
it there.

This file records the parts that are architecture rather than syntax.

## Living documentation

Two things keep the format honest:

- `sampleStatBlock()` and `sampleEngineStatBlock()` in `importer.js` back the
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

## Cross-feature contract: statsblock-import → pf2e-ultimates

`statsblock-import` is the only feature that writes flags owned by another
feature. This is deliberate and bounded.

| Flag | Owner | Written by | From |
|---|---|---|---|
| `ult.state` | `pf2e-ultimates` (actor) | `buildActorSource` | the `## Engine` section |
| `ult.functions` | `pf2e-ultimates` (item) | `buildMeleeItem`, `buildActionItem`, `buildPhaseItem` | a block's `Function:` field |
| `ult.isUltimate` | `pf2e-ultimates` (item) | as above | `Function:` containing `ultimate` |
| `sbi.phase` | `statsblock-import` (item) | `buildPhaseItem` | a `## Phases` block's ordinal |

Rules:

- **The write is unconditional.** It does not check whether `pf2e-ultimates` is
  enabled. Flags are inert data; the Ultimates feature clamps and validates
  every field through `normalizeUltimateState()` when it reads them back. A GM
  can import a boss today and enable Ultimates next week.
- **`statsblock-import` never reads or interprets these flags**, and never
  imports from `pf2e-ultimates`. It writes the shape and stops. The meaning
  belongs to the owning feature.
- There is no `requires` relationship. The registry's `requires` field names
  external module ids, not sibling features, and no dependency is needed here.
- If `normalizeUltimateState()` gains or renames a field, update
  `buildUltimateState()` in `importer.js` and the `## Engine` table in the
  grammar reference together.

`buildUltimateState()` writes only what a stat block can express and leaves the
rest to the Ultimates defaults. Notably it always writes `value: 0` — an
imported NPC starts the encounter with an empty resource, which is what the
design contract calls for unless a prepared opening says otherwise.

## Round-trip symmetry

`exportActorToMarkdown` is the inverse of the parser and must stay that way.
Every section the parser accepts, the emitter produces:

| Section | Parser | Emitter |
|---|---|---|
| head, `## Attacks`, `## Actions`, `## Spellcasting`, `## Inventory`, `## Effects` | yes | yes |
| `## Engine` | `parseEngineField` | `exportEngine`, from `ult.state` |
| `Function:` | `parseFunctions` | `exportFunctions`, from `ult.functions` |
| `## Recall Knowledge` | `parseRecallKnowledgeLine` | `exportRecallKnowledge`, scraped back out of `privateNotes` |
| `## Phases` | `normalizeBlock` | `exportPhase`, selected by the `sbi.phase` flag |

Export → edit → re-import must not lose the engine. When you add to one side,
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

## The authoring skill

`skills/pf2e-statblock/` is a Claude skill that writes this format. It lives in
this repository so its grammar reference is versioned alongside the parser it
documents. Install it by junction so the two can never diverge:

```bash
cmd //c mklink //J "%USERPROFILE%\.claude\skills\pf2e-statblock" "%CD%\skills\pf2e-statblock"
```

The skill is not loaded by Foundry and is absent from `module.json`; it ships
with the repository as developer/GM tooling.
