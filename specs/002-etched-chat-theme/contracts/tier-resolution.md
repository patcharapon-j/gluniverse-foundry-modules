# Contract: Tier Resolution

The single deterministic function that maps a PF2e chat message to exactly one
Treatment Tier (and, when fractured, exactly one color). Lives in
`scripts/features/etched-chat/classify.mjs`.

## Signature

```js
/**
 * @param {ChatMessage} message
 * @returns {{
 *   tier: "baseline" | "fracture-gold" | "fracture-red" | "dying",
 *   fracture: null | "gold" | "red",
 *   category: "check"|"save"|"damage"|"action"|"item-spell"|"whisper"|"other",
 *   visibility: "public"|"gm"|"blind"|"self"|"private",
 *   // v2 additions:
 *   archetype: "roll-d20"|"damage"|"content"|"IC"|"OOC"|"emote"|"manual"|"system",
 *   degree: null | "criticalSuccess"|"success"|"failure"|"criticalFailure",  // d20 only
 *   reason: string   // human-readable, for debugging/quickstart assertions
 * }}
 */
export function classifyMessage(message) { /* … */ }
```

`archetype` and `degree` are **v2** outputs that join the existing tier / fracture /
category / visibility. They are orthogonal: `tier`/`fracture` is the rare crit/dying
escalation (disposition-reversible); `archetype` selects the scaffold; `degree` is the
literal four-valued d20 outcome that colors the verdict bar (never reversed). All are
resolved by this one pure function; `layout.mjs` and `fx-card.mjs` are pure consumers.

The function MUST be **total** (always returns a valid tier) and **pure with respect
to the message + live actor/token state** (no DOM, no side effects, no persistence).
It may read the speaker actor / token for the disposition + dying signals.

## Inputs (property paths)

| Signal | Path | Confirmed in |
|--------|------|--------------|
| outcome | `message.flags.pf2e.context.outcome` (`criticalSuccess` / `criticalFailure` / `success` / `failure`) | `critical/module.js:664` |
| rollType | `message.flags.pf2e.context.type` | `critical/module.js:630-636` |
| speaker actor | `message.speaker?.actor` → `game.actors.get()` / `message.actor` | — |
| disposition | `message.token?.disposition` → `actor.prototypeToken?.disposition` → default `0` (neutral) | Research B |
| dying counter | `actor.system.attributes.dying.value` | `initiative/conditions.mjs:23` |
| dying/wounded item | `actor.items` where `type==="condition"` && slug ∈ {dying,wounded} | `initiative/conditions.mjs:83-100` |

Foundry disposition constants: `FRIENDLY=1`, `NEUTRAL=0`, `HOSTILE=-1`, `SECRET=-2`.
**Kill / 0-HP is NOT an input** — deferred (Research B); there is no kill branch.

## Eligible roll types (fracture from outcome)

Only these `context.type` values are eligible for outcome-driven fracture (mirrors
the `critical` feature): `attack-roll`, `spell-attack-roll`, `saving-throw`,
`skill-check`, `perception-check`. Other types never fracture.

## Color resolution (outcome × disposition)

```
valence = outcome === "criticalSuccess" ? "positive"
        : outcome === "criticalFailure" ? "negative"
        : null
reverse = (disposition === -1)            // HOSTILE only; friendly/neutral/secret keep base
if reverse: valence = flip(valence)       // positive<->negative
color   = valence === "positive" ? "gold"
        : valence === "negative" ? "red"
        : null
```

| disposition | crit success | crit failure |
|-------------|--------------|--------------|
| friendly / neutral / secret | gold | red |
| **hostile** | **red** | **gold** |

## Archetype resolution  *(v2)*

Resolve exactly one `archetype`, evaluated in order; first match wins. Orthogonal to the
tier — a `roll-d20` card may also be `fracture-gold`.

```
1. context.type ∈ {attack-roll, spell-attack-roll, saving-throw,
                    skill-check, perception-check, flat-check}   → "roll-d20"
2. context.type === "damage-roll"                                → "damage"
3. spell-cast / item / feat / action description card (no roll)  → "content"
4. emote message                                                 → "emote"
5. in-character speech (actor speaker, no roll context)          → "IC"
6. out-of-character (no actor / OOC speaker)                     → "OOC"
7. has rolls but NO flags.pf2e.context (independent /r)          → "manual"
8. otherwise (system/automation/whisper noise)                   → "system"
```

`manual` is specifically "a roll with no PF2e context" — it is what catches `/r 1d20`
and other system-agnostic rolls. `system` is the inert floor: a baseline glass shell with
no reconstruction.

## Degree-of-Success → verdict-bar color  *(v2)*

For `roll-d20` cards, `degree = message.flags.pf2e.context.outcome` (one of the four
values; `null` for non-d20 archetypes). It maps to the verdict-bar color via a
**four-outcome** language. This is **independent of disposition** — the verdict bar states
the literal mechanical result and is NEVER reversed.

| `degree` | Verdict-bar color | Token |
|----------|-------------------|-------|
| `criticalSuccess` | gold | `--gl-signal` |
| `success` | green | `--gl-good` |
| `failure` | amber | (amber token) |
| `criticalFailure` | red | `--gl-hazard` |

**Verdict bar vs. fracture color** — these are two different mappings on purpose:
- The **verdict bar** (this table) is shown on *every* `roll-d20` card, all four degrees,
  never disposition-reversed.
- The **fracture color** (the outcome × disposition table above) only exists for
  `criticalSuccess` / `criticalFailure` (and bare nat-20 / nat-1) and *is* reversed for a
  `HOSTILE` actor. A success/failure card therefore shows a green/amber verdict bar and
  **no** fracture.

## Manual / independent rolls — never fracture, never verdict  *(v2)*

The `manual` archetype (a roll with no `flags.pf2e.context`) is a hard exception:

- It MUST NOT receive a verdict bar (`degree` is `null` — there is no declared outcome).
- It MUST NOT fracture: even on a natural 20 / natural 1, `tier` stays `baseline` for a
  manual card. The nat-20/1 surfaces **only** as a tint on the d20 face chip
  (`glec-nat-max` / `glec-nat-min`), never as a fracture or verdict.

> **Note (current code).** `classify.mjs` today synthesizes a fracture from a bare
> natural 20 / natural 1 on *eligible roll types*. Under v2 that nat-20/1 → fracture
> path applies **only** to PF2e-context d20 rolls (`roll-d20` archetype). A `manual`
> roll with no PF2e context MUST be excluded from the synthesized-fracture branch, so a
> manual nat-20 tints the chip but does not crack the card. Encode this as: the
> synthesized nat-fracture branch is gated on `archetype === "roll-d20"`.

## Resolution algorithm (deterministic precedence)

Evaluate in order; first match wins.

```
1. eligibleRollType && outcome ∈ {criticalSuccess, criticalFailure}
       → color = resolveColor(outcome, disposition)
         { tier: color==="gold" ? "fracture-gold" : "fracture-red", fracture: color }
2. dyingOrWounded(speakerActor)
       → { tier:"dying", fracture:null }
3. otherwise
       → { tier:"baseline", fracture:null }
```

**Precedence rationale:**
- `outcome` is a single value, so a card cannot be both crit-success and crit-failure;
  disposition only remaps the color, it never produces two fractures. The "both
  qualify" ambiguity from the kill design is gone.
- Fracture outranks dying so a crit on a dying creature still fractures; the dying
  sheen is the resting treatment for non-critical dying-related cards.
- Unresolved disposition defaults to neutral (non-reversed) — never throws, never
  omits the fracture (spec edge case).

## Invariants

- Returns exactly one tier; `fracture` is non-null **iff** tier starts with
  `fracture-` (and then equals `"gold"`/`"red"`).
- Same message ⇒ same tier across clients and re-renders (depends only on persisted
  flags + current actor/token state; stable for historical cards).
- No throw on malformed/foreign messages: missing flags ⇒ `baseline`.
- Non-pf2e system ⇒ the feature never runs this (registry `system:"pf2e"` gate), but
  the function still returns `baseline` defensively if called.
- **(v2)** Returns exactly one `archetype`; `degree` is non-null **iff**
  `archetype === "roll-d20"` (and then equals the four-valued outcome). `degree` colors
  the verdict bar via the four-outcome table and is **never** disposition-reversed.
- **(v2)** A `manual` card never fractures and never gets a verdict bar; a manual
  nat-20/1 tints only the d20 face chip (the synthesized nat-fracture branch is gated on
  `archetype === "roll-d20"`).
