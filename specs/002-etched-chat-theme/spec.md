# Feature Specification: Etched-Glass Chat Theme (PF2e)

**Feature Branch**: `002-etched-chat-theme`

**Created**: 2026-06-27

**Status**: Draft — **v2 overhaul folded in** (premium reconstructed "Dossier"
layout; supersedes the v1 restyle-in-place mechanism. All v1 value — baseline glass
surface, disposition-driven gold/red fracture, dying tier, feature-local WebGL FX,
Dorako-independence, inert-when-disabled, visibility badge, pf2e-gating,
animations-always-play — is retained. New scope captured in US4 + FR-018…FR-028.)

**Input**: User description: "Etched-Glass Chat Theme (PF2e) — a new toggleable suite feature (id `etched-chat`, setting prefix `ec.`, CSS prefix `glec-`, i18n namespace `GLEC.*`) that restyles PF2e chat cards in the suite's Etched Glass aesthetic as a self-contained alternative to Dorako UI's chat-message themes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Unified premium look on every chat card (Priority: P1)

A Pathfinder 2e GM who runs the GLUniverse suite turns on the Etched-Glass Chat
Theme in the suite Control Center. From that moment, every new chat card at the
table — rolls, checks/saves, damage, actions, and item/spell cards — renders in
the suite's Etched Glass aesthetic (liquid-glass surface, edge-reflection light,
diorama portrait bleed, a quick entrance animation, and a hover light-sweep on
action buttons), instead of the plain default or Dorako UI's chat themes.

**Why this priority**: This is the core promise — unifying the most-watched
surface in play (the chat log) with the rest of the suite. Delivered alone, it is
a complete, valuable feature: the calm "baseline" styling on ordinary cards is
what a player sees 95% of the time.

**Independent Test**: On a pf2e world with the feature enabled, post an ordinary
skill check and a damage roll; confirm both cards visibly adopt the Etched Glass
styling and differ from both the unstyled default and any active Dorako chat
theme. Toggle the feature off and confirm cards revert untouched.

**Acceptance Scenarios**:

1. **Given** a pf2e world with the feature enabled, **When** any user posts a
   standard check/save/skill chat card, **Then** that card renders with the
   Etched-Glass baseline (glass surface, edge light, portrait bleed where art
   exists, entrance animation) for every connected user.
2. **Given** the feature is enabled and Dorako UI has a chat-message theme set
   (e.g. BG3), **When** a chat card is posted, **Then** the Etched-Glass styling
   visually overrides Dorako's chat-message theme on that card, while Dorako's
   styling of windows and sheets is unchanged.
3. **Given** a styled card containing interactive buttons (e.g. damage/save
   buttons), **When** a user hovers a button, **Then** a light-sweep sheen plays
   on it.
4. **Given** the feature is disabled, **When** any chat card is posted, **Then**
   the card shows the default/Dorako styling with no Etched-Glass markup, classes,
   animations, or behavior present.

---

### User Story 2 - Signature fracture on decisive moments, colored by valence (Priority: P2)

During combat, a decisive beat lands. The corresponding chat card briefly shows
the suite's signature glass-fracture effect — the same Voronoi shatter used by the
Initiative tracker — then settles into a persistent "cracked" resting state. The
fracture's color encodes whether the beat was good or bad **from the player party's
perspective**: a positive beat shatters in **gold** and a negative beat in **deep
red/purple**, making the outcome readable at a glance from across the room. Because
"good" depends on who rolled, the color is resolved relative to the rolling actor's
**disposition**: for a friendly or neutral actor a critical success is gold and a
critical failure is red/purple, but for a **hostile** actor the meaning **reverses**
— a hostile critical success is bad for the party (red/purple) and a hostile
critical failure is good for the party (gold).

**Why this priority**: This is the "premium, memorable" payoff that distinguishes
the theme from a flat reskin. It depends on the baseline (P1) existing first, and
is rare by design, so it is valuable but secondary.

**Independent Test**: With the feature enabled, produce a friendly/PC
critical-success card, a friendly critical-failure card, a hostile-NPC
critical-success card, and a hostile-NPC critical-failure card; confirm the colors
are gold, red/purple, red/purple, gold respectively, each animating (~1s) then
settling to a static cracked state, while ordinary (non-critical) cards show no
fracture.

**Acceptance Scenarios**:

1. **Given** the feature is enabled and WebGL is available, **When** a
   friendly/neutral actor's card is a critical success, **Then** the card plays the
   **gold** glass-fracture once and settles into a static cracked appearance.
2. **Given** the feature is enabled and WebGL is available, **When** a
   friendly/neutral actor's card is a critical failure, **Then** the card plays the
   **deep red/purple** fracture once and settles into the cracked state.
3. **Given** the feature is enabled and WebGL is available, **When** a **hostile**
   actor's card is a critical success, **Then** the fracture color is **reversed**
   to **deep red/purple** (bad for the party).
4. **Given** the feature is enabled and WebGL is available, **When** a **hostile**
   actor's card is a critical failure, **Then** the fracture color is **reversed**
   to **gold** (good for the party).
5. **Given** the feature is enabled, **When** a card is an ordinary (non-critical)
   success or failure, **Then** no fracture effect plays — only the calm baseline
   styling.
6. **Given** several fracture-worthy cards are posted in quick succession, **When**
   they render, **Then** the table experiences no crash, freeze, or loss of chat
   interactivity, and the suite never creates a separate WebGL context per card.

---

### User Story 3 - Dying/wounded emphasis and graceful fallback (Priority: P3)

A card relating to the dying or wounded condition shows the suite's "dying sheen"
emphasis. And when WebGL is unavailable (the browser/client cannot initialize the
shared effect renderer), the fracture and dying effects still appear via a pure-CSS
approximation, so no styled card is ever left visually broken. (Note: the effect
renderer is independent of the game canvas/scene, so an unloaded scene or a
board-closed client does NOT disable the WebGL effect — see Assumptions.)

**Why this priority**: Completes the emotional vocabulary of the theme and
guarantees correctness across all client states. Lower priority because it
polishes and hardens P1/P2 rather than introducing the headline value.

**Independent Test**: Trigger a dying/wounded-related card and confirm the dying
sheen. Then force WebGL to be unavailable (e.g. disable WebGL in the browser) and
trigger a critical card; confirm a CSS crack appears in place of the WebGL effect
with no errors.

**Acceptance Scenarios**:

1. **Given** the feature is enabled, **When** a chat card relates to the
   dying/wounded condition, **Then** the card shows the dying-sheen emphasis.
2. **Given** the feature is enabled but WebGL is unavailable, **When** a
   fracture-worthy card is posted, **Then** the card shows a CSS/SVG crack
   approximation instead of the WebGL effect, with no console errors and no
   missing visuals.
3. **Given** a player has the game board closed while viewing only the chat,
   **When** a fracture-worthy card arrives, **Then** that player still sees a
   correct cracked card (the WebGL effect still works because the renderer is
   scene-independent; if WebGL itself is unavailable, the CSS fallback shows).

---

### User Story 4 - Premium reconstructed layout ("Dossier") (Priority: P1)

A Pathfinder 2e GM enables the theme and every chat card is not merely re-skinned but
**reconstructed** into the suite's premium "Dossier" layout: a two-column scaffold
(content column + a feathered side art rail when a portrait resolves) with a clear
header band, trait rail, optional meta line, a result band, an optional themed body,
and an action tray. The reconstruction is built by **reparenting** PF2e's own live
functional nodes — its buttons, dice-roll subtrees, inline rolls/links, and the
damage-application section — into named slots in the suite's scaffold, so every
existing click handler keeps working (apply damage, set-as-initiative, inline rolls,
item links) because the real elements are **moved, not cloned or re-rendered**.
Every d20 roll gets a full-width **verdict bar** stating the degree of success in a
four-color language (gold / green / amber / red); damage cards get a **hero total**
with per-type colored chips (fixing the long-standing grey-physical-damage
readability problem); and spells/items/feats get fully themed bodies with labeled
sections, a clickable save/DC strip, and a meta line.

**Why this priority**: This is the v2 headline — the difference between "a CSS reskin
of Dorako" and "a bespoke premium card." It owns the layout instead of fighting
another module's CSS, which both *fixes* legibility problems (grey damage, buried
degree of success) and makes the look unmistakably the suite's. It is P1 because it
*is* the baseline experience in v2: every card, every render. US1's baseline glass
surface is now delivered *through* this scaffold rather than as in-place overrides.

**Independent Test**: On a pf2e world with the feature enabled, post (a) an attack
roll, (b) a damage roll, (c) a spell with a save, (d) a `/r 1d20` manual roll, and
(e) an IC speech line. Confirm each renders in the reconstructed Dossier layout;
click the reparented apply-damage / inline-roll / save buttons and confirm they still
function; confirm the d20 cards carry a correctly-colored verdict bar, the damage card
shows a hero total with colored type chips, and the manual roll shows a minimal
readout with no verdict bar and no fracture. Post a card whose actor has no portrait
and confirm the art rail is omitted and content reflows full-width.

**Acceptance Scenarios**:

1. **Given** a pf2e attack/damage card with PF2e action buttons, **When** it renders
   in the Dossier layout, **Then** the buttons are reparented into the action tray and
   every original click handler (apply-damage Full/Half/Double/Heal, set-as-initiative,
   inline rolls, item links) still fires correctly — before and after a re-render.
2. **Given** a d20 check / save / attack card, **When** it renders, **Then** a
   full-width verdict bar states the degree of success colored by the four-outcome
   language (criticalSuccess = gold, success = green, failure = amber,
   criticalFailure = red), the formula↔total strip shows the d20 face chip, and the
   chip glows gold on a natural 20 / red on a natural 1.
3. **Given** a damage-roll card, **When** it renders, **Then** it shows a large hero
   total plus one colored chip per damage type (type icon + value + type color),
   collapsing to a single chip for single-type damage, and shows **no** verdict bar;
   each physical type is legible via its own colored chip rather than a grey pill.
4. **Given** a card whose actor resolves **no** portrait art, **When** it renders,
   **Then** the side art rail is omitted and the content column reflows full-width
   (`glec-has-art` absent), with no empty or broken rail.
5. **Given** a spell that imposes a save, **When** it renders, **Then** an inline
   save/DC strip (shield icon + "Basic save / Reflex" label + right-aligned DC) is
   shown in green and the **whole strip is clickable** to roll that save; a non-basic
   save reads "save" (not "Basic save"); a spell-**attack** spell shows a spell-attack
   roll affordance and **no** save strip.
6. **Given** an independent `/r` roll with no PF2e context, **When** it renders,
   **Then** it shows a minimal readout (user + time + "Manual roll" tag, formula↔total
   strip, d20 face chip) with **no** verdict bar, **no** fracture, and no buttons; on a
   natural 20 / natural 1 only the d20 face chip is tinted gold / red.
7. **Given** an IC speech, OOC, or emote message, **When** it renders, **Then** it gets
   the appropriate plain treatment: IC speech = glass shell + art rail (only with token
   art) and a left-accent cyan quote; OOC = no actor/art, quieter dim text and a cyan
   "OOC" eyebrow tag; emote = centered italic violet narration with minimal chrome.

---

### Edge Cases

- **No portrait art on a card**: the baseline styling MUST still read as
  Etched-Glass (glass surface + edge light) without a broken or empty art region.
- **Non-pf2e world**: the feature MUST NOT activate at all (it is pf2e-gated);
  chat cards render in their normal style.
- **Dorako UI absent or set to "no-theme"**: the feature MUST still produce the
  full Etched-Glass look, since it targets the pf2e system card markup, not
  Dorako's classes.
- **Card edited/re-rendered after posting**: the styling and any persistent
  cracked/dying state MUST be re-applied so the card does not revert to default on
  update.
- **A critical card whose actor disposition cannot be resolved** (e.g. a GM roll
  with no speaker token): the feature MUST treat it as non-reversed (friendly/neutral
  semantics) — critical success → gold, critical failure → red/purple — rather than
  failing or omitting the fracture.
- **Disposition reversal**: a hostile actor's critical success MUST render red/purple
  and its critical failure MUST render gold; friendly and neutral (and secret) actors
  MUST use the non-reversed mapping. The resolution rule MUST be deterministic.
- **Rapid combat with many cards**: performance MUST remain acceptable; the
  signature effects are bounded to qualifying cards and to short animations.
- **Feature toggled off mid-session**: previously styled cards SHOULD cease to
  show Etched-Glass treatment on next render, and no feature behavior persists.
- **Chat search/popout or exported chat log**: styling degrading gracefully to
  readable content is acceptable; the WebGL effect need not appear in contexts
  without a renderer.
- **Expected source node absent** (e.g. PF2e renders no damage-application section,
  no trait rail, or no save line): the corresponding scaffold slot MUST be omitted and
  the layout MUST remain valid — never a placeholder, empty slot, or broken grid.
- **Reparent runs twice** (re-render / edit): re-acquisition MUST be idempotent — the
  handler re-finds the live PF2e nodes and re-slots them without duplicating the
  scaffold, double-wrapping, or destroying handlers (FR-017, FR-018).
- **Multi-type damage** (e.g. piercing + fire + persistent): each instance MUST get its
  own colored type chip; a single-type roll collapses to one chip; the hero total is the
  summed roll total.
- **Spell-attack vs. save spell**: a spell that makes a spell attack MUST surface a
  spell-attack/roll affordance and MUST NOT show a save strip; a spell that imposes a
  save MUST show the clickable save/DC strip and no spell-attack affordance.
- **Manual natural 20 / natural 1** on an independent `/r` (no PF2e context): ONLY the
  d20 face chip is tinted gold / red — NO verdict bar and NO fracture, because no game
  outcome is declared.
- **OOC / emote with no actor or no token art**: the plain treatment MUST still render
  (OOC eyebrow / centered emote / quieter text) with the art rail simply omitted; the
  card MUST NOT show a result band or attempt a portrait bleed it cannot resolve.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The feature MUST be a self-registering suite feature exposed as a
  single world-level on/off toggle in the suite Control Center, defaulting to off.
- **FR-002**: The feature MUST be gated to the Pathfinder 2e system and MUST NOT
  activate on any other system. It MUST NOT declare a hard dependency on Dorako UI
  and MUST function correctly whether Dorako UI is installed, active, or absent.
- **FR-003**: When enabled, the feature MUST apply Etched-Glass styling to PF2e
  chat messages: standard rolls, checks/saves, damage cards, action cards, and
  item/spell cards, as well as GM whispers.
- **FR-004**: When enabled, the Etched-Glass chat styling MUST visually take
  precedence over any active Dorako UI chat-message theme on the affected cards,
  without modifying, reading-to-change, or disabling any Dorako UI setting.
- **FR-005**: The feature MUST NOT alter Dorako UI's styling of any surface other
  than chat messages (windows, sheets, sidebar, hotbar, HUD remain Dorako's).
- **FR-006**: The styling MUST be applied identically for every connected user
  once the GM enables it; there is no per-user opt-in or per-user variation in v1.
- **FR-007**: Scope for v1 is chat messages ONLY. The feature MUST NOT restyle
  character sheets, the sidebar, the hotbar, the scene HUD, or dialog/windows.
- **FR-008**: The calm baseline treatment applied to every styled card MUST
  include: a liquid-glass surface, edge-reflection light, portrait overflow/bleed
  ("diorama") art where the card has portrait art, a fast no-bounce entrance
  animation, and a hover light-sweep sheen on interactive action buttons.
- **FR-009**: The feature MAY apply running-text header accents to card headers as
  part of the baseline aesthetic.
- **FR-010**: The feature MUST detect critical-outcome cards and apply the
  glass-fracture effect, with color resolved relative to the rolling actor's
  disposition. Base mapping (friendly / neutral / secret disposition): critical
  **success** → **gold**, critical **failure** → **deep red/purple**. For a
  **hostile** actor the mapping is **reversed**: critical success → red/purple,
  critical failure → gold. Ordinary (non-critical) successes and failures MUST
  receive only the calm baseline. (Kill/0-HP detection is explicitly **out of scope
  for v1** — see Assumptions.)
- **FR-010a**: Disposition MUST be resolved from the message's token first
  (`token.disposition`), falling back to the speaker actor's prototype-token
  disposition, and finally to **neutral / non-reversed** when no disposition can be
  resolved. Only the **hostile** disposition reverses the color.
- **FR-011**: The feature MUST apply the dying-sheen emphasis to cards relating to
  the dying/wounded condition.
- **FR-012**: The glass-fracture effect, when WebGL is available, MUST be produced
  using a single shared effect renderer — never by creating a separate per-card
  WebGL context. The effect MUST animate briefly and then settle into a persistent
  static cracked appearance on the card. (The shared renderer is independent of the
  game canvas/scene.)
- **FR-013**: When WebGL is unavailable (the client cannot initialize the shared
  effect renderer), the feature MUST fall back to a pure-CSS/SVG crack and dying
  approximation so that no styled card is left visually broken, with no errors
  surfaced to the user.
- **FR-014**: When disabled, the feature MUST be completely inert: no chat hooks
  active, no Etched-Glass markup/classes added to cards, no styling, no animation,
  and no runtime behavior. The feature's settings toggle MUST still exist while
  disabled.
- **FR-015**: All user-facing strings introduced by the feature MUST be
  localizable through the suite's localization system under the feature's own
  string namespace.
- **FR-016**: The signature animations MUST always play when their trigger
  conditions are met, regardless of any operating-system reduced-motion preference.
- **FR-017**: Re-rendering or editing an already-posted chat card MUST re-apply the
  correct Etched-Glass treatment, including any persistent cracked or dying state,
  so the card does not revert to the default appearance.

#### v2 overhaul — reconstructed "Dossier" layout

- **FR-018**: When enabled, the feature MUST build its **own** layout scaffold and
  **reparent** (move) PF2e's existing live functional nodes — action/apply-damage
  buttons, dice-roll subtrees, inline rolls/links, and the damage-application section
  — into named scaffold slots. It MUST NOT restyle PF2e's markup in place as the
  primary mechanism, and MUST NOT clone or re-render those nodes from message data.
  Because the live elements are *moved, not recreated*, all existing PF2e / Foundry /
  module event handlers and listeners on them MUST remain attached and functional. The
  reparenting MUST be **idempotent and re-render-safe**: on every render it re-acquires
  and re-slots the live nodes without duplicating the scaffold or destroying handlers
  (satisfies FR-017). (This SUPERSEDES the v1 "out-specify Dorako by specificity"
  approach as the *primary* mechanism; targeted specificity overrides are retained
  only for the reparented inner dice nodes that still carry PF2e/Dorako styling.)
- **FR-019**: The scaffold MUST be the two-column "Dossier": a content column plus a
  right-side art rail (~92–96px, feathered inner edge via a gradient mask for the
  diorama bleed). When NO portrait resolves, the rail MUST be omitted and the content
  MUST reflow full-width (single column); `glec-has-art` drives this. The slot set,
  top→bottom, MUST be: header band, trait rail, optional meta line, result band
  (verdict|damage), optional body, action tray, plus the art rail.
- **FR-020**: The header band MUST present action-cost pips (diamond glyphs, shown only
  when the action/spell/item has a cost) inline with the name (Oxanium display, bright),
  a subtitle line beneath (e.g. "Strike · weapon", "Spell · Rank 3 · Evocation"), and
  the existing visibility badge + timestamp stacked top-right. The visibility badge and
  its per-visibility colors (public / gm / blind / self / private) MUST be retained.
- **FR-021**: For every d20 roll card (check / save / attack), the feature MUST show a
  formula↔total strip (formula left, tech-mono dim; total right, large Oxanium) with
  the raw d20 face chip beside the total, AND a full-width **verdict bar** stating the
  degree of success on **every** such roll. The verdict bar color MUST follow a
  four-outcome language: criticalSuccess = gold (`--gl-signal`), success = green
  (`--gl-good`), failure = amber, criticalFailure = red (`--gl-hazard`). The d20 face
  chip MUST be retained and MUST glow gold on a natural 20 and red on a natural 1
  (existing `glec-nat-max` / `glec-nat-min`).
- **FR-022**: For damage-roll cards, the feature MUST show a large hero total (Oxanium)
  as the focal point plus one colored chip per damage instance (type icon + value +
  type color), collapsing to a single chip for single-type damage. Damage cards MUST
  NOT show a verdict bar. This explicitly resolves the grey-physical-damage legibility
  problem by giving each type its own explicitly-colored chip instead of relying on
  PF2e's grey pill background.
- **FR-023**: Damage-apply buttons (Full / Half / Double / Heal, etc.) MUST be the
  **reparented** PF2e buttons restyled as glass, living in the action tray (their
  handlers preserved per FR-018).
- **FR-024**: Both roll cards AND content cards (spell / item / feat / action) MUST get
  the full scaffold including themed bodies. The body MUST use a labeled section divider
  ("Effect", generalizing to "Trigger" / "Requirements" / etc.), prose, and an
  accent-bordered heighten block (border-left accent). Stored data values and parse
  vocabulary MUST NOT be relocalized.
- **FR-025**: For spells/abilities that impose a save, the feature MUST show an inline
  save/DC strip — shield icon + save label + right-aligned DC — colored green
  (`--gl-good`), and the **whole strip** MUST be clickable to roll that save (wiring /
  triggering PF2e's inline save roll). It MUST handle non-basic saves (label "save",
  not "Basic save") and spell-**attack** spells (no save strip; surface a spell-attack
  roll instead).
- **FR-026**: Spells/items MUST show a meta line (Range / Area / Targets / Duration, as
  applicable) rendered as a tech-mono line with dim labels.
- **FR-027**: Trait pills MUST be uniform glass by default; rarity traits MUST carry
  color — uncommon = amber, rare = blue, unique = violet (`--gl-violet`) — and all other
  traits stay uniform. Trait pills MUST wrap on overflow. Trait values MUST NOT be
  relocalized.
- **FR-028**: The feature MUST handle plain message types: (a) IC speech — glass shell +
  art rail only when token art exists, no result band, spoken text given a left-accent
  cyan (`--gl-cyan`) quote treatment; (b) OOC — no actor, no art, quieter dim text, a
  cyan "OOC" eyebrow tag, clearly out-of-fiction; (c) emote — centered italic violet
  narration with minimal chrome.
- **FR-029**: Independent `/r` rolls with no PF2e context MUST render a minimal readout:
  a small header (user + time + "Manual roll" tag), a formula↔total strip with the d20
  face chip, and NO verdict bar, NO fracture, and no buttons. On a natural 20 / natural
  1, ONLY the d20 face chip is tinted gold / red — no verdict bar, no fracture (a subtle
  nod that does not imply a declared game outcome).
- **FR-030**: The signature WebGL fracture (retained as the crit escalation per the
  existing classify logic — critical success/failure + nat 20/1) MUST be **re-anchored**
  so its impact origin bursts from the verdict-bar / total area instead of the top-right
  corner: both the GLSL `uImpact` origin AND the CSS mask MUST be updated so the shatter
  nucleates at the verdict-bar band and fades across, paired with the gold/red verdict
  bar. The CSS-crack fallback is retained.
- **FR-031**: Item / feat content cards MUST generalize the spell anatomy minus the
  save/range strips when those are absent: name + traits + "Effect" body + activate/roll
  buttons, with action-cost pips shown when the item/feat has a cost.

### Key Entities *(include if feature involves data)*

- **Styled Chat Card**: a PF2e chat message that the feature has marked for
  Etched-Glass treatment. Attributes (conceptual): card category (check, damage,
  action, item/spell, whisper), whether portrait art is present, and an assigned
  treatment tier.
- **Treatment Tier**: the visual level applied to a card — *baseline* (calm
  glass), *gold fracture*, *red/purple fracture*, or *dying* (dying/wounded). Each
  card resolves to exactly one tier, and a fractured card carries exactly one
  fracture color. Which fracture color a critical card gets is determined by outcome
  **and** disposition (see Signature-Moment Signal).
- **Signature-Moment Signal**: the per-card determination feeding tier resolution —
  the critical outcome (`criticalSuccess` / `criticalFailure`), the rolling actor's
  disposition (friendly / neutral / hostile / secret), and the dying/wounded
  condition state. Outcome + disposition yield the fracture color; the dying state
  yields the dying tier.
- **Render Capability State**: whether the shared effect renderer (WebGL) is
  available on this client, which selects between the WebGL effect and the CSS/SVG
  fallback. Independent of the game canvas/scene.
- **Card Archetype**: the structural shape a message resolves to, which selects the
  scaffold assembly and slot set — one of *roll-d20* (check/save/attack: result band =
  verdict bar), *damage* (result band = hero total + type chips, no verdict), *content*
  (spell/item/feat/action: themed body, optional save/DC + meta), *IC speech*, *OOC*,
  *emote*, *manual* (independent `/r`: minimal readout), or *system* (no reconstruction).
  Orthogonal to Treatment Tier: archetype picks the layout; tier picks the
  fracture/dying escalation on top of it.
- **Degree-of-Success**: the four-valued outcome of a d20 roll —
  `criticalSuccess` / `success` / `failure` / `criticalFailure` — read from
  `flags.pf2e.context.outcome`. Maps to the verdict-bar color (gold / green / amber /
  red). Distinct from the *fracture color* (which only criticalSuccess/criticalFailure
  + nat 20/1 produce, and which disposition can reverse): the verdict bar is shown on
  every d20 roll and is never disposition-reversed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the feature enabled on a pf2e world, 100% of newly posted
  in-scope chat cards (check, save, damage, action, item/spell, whisper) display
  the Etched-Glass baseline styling, visibly distinct from both the unstyled
  default and any active Dorako chat theme.
- **SC-002**: With the feature disabled, 100% of chat cards show no trace of the
  feature — a reviewer inspecting the rendered cards finds no Etched-Glass
  classes/markup, styling, or animation, and Dorako/default styling shows through.
- **SC-003**: For friendly/neutral actors, 100% of critical-success cards show a
  **gold** fracture and 100% of critical-failure cards show a **deep red/purple**
  fracture; for **hostile** actors these are reversed (success → red/purple,
  failure → gold); and 0% of ordinary (non-critical) cards show any fracture.
- **SC-004**: 100% of dying/wounded-related cards show the dying-sheen treatment.
- **SC-005**: When WebGL is unavailable, 100% of fracture/dying cards still render a
  correct cracked/dying appearance via the CSS fallback, with zero user-visible
  errors.
- **SC-006**: During a stress test of at least 20 chat cards posted in rapid
  succession (including multiple fracture cards), the chat log remains scrollable
  and interactive with no crash, freeze, or loss of input, and the client never
  opens more than one shared effect-renderer context (and never one per card).
- **SC-007**: A non-pf2e world with the feature toggle present shows no activation
  and no change to chat-card appearance.
- **SC-008**: 100% of reparented interactive elements (apply-damage Full/Half/Double/
  Heal, set-as-initiative, inline rolls, item links, save/DC strip, activate/roll
  buttons) remain functional after the card is styled AND after the card re-renders —
  a reviewer clicking each affordance gets the same result as on an unstyled card.
- **SC-009**: 100% of d20 roll cards (check / save / attack) display a verdict bar, and
  the verdict-bar color matches the card's degree of success under the four-color
  language (criticalSuccess = gold, success = green, failure = amber,
  criticalFailure = red) on every one.
- **SC-010**: 100% of damage-roll cards show a hero total with one explicitly-colored
  chip per damage type (and never a verdict bar); a reviewer can read each physical
  damage type's value and type at a glance, with no grey-on-grey pill.
- **SC-011**: 100% of cards with no resolvable portrait omit the art rail and reflow
  content full-width (no empty/broken rail), and 100% of independent `/r` rolls show the
  minimal readout with no verdict bar and no fracture.

## Assumptions

- The PF2e system's chat-card data (`flags.pf2e.context.outcome` for the critical
  outcome, plus the rolling actor's disposition and dying/wounded condition state)
  is stable enough to detect critical-success / critical-failure / dying cards and
  to attach styling against.
- **Kill / 0-HP detection is out of scope for v1.** PF2e does not provide a reliable
  chat-card-linked "this reduced target X to 0 HP" signal (damage cards are created
  before damage is applied, and applying damage emits no strongly-linked message),
  so the gold fracture is driven by critical **success** (disposition-adjusted)
  rather than kills. A kill-driven fracture is deferred to a fast-follow that can
  design HP-transition correlation properly.
- "Diorama" portrait bleed reuses the visual pattern already established by the
  clocks-tracker support cards; cards without portrait art simply omit that layer.
- The signature glass-fracture and dying visuals reuse the Initiative tracker's
  existing effect vocabulary (the `FX_FRAG_BREAK` WebGL shader and the existing CSS
  crack/dying animations), adapted to the chat-card surface.
- The shared effect renderer is a single dedicated offscreen WebGL renderer
  (mirroring the Initiative tracker's card-FX renderer), **independent of the game
  canvas/scene**. "Unavailable" therefore means the client cannot initialize WebGL
  at all — NOT an unloaded scene or a board-closed client (those still get the WebGL
  effect).
- The feature is per-world enabled (GM decision) and applies to all users; no
  per-client preference is in scope for v1.
- Sheets, sidebar, hotbar, scene HUD, and dialogs/windows remain out of scope and
  continue to be styled by Dorako UI or the default, as applicable.
- No new persisted world data is required beyond the feature's enable setting;
  per-card treatment is derived at render time from the card's own content.
