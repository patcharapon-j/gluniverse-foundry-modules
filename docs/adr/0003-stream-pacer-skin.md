# 0003 · A scoped black skin for Stream Pacer

Status: accepted (2026-11-03)

## Context

Stream Pacer draws over every screen at the table, the stream capture
included, in every campaign the suite runs. Its old look leaned on the suite's
signature violet, holographic accents and a sci-fi HUD, which reads as one
setting and fights a fantasy or horror map. The remake needs to read as
GLUniverse (the cut motif, the type, the motion) while staying neutral enough to
sit on any campaign's art, and loud enough to be noticed by a player who is
looking at the map.

An accent remap alone (ADR 0001's floor for a preset) cannot do that: the
suite's glass surfaces carry blue and violet in their tints and glows, and the
band needs solid tone slabs (amber for a call, red for danger, paper for a hand)
that are louder than any glass panel.

## Decision

Stream Pacer carries a scoped skin, the third after the initiative rail and
Combat Intro.

- Every rule lives under the feature's own roots: `.sp-root` (the band, the HUD,
  the Dire Peril splash) and its two settings forms. Nothing is written on
  `:root`, and no foundation `--gl-*` token is redeclared.
- The skin's tokens are `--sp-*`: a black-leaning neutral ink ramp, paper text,
  and five tones (amber, red, ember, green, steel) taken from the suite's own
  semantic palette. A tone is routed through `--sp-tone` on a scoped class, so a
  lane retones with one class swap.
- Motion comes from the suite's tokens (`--gl-d-*`, `--gl-ease*`) and from
  anime.js through `core/motion.mjs`. Keyframes are prefixed `sp-`. Blur is
  written against `--gl-glass-k`.
- Shape is the suite's cut motif: a chamfered plate and a 115° wedge on the tag.

## Consequences

- `tools/stream-pacer-check.mjs` refuses a `:root` rule, a foundation token
  declaration, an unprefixed keyframe, a raw duration or easing, a white veil and
  a blur not written against `--gl-glass-k` in `styles/stream-pacer.css`.
- The skin is not a setting. There is one look, and it is the same in every
  campaign.
- No other feature gains a skin from this ADR.
