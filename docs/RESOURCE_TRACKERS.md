# Resource Trackers

GM clocks, counters, points, pools, tasks and hazards on a dock over the map,
plus private trackers on a PF2e character sheet tab. The feature id is
`clocks-trackers`, a promoted sub-feature of `clocks-tracker` that runs without
the time engine (see the clocks-tracker section of `CLAUDE.md`).

## Files

| File | Job |
| --- | --- |
| `trackers/tracker-model.js` | Pure. Types, limits, sanitising, stepping, id repair, pool tally and verification. |
| `trackers/view.js` | Pure. What a row says (tone, tag, meter, cap, which controls) for one viewer. |
| `trackers/tracker-render.js` | Pure DOM. The keyed list, the shells, the menu, the pool card. |
| `trackers/pool-roll.js` | Rolls a pool (Dice So Nice, then the chat card). |
| `trackers/trackers.js` | The world store (`ct.trackers`) and pool result persistence. |
| `trackers/actor-trackers.js` | A sheet's store (`flags[SUITE_ID].ct.trackers` on the actor). |
| `apps/tracker-hud.js` | The dock. |
| `apps/tracker-sheet.js` | The PF2e sheet tab. |
| `apps/tracker-editor.js` | One dialog for create and edit, with a live sample row. |
| `styles/clocks-tracker-trackers.css` | The scoped skin (ADR 0004). |

## Types

| Type | Value | Meter | Notes |
| --- | --- | --- | --- |
| point | free, optional min and max | bar when it has a max | a counter |
| clock | 0 to slices | pie | `bad` turns it red and reads DOOM when full |
| pool | dice left (`current`) of `count` | pips | a roll drops every die at or under `discard` |
| task | 0 to boxes | cells | reads Completed when full |
| hazard | 0 to boxes | cells, red | reads Sprung when full |
| separator | none | none | a labelled divider |

## Rules that fail silently

- Ids are repaired on read, deterministically, by `normalizeList`. Every control
  resolves its tracker by id, so a missing or duplicated id would act on the
  wrong row. Read lists through the stores, never the setting or flag directly.
- Writes are queued per store (per actor UUID on a sheet). Two quick clicks that
  both read 3 would otherwise both write 4.
- A pool result is persisted by the responsible GM from the chat message, and
  only if the faces it carries fit the pool as it stands now
  (`verifyPoolResult`). The count is re-derived from the faces, never read from
  the message. A player's result counts only on a pool the GM opened to players.
- `trackersChanged` fires on every client once per real change, not only on the
  GM's.
- The sheet tab handles its own clicks. Foundry's `Tabs` must never receive its
  name, and leaving it is done by hand.
- Visibility is a presentation flag. The world setting reaches every client, so
  a hidden tracker is not a secret, and the editor says so.

## Controls

Click the value to step up, right-click it to step down (a pool refills). The
`-` and `+` tools step too, and the `⋯` button or a right-click on the row opens
the menu (edit, duplicate, promote, hide, clear, fill, refill, roll, delete).
Rows reorder by the grip. Keyboard: arrows or `+`/`-` step, Enter rolls a pool,
the context menu key or Shift+F10 opens the menu.

## Checks

```bash
node tools/resource-trackers-check.mjs
node tools/clocks-tracker-toggle-check.mjs
```

To see it: `node tools/trackers-preview.mjs && node tools/preview-server.mjs`,
then `/.preview/trackers.html?scene=gm|player|compact|sheet|editor|edit|card|empty`
(`&step=1` plays a change, `&live=1` keeps changing). The preview imports the
shipped model, view and renderer. Dice So Nice, the chat round trip, the sheet
tab inside a real PF2e sheet and the dock's saved position need a live session.
