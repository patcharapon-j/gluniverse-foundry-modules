# Hexcrawl

A system-agnostic hexcrawl map for Foundry: a normal Scene switched into
"hexcrawl" mode, drawn as Etched Glass terrain tiles over Foundry's own hex
grid, with regions, terrain ratings, landmarks, a party token that walks hex to
hex, fog of war with a sight radius, and GM reveal / mask / hide. The procedure
it follows is *Journey to Horizon* (Daggerheart, *Hope and Fear* pp. 169–179),
reduced to its generic structure: the automation stops at "here is what the
book would have you roll"; the GM decides everything else.

Feature id `hexcrawl`, settings prefix `hex.`, i18n namespace `GLHEX.*`, CSS
prefix `glhex-`. Off by default.

## Internal contracts (binding for everyone editing this feature)

### Pure modules — importable under plain Node and a bare browser page

| file | owns |
|---|---|
| `constants.mjs` | ids, flag/setting keys, states, mask presets, built-in terrains, glyph ids, defaults, `TIMING` |
| `hex-math.mjs` | offset keys `"i,j"`, cube maths, `range/unionRange/line/boundaryEdges`, `pureAdapter`, `foundryAdapter` |
| `model.mjs` | MapData shape + normalisation, resolution (`effective*`), `viewFor` (the viewer question), patches, `brushPatch`, `autoRevealPatch`, `stateDiff` |
| `glyphs.mjs` | terrain glyph path data, `drawGlyph(g, id, x, y, scale)` |
| `render/*.mjs` | the renderer — takes PIXI and an adapter by injection, never reads `game`/`canvas`/`foundry` |

None of these may reference `game`, `canvas`, `foundry`, `ui` or `Hooks` at
module scope or anywhere reachable from the renderer. The preview page drives
the shipped renderer; the moment it reads the world, the preview has to
reimplement it and flatters whichever copy was touched last.

### Addressing

Every hex is its Foundry grid **offset key** `"i,j"` (row, column). In Foundry,
pixels ↔ offsets ↔ cubes always go through `foundryAdapter(canvas.grid,
canvas.dimensions.sceneRect)` — Foundry's HexagonalGrid is the only authority
on where a token snaps, and our own layout maths must never be the thing that
disagrees with it. `pureAdapter` exists for the preview and check tool only.
Changing a scene's grid type re-addresses every hex; the scene config warns.

### Storage

- Scene `flags[SUITE_ID].hex.enabled` — Boolean.
- Scene `flags[SUITE_ID].hex.map` — MapData (see `model.mjs` header).
- Scene `flags[SUITE_ID].hex.moves` — MoveRecord[] newest last, capped at 20:
  `{ id, token, from, to, cost, seconds, visited: [keys newly marked visited], trail: [keys], at, advanced, leg }`
  (`cost` in the scene's unit; `advanced` — world time was advanced by `seconds`, so undo rewinds it;
  `leg` — the journey-leg id current when the move was made).
- Scene `flags[SUITE_ID].hex.leg` — the current journey-leg id (the arrival card's "New leg"); absent = `"0"`.
- Token `flags[SUITE_ID].hex.party` — `{ on: true, sight: number|null }`.
- ChatMessage `flags[SUITE_ID].hex.card` — `{ kind: "arrival"|"encounter", … }` on the arrival card and its roll.

Only a GM client writes the scene flags (the **active GM**, `game.users.activeGM`,
for anything triggered by a token move, so two GMs never both write). Players
never write them: a player's move is a Token update that Foundry already
permission-checks; the active GM reacts to it. Hex edits are written as
dotted-path updates so a one-hex edit does not rewrite a 2,400-hex object —
through `store.mjs` `hexPatchUpdate()` / `forceSet()` / `forceDelete()`, which
write every value as a FORCED replacement (v14 `foundry.data.operators`, v13
`==key` / `-=key`). A plain nested update MERGES: a hex that loses `bl` would
keep it forever. `model.mjs` `patchToUpdate()` predates this and must not be used
for writes. Read the value back off the document — never trust the
`updateScene` change diff for its shape.

### The store (`store.mjs`, runtime) — what apps and input talk to

```js
import { HexStore } from "./store.mjs";
const store = HexStore.current;   // null unless the viewed scene is a hexcrawl
store.scene            // Scene
store.map              // normalized MapData (read-only; replace via methods)
store.adapter          // foundryAdapter for the current canvas
await store.applyPatch(patch, { undoable = true, label })   // hex patch (model.mjs)
await store.setRegion(id, data)        // create/replace; returns id (newId("r") when id null)
await store.deleteRegion(id)           // also strips rg from its hexes
await store.setTerrain(id, data)       // custom terrain create/replace
await store.deleteTerrain(id)
await store.setConfig(partial, { presets })  // merged + normalized; presets (optional) REPLACE map.presets, same write + undo step
await store.undo()                     // GM edit history (in-memory, per session)
store.brush            // { tool, value, stage: boolean } — the palette writes it
store.staged           // Set<key> — hexes marked for a staged reveal (GM client only)
await store.commitStaged()             // reveal all staged hexes at once
store.viewAsPlayers    // boolean, GM client only
store.setViewAsPlayers(bool)
store.on("change", fn) / store.off("change", fn)   // fires after any map/brush/staged/view change
// additions beyond the original contract:
store.baseMap          // the STORED map; brushes compute against this, never the preview
store.setBrush(partial)                // merge into brush, emits change {kind:"brush"}
store.setPaletteOpen(bool) / store.paletteOpen   // the palette reports itself; input reads it
store.stage(keys) / unstage(keys) / clearStaged()
store.previewPatch(patch|null)         // local paint preview (store.map shows it; nothing written)
store.brushPatchFor(keys, brush?)      // brushPatch against baseMap
store.canUndo
```

Listeners receive `(store, detail)`; `detail.kind` is one of `scene` (a scene
update: `detail.map`, `detail.moves`, `detail.prev`, `detail.diff` = `stateDiff`),
`brush`, `view`, `palette`, `staged`, `preview`.

`HexStore.current` changes with the viewed scene; listen with
`Hooks.on("glhex.storeChanged", (store|null) => …)` (hook name exported as
`HOOK_STORE_CHANGED` from `store.mjs`; the apps restate the literal).

### The renderer (`render/renderer.mjs`)

```js
import { HexRenderer } from "./render/renderer.mjs";
const r = new HexRenderer({ PIXI, adapter, keys, loadTexture, resolveIcon, palette });
//   keys        — iterable of every in-bounds offset key (the drawable grid)
//   loadTexture — async (src) => PIXI.Texture   (Foundry: foundry.canvas.loadTexture)
//   resolveIcon — (faClass) => { char, fontFamily, fontWeight } | null
//   palette     — core/theme.mjs PALETTE (or a mirror in the preview)
parent.addChild(r.root);                 // r.root is a PIXI.Container
r.setMap(map, { asGM, viewAsPlayers, animate: true });  // diff → animations
r.setParty([{ key, sight }]);            // sight boundary + current-hex marker
r.setTrail(keys);                        // dotted visited trail (ordered)
r.setStaged(setOfKeys);                  // GM-only staged outlines
r.setHover(key | null);                  // hover highlight
r.setZoom(scale);                        // hairlines in device px; pip LOD
r.setMotionScale(k);                     // 0 = no motion, 1 = full
r.update(dtMs);                          // called every frame by the host
r.destroy();
```

The renderer never decides visibility itself — it asks `viewFor(map, key,
{ asGM })`. With `asGM && !viewAsPlayers` it draws everything and hatches what
players cannot see; otherwise it draws exactly the player view.

## Rendering decisions (from the design review)

- Tiles: **Etched glass**, **fused by region** (review 2: *twin rims*) — dark
  glass tinted by terrain with a bright terrain glyph. Hexes of one region join
  into one shape: interior edges are a faint seam (dashed while masked), and
  only boundary edges — another region, fog, the map edge — get a dark channel
  and the region's rim, in the region's colour (neutral on a silhouette; the
  terrain's lit colour when the region has none). So two regions of the same
  habitat side by side, or two silhouettes, still read as two shapes. A masked
  hex that withholds its region is its own island. Geometry: `template.mjs`
  `fused(mask)`, where a rim leaving one hex meets its neighbour's exactly
  (pinned by the check); the boundary mask is part of each hex's signature, so
  a region change next door redraws it.
- Art (review 3): terrain icons are **images** (`assets/hexcrawl/icons/<id>.webp`,
  white on transparency, tinted per terrain, embossed with a halo, drop shadow
  and highlight so they sit ON a textured ground); the vector glyph is only the
  fallback while an icon is missing or failed. A region may carry a **ground
  texture** (`fit`: one image over the region's whole bounding box, stable as
  hexes reveal; `tile`: repeated; `pixel`: nearest-neighbour for pixel art),
  shown through the glass by `config.texStrength`. Region icon variants exist
  in the model but are not the default: landmarks carry points of interest, the
  hex icon says what KIND of ground it is. Art follows `visualFor()` — nothing
  unless the terrain shows, region art only when the region does.
- Blight is its own layer: one Mesh + shader (`render/blight.mjs`) over every
  blighted hex body — crawling pixel-snapped violet veins with an edge glow,
  above the ground and fill, beneath icons. Not a filter (no resolution trap).
- Region names: a region's name reaches players only once the GM ticks
  *Name known to players* (`region.nk`); until then `viewFor` returns
  `nameUnknown` and the label and tooltip print **???**.
- Sight: hexes in sight rise to `config.sightState`; when masked, they use the
  reserved preset `"sight"`, resolved live from `config.sightFields` (default:
  region shape, terrain, difficulty, name). Mask presets are the map's own
  (`map.presets`, seeded from `MASK_PRESETS`), edited in scene settings; a hex
  on a deleted preset falls back to the sight checklist.
- Fog: **Uncharted** — a hidden hex is blank ink with a dashed survey outline
  and a faint "?" in the region-label face (one rasterised Text shared by a
  Sprite per fog hex, not text per hex). A reveal draws the outline in, then the terrain inks in,
  sweeping outward from the party.
- Masked: tile dimmed, withheld rating shown as a dashed "?" diamond.
- Rating pips: **count only**, drawn per hex only where the hex overrides its
  region, or when zoomed past `PIP_ZOOM_THRESHOLD`, or when the scene's
  "always show pips" is on.
- Region label: **two-tier** — the name in spaced caps, terrain and rating
  pips beneath, placed once per region at the hex nearest its centroid.
- Landmark: **diamond badge** with the Font Awesome icon (or image) and a label.
- Party: **sight boundary** — a dashed outline around the union of the party's
  sight ranges, and a solid outline on the occupied hex.
- Blight: **violet veins** pulsing slowly over a violet-leaned tile.
- GM view of hidden/masked hexes: **hatched**.

## Runtime layout (`main.mjs` and friends)

| file | owns |
|---|---|
| `index.mjs` | `Suite.register` + the three settings; nothing at import time |
| `main.mjs` | every hook; attach/detach on `canvasReady` / `canvasTearDown` / enable-flag change |
| `store.mjs` | `HexStore`, forced-replacement update builders, `HOOK_STORE_CHANGED` |
| `host.mjs` | mounts `HexRenderer` in `canvas.primary` and feeds it; `resolveIcon` (DOM) |
| `input.mjs` | GM paint capture (canvas.interface), right-click → hex editor, `isPaletteOpen()` |
| `tooltip.mjs` | the hover/pinned tooltip (every client) |
| `party.mjs` | party-token flag, document-centre → hex key |
| `movement.mjs` | movement rules, travel, auto-reveal, move undo, journey legs |
| `arrival.mjs` | the arrival card and its encounter roll |
| `hud.mjs` / `controls.mjs` | token HUD buttons; scene controls + the Ctrl+Z keybinding |
| `scene-setup.mjs` | `createHexcrawlScene`, `enableHexcrawl`, `disableHexcrawl`, the scene dialog |
| `sounds.mjs` | reveal / step playback (`tools/gen-hexcrawl-sounds.mjs` writes the WAVs) |

**Mounting.** The renderer's root goes into a container in `canvas.primary` with
`sortLayer = SORT_LAYERS.TILES - 1` and the scene background's `elevation`:
above the background, beneath tiles, drawings and tokens (the primary group
sorts by elevation → sortLayer → sort). `canvas.interface` would draw the map
over the token art. The paint capture is the opposite: it must sit ABOVE the
token layer's hit-testing, so it lives in `canvas.interface` at a high zIndex.

## Usage (GM)

1. Enable **Hexcrawl** in the Control Center (reload).
2. Suite scene-control group → **Hexcrawl scene**: *Create scene* (cols × rows,
   hex size, flat- or pointy-top), *Import from JSON…* (format:
   [`HEXCRAWL_IMPORT.md`](HEXCRAWL_IMPORT.md), parsed by `import.mjs`), or
   *Enable / Disable on this scene* for an existing hex-grid scene (square and
   gridless scenes are refused). Disabling keeps the map; enabling restores it.
   A created scene has token vision and fog exploration off.
3. **Hexcrawl palette** (only on a hexcrawl scene): pick a brush and drag over
   hexes. One stroke = one write = one undo step (Ctrl+Z while the palette is
   open). Right-click any hex with the palette open → hex editor. With
   *stage* on and the reveal brush, strokes mark hexes for a staged reveal that
   the palette commits in one go.
4. Drop a token, open its HUD → **Party token** (right-click that button to
   override its sight radius). Everything within sight rises to the scene's
   sight state (masked with the sight checklist, or revealed); the hex it
   stands on is revealed and visited. Mask presets and the sight checklist
   are in the palette's scene settings.
5. Hover a hex for its tooltip; click to pin it (Esc or a click elsewhere
   unpins). GMs see a violet GM-only block; "view as players" hides it.

## Procedure mapping (Journey to Horizon, *Hope and Fear* pp. 169–179)

| book | here |
|---|---|
| Habitats, Shadowblighted | built-in terrains; blight is an overlay on the habitat |
| Terrain rating 1–4 (Optimal…Extreme) | region `rt`, per-hex override; pips |
| Travel time 1/2/3/4 days | `config.cost` table (+ per-hex override, any unit) |
| "roll rating-many d6, a 1 triggers" | `config.dice` → arrival card's roll button (dice ≤ trigger highlighted) |
| Sight: current + adjacent | `config.sight` (0–6), per-token override |
| Rumours (true / partly / false) | region rumour + truth + "known" |
| Hidden points of interest | landmarks with visibility `hidden` |

The automation stops at "here is what the book would have you roll". Nothing
applies an encounter, a consequence or a rule.

## Settings

| key | scope | what |
|---|---|---|
| `hex.sounds` | world | reveal whoosh + step sound on/off for everyone |
| `hex.volume` | client | 0–1 |
| `hex.tooltipDelay` | client | ms before the hover tooltip opens (default `TIMING.tooltipDelay`) |

Per-scene options (sight, sight state and checklist, mask presets, render mode, pips, trail, players
may move, dice, cost, advance time, arrival card) live in the map's `config`
and are edited in the palette's scene settings.

## Movement rules

- **Players** (on the moving client, `preUpdateToken`): refused outright when
  the scene's *players may move* is off; otherwise the destination must be on
  the map and at most one hex away. Snapping is Foundry's.
- **GM**: a drag is a *reposition* (reveal, no time, no record); hold **Alt**
  while dropping to make it *travel*.
- **Travel** (active GM only): reveal around every party token; cost = the
  entered hex's travel cost; if *advance time* is on **and** the Clocks &
  Tracker engine is enabled, `game.time.advance(seconds)`; a MoveRecord is
  pushed (cap 20); with *arrival card* on, the card is whispered to GMs.
- **Undo last move** (token HUD, when the last record is this token's): moves
  the token back, rewinds the time it advanced, clears the `vs` marks that move
  added. It NEVER re-hides anything — what the party saw stays seen.
- **Journey leg**: the card's *This leg* is the sum of recorded moves with the
  current leg id; *New leg* starts another. Bounded by the 20-move history.

## Known limitations

- **Scene flags are readable by every client.** A player with the console open
  can read the whole map, hidden hexes and GM notes included — exactly as they
  can read a hidden Tile or Note. `viewFor()` decides what is *drawn*; it is
  not a secrecy boundary. Keep true secrets in GM-only journals.
- The move history is 20 records; undo and leg totals cannot reach past it.
- The GM paint capture and right-click use the palette's reported open state
  (`store.setPaletteOpen`); a stale report leaves the capture mounted until
  the next app render/close re-syncs it.

## Verification

```bash
node tools/hexcrawl-check.mjs
node tools/gen-hexcrawl-sounds.mjs --check
node tools/hexcrawl-preview.mjs --out=.preview/hexcrawl.html && node tools/preview-server.mjs
```

The check drives hex-math, model (viewer question, auto-reveal, brushes,
costs), glyphs, the import round trip, and the runtime store against a fake
Scene that MERGES plain nested updates the way Foundry does — which is what
proves every write is a forced replacement and that undo unwinds to the exact
starting map. Nothing here can prove the canvas layering, the token-move
pipeline or the chat card; those need a live session.
