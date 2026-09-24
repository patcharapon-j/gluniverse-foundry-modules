# Performance

The `perf` feature makes Foundry and the suite cheaper to run on every machine
at the table. It is **on by default** and its default tier, Balanced, is defined
as "no visible change". It **never writes a Foundry setting**: everything it does
to Foundry is an override applied at runtime, so choosing Quality, or switching
the feature off, leaves Foundry exactly as each user configured it. That holds
on the next load too, because nothing was stored.

Validation: `node tools/perf-check.mjs` (zero problems) and
`node tools/perf-bench.mjs`. Only a live session proves the patches (see the end
of this file).

## The pieces

| Where | What |
|---|---|
| `scripts/core/budget.mjs` | The one frame clock. Every shedding feature binds its `SHED_ORDER` with `Budget.ladder()`. Works with the feature off (the shipped 22/15 ms policy); the feature only changes the policy. |
| `scripts/core/gl-surfaces.mjs` | Pause/release lifecycle for the suite's own WebGL contexts. |
| `scripts/core/pan.mjs` | `coalescePan()`: one `canvasPan` pass per frame. |
| `features/perf/tiers.mjs` | The tier table and how a client's tier is resolved. |
| `features/perf/governor.mjs` | Auto. |
| `features/perf/runtime.mjs` | Resolution, the policy push, the work bracket. |
| `features/perf/patches.mjs` | The core-patch registry. |
| `features/perf/canvas.mjs` | Performance mode, resolution, sight throttle, idle rate, texture loading. |
| `features/perf/ui.mjs` | Render merging, directory batching, chat trimming. |
| `features/perf/ambient.mjs` | Glass level, ambient loops, zoom blur. |
| `features/perf/overlay.mjs`, `report.mjs` | The overlay, the 30 s benchmark, GM report pulls. |
| `features/perf/floor-app.mjs`, `audit-app.mjs` | The GM's floor sheet and texture audit. |

## Tiers

Ordered best to cheapest. Every row states every field (`perf-check` refuses a
gap) and every field only gets cheaper down the table.

| | Quality | Balanced (default) | Performance | Potato |
|---|---|---|---|---|
| Foundry performance mode | yours | yours | yours | Low |
| Canvas resolution | yours | yours | 0.75 × DPR (≥ 1) | 1.0 |
| Idle canvas rate | off | 20 fps | 15 fps | 10 fps |
| Sight during a move | every frame | every 3rd frame | once, on landing | once, on landing |
| Suite shed floor | 0 | 0 | 1 | everything |
| Supersample start | 2× | 2× | 1.5× | 1× |
| Glass (`data-gl-perf`) | full | full | light | none |
| Ambient loops | always | held while panning / hidden | held while panning / hidden | off |
| Soft-shadow blur while zooming | on | on | off | off |
| Idle WebGL context released after | 60 s | 60 s | 30 s | 10 s |

**Balanced promises no visible change**, and three rules keep that true. The
idle rate drop never applies to a scene that moves on its own: weather, an
animated light, a video, or a suite feature that claims continuous motion with
`Budget.claimMotion()` (resource bars and PF2e areas do while they tick). Sight
at one frame in three during a short move is below what anyone can see. And a
paused ambient loop only pauses for the ~150 ms of a pan.

**The floor** is the best tier a machine may run, set by the GM in the floor
sheet. A per-user row replaces the world floor for that user, in either
direction. A player can always choose something cheaper.

**Capture clients** never pause on hidden. An OBS browser source is
`document.hidden` while it records. The stream feature's own capture login
(`stream.streamUserId`) counts as one automatically.

**Auto** moves between Balanced and Potato. It steps down after about 2 s of
p95 frame intervals over budget × 1.2, and steps up after about 10 s of p95
canvas work under budget × 0.7. It never steps above the floor and waits 3 s
after any change or scene load. Frame intervals can say "too slow" but never
"there is headroom", because at the display's refresh rate every interval is
~16.7 ms however little work the frame did. That is why up is judged on work,
bracketed on the PIXI ticker. Auto only moves fields that are cheap to change
live (`LIVE_FIELDS`). Performance mode and resolution force a redraw, so under
Auto they stay at the floor-clamped Balanced.

## Core patches

Four wraps of Foundry methods, each earning its place three times before it
installs:

1. **Generation.** It is written for v14 (`VERIFIED_GENERATIONS`). On anything
   else it stays off and says "Unsupported Foundry version".
2. **Integrity.** Each names a fragment of the pristine method's source
   (`signature`). If the method at the target no longer contains it, then either
   core changed it or another module replaced it. In both cases it stays off
   with "Conflict". libWrapper conflicts reported at call time switch it off too.
3. **Switches.** A world switch (the GM's one-click kill) and a client switch,
   both read on every call.

| Patch | Target | What it does |
|---|---|---|
| `perfMode` | `Canvas#_configurePerformanceMode` + the `canvasConfig` hook | Caps the mode and sets the resolution. Applies at the next scene draw (`canvasInit`, before blur and textures initialise), never live. |
| `visionThrottle` | `Token#initializeSources` | A token mid-animation initialises every Nth call, or once when its move lands. A ticker flush runs the final call through the wrapper, which lets it pass now that nothing is animating. The final position is always exactly Foundry's. |
| `appRender` | `ApplicationV2#render` | Calls that arrive while a render is in flight collapse into one trailing render with merged options. `force` is sticky, `parts` are unioned, a full render wins. Every caller's promise resolves after a render that includes its change. |
| `directoryDebounce` | `DocumentCollection#render` | Leading call immediate. Calls within 120 ms after it collapse into one trailing render. |

Three more interventions use only public API and still get switches:
`idleFps` (`ticker.maxFPS`), `textureLoad` (`loadTexturesOptions.maxConcurrent`,
`TextureLoader.pinSource`, the GM's opt-in navigation preload) and `chatPrune`
(`ChatLog#deleteMessage`, the UI-only removal Foundry uses itself, oldest first
so its "oldest rendered" pointer stays exact).

## Suite surfaces

`Surfaces.register({ id, element, pause, resume, release, restore })` for every
WebGL context a feature owns. The feature calls `use()` before each draw: that
rebuilds a released context and returns false while the surface is off-screen or
the page is hidden under policy. `perf-check` requires a registration in every
feature folder that creates a context. Registered today: initiative (break
splash, card FX), stage postfx, stream-pacer campfire and peril, arcane-surge
beats, critical.

## What was measured (scratch v14 world, stub system)

- **Sight throttle**, 400 walls, one vision token, one move: Quality 108 source
  initialisations in 126 frames, Balanced 49 in 167, Performance 1. The final
  sight position equalled the token's in every tier.
- **Render merging**: 6 overlapping `render()` calls → 2 renders. 6 awaited → 6.
- **Directory batching**: 10 separate creates → 2 directory renders, all listed.
- **Chat trimming**: 302 rendered → 200. Scrolling up restores 300 in unbroken
  order, and the database is untouched.
- **Potato** on a High / 2× machine: Low, 1×, blur off. Back to Quality: High,
  2×. `core.performanceMode` was never written.

## Live-session checklist

What no tool here can prove, and what to try after touching the patches:

1. Open a PF2e sheet and apply damage with several effects. The sheet must end
   in the right state.
2. Move a token across a walled scene at Balanced and Performance. Fog must end
   exactly where it does at Quality.
3. Switch Potato mid-scene, then change scene. The overlay's "Overriding
   Foundry" list must show Low and 1×. Switch back and change scene again.
4. Leave a scene with an animated torch idle at Balanced. The rate must stay at
   60, because the scene moves on its own.
5. With a capture login marked in the floor sheet, hide its window. Its ambient
   loops must keep running.
