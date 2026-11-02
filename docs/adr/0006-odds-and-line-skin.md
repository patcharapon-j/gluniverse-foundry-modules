# 0006 · A scoped ink skin for PF2e Odds

Status: accepted (2026-11-03)

## Context

PF2e Odds draws on the board in every PF2e campaign the suite runs: a tag on
each targeting line, a plate beside it, a mark on the landed die, a readout on
the sheet. Its old look was the suite's cyan and violet glass, with `???` in
violet for anything unknown. On a fantasy or horror map that reads as one
setting, and violet for "unknown" spent a hue on the absence of information.

The remake needs the odds to read at a glance over any map art, on a
compressed stream, and without relying on hue. An accent remap (ADR 0001's
floor) cannot do that: the glass surfaces carry blue and violet in their tints,
and the four degrees need fixed, ranked tones that are not the accent.

## Decision

PF2e Odds carries a scoped skin, built the same way as Stream Pacer's (ADR
0003) and using the same neutral ramp, so the two read as one family.

- Every token is `--glod-*`, declared once on the feature's own roots:
  `.glod-lines`, `.glod-badge`, `.glod-tag`, `.glod-inline`, `.glod-dialog`,
  `.glod-save-odds`, `.glod-dice-layer`, `.glod-obs-root`, `.glod-dexhint`.
  Nothing is written on `:root`, and no foundation `--gl-*` token is redeclared.
- The four degrees are fixed tones: amber for a critical, paper for a success,
  steel for a failure, red for a critical failure. Unknown is a faint hatch,
  never a hue. The die is drawn as a skyline whose bar heights rank the same
  four degrees, so nothing depends on colour alone.
- The tag takes the targeting line's own colour as a rule (`--glod-line`, set
  per line from the `linesChanged` payload), which is the one place a line's
  hue reaches the odds.
- Motion comes from the suite's tokens (`--gl-d-*`, `--gl-ease*`). Keyframes are
  prefixed `glod-`. Blur is written against `--gl-glass-k`.

## Consequences

- `tools/pf2e-odds-check.mjs` refuses a `:root` rule, a `--glod-*` read with no
  declaration behind it, a skyline whose heights do not rank the degrees, an
  animation naming keyframes that do not exist, and a violet unknown.
- The skin is not a setting. The Observations window and the Creaturedex line
  wear it too, so the feature has one look.
- No other feature gains a skin from this ADR.
