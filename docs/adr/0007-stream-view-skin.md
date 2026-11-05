# 0007 · A scoped black skin for the stream view

Status: accepted (2026-11-03)

## Context

The stream view is what an audience sees: the capture login's overlay, the roll
and status cards in it, and the Control Room a GM or co-host drives it from. It
sits over every campaign the suite runs, the same as Stream Pacer's band, and
its old look was a rounded blue-tinted glass strip that read as a different
product from the Pacer band drawn on the same screen.

The suite's glass carries blue in its ink ramp and its tints, so an accent
remap alone (ADR 0001's floor) cannot make the cards black-leaning, and the
tone tag on a card (gold for a critical, red for a fumble) needs to be a solid
slab louder than any glass panel.

## Decision

The stream view carries the same black skin Stream Pacer carries (ADR 0003),
under its own roots and its own prefix.

- Every rule lives under the stream's roots: the cards (`.glus-rc`, `.glus-sc`),
  the overlay (`.gluniverse-stream-overlay-root`, `.gluniverse-stream-chat-card`)
  and the three windows (`.gluniverse-stream-director`,
  `.gluniverse-stream-filter`, `.gluniverse-stream-framing`). Nothing is written
  on `:root`, and no foundation `--gl-*` token is redeclared.
- The skin's tokens are `--glus-*`: the same neutral ink ramp, paper text and
  tones as `--sp-*`. Since 0012 they alias core's `--gl-is-*` on the stream's
  roots rather than restating a value. A card's tone is routed through `--glus-rc-tone` (and
  `--glus-sc-tone`) on a data attribute, so a card retones with one attribute.
- Shape is the suite's cut motif: a chamfered plate, and a 115° wedge on the
  tone tag. A clip that animates a plate (the strip unfolding) starts and ends on
  the plate's own polygon, so the card never changes shape when it lands.
- Motion lengths for the cards live in one table (`CARD_MOTION`) and pass
  through `motionDuration()`; the overlay's own live in `OVERLAY_MOTION`.
  Keyframes are prefixed `glus-`. Blur is written against `--gl-glass-k`.
- Narrated text keeps its serif (Cormorant Garamond italic). Everything else is
  Google Sans Flex.

## Consequences

- `tools/stream-check.mjs` refuses a `:root` rule, a foundation token
  declaration, an unprefixed keyframe, a raw duration or easing, a white veil
  and a blur not written against `--gl-glass-k` in the stream stylesheets, and a
  literal duration in the card code. In `styles/stream.css` it also refuses a
  `--glus-*` token stated as a colour rather than aliased, an Etched Glass token
  (`--gl-signal`, `--gl-accent`, the glass ink), a font size off the
  `--gl-is-t-*` scale and a hand-mixed tint veil.
- The Control Room and the Chat Filter follow DESIGN.md's components: 32px
  controls on Raised Slate with a hairline inset and the cut-sm chamfer, fields
  in a Void well, tags on the 115° wedge, and going live as the one red slab.
- A cloned chat card on a world with no roll cards keeps Foundry's own markup
  inside; only its frame takes the skin.
- The skin is not a setting. There is one look, and it is the same in every
  campaign.
