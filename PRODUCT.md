# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A tabletop game master and their players, using one Foundry VTT world together. The
GM runs the game from panels, editors and HUDs; players act and read from their own
screens. Both count equally: a player-facing overlay (initiative rail, Insight card,
Stream Pacer band, Creaturedex) is judged as hard as a GM tool. A third audience is
the stream: a dedicated capture login (Stream Client) is recorded and watched by
viewers, so anything it draws is seen by people who are not at the table.

The suite is built for the author's own table, not a public release. Copy and
onboarding can assume the people using it already know the features.

## Product Purpose

GLUniverse Suite is one Foundry VTT module (v13+, verified v14) that bundles ~17
former standalone modules as switchable features behind one shared interface,
configured from one Control Center. It exists so one person maintains one package,
and so every feature looks and behaves like part of one product.

## Positioning

Cinematic, broadcast-grade table tools that keep secrets. Every feature decides who
may see what (GM, owning player, other players, the stream login) and draws only that,
while still playing like a game UI rather than a settings form.

## Operating Context

- Runs inside Foundry VTT's own window: ApplicationV2 windows, the canvas (PIXI and
  WebGL), sidebars, chat cards, token HUDs, and full-screen overlays. Foundry's own
  styles and Interface Scale sit around every surface.
- Played live, often on a big shared screen or captured in OBS at 1080p. Some
  overlays exist to be read at a glance mid-scene.
- Systems: PF2e first, also D&D 5e and the author's own Daggerheart system. Many
  features are system-gated.
- Every feature has a pure preview page under `tools/*-preview.mjs`, served with
  `node tools/preview-server.mjs` at `/.preview/<page>.html`. Those are where UI is
  looked at outside a live world, and what `impeccable detect <url>` should scan.
  A live Foundry desktop app can be scanned with `detect --cdp <port>`.

## Capabilities and Constraints

- No build step, bundler or framework. Native ES modules, Handlebars templates,
  plain CSS, markup often built as strings in pure view modules.
- The visual system is fixed and enforced: see DESIGN.md. Refinement preserves it;
  no command may introduce a new palette, font or token outside it.
- Motion always plays. The suite deliberately ignores the OS
  `prefers-reduced-motion`; never add that media query or check. Some features
  have an in-app motion tier, which is an explicit user choice.
- Privacy is a feature, not a detail. A change that makes hidden data visible to a
  player or the stream login is a bug however good it looks.
- Every feature has a check tool (`node tools/<feature>-check.mjs`) that must still
  pass after a UI change. CLAUDE.md lists them and what they pin.
- All UI strings go through `game.i18n`; keep each feature's key namespace.

## Evidence on Hand

- Per-feature design docs in `docs/` (e.g. `docs/CREATUREDEX.md`,
  `docs/STREAM_PACER.md`) and decision records in `docs/adr/`.
- Preview pages for nearly every feature (see CLAUDE.md for the commands).
- No public users, testimonials or usage data. Do not invent any.

## Product Principles

1. The table's secrets are kept. Who sees what is decided once and honoured on
   every surface.
2. One product. A feature looks like the suite, or like its documented scoped skin.
3. Read at a glance. Live play and a stream leave no time for squinting.
4. Cinematic where it is a moment, quiet where it is a tool.
5. The GM is never surprised: nothing changes the game without the GM seeing it.
