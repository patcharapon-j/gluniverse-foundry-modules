# 0009 · A scoped ink skin for Flatfinder

Status: accepted (2026-11-03)

## Context

Flatfinder draws in two places every PF2e session passes through: a badge on
skill-check chat cards and a strip at the top of the combat tracker. It now
also has a window of its own, the encounter planner. Its old look was the
suite's glass with a rainbow of raw hexes for the eight competence bands and
the five threat ratings, a glow on each, and a violet gradient for the top
band. On a parchment chat card that read as a sci-fi sticker, and eight hues
for eight bands asked the table to learn a colour code.

The remake needs both readings to work at a glance, on PF2e's parchment cards
and on a dark sidebar, without relying on hue. An accent remap (ADR 0001's
floor) cannot do that: the bands and ratings need fixed, ranked tones that are
not the accent.

## Decision

Flatfinder carries a scoped skin built the same way as Stream Pacer's (ADR
0003) and PF2e Odds' (ADR 0006), with the same neutral ramp, so the three read
as one family.

- Every token is `--ff-*`, declared once on the feature's own roots: `.ff-root`
  (the badge, the strip, the planner's content) and `.flatfinder-planner-app`
  (the planner's frame). Nothing is written on `:root`, and no foundation
  `--gl-*` token is redeclared.
- Colour is kept for meaning. Red and ember are danger and strain, steel and
  paper the ordinary middle, amber the one accent and it means exceptional
  (a Remarkable or Phenomenal result, a Moderate fight).
- Every reading also has a shape that says the same thing: the competence
  ladder's eight bars rise in height and light up to the band, and the threat
  meter fills across one equal segment per rating.
- Motion comes from the suite's tokens (`--gl-d-*`, `--gl-ease*`). Keyframes
  are prefixed `flatfinder-`. The old class names (`flatfinder-competence`,
  `flatfinder-tier-*`, `flatfinder-encounter-budget`) stay on the elements.

## Consequences

- `tools/flatfinder-check.mjs` refuses a `:root` rule, a `--ff-*` read with no
  declaration, an unprefixed keyframe, an animation naming keyframes that do
  not exist, a raw duration or easing, and a class drawn but never styled (or
  styled and never drawn).
- The skin is not a setting.
- No other feature gains a skin from this ADR.
