# 0012 · Ink and Signal moves into core

Status: accepted (2026-11-04). Amends 0003, 0004, 0005, 0006, 0007, 0008, 0009,
0010 and 0011.

## Context

The remakes merged on 2026-11-03 gave ten features a scoped skin: Stream Pacer,
Resource Trackers, the Creaturedex, PF2e Odds, the stream view, Stage's
Director, Theatre's apps, Mythic GME, Flatfinder and Destiny Dice. Each ADR
says the skin's tokens live under the feature's prefix on its own roots and
never on `:root`.

Read side by side, the ten are one system, not ten. Every sheet declared the
same seven-step ink ramp, the same paper, dim, faint and steel, the same font
stack and the same hairlines, copied by hand. The copies had already drifted:
Destiny Dice's `ink-2` was `#101219` where the other nine said `#0f1017`, the
plate cut was 8, 9 or 10px depending on the sheet, controls were 5 or 6px, the
hover veil 0.045 or 0.05, and two sheets routed their signal hues through the
Etched Glass semantics while four stated their own. Seven font sizes sat
between 10 and 13px. The shared faint grey (`#6a6d7c`) failed text contrast on
every ground it sat on, and fixing it meant ten edits that could drift again.

The suite is now migrating every surface to this system (DESIGN.md, "Ink and
Signal"), so a second copy per feature stops being a local decision and becomes
the main way the migration can drift.

## Decision

- The system's primitives live once, in `styles/gl-tokens.css`, as the
  `--gl-is-*` family: the ink ramp, text and neutral tones, the signal hues,
  hairlines and shade, state tokens (hover, selected, press, disabled, focus),
  the type scale (11, 12, 13, 15 and 22px; nothing under 11px) and the cut
  scale (10, 8, 5 and 3px, plus a 2px radius).
- The family is `--gl-is-*`, not `--gl-ink-*`, because Etched Glass already owns
  `--gl-ink-0` to `--gl-ink-3` with its own blue-tinted values, and every legacy
  surface reads them. When the migration ends, Etched Glass's tokens retire and
  the family can be renamed in one pass.
- A feature skin keeps its prefix and its roots. It aliases the core values
  (`--gmyth-ink-2: var(--gl-is-ink-2)`) on its roots and never re-states one.
  What 0003 to 0011 forbid is unchanged: a feature still writes nothing on
  `:root` and redeclares no foundation token. Only the source of the values
  moves.
- A paper ground (`.gl-is-paper`) restates the same roles for a light host.
  Hairlines and state veils are restated there rather than inherited, because a
  `var()` resolves where it is declared.

## Consequences

- Retuning the system (a ramp step, the faint grey, a signal hue) is one edit in
  core, and every migrated feature follows.
- A sheet that re-states a ramp value instead of aliasing it is drift. DESIGN.md
  says so; no check enforces it yet.
- Each feature's check tool still pins its own rules (no `:root` rule, no
  foundation token, prefixed keyframes) and keeps passing, because an alias is a
  declaration under the feature's own prefix.
- Flatfinder's chat badge and Destiny Dice's strip stay ink plates on parchment.
  0010 chose a plate that reads on a parchment card and a dark sidebar without
  knowing which it is on; the paper ground is for hosts that are known to be
  light.
