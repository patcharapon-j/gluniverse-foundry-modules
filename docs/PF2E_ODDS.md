# PF2e Odds and Save Resolution — design

Status: **PRs 1–3 built, not yet run in a live session.** The engine,
every Odds surface (line badge, sheet, roll dialog, save prompt), the
observation ledger, the Observations window, the Creaturedex hint and the Dice
So Nice highlight exist and pass `tools/pf2e-odds-check.mjs`. Save Resolution
is built and documented in `docs/SAVE_RESOLUTION.md`. Not built: the HUD (its
own grilling). This file records the decisions from the grilling session
(Q1–Q36).

### Still to prove in a live session

- the probe returning before PF2e's dialog or dice (`probe.mjs`), on Strikes,
  skill actions, spell attacks and saves;
- the sheet selectors, the dialog hook (and its `renderApplication` fallback),
  the spell-card save button, `setPosition({height: "auto"})` on the dialog;
- observation off real chat cards (`flags.pf2e.context`, `unadjustedOutcome`,
  `dc.visible`), and the landing stamp keyed on `context.target.token`;
- spells inside wands, scrolls and staves (`fromUuidSync` may not resolve them:
  they show no odds rather than wrong ones);
- the dice highlight against DSN 6's real board: the result → vectors →
  `mesh.notation` join, `sim.dead` against the playback iteration as the
  settle signal, the projection onto the canvas, and the layer stacking above
  `#dice-box-canvas` in each of DSN's three layering modes.

## Shape

One pure engine, three toggleable features, one later session.

| Piece | Id / prefix / i18n | What it is |
|---|---|---|
| Engine | `core/pf2e-odds.mjs` | Pure maths, importable under Node. No `game`, no `canvas`. |
| Odds | `pf2e-odds`, `od.`, `GLOD.*` | Odds on the targeting line, the sheet and the roll dialog, plus the observation ledger. |
| Dice highlight | sub-feature `od.dice` | The degree ring on the Dice So Nice die, and the landed-face pulse on the badge. |
| Save Resolution | `pf2e-saves`, `sv.`, `GLSV.*` | Resolve saves for an area or a set of targets, then apply damage and effects. |
| HUD | — | A replacement for pf2e-hud / Token Action HUD. Gets its own grilling session after the three above ship. |

PF2e only. There is no system-adapter seam.

Delivery is three stacked PRs: (1) engine + Odds + ledger, (2) dice highlight,
(3) Save Resolution.

## The engine

- **Input:** a modifier, a DC (exact, a range `[lo, hi]`, or unknown), the
  roller's degree-of-success adjustments, and an optional flat check.
- **Output:** the degree of every d20 face 1–20. Faces whose outcome differs
  across the DC range are **uncertain** and carry the lowest and highest degree
  they could have. Everything else is derived from those faces: P(success or
  better), P(crit), and the ranges of both.
- **Nat 20 / nat 1:** they shift the result one degree up or down, the same rule
  as `core/pf2e-degree.mjs`.
- **Degree adjustments:** read from PF2e's own adjustments on the roller's
  statistic (Evasion, Juggernaut, Resolve, incapacitation) and applied per face.
  Each adjustment that applies shows as a chip, e.g. `EVASION`.
- **Modifiers:** never recomputed by hand. The live total and the modifier list
  come from PF2e's own pipeline, using the same no-roll path Spotlight Roll
  already uses (`pf2e-roll.mjs`). Toggles from the roll dialog and the sheet,
  and the target's conditions, arrive through PF2e. Flanking, read from token
  positions, arrives as the target being off-guard.
- **Roll-dialog hook:** the live dialog preview shares Spotlight Roll's single
  wrapper around PF2e's check roll (`pendCheck` / `installCheckWrapper`).
  libWrapper allows only one per package.
- **Flat checks:** concealed (DC 5) and hidden (DC 11) multiply into the
  headline number. The strip's faces stay the pure d20. A chip shows
  `CONCEALED · DC 5 · 80%`. An undetected creature can't be targeted and gets no
  badge.

### MAP

- **Auto-count:** chat messages carrying the `attack` trait, Grapple and Trip
  included, posted by that actor. The agile trait is respected.
- **Reset in combat:** on `combatTurnChange` for that combatant.
- **Reset out of combat:** after 12 s with no attack-trait check from that actor
  (world setting).
- **Manual override:** a clickable chip cycles 0 / −5 / −10 and holds until the
  next reset.

## Knowledge: what a player is allowed to see

The GM always sees the truth. Players see what the party has *observed*.

- **Sources:**
  - **Creaturedex:** a revealed section gives an exact number. If it was a
    deliberate lie, players get odds computed from the number they *believe*,
    and the GM's view marks those odds as built on a lie.
  - **The observation ledger (`od.ledger`):** its own world store, written only
    by the active GM. It **never** writes to Creaturedex, because Creaturedex
    pins "the reveal is the GM's click, no roll hook".
- **Who knows:** follows Creaturedex's party-knowledge setting. Per party by
  default (a union over members); per character when that setting is off.
- **Key:** the creature's *kind*, the same identity Creaturedex uses (compendium
  source, otherwise a name+level slug). One goblin warrior teaches you about
  every goblin warrior.
- **What counts as an observation**, gated on *what players could actually see
  in chat*:
  - A PC's check against a creature's AC or DC narrows that defence from the
    total and the degree, with nat-20/nat-1 shifts unwound.
  - A visible enemy attack roll reveals its attack modifier exactly.
  - A PC's save against a creature's spell narrows that spell DC.
  - A blind or private GM roll teaches nothing. When PF2e's metagame setting
    hides results, no degree is learned.
- **Normalisation:** bounds are stored for the *base* stat. Target modifiers
  that were visible at roll time (off-guard, a raised shield) are unwound first.
- **Contradiction:** if low > high (a hidden buff, say), the stat resets to the
  latest observation and is flagged in the GM view. It never sticks at
  "impossible".
- **The GM's tools:**
  - An Observations view in the Odds feature: a row per creature kind, each
    stat's range and the roll it came from, plus per-stat and per-creature
    reset.
  - A read-only "observed: AC 19–22" hint in Creaturedex's GM view.

One visibility gate decides all three of: the degree a player learns, the
dice highlight, and an NPC row's degree in Save Resolution.

## Surfaces

### Which action
The targeting line shows the **armed action**: whatever the player last hovered
or clicked on the sheet, the HUD or a chat card. Otherwise it falls back to the
primary strike (the wielded weapon with the best attack bonus). The badge always
names its action (`LONGSWORD · 2ND ›› OGRE`).

### The badge — variant C, "d20 strip"
- **Headline:** P(success or better) in large type, or a range `55–70%`, or
  violet `???` when nothing is known.
- **Strip:** 20 pips, one per die face, coloured by degree:
  - crit: amber `--gl-signal`
  - success: cyan
  - failure: dim steel
  - crit fail: `--gl-hazard`
- **Uncertain faces:** hatched in their two possible colours. With nothing
  known, every face is violet hatch.
- **Beside the headline:** crit %, and the AC/DC range as known.
- **Chips:** small Endfield tags (MAP −5, OFF-GUARD +2, FRIGHT −1, EVASION,
  CONCEALED…).
- **GM-only:** a dashed violet tag, `GM · TRUE 60% · PLAYERS SEE 55–70%`.
- **Material:** the Etched × Endfield language the initiative rail already uses.
  This is not a third skin; it uses tokens only.
- **Lifetime:** shown as long as the line exists. It collapses to a compact `60%`
  tag off the attacker's turn and expands on their turn, on hover, or while
  their roll dialog is open.
- **Visibility:**
  - Every client draws the badge from its own knowledge.
  - The stream client always renders the **player** view, even when it is logged
    in with GM rights.
  - Lines between two NPCs carry no badge for players.
- **Enemy attacks on PCs:** shown on the line when the GM targets a PC, gated on
  the attack modifier being known.

### Sheet
With exactly one target:
- Every Strike's three MAP buttons get a % and an underline bar.
- Spell attacks and save spells get a %.
- Skill actions get a % against the right defence (Demoralize → Will,
  Grapple → Fortitude, …).

With no target or several, the sheet shows nothing.

### Roll dialog
A full odds panel at the top, updating live as boxes are ticked: the headline,
crit %, and the strip with face numbers. With several targets it shows one row
per target.

### Save prompts
The "Roll Reflex save" button on a spell's chat card gets the player's own odds
against that DC, gated on whether they've learned it.

### Motion
- **Narrowing:** hatched pips resolve one at a time, staggered outward from the
  boundary that moved. The headline counts from the old range to the new one;
  the AC readout ticks.
- **Collapsing to exact:** a bigger beat. The pips sweep and the plate gets a
  short amber etched rim.
- **Roll lands:** the landed face's pip pulses, and the badge shows the degree
  stamp (CRIT / HIT / MISS / FUMBLE, or the save words) for about 1.5 s before
  returning to odds.
- **Sound:** none by default; an optional setting.
- All durations are tokens. The feature has a `SHED_ORDER` bound to the shared
  budget.

## Dice highlight (`od.dice`)

- **What's drawn:** a degree-coloured ring/burst and a short stamp over the
  landed d20, in the same four colours.
- **How:** a DOM overlay stacked directly above DSN's `#dice-box-canvas`,
  re-stacked on every draw because DSN's "auto" layering raises its board above
  whichever window is open. It never edits DSN materials; Spotlight's
  `dsn-host.mjs` remains the only file that reaches into DSN's internals, and
  only to read.
- **Which die:** by identity, through DSN's own two links. DSN builds a throw
  from the message's own dice terms, and each die entry in
  `throwEngine.throws[].dice[]` keeps `fvttResult` (the term's result object)
  and a `vectors` object, which is what becomes `mesh.notation`. The reader
  remembers result → vectors in a WeakMap while the batch plays. The result
  objects are captured from the roll DSN is handed at `diceSoNiceRollStart`; a
  die is ours only if it is the kept one of those. Concurrent throws showing
  the same natural, and dice left on the board, never match.
- **When:** `dice-watch.mjs` reads the board on a timer until the kept die is
  at rest by DSN's own test — its sim died at or before the playback
  iteration, playback ended, or the batch stopped rolling. Finished dice stay
  in `diceList` until the next batch, so list membership says nothing. Not
  DSN's completion hook, which fires before the dice land under "immediately
  display chat messages" and whose waiter is never removed.
  Every watch ends: settled; DSN never started the throw (1.5 s); started but
  never reached an idle board (4 s); deleted; or 10 s. Both landing beats —
  the badge pulse and the ring — wait on that one watch, in `dice-highlight.mjs`.
- **Visibility:** the same gate as above (`landing.mjs`). No highlight when PF2e
  would hide the result from that viewer, and the stream login lands only
  public rolls: a whisper to one player is content its audience may not see.
- **Exclusion:** Spotlight Roll messages are skipped, since that feature draws
  its own die.

## Save Resolution (`pf2e-saves`)

Built; see `docs/SAVE_RESOLUTION.md`, which also records where it departs from
the design agreed here (saves roll through PF2e's own `check.roll` rather than
Spotlight's `rollSlot`, and the session carries message ids, never results).

## Checks and previews (to build with each PR)

- `tools/pf2e-odds-check.mjs`:
  - the strip maths against the PF2e degree rules, including nat shifts and
    degree adjustments
  - the visibility gate across PF2e's metagame settings
  - ledger narrowing, normalisation and contradiction reset
  - the stream client never rendering truth
  - the dynamic `GLOD.*` key families
- `tools/pf2e-odds-preview.mjs`: the badge, sheet chips and dialog panel driven
  by the shipped pure modules, including the narrowing and landing beats.
- `tools/pf2e-saves-check.mjs`:
  - degree × basic-save multipliers
  - area membership against `pf2eCoverage`
  - the GM-only write path
  - undo round trip
  - NPC rows sealed
