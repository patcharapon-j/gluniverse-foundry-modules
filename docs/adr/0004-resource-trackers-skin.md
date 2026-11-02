# 0004 · A scoped black skin for Resource Trackers

Status: accepted (2026-11-03)

## Context

The trackers dock sits over the map in every campaign the suite runs: a
countdown in a horror one-shot, a downtime task in a PF2e campaign, a torch pool
in a dungeon crawl. Its old look borrowed the time HUD's sci-fi chrome (glows,
corner brackets, the suite's violet), which reads as one setting and made a
clock look like part of the calendar. It also shared `clocks-tracker-hud.css`
with the time engine, so a trackers-only world loaded the whole HUD sheet to
draw a list.

The remake wants what Stream Pacer got (ADR 0003): neutral enough to sit on any
campaign's art, with clear tone for the few states that matter (danger, done,
empty). An accent remap alone cannot do that, for the same reason it could not
there.

## Decision

Resource Trackers carries a scoped skin, the fourth after the initiative rail,
Combat Intro and Stream Pacer.

- Every rule lives in `styles/clocks-tracker-trackers.css` under the feature's
  own root, `.glct-trk-skin` (the dock app, the sheet tab, the editor dialog, the
  pool chat card), plus two host rules that size Foundry's own chat message
  around a pool card. Nothing is written on `:root`, and no foundation `--gl-*`
  token is redeclared.
- The skin's tokens are `--trk-*`: the same black-leaning ink ramp as Stream
  Pacer, paper text, and three tones (red, green, amber). A row's tone is routed
  through `--trk-tone` from `[data-tone]`.
- Motion comes from the suite's tokens (`--gl-d-*`, `--gl-ease*`). Keyframes are
  prefixed `glct-trk-`. Blur is written against `--gl-glass-k`.
- The stylesheet is independent of the time engine's. The trackers half injects
  only its own sheet.

## Consequences

- `tools/resource-trackers-check.mjs` refuses a rule outside the roots, a
  `:root` rule, a foundation token declaration, an unprefixed keyframe, a raw
  duration or easing, a white veil, a blur not written against `--gl-glass-k`,
  and a class the renderer emits with no rule behind it.
- The skin is not a setting. There is one look in every campaign.
- No other feature gains a skin from this ADR.
