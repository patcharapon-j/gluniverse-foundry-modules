# Research: Etched-Glass Chat Theme (PF2e)

Phase 0 findings. Every "NEEDS CLARIFICATION" from Technical Context is resolved
here. Decisions are grounded in existing suite code (file:line references) so the
implementation reuses proven patterns rather than inventing them.

## A. Chat hooks — one classifier, two roles  *(REVISED in grill-plan)*

**Decision**: `renderChatMessageHTML` is the **sole classifier**; `createChatMessage`
does **one** thing only — mark a message id as "fresh" so the renderer knows to
animate-once vs. show-static.

- `renderChatMessageHTML` (v13+), with legacy `renderChatMessage` fallback — fires on
  **every** render of the message element (initial, re-render, edit, scrollback
  rebuild, late-joining clients), **on every client**. It classifies the card from
  `message.flags.pf2e.context` (+ disposition/condition), stamps `.glec-card` +
  `data-glec-tier` (+ `data-glec-frac`), mounts the diorama portrait layer, and
  mounts the fracture canvas (animated if fresh, static otherwise). This alone
  satisfies baseline + dying + Dorako override + re-render persistence (FR-017).
- `createChatMessage` — adds `message.id` to an in-memory `freshIds` Set on **every**
  client. Its ONLY purpose is the live-vs-historical distinction for animate-once.

**Critical correction (grill-plan):** `createChatMessage` fires on **all connected
clients**, not just the author. The `critical` feature only *looks* author-scoped
because it deliberately gates with `if (messageAuthorId(message) !== game.user.id)
return;` (`module.js:713`) for its full-screen cinematic. Our feature wants the
fracture to play for the **whole table**, so we MUST NOT copy that author gate.

**Animate-once mechanism:** in `renderChatMessageHTML`, a fracture card animates
**iff** its id is in `freshIds`; on play, remove it from the set so any later
re-render (scrollback, edit) shows the **static** cracked still — never a replay.
A late-joining client never received `createChatMessage` for historical messages, so
those ids are absent from `freshIds` → they correctly render static.

**Rationale**: Styling must survive re-render (FR-017), so classification cannot live
in a one-shot handler. The tier is fully derivable from persisted flags + live actor
state, so the renderer is self-sufficient; `createChatMessage` only supplies the
"this is new right now" bit that flags alone cannot express. This is *less* code than
classifying in both hooks. The codebase already uses `renderChatMessageHTML` with a
jQuery/HTMLElement-tolerant unwrap (`flatfinder/flatfinder.js:56,75`;
`clocks-tracker/module.js:113`); signature `(message, html)`, normalize via
`const root = html instanceof HTMLElement ? html : html?.[0]`.

**Alternatives considered**: classify in `createChatMessage` too — rejected as
redundant double-classification that also breaks for late joiners (they never get the
create event). Single `renderChatMessageHTML` only (no `freshIds`) — rejected because
nothing would then distinguish a brand-new crit (animate) from scrollback of an old
crit (static), so historical crits would replay on scroll.

## B. Tier classification — property paths  *(REVISED in grill-plan: kill dropped, disposition added)*

**Decision**: Resolve a single Treatment Tier from these sources (full rules in
[contracts/tier-resolution.md](contracts/tier-resolution.md)):

- **Critical outcome** from `message.flags.pf2e.context.outcome`:
  - `"criticalSuccess"` → fracture, base valence *positive*
  - `"criticalFailure"` → fracture, base valence *negative*
  - `"success"` / `"failure"` / absent → no fracture
  (Path confirmed at `critical/module.js:664`. `context.type` gates eligible roll
  kinds: attack-roll, spell-attack-roll, saving-throw, skill-check, perception-check
  — `critical/module.js:630-636`.)
- **Disposition** (decides the final color) resolved token-first:
  `message.token?.disposition` → `speakerActor.prototypeToken?.disposition` →
  default **neutral**. Foundry disposition constants: `FRIENDLY=1`, `NEUTRAL=0`,
  `HOSTILE=-1`, `SECRET=-2`. **Only `HOSTILE` reverses** the valence; friendly /
  neutral / secret keep it.
  - positive valence → `gold` unless hostile → `red`
  - negative valence → `red` unless hostile → `gold`
- **Dying/wounded** from the speaker's actor, read live (not from the message):
  `actor.system.attributes.dying.value` or a `condition`-type item with slug
  `dying`/`wounded` (`initiative/conditions.mjs:23,83-100`). Resolve the actor via
  `message.speaker?.actor` → `game.actors.get(...)` (or `ChatMessage#actor`).

**Kill (target → 0 HP): OUT OF SCOPE for v1.** PF2e gives no reliable
chat-card-linked kill signal — the damage-roll card is created *before* damage is
applied (the `critical` feature even `HARD_BLOCK`s `"damage-roll"` at
`module.js:637`), and applying damage mutates the target actor's HP with no
strongly-linked message. The only robust "reached 0 HP" signal is an
`updateActor`/`updateToken` HP transition, which is decoupled from chat and would
require HP-watching + card correlation + a retroactive fracture — a larger mechanism
than the rest of the feature. Deferred to a fast-follow; gold is driven by critical
**success** (disposition-adjusted). Recorded so `classify.mjs` has no kill branch and
tasks don't scaffold one.

**Rationale**: outcome + disposition + condition are all stable, persisted, and
proven in shipping suite code, so the entire classifier is deterministic and
side-effect-free. Removing kill removes the only genuine runtime unknown.

## C. FX-to-DOM mechanism — the corrected, proven pipeline

**Decision**: Reuse the **initiative CardFXManager** mechanism exactly:
1. A **single** offscreen PIXI renderer (`this.renderer`) runs the `FX_FRAG_BREAK`
   shader on a sprite/mesh (`scripts/features/initiative/gl.mjs` for the GLSL +
   mesh helpers; `gluniverse-initiative.mjs` CardFXManager for the loop).
2. Each qualifying chat card gets a 2D `<canvas class="glec-fx">` positioned
   `absolute; inset:0` over the card art.
3. A throttled (~30fps) `requestAnimationFrame` loop updates `uTime`/`uSeed`/`uImpact`
   uniforms, renders the shared renderer, and blits to each card's 2D context via
   `entry.ctx.drawImage(this.renderer.view, …)` (pattern at
   `gluniverse-initiative.mjs:5591-5592`).

**This corrects a spec assumption.** The spec described rendering through Foundry's
shared `canvas.app.renderer` (which needs a loaded scene). The proven pattern uses a
**dedicated** PIXI renderer that is independent of the canvas/scene. Consequences:
- The "no scene loaded" / "board closed" fallback trigger from the spec **no longer
  applies** — the dedicated renderer works without a scene.
- The real fallback trigger narrows to **"WebGL unsupported / renderer init failed"**
  (CardFXManager exposes a `supported` flag; mirror it). Functionally this still
  satisfies FR-013 (fallback exists and no card is left broken); it just makes WebGL
  available in *more* situations than the spec assumed (strictly better).
This refinement is recorded so `/grill-plan` and `/speckit-tasks` use the accurate
trigger, and so the spec's Assumptions/FR-013 wording can be reconciled if desired.

**Settle-to-static**: initiative's CardFXManager animates indefinitely; etched-chat
needs a **one-shot then static** behavior. Decision: after the animation window
(~1s, `uTime` past the shatter front), capture one final blit and **remove the entry
from the rAF loop**, leaving the last frame painted on the 2D canvas (a frozen
cracked still) — or snapshot to a `background-image` and drop the canvas. Either way
the rAF loop only iterates over *currently animating* cards, so idle cracked cards
cost nothing. Defined in [contracts/fx-surface.md](contracts/fx-surface.md).

**Per-card WebGL contexts**: never. One shared renderer; N cheap 2D canvases. This is
the core of SC-006 and FR-012.

## D. Renderer ownership — feature-local renderer, shared GLSL  *(RESOLVED in grill-plan)*

**Decision**: etched-chat owns its **own** offscreen PIXI renderer + blit loop (a
thin mirror of initiative's CardFXManager mechanism). The crack **geometry** is NOT
forked: the pure GLSL primitives (`FX_FRAG_BREAK`, the Voronoi/noise helpers, the
mesh builder) are extracted from `initiative/gl.mjs` into a new dependency-free
`scripts/core/fx-glsl.mjs`; `initiative/gl.mjs` **re-exports** them (no behavior
change, no touch to its render loop); etched-chat imports them from core.

Result: **two WebGL contexts total** across the suite (initiative + etched-chat) —
well within browser limits and never per-card — with the crack look guaranteed
identical because the shader source is a single file. Gold-vs-red is still only
`uBreakAmber`/`uBreakHot` uniform values.

**Rationale (why this flipped from "shared renderer"):** initiative's CardFXManager is
finely tuned (supersample factor, apex phases, dying-sheen timing); extracting a
*shared renderer* risks regressing a shipped, actively-used feature to save a single
context. A feature-local renderer has **zero regression risk** to initiative and keeps
etched-chat shippable independently. Sharing only the *pure GLSL constants* via core
gives single-sourced geometry without a feature→feature import (which the constitution
discourages) and without destabilizing initiative.

**Cost / gate:** the extraction makes a small, careful edit to `initiative/gl.mjs`
(local `const`s become re-exports of the core module). Pure data, covered by
`node --check`, but it *does* touch a shipped feature → it is an explicit quickstart
gate (re-run initiative's card FX after the move).

**Alternatives considered**: (a) shared single renderer in `core/fx-renderer.mjs` —
rejected for initiative-regression risk. (b) import GLSL directly from
`initiative/gl.mjs` — rejected as feature→feature coupling. (c) per-frame
`renderer.view.toDataURL` to a `background-image` — rejected for the animation phase
(per-frame encode ≫ `drawImage`); acceptable only for the single final static snapshot.

## E. Dorako override without coupling  *(BINDING CSS rules confirmed in grill-plan)*

**Decision**: Stamp our own `.glec-card` (+ `data-glec-tier`) on the message root and
out-rank Dorako by **specificity, not source order**. **Never** read, write, or
disable any Dorako setting. Binding rules for the CSS tasks:

1. **Specificity must beat Dorako.** Foundry loads two modules' stylesheets in
   registration order we do not control, so we CANNOT rely on `etched-chat.css`
   loading after `pf2e-dorako-ui`. Every override selector must out-specify Dorako's
   `[data-theme="…"]` chat rules — e.g. `.chat-message.glec-card .message-content`,
   and the **doubled-class trick** `.glec-card.glec-card …` where Dorako goes deeper.
2. **`!important` only as a scoped last resort** on individual properties Dorako pins
   hard (backgrounds/borders), never blanket — to stay debuggable.
3. **Quickstart Scenario A is a HARD visual gate**: with Dorako set to BG3, a styled
   card must visibly be glass, not BG3. Any property that loses is a bug to fix before
   sign-off, not "close enough."

**Rationale**: Dorako themes by stamping `data-theme`/`data-color-scheme` and keying
CSS off attribute selectors (`pf2e-dorako-ui/esmodules/ui-theme.js`). Matching that
"marker + scoped CSS" convention under our own marker lets both coexist with ours
winning on chat cards, leaving Dorako's window/sheet theming untouched (FR-004,
FR-005). Targets pf2e **system** markup, so it also works with Dorako absent.

**Alternatives considered**: registering an `"etched-glass"` entry into Dorako's theme
dropdown — rejected in brainstorm (brittle monkey-patch of a hard-coded `choices`
literal; violates inert-when-disabled). Relying on load order — rejected (not
controllable across modules).

## G. Dice So Nice — no coupling in v1  *(RESOLVED in grill-plan)*

**Decision**: The fracture does **not** wait for Dice So Nice. The `critical` feature
holds its cinematic until DSN dice land (`waitForDiceThenProcess`,
`critical/module.js:735`) because it is a full-screen takeover; our fracture is
**card-local**, so it plays on first render even if 3D dice are still rolling on top.
The `context.outcome` data is present at message-creation time regardless of DSN, so
classification is never blocked.

**Rationale**: Simpler (no DSN dependency or per-message wait/timeout plumbing), and a
card-local effect under still-rolling dice reads fine. **Possible polish later**:
delay the fracture mount until DSN completion for crit rolls, reusing
`waitFor3DAnimationByMessageID`. Out of scope for v1.

## F. Motion & inert-when-disabled

- All fracture/dying/entrance animations **always play** when triggered; no
  `prefers-reduced-motion` media query or `matchMedia` check (Constitution
  Platform & Compatibility; CLAUDE.md).
- CSS keys entirely off `.glec-card`; the class is only ever added by the enabled
  feature's hook, so a disabled feature contributes no styling, no hooks, no
  renderer (FR-014, Principle III). The `etched-chat.css` file is always loaded by
  `module.json`, but it is inert without the `.glec-card` marker.

---

# v2 overhaul — premium reconstructed "Dossier" layout

The sections below are the locked decisions from the v2 design interview. They *extend*
A–G: the classifier, FX pipeline, disposition valence, dying tier, Dorako-independence,
and inert-when-disabled all stand; v2 changes how the card is *built* (reconstruct, not
restyle-in-place) and adds the verdict bar, damage chips, save strip, meta line, trait
rarity, plain-message handling, and a manual readout.

## H. Render strategy — reparent live nodes  *(v2, LOCKED)*

**Decision**: In `renderChatMessageHTML`, build the suite's **own** layout scaffold and
**move** PF2e's existing functional nodes (action/apply-damage buttons, dice-roll
subtrees, inline rolls/links, the damage-application section) into named slots. Never
restyle-in-place as the primary mechanism; never clone or re-render from message data.
This lives in the new `scripts/features/etched-chat/layout.mjs`; `style.mjs` orchestrates
classify → layout → fx → badges. It MUST be idempotent and re-render-safe: on every
render re-acquire the live nodes and re-slot them (FR-017, FR-018).

**Rationale**: Reparenting (`slot.appendChild(node)`) preserves every PF2e / Foundry /
module event handler and listener because the real elements are *relocated, not
recreated* — apply-damage, set-as-initiative, inline rolls, and item links keep working
with zero re-wiring. It also lets the suite *own* the look instead of out-specifying
Dorako rule-by-rule (Research E), which is what makes the v1 grey-physical-damage and
buried-degree-of-success problems fixable at the source. Owning the layout deletes most
of the v1 override CSS; only the reparented **inner** dice nodes (which still carry
PF2e/Dorako styling) need targeted overrides.

**Alternatives considered**: (a) *Restyle-in-place via specificity* (v1 Research E) —
rejected as the primary mechanism: a perpetual specificity war with Dorako, and it can
only recolor, never restructure (can't add a verdict bar or re-order slots). Retained
only as targeted overrides for reparented inner dice nodes. (b) *Full re-render from
message data* (read flags, rebuild buttons) — rejected: it destroys PF2e's live handlers
and duplicates PF2e's own logic (apply-damage math, inline-roll wiring), guaranteeing
drift and broken clicks. (c) *Clone nodes then re-bind* — rejected: handlers and closures
captured on the originals don't survive `cloneNode`, so we'd be reimplementing PF2e.

## I. Dossier layout + slot model + art-rail collapse  *(v2, LOCKED)*

**Decision**: A two-column "Dossier" scaffold — a content column plus a right-side art
rail (~92–96px, feathered inner edge via a CSS gradient `mask-image` for the diorama
bleed). When no portrait resolves, omit the rail and reflow content full-width (single
column), driven by the existing `glec-has-art` class (already toggled in
`style.mjs:mountPortrait`). Slot order top→bottom: **header band → trait rail → optional
meta line → result band (verdict | damage) → optional body → action tray**, with the art
rail spanning the right edge.

**Rationale**: A fixed slot set makes the per-archetype assembly (Research L) a matter of
*which slots are populated*, not bespoke layouts per card type — keeping `layout.mjs`
small and the CSS grid single-sourced. The art rail reuses the diorama bleed already
established (clocks-tracker support cards; spec Assumptions) and the existing
`glec-has-art` switch, so "no art" is a graceful reflow, not a special case
(spec edge case; FR-019). The feathered inner edge (gradient mask) is what reads as a
diorama *bleed* rather than a boxed avatar.

**Alternatives considered**: (a) *Single-column with a floated portrait* — rejected: the
float collapses unpredictably across card heights and can't feather cleanly. (b)
*Portrait as a full-card background* — rejected: it fights text legibility (the exact
problem v2 is solving) and can't be omitted cleanly when art is absent.

## J. Degree-of-success verdict bar on every roll  *(v2, LOCKED)*

**Decision**: On every d20 roll card (check / save / attack) show a formula↔total strip
(formula left, tech-mono dim; total right, large Oxanium) with the raw **d20 face chip**
(existing `glec-d20`, kept) beside the total, then a full-width **verdict bar** stating
the degree of success on **every** roll. Color follows a four-outcome language:
`criticalSuccess` = gold (`--gl-signal`), `success` = green (`--gl-good`), `failure` =
amber, `criticalFailure` = red (`--gl-hazard`). The face chip glows gold on a natural 20
and red on a natural 1 (existing `glec-nat-max` / `glec-nat-min`). The four-valued
**Degree-of-Success** is resolved in `classify.mjs` from
`message.flags.pf2e.context.outcome`.

**Rationale**: PF2e buries the degree of success in small text; surfacing it as a colored
bar on *every* roll (not just crits) is the single biggest readability win and is what
makes a card glanceable across the room. Crucially the verdict bar is **distinct from the
fracture color**: the fracture is the rare crit *escalation* and is disposition-reversed
(Research B), whereas the verdict bar is shown on every roll and is **never** reversed —
it states the literal mechanical outcome, not the party-relative valence. Keeping the d20
face chip (rather than folding it into the total) preserves the "what did the die
actually show" signal that nat-20/nat-1 drama depends on.

**Alternatives considered**: (a) *Verdict bar only on crits* — rejected: leaves ordinary
success/failure as buried text, the main legibility complaint. (b) *Reuse the fracture
gold/red for the verdict color* — rejected: only two colors, can't distinguish
success from failure, and disposition-reversing the verdict would misstate the mechanical
result. (c) *Drop the d20 face chip, show only the total* — rejected: loses the nat-20/1
read the signature moments hang on.

## K. Damage hero total + per-type chips  *(v2, LOCKED — fixes grey physical damage)*

**Decision**: For damage-roll cards show a large hero total (Oxanium) as the focal point
plus one colored chip per damage instance (type icon + value + type color), collapsing to
a single chip for single-type damage. **No verdict bar** on damage cards. Each damage
type carries its own explicit color (e.g. fire/red, cold/blue, acid/green, electricity/
yellow, and *physical* — bludgeoning/piercing/slashing — given a legible metallic/light
token rather than grey-on-grey).

**Rationale**: This fixes the historical grey-physical-damage problem **at the source**.
The v1 approach fought PF2e's grey damage *pill background* with override CSS and kept
losing the specificity war (Research E). v2 doesn't fight the pill — it **reparents the
damage value and re-presents it as our own chip**, overriding the *type's* color directly,
so physical damage is legible because we own the chip, not because we out-specified a
background. Damage has no degree of success, so a verdict bar would be meaningless noise —
the hero total is the focal point instead.

**Alternatives considered**: (a) *Keep PF2e's damage pills, recolor via CSS* — rejected:
the v1 specificity dead-end. (b) *One chip for the whole total* — rejected: loses the
per-type breakdown that matters for resistances/weaknesses. (c) *A verdict bar derived
from "did it hit"* — rejected: the hit/miss lives on the *attack* card, not the damage
card; correlating them is the same unreliable plumbing as kill detection (Research B).

## L. Card archetype matrix  *(v2, LOCKED)*

**Decision**: `classify.mjs` resolves a **Card Archetype** (in addition to tier /
fracture / category / visibility) that selects the scaffold assembly. The matrix and the
slots each archetype populates:

| Archetype | Trigger (signals) | Populated slots |
|-----------|-------------------|-----------------|
| `roll-d20` | `context.type` ∈ {attack-roll, spell-attack-roll, saving-throw, skill-check, perception-check, flat-check} | header, traits?, **result = verdict bar** (formula↔total + d20 chip + verdict), action tray? |
| `damage` | `context.type === "damage-roll"` | header, **result = hero total + type chips**, action tray (reparented apply buttons) — *no verdict bar* |
| `content` | spell-cast / item / feat / action card (no roll, or a description card) | header (cost pips), traits (rarity), meta line?, save/DC strip?, **body** (Effect/Trigger/Requirements + heighten), action tray (activate/roll) |
| `IC` | in-character speech (actor speaker, no pf2e roll context) | glass shell, art rail (only with token art), spoken text = left-accent cyan quote — *no result band* |
| `OOC` | out-of-character (no actor / OOC speaker) | quieter dim text, cyan "OOC" eyebrow — *no actor, no art* |
| `emote` | emote message | centered italic violet narration, minimal chrome |
| `manual` | independent `/r` with no `flags.pf2e.context` | minimal readout: small header (user + time + "Manual roll" tag), formula↔total + d20 chip — *no verdict, no fracture, no buttons* (Research O) |
| `system` | system/automation/whisper noise not matching the above | left unreconstructed (baseline glass shell only) |

**Rationale**: A closed archetype set keeps `layout.mjs` a switch over "which slots to
fill," reusing the single slot grid (Research I) rather than a bespoke builder per card.
Archetype is **orthogonal to Treatment Tier**: archetype picks the structure, tier
(baseline / fracture-gold / fracture-red / dying) picks the escalation painted on top, so
a `roll-d20` card can also be `fracture-gold`. The existing `category` output is folded in
(it already distinguishes check/save/damage/action/item-spell) and generalized with the
plain/manual/system cases the v1 classifier didn't name.

**Alternatives considered**: (a) *One generic layout for all cards* — rejected: speech,
damage, and d20 rolls have genuinely different anatomies; one layout would either over- or
under-structure each. (b) *Derive archetype in `layout.mjs` from the DOM* — rejected: keeps
classification split across two modules; resolving it in the pure `classify.mjs` (from
flags + speaker) keeps layout a pure consumer.

## M. Traits — rarity-aware coloring  *(v2, LOCKED)*

**Decision**: Trait pills are uniform glass by default; **rarity** traits carry color —
uncommon = amber, rare = blue, unique = violet (`--gl-violet`); all other traits stay
uniform. Pills wrap on overflow. Trait values are **not** relocalized (CLAUDE.md: do not
relocalize stored data / parse vocabulary).

**Rationale**: Rarity is the one trait dimension a player scans for at a glance; coloring
*only* rarity (and leaving the rest uniform glass) keeps the trait rail calm instead of a
rainbow, while making the meaningful signal pop. The colors reuse suite tokens and PF2e's
own rarity convention (uncommon/rare/unique) so the meaning transfers without a legend.

**Alternatives considered**: (a) *Color every trait by category* — rejected: visually
noisy, no clear hierarchy. (b) *No trait coloring at all* — rejected: loses the rarity
glance that PF2e players rely on.

## N. Fracture re-anchoring to the verdict bar  *(v2, LOCKED)*

**Decision**: Keep the WebGL fracture as the crit escalation (critical success/failure +
nat 20/1, per the existing `classify.mjs` logic) and keep the CSS-crack fallback, but
**re-anchor the impact origin** so the shatter nucleates at the **verdict-bar / total
band** instead of the top-right corner. This means updating **both** the GLSL `uImpact`
origin in `fx-card.mjs` AND the CSS `mask-image` so the crack bursts from the verdict bar
and fades across the card. Today `fx-card.mjs` seeds `uImpact: [0.65, 0.34]` and entries
in the **top-right quadrant** (`impact: [0.82 + …, 0.08 + …]`) with a radial-top-right
mask; v2 re-targets those to the verdict-bar band's normalized position.

**Rationale**: In v1 the crack burst from the corner because there was no canonical "focal
point." v2 gives every crit a verdict bar, which *is* the dramatic focal point — bursting
the shatter from the bar (paired with its gold/red color) ties the FX to the moment that
caused it, instead of a decorative corner. The pipeline (feature-local renderer, blit,
settle-to-static, two contexts total) is unchanged — only the `uImpact` value and the mask
geometry move (FR-030).

**Alternatives considered**: (a) *Leave the impact top-right* — rejected: disconnects the
FX from the verdict it celebrates. (b) *Burst from the d20 face chip* — considered; the
chip is small and sits inside the strip, so the verdict bar (full width) gives the shatter
a wider, more legible nucleation front. Recorded as a possible tuning knob.

## O. Independent `/r` rolls — minimal readout  *(v2, LOCKED)*

**Decision**: An independent `/r` roll with **no** `flags.pf2e.context` is the `manual`
archetype: a minimal readout — small header (user + time + a "Manual roll" tag),
formula↔total strip with the d20 face chip — and **no** verdict bar, **no** fracture, no
buttons. On a natural 20 / natural 1, **only** the d20 face chip is tinted gold / red (via
the existing `glec-nat-max` / `glec-nat-min`); no verdict bar and no fracture.

**Rationale**: A bare `/r` has no declared game outcome — there is no degree of success to
state and no critical *event* to celebrate — so showing a verdict bar would assert a
mechanical result that doesn't exist, and a fracture would imply a decisive beat that
didn't happen. Tinting just the face chip is a subtle nod to a swung-high/low die without
fabricating a game outcome. This keeps the headline FX honest: fracture means "a declared
crit happened," not "a 20 appeared on some die."

**Alternatives considered**: (a) *Treat a manual nat-20 like a crit (verdict + fracture)* —
rejected: overstates an undeclared outcome; would fire constantly on damage/utility `/r`s.
(b) *No nat indication at all on manual rolls* — rejected: a manual nat-20/1 is still worth
a glance; the chip tint is the minimal honest signal.
