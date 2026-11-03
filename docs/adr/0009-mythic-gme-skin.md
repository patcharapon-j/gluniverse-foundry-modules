# 0009 · A scoped black skin for the Mythic GME panel

Status: accepted (2026-11-03)

## Context

The Mythic GME panel is where a GM asks the oracle a question and reads the
answer, many times a session, in any campaign and any game system. Its old
look was the suite's glass with the blue accent and `//` slash labels, which
reads as one setting and gave every row the same weight: the odds picker, the
table buttons and the answer all competed.

The remake needs the answer to be the loudest thing on the panel, and four
answers (Exceptional Yes, Yes, No, Exceptional No) plus a Random Event to be
told apart at a glance. An accent remap (ADR 0001's floor) gives one hue, not
five.

## Decision

The Mythic GME panel carries a scoped skin, after Stream Pacer, Resource
Trackers, the Creaturedex and the others.

- Every rule lives under the feature's own roots: `.application.gmyth` (the
  window frame), `.gmyth-root` (the panel) and `.gmyth-card` (a chat card).
  Nothing is written on `:root`, and no foundation `--gl-*` token is
  redeclared.
- The skin's tokens are `--gmyth-*`: the design system's neutral ink ramp
  mirrored as hex (the same mirror the other skins keep), paper text, and
  meaning taken from the suite's semantic tokens: an Exceptional Yes is
  `--gl-good`, an Exceptional No `--gl-hazard`, a Random Event and an
  interrupted scene `--gl-warn`, an altered scene `--gl-info`. A plain Yes is
  paper and a plain No is steel. The hue is routed through `--gmyth-tone` on
  the element carrying `data-tone`, so a plate, its edge, a log row and a chat
  card follow one declaration.
- Motion comes from the suite's tokens (`--gl-d-*`, `--gl-ease*`,
  `--gl-stagger`). Keyframes are prefixed `gmyth-`. There is no backdrop blur.
- Shape is the suite's cut motif: a chamfered plate for the answer, smaller
  cuts on buttons and chips.

## Consequences

- `tools/mythic-gme-check.mjs` refuses a `:root` rule, a foundation token
  declaration, a selector outside the roots, an unprefixed keyframe, a raw
  duration or easing, a white veil, an untiered blur, a `--gmyth-*` token read
  and never declared, and any `--gl-*` token the sheet reads that
  `gl-tokens.css` does not declare.
- The skin is not a setting. There is one look in every campaign.
- No other feature gains a skin from this ADR.
