# Data Model: Etched-Glass Chat Theme (PF2e)

No persisted world/document data is introduced beyond the feature's world-scoped
enable toggle (handled by the suite's existing `moduleConfig`, key prefix `ec.`).
Everything below is **derived at render time** or held **in-memory** for the
lifetime of the client session. There are no flags written to messages or actors.

## Entities

### Styled Chat Card
A PF2e chat message the feature has marked for Etched-Glass treatment.

| Field | Source | Notes |
|-------|--------|-------|
| `messageId` | `ChatMessage#id` | Identity / WeakSet key for one-shot animation. |
| `category` | `message.flags.pf2e.context.type` + DOM | check / save / damage / action / item-spell / whisper. Drives which baseline sub-styling applies. |
| `hasPortraitArt` | DOM (`img` in header/content) or speaker actor img | Gates the diorama-bleed layer; absent → omit layer (edge case). |
| `tier` | derived (see Treatment Tier) | Exactly one. |
| `isFresh` | in-memory `freshIds: Set<messageId>` | Added by `createChatMessage` (every client). Present ⇒ render animates once then removes it; absent ⇒ render shows static (scrollback / late join). |

**Marker on the DOM**: `.glec-card` class + `data-glec-tier="<tier>"` (and
`data-glec-frac="gold|red"` when fractured) on the message root element. This is the
*only* mutation the feature makes to the card.

### Treatment Tier  *(state: exactly one per card)*
The visual level applied to a card. A card resolves to one tier; a fractured card
carries exactly one fracture color.

| Tier value (`data-glec-tier`) | Trigger | Fracture color (`data-glec-frac`) |
|-------------------------------|---------|----------------|
| `baseline` | any in-scope card not matching below | — |
| `fracture-gold` | positive valence after disposition (crit success for friendly/neutral; crit **failure** for hostile) | gold (`uBreakAmber`/`uBreakHot` warm) |
| `fracture-red` | negative valence after disposition (crit failure for friendly/neutral; crit **success** for hostile) | deep red/purple |
| `dying` | speaker actor has dying/wounded condition relevant to the card | — (dying sheen, no fracture) |

**Resolution is deterministic** and total (every in-scope card maps to exactly one
tier). Color = outcome × disposition (only `HOSTILE` reverses); full rules in
[contracts/tier-resolution.md](contracts/tier-resolution.md). Kill/0-HP is not a
trigger in v1.

### Signature-Moment Signal  *(transient, per classification)*
The intermediate determination feeding tier resolution.

| Field | Source |
|-------|--------|
| `outcome` | `message.flags.pf2e.context.outcome` (`criticalSuccess` / `criticalFailure` / `success` / `failure` / undefined) |
| `rollType` | `message.flags.pf2e.context.type` (gates eligible roll kinds) |
| `disposition` | `message.token?.disposition` → `actor.prototypeToken?.disposition` → `0` (neutral); only `-1` (hostile) reverses |
| `dyingState` | `actor.system.attributes.dying.value` or `dying`/`wounded` condition item |

### Card Archetype  *(v2; derived, exactly one per card)*
The structural shape a message resolves to, selecting the scaffold assembly and which
slots are populated. Resolved in `classify.mjs` from `flags.pf2e.context.type` + speaker
+ message kind. **Orthogonal to Treatment Tier** — archetype picks the layout, tier picks
the fracture/dying escalation painted on top.

| Archetype (`data-glec-arch`) | Trigger | Result-band slot |
|------------------------------|---------|------------------|
| `roll-d20` | `context.type` ∈ {attack-roll, spell-attack-roll, saving-throw, skill-check, perception-check, flat-check} | **verdict bar** (formula↔total + d20 chip + verdict) |
| `damage` | `context.type === "damage-roll"` | **hero total + per-type chips** (no verdict bar) |
| `content` | spell-cast / item / feat / action (description card) | — (themed body + optional save/DC + meta) |
| `IC` | in-character speech (actor speaker, no roll context) | — (left-accent cyan quote) |
| `OOC` | out-of-character (no actor / OOC) | — (cyan "OOC" eyebrow, dim text) |
| `emote` | emote message | — (centered italic violet) |
| `manual` | independent `/r`, no `flags.pf2e.context` | formula↔total + d20 chip only (no verdict) |
| `system` | system/automation noise not matching above | — (baseline glass shell only) |

Full matrix + slot mapping in [research.md](research.md) §L and
[contracts/layout-scaffold.md](contracts/layout-scaffold.md).

### Degree-of-Success  *(v2; derived, per d20 roll)*
The four-valued mechanical outcome of a d20 roll, read from
`message.flags.pf2e.context.outcome`. Drives the **verdict-bar color** on `roll-d20`
cards. **Distinct from the fracture color**: shown on *every* d20 roll, and **never**
disposition-reversed (it states the literal mechanical result, not the party-relative
valence).

| `outcome` value | Verdict-bar color | Token |
|-----------------|-------------------|-------|
| `criticalSuccess` | gold | `--gl-signal` |
| `success` | green | `--gl-good` |
| `failure` | amber | (amber token) |
| `criticalFailure` | red | `--gl-hazard` |

Only `criticalSuccess` / `criticalFailure` (and bare nat-20 / nat-1) additionally feed the
fracture color (which disposition *can* reverse — see Treatment Tier / Signature-Moment
Signal); `success` / `failure` get a verdict bar but never a fracture.

### Layout Slot  *(v2; DOM scaffold positions)*
The named slots of the "Dossier" scaffold built by `layout.mjs`. Each is populated by
reparenting the matching PF2e source node (moved, not recreated) or by suite-built
content; a slot whose source is absent is **omitted** and the layout stays valid.

| Slot | Contents | Populated for |
|------|----------|---------------|
| `header` | cost pips + name + subtitle; visibility badge + timestamp top-right | all reconstructed |
| `traits` | rarity-aware trait pills (wrap on overflow) | roll-d20, content |
| `meta` | tech-mono Range / Area / Targets / Duration | content (when present) |
| `result` | **verdict bar** (roll-d20) \| **hero total + type chips** (damage) | roll-d20, damage |
| `body` | labeled section (Effect/Trigger/Requirements) + heighten block | content |
| `actions` | reparented PF2e buttons (apply-damage, activate, inline rolls) restyled glass | any with action buttons |
| `art-rail` | feathered side portrait (diorama bleed); omitted when no art (`glec-has-art`) | any with resolvable portrait |

### Render Capability State  *(client-global, in-memory)*
Selects WebGL effect vs CSS fallback.

| Field | Source | Notes |
|-------|--------|-------|
| `webglSupported` | FX renderer init (`supported` flag, mirrors initiative CardFXManager) | False → all fractures use the CSS/SVG crack path. Scene-independent. |
| `featureRenderer` | `etched-chat/fx-card.mjs` (feature-local; shares only GLSL from `core/fx-glsl.mjs`) | One per client for this feature (two total with initiative). Never one per card. |

## State transitions

```
            createChatMessage (EVERY client, no author gate)
message ───────────────────────────────────────► freshIds.add(id)
                                                                     │
        renderChatMessageHTML (every client, every render)          │  (sole classifier)
message ───────────────────────────────────────► classifyMessage() ─► tier + color
                                                  │
              ┌───────────────────────────────────┼───────────────────────────────┐
        tier=baseline/dying                  tier=fracture-*                 webgl unavailable
              │                                    │                               │
        apply CSS only              freshIds.has(id)? ──yes──► play ~1s WebGL    apply CSS crack
                                          │                    then settle static  (.glec-crack-css)
                                          │                    & freshIds.delete(id)
                                          └──no (scrollback / late join) ──► mount static still (no replay)
```

## Validation rules (from requirements)

- A card resolves to **exactly one** tier; fracture color = outcome × disposition,
  only `HOSTILE` reverses (FR-010, FR-010a; data-model invariant).
- Tier is **re-derivable from message flags + live actor/token state** so
  re-renders/late joiners are correct without the create event (FR-017, Research A).
  `createChatMessage`/`freshIds` only governs animate-once, never the tier.
- Fracture is applied **only** to `fracture-gold` / `fracture-red`; ordinary
  (non-critical) cards stay `baseline` (FR-010, SC-003). Kill/0-HP is not a v1 trigger.
- No tier, marker, CSS effect, or renderer exists when the feature is disabled
  (FR-014).
- No per-card WebGL context is ever created (FR-012, SC-006).
- A card resolves to **exactly one** archetype; the result-band slot is a verdict bar
  for `roll-d20`, a hero-total+chips for `damage`, and absent otherwise (FR-019–FR-022).
- The verdict bar appears on **every** `roll-d20` card and its color follows the
  four-valued Degree-of-Success (never disposition-reversed) (FR-021, SC-009).
- Reparented PF2e nodes are **moved, not recreated**; their event handlers survive
  styling and re-render (FR-018, SC-008). A slot whose source node is absent is omitted
  and the layout stays valid (edge case).
- `manual` cards never show a verdict bar and never fracture; a manual nat-20/1 tints
  only the d20 face chip (FR-029, SC-011).
