# 0001 · Scoped skins for the initiative rail and Combat Intro

Status: accepted (2026-10-06)

## Context

Etched Glass is the suite's only theme (docs/DESIGN_SYSTEM.md, CLAUDE.md). A
preset may remap `--gl-accent` and its own feature tokens and nothing else
(Insight's rule), so every feature reads as one product.

The Aegis Fallen campaign needs its combat to look like Aegis: a red halftone
"print through a monitor" surface, notch-cut plates, hazard tape, wide
industrial type. An accent remap alone gives "Etched Glass, but red", which is
not the campaign. Forking the suite theme would mean seventeen features each
carrying a second look.

## Decision

Two features, and only two, carry a **scoped skin**: the initiative rail and
Combat Intro, because they are one continuous moment (the cinematic hands off
into the rail).

- The skin is one world setting, `init.skin` (`etched` | `aegis`), owned by the
  initiative feature. Combat Intro reads it and never registers its own.
- It is applied as `data-gl-skin` on the rail's own roots and as `data-skin` on
  the `.glci` overlay. Every skinned rule is scoped under one of those
  attributes **on the feature's own root**. A skin never writes on `:root` and
  never uses a bare attribute selector.
- Inside the scope a skin may remap `--gl-accent`, the feature's own
  `--gluni-*` / `--glci-*` tokens, surface material and fonts. Values derived
  from the accent are struck with `color-mix()` off `var(--gl-accent)`, because
  `--gl-glow`, `--gl-bloom`, `--gl-accent-soft` and `--gl-accent-faint` resolve
  at `:root` and do not follow a scoped remap.
- Danger states (guard break, dying, peril) move to amber with a hazard hatch
  under Aegis, so they never share the skin's red accent.
- WebGL reads its palette from the skinned root, not from `:root`.

## Consequences

- No other feature gains a skin. A third skinned feature needs a new ADR.
- `tools/combat-intro-check.mjs` refuses a skinned rule outside a feature root,
  any `:root` write in the skin sheets, and a danger colour too close to the
  skin's accent.
- Aegis uses Google Sans Code and Google Sans Flex (wide), both already bundled.
  No new font is declared.
