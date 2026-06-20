# GLUniverse Suite

A single Foundry VTT module that bundles the entire GLUniverse module family behind
one installed package and one shared **Etched Glass** interface. Every module is a
**feature** you enable, disable and configure from one unified **Control Center** —
so you maintain one package, every setting is grouped by module in one place, and the
features integrate cleanly with each other.

> Compatibility: Foundry VTT **v13+** (verified v14).

## Features

Open **Game Settings → Configure Settings → GLUniverse Suite → Open Control Center**.
Each feature is a section with its enable toggle, its own settings, and buttons to its
specialized editors. Features that need a specific game system or companion feature
stay locked until that requirement is met. (The suite hides its settings from Foundry's
flat native list — the Control Center is the single place to configure everything.)

| Feature | System | Notes |
|---|---|---|
| **Clocks & Tracker** *(core, always on)* | any | Core engine: in-game calendar & time HUD. |
| **Resource Trackers** | any (needs Clocks & Tracker) | GM-managed clocks, points, pools and hazard trackers in a dockable HUD. |
| **Weather** | any (needs Clocks & Tracker) | Hex Flower weather engine with a calendar-driven forecast. |
| **Mission Support** | any (needs Clocks & Tracker) | Support-NPC roster and the Comms-Coin HUD. |
| **Delving Mode** | any (needs Clocks & Tracker) | Turn-driven dungeon delve with a degrading resource HUD. |
| **Initiative** | any | Cinematic initiative overlay with condition badges, turn/start markers, guard-break gauges. |
| **Flatfinder** | PF2e | Off-guard / competence surfacing, incapacitation, Apex boss support. Ships a Flatfinder compendium. |
| **Destiny Dice** | PF2e | Cinematic Destiny/Fate die for checks & rerolls (Dice So Nice optional). |
| **Insight** | any | Passive, broadcastable on-screen notifications. |
| **Stage** | any | Visual-novel presenter: portraits, dialogue, comms overlays. |
| **Stream Pacer** | any | Pacing HUD: countdowns, spotlight, hand-raise, peril cues. |
| **PF2e Stat Block Importer** | PF2e | Import NPCs & hazards from pasted stat-block text. |
| **Loot Generator** | PF2e / D&D 5e | System-aware loot generation with audited treasure proposals. |
| **Cargo Grid** | any | Polyomino cargo-packing board. |
| **Tidy 5e Inventory Slots** | D&D 5e + `tidy5e-sheet` | Slot encumbrance and wear-and-tear for the Tidy 5e sheet. |
| **Flatten Proficiency** | PF2e | Proficiency Without Level variant automation. |
| **Critical** | PF2e / D&D 5e | JRPG-style cinematic critical-hit / critical-success animations. |

## Migrating from the standalone modules

If you previously installed the individual GLUniverse modules, the suite imports their
settings (and key document flags) automatically the first time a GM loads a world.
You can then uninstall the standalone modules. The import runs once and never
overwrites a value you've already changed in the suite.

## Architecture

The suite is one package (`gluniverse-foundry-modules`); each former module lives under
`scripts/features/<id>/` and registers itself with a small core framework:

- **`scripts/core/registry.mjs`** — feature definitions, system/dependency
  auto-gating, and enable/disable resolution (core-on, everything else opt-in).
- **`scripts/core/socket.mjs`** — one multiplexed socket channel shared by all
  features (payloads tagged per feature), since only the installed package id routes.
- **`scripts/core/settings.mjs` + `suite-config-app.mjs`** — the Feature Manager UI.
- **`scripts/core/migration.mjs`** — one-time import from the standalone modules.
- **`styles/gl-tokens.css`** — the canonical Etched Glass design system (tokens,
  keyframes, glass/button utilities) shared by every feature. Respects
  `prefers-reduced-motion`.

Because a Foundry package may only register settings/flags/sockets under its own id,
each feature's settings and flags are namespaced onto `gluniverse-foundry-modules` with a
per-feature key prefix (`ct.`, `init.`, `ff.`, …). See
[`docs/FEATURE_CONTRACT.md`](docs/FEATURE_CONTRACT.md) for the full porting contract.

## Credits

GLUniverse. Built on the work of the individual GLUniverse modules, now unified.
