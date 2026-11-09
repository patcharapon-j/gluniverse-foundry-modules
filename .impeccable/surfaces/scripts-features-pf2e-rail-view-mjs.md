---
version: 1
slug: "scripts-features-pf2e-rail-view-mjs"
primary_target: "scripts/features/pf2e-rail/view.mjs"
related_targets: ["styles/pf2e-rail.css", "scripts/features/pf2e-rail/drive.mjs", "tools/pf2e-rail-preview.mjs"]
---

# Surface: the PF2e HUD bottom rail (player and GM)

Mode: Operate (a game HUD played live). Code-led. Design-only phase; Foundry wiring follows.

## Brief
- Audience: PF2e players running one character (sometimes a companion), and the GM running creatures and hazards; live, often streamed at 1080p.
- Job: play a PF2e turn without the sheet. Read state at a glance; strike, cast, use skill actions, spend Hero Points, raise a shield from the bar.
- Constraints: 112px rail (four rows of presses), never taller (only the figure, held cards and raised panels rise above it); nothing under 11px; every control sizes itself; Ink and Signal scoped to `.gph` (ADR 0013); motion from `--gl-d-*`/`--gl-ease*`, no reduced-motion query; who-sees-what decided by the host before the model reaches the view.
- Pinned by the user (grilling + evolution round): suite feature `pf2e-rail` replacing pf2e-hud; plinth + party seats; Hero Points as light; vitals and strikes always visible; one tabbed deck (Spells · Actions · Skills · Items); local action pips and next-MAP marker; encounter/exploration morph; roll echo; skill actions as the hero feature, grouped by skill in compact one-line chips with game-icons.net pictures (user, 2026-11-09). Started from the Daggerheart rail, explicitly not bound to it.

## Direction contract
THESIS: A PF2e turn is three actions and a reaction, so the rail is built around the action economy, not around a sheet: a black instrument rail where the character stands on the plinth, the actions you have left burn on the rail's edge, and every press is the exact thing PF2e would do. It refuses the MMO grid of equal slot squares and the sheet-in-a-sidebar of pf2e-hud: every region has the shape of what it holds.
OWN-WORLD: Ink and Signal (ink-1 plates, inset hairlines, bottom-right cut, Google Sans Flex at 11/12/13/15/22, Bahnschrift numerals). Signals: amber = Hero Points and their light only; red = danger (low HP, dying, broken, hostile); green = friendly, success; info = temp HP; paper = active/selected/your turn. PF2e's action diamonds are the one recurring mark.
STORY: A player glances down: HP, AC, how many actions are left and which MAP step is next. They type "tri", see Trip vs the target's Reflex with its odds, press Enter; the button flips to the result. The GM sees the party as rings and a creature as AC, saves and moves.
FIRST VIEWPORT: Bottom-left plinth with a cut-out figure rising ~76px, amber halo behind it; vitals (AC tile, HP numeral + bar, shield press, four checks); strikes (rows of MAP presses with the next step underlined); the deck (vertical tabs, then the tab's content: fanned spell cards by rank, action rows, the skill finder field with suggested actions, item tiles); a slim utility column. In an encounter, a turn bar rides the top edge over strikes and deck: ◆◆◆ ↺, MAP step, your turn.
FORM: Instrument rail, user-pinned. seed: 5d5c4dbf0d2fc1f0 rolled for surface/operate, not taken: composition was fixed by the user in the grilling and evolution rounds.
SIGNATURE: Hero Points as light, plus the turn ignition: at your turn the rail's top edge sweeps paper and the action diamonds light one by one; each costed press drains its diamonds.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
