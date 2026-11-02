# 0005 · A scoped black skin for the Creaturedex

Status: accepted (2026-11-03)

## Context

The Creaturedex is a stat block a player reads beside their own character
sheet, mid-combat, in every campaign the suite runs. Its old look was the
suite's glass panel with the blue accent, which reads as one setting and puts
the section hues (the book's Characteristics, Defense and Offense) on a tinted
surface where green and blue lose each other.

The remake needs three hues that carry meaning at a glance, a sealed plate that
reads as sealed beside a revealed one, and a lie colour that only a GM ever
sees. An accent remap (ADR 0001's floor) gives one hue, not three.

## Decision

The Creaturedex carries a scoped skin, the fifth after the initiative rail,
Combat Intro, Stream Pacer and Resource Trackers.

- Every rule lives under the feature's own roots: `.application.gldex` (the dex
  and Falsify windows), `.gldex-root`, `.gldex-lie-root`, `.gldex-card` (the
  reveal notice in chat) and `.gldex-hud`. Nothing is written on `:root`, and no
  foundation `--gl-*` token is redeclared.
- The skin's tokens are `--gldex-*`: the design system's neutral ink ramp
  mirrored as hex (the same mirror Stream Pacer keeps), paper text, and the
  section hues taken from the suite's own semantic tokens (`--gl-good`,
  `--gl-info`, `--gl-hazard`). A lie is `--gl-violet`. A hue is routed through
  `--gldex-tone` on the element carrying `data-section`, so a plate, a pip, an
  index tab and a chat card follow one declaration.
- Motion comes from the suite's tokens (`--gl-d-*`, `--gl-ease*`,
  `--gl-stagger`). Keyframes are prefixed `gldex-`. There is no backdrop blur.
- Shape is the suite's cut motif: a chamfered plate per section.

## Consequences

- `tools/creaturedex-check.mjs` refuses a `:root` rule, a foundation token
  declaration, an unprefixed keyframe, a raw duration or easing, a white veil, a
  blur not written against the glass tier, a `--gldex-*` token declared outside
  the roots, and any `--gl-*` token the sheet reads that `gl-tokens.css` does not
  declare.
- The skin is not a setting. There is one look, and it is the same in every
  campaign.
- No other feature gains a skin from this ADR.
