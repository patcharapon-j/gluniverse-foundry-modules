# 0008 · A scoped console skin for the Stage and Theatre GM apps

Status: accepted (2026-11-03)

## Context

Stage's Director and Theatre's filmstrip and shot editor are the panels a GM
runs a scene from, often side by side and often during a stream. Their old look
was Etched Glass with the suite's blue accent: glass panels tinted cool, glowing
rules, a display face. Three problems came out of that.

- The panels competed with the picture they control. A shot editor whose chrome
  glows blue makes it hard to judge whether a shot reads warm or cold.
- There was no clear signal for "this is on screen for the players now" versus
  "this is what I am about to put on screen". Both were the accent.
- Stage and Theatre drifted apart. They are driven together (a Theatre cut
  relights the Stage cast) but looked like two different tools.

An accent remap (ADR 0001's floor) cannot fix it: the glass surfaces carry the
cool tint in every layer, and the apps need a signal pair that is louder than
any accent.

## Decision

The three GM apps carry one scoped skin, the console skin, read like a vision
mixer.

- Every rule lives under the apps' own roots: `.glstage-dir-app` for the
  Director, `.glth-app` and `.glth-dialog` for Theatre. Nothing is written on
  `:root`, and no foundation `--gl-*` token is redeclared.
- The tokens are one black-leaning neutral ramp (`ink-0` to `ink-6`, `text`,
  `dim`, `faint`, hairline tints from `--gl-tint-light`), paper for the primary
  action, and four signal hues: red for program (on air), green for preview
  (cued up), amber for unsaved, steel for neutral marks. Stage states them as
  `--glstage-*`, Theatre as `--glth-*`, with identical values.
- The type is Google Sans Flex. Corners are 2px. Motion comes from the suite's
  tokens (`--gl-d-*`, `--gl-ease*`); neither sheet declares a keyframe.
- The apps render through pure view modules (`director-view.mjs`,
  `filmstrip-view.mjs`, `editor-view.mjs`) that return markup strings, so the
  previews draw the shipped markup over the shipped CSS.

What the players see is not part of this skin. The Stage name card and the
Theatre title, card and tag stay in the global theme, but drop the accent for a
neutral paper rule and a neutral sans, because they sit over campaign art.

Amended 2026-11-05: the Stage name card and the comms stack are on Ink and
Signal too, aliased as `--glstage-*` on `.glstage-root` and `--glstage-comms-*`
on `.glstage-comms` (ADR 0012). The clean comms card is an ink slab with the
system's cut corner and the character's tint as its one tone edge. Holo and
radio stay diegetic looks (a projection, a transmission) on the same ink, type
and signals: a holo is the character's tint lifted toward paper, never the old
cyan, and radio's on-air lamp is the signal red. `stage-check` refuses an
Etched Glass token, a hex and type under 11px in all three Stage sheets.

Amended 2026-11-05: Theatre's player-facing surfaces (the title overlay and the
chat line a cut posts) moved to Ink and Signal too, aliasing the core family as
`--glth-*` on `.glth-overlay` and `.glth-chat-cut` in `styles/theatre.css`. The
overlay still carries no hue. Its black dip and bars are film black from the
tint channel rather than `ink-0`, so they stay the darkest thing on screen. The
scene prompts (create, convert, leave) joined the console skin's `.glth-dialog`.

## Consequences

- `tools/theatre-check.mjs` holds the two ramps equal and refuses the skin on
  `:root`. `tools/stage-check.mjs` already refuses a selector outside
  `glstage`, a white veil and an unprefixed keyframe in the Director's sheet.
- The skin is not a setting. There is one look for these panels.
- Templates for the three apps are gone (`templates/stage/director.hbs`,
  `templates/theatre/{editor,filmstrip}.hbs`). Their markup is the view modules.
- No other feature gains a skin from this ADR.
