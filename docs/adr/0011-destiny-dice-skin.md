# 0011 · A scoped skin for Destiny Dice

Status: accepted (2026-11-03)

## Context

Destiny Dice puts a strip under a PF2e check card, a switch in PF2e's check
dialog and a window in the settings. Its old look was fantasy art baked into
36 PNGs, a colour theme injected from JS as raw hex, and `--gl-motion-scale`
written on `body`, which retimed every other feature. The art also printed a
fixed +4 and +2 whatever the GM had configured.

The remake needs the strip to sit quietly inside a busy chat log, to say which
result it is without relying on hue alone, and to draw the 3D die from the
same statement as the card.

## Decision

Destiny Dice carries a scoped skin on the same neutral ramp as PF2e Odds and
Stream Pacer (ADR 0003, ADR 0006), so the three read as one family.

- Every token is `--glddf-*`, declared once on the feature's roots:
  `.glddf-fate-strip`, `.glddf-fated-roll-row` and `.glddf-cfg`. Nothing is
  written on `:root` or `body`, and no foundation `--gl-*` token is redeclared.
- A result's tone is `data-tone`, a key of `PALETTE` in `core/theme.mjs`,
  mapped to a semantic token in the stylesheet. The die bakes the same key
  from `PALETTE`, so the card and the die cannot drift apart.
- Each result has its own mark (a star, a signed number, nothing), drawn from
  one geometry in `glyphs.mjs` as SVG in chat and as a raster on the die.
- Motion comes from the suite's tokens, and the reveal is one anime.js
  timeline scaled by the feature's own Animation Style. There are no keyframes.

## Consequences

- `tools/destiny-dice-check.mjs` refuses a `:root` rule, a `--glddf-*` read
  with no declaration, a foundation token redeclared, a raw duration, a raw
  white veil, and a tone with no `[data-tone]` rule or palette entry.
- The old kind classes (`glddf-opportunity`, `glddf-complication`,
  `glddf-blank`) stay on the strip for world CSS written against them; the
  look no longer depends on them.
