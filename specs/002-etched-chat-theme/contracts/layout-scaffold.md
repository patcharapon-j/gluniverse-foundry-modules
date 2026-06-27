# Contract: Layout Scaffold (reparent PF2e nodes into the Dossier)

**v2 overhaul.** The contract for reconstructing a PF2e chat card into the suite's own
"Dossier" scaffold by **moving** PF2e's live functional nodes into named slots — never
restyling them in place, never cloning, never re-rendering from message data. Home:
`scripts/features/etched-chat/layout.mjs`, driven by `style.mjs` (the orchestrator) after
`classifyMessage` resolves the [Card Archetype](tier-resolution.md). Cross-links:
[data-model.md](../data-model.md) (Layout Slot, Card Archetype),
[tier-resolution.md](tier-resolution.md) (archetype + degree),
[fx-surface.md](fx-surface.md) (the fracture mounts onto this scaffold).

## Surface

```js
/**
 * Build (or re-acquire) the Dossier scaffold on a card root and reparent PF2e's live
 * nodes into the slots for this archetype. Idempotent + re-render-safe.
 * @param {HTMLElement} root     the chat-message root (already has .glec-card)
 * @param {ChatMessage} message
 * @param {ReturnType<import("./classify.mjs").classifyMessage>} info  // archetype, degree, …
 * @returns {void}
 */
export function buildScaffold(root, message, info) { /* … */ }
```

`buildScaffold` performs **only DOM structure + reparenting**. It does not classify (that
is `classify.mjs`), does not paint the fracture (that is `fx-card.mjs`), and does not stamp
the visibility badge / d20 chip (those stay in `style.mjs`). It MUST NOT read or write any
persisted document data.

## Slot set

The scaffold is a single CSS-grid shell. Slots, top→bottom (plus the side rail):

| Slot (class) | Purpose |
|--------------|---------|
| `glec-slot-header` | cost pips + name + subtitle; visibility badge + timestamp top-right |
| `glec-slot-traits` | rarity-aware trait pills (wrap on overflow) |
| `glec-slot-meta` | tech-mono Range / Area / Targets / Duration |
| `glec-slot-result` | verdict bar (`roll-d20`) \| hero total + type chips (`damage`) |
| `glec-slot-body` | labeled section (Effect / Trigger / Requirements) + heighten block |
| `glec-slot-actions` | reparented PF2e buttons (apply-damage, activate, inline rolls) restyled glass |
| `glec-art-rail` | feathered side portrait (diorama bleed); omitted when no art |

The grid is two-column (content column + `glec-art-rail`) when `glec-has-art` is present,
and reflows to a single full-width column when it is absent (FR-019).

## Reparenting map (source node → slot, per archetype)

Each row is a **move** (`slot.appendChild(sourceNode)`), never a clone. "Source" is the
live PF2e/Foundry element found under the message root; "—" means the slot is built from
suite content (not reparented).

| Archetype | PF2e source node | → Slot |
|-----------|------------------|--------|
| all reconstructed | (suite-built header from speaker/flags) | `glec-slot-header` |
| roll-d20 | `.dice-roll` / `.dice-result` subtree (formula, total, tooltip) | `glec-slot-result` (wrapped as formula↔total + d20 chip + verdict bar) |
| roll-d20 | inline-roll / repost buttons, set-as-initiative | `glec-slot-actions` |
| damage | the damage-roll total + per-instance damage nodes | `glec-slot-result` (re-presented as hero total + per-type chips) |
| damage | the damage-application section (Full/Half/Double/Heal buttons) | `glec-slot-actions` |
| content | card description / `.card-content` prose | `glec-slot-body` |
| content | the inline save link (`[[/save …]]` / `.inline-check`) | `glec-slot-body` save/DC strip (whole strip wired to the save roll) |
| content | activate / use / cast buttons | `glec-slot-actions` |
| content | trait tags | `glec-slot-traits` |
| IC | the spoken text node | content column (left-accent cyan quote) — no result/actions |
| OOC / emote / system / manual | (minimal suite-built content; few/no reparents) | per [tier-resolution.md](tier-resolution.md) §Archetype |

Inline rolls, item links, and any other live PF2e affordances inside a reparented subtree
move **with** their subtree (they are descendants of the node being appended), so their
handlers ride along untouched.

## Idempotency & re-render re-slotting

`renderChatMessageHTML` fires on every render (initial, edit, scrollback rebuild, late
join). `buildScaffold` MUST therefore:

1. **Detect an existing scaffold** on `root` (e.g. a `glec-slot-header` already present)
   and reuse it rather than building a second shell — no nested/duplicated scaffolds.
2. **Re-acquire** the live PF2e nodes (PF2e may have re-rendered fresh ones) and re-slot
   them into the existing slots. Re-appending an already-correctly-slotted node is a no-op.
3. Leave the result identical whether called once or N times for the same message
   (matches the existing idempotent `style.mjs` mounts: `mountPortrait`, `mountD20Chip`,
   `mountVisBadge`, `mountFracture`).

## Hard guarantee — move, never recreate

- Reparented nodes are the **same DOM elements** PF2e created — relocated via
  `appendChild` / `insertBefore`, never `cloneNode`, never rebuilt from message data.
  Therefore **every event handler, delegated listener, and data binding attached by PF2e /
  Foundry / other modules survives** (apply-damage Full/Half/Double/Heal, set-as-initiative,
  inline rolls, item links, the clickable save/DC strip). This is the FR-018 guarantee and
  the SC-008 gate.
- The feature MUST NOT detach-and-rebuild, re-bind, or re-implement any PF2e handler. If a
  reparented node needs a glass restyle, that is CSS on the moved element, not a new node.
- **Validation gate (NON-NEGOTIABLE):** after styling AND after a forced re-render, every
  reparented affordance is click-tested and behaves identically to an unstyled card
  (SC-008; quickstart scenario).

## Graceful absence

When an expected source node is **absent** (PF2e rendered no damage-application section,
no trait tags, no save line, no description, no portrait):

- The corresponding slot MUST be **omitted entirely** (not left empty, not a placeholder).
- The scaffold MUST remain valid — the grid reflows, no broken/empty cell, no error.
- `glec-art-rail` absence specifically drops `glec-has-art` and reflows to full-width
  single column (FR-019 edge case).
- A `system` / unrecognized card with no reconstructable content degrades to the baseline
  glass shell (no slots populated beyond the header), never a broken scaffold.

## Non-goals

- No re-rendering PF2e's card from message data (would destroy handlers — see
  [research.md](../research.md) §H alternatives).
- No cloning nodes (clones lose captured handlers/closures).
- No reparenting when the feature is disabled — the hook is not even registered, so PF2e's
  native DOM is never touched (FR-014, Principle III).
