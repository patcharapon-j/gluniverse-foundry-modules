# GLUniverse Stream

Three suite features, ported from the standalone `gluniverse-stream` module.

| Feature | Prefix | Requires | System |
|---|---|---|---|
| **Stream Client** (`stream`) | `stream.` | — | any |
| **Stream Roll Cards** (`stream-cards`) | `stream.card` | `stream` | pf2e |
| **Targeting Lines** (`stream-targets`) | `tgt.` | — | any |

All three ship disabled.

## Why three

The standalone module was one package doing three separable jobs.

**Stream Client** is the capture rig: a dedicated login that hides Foundry's UI,
frames the canvas camera, and renders chat and presentation overlays for OBS or
a browser capture. A control panel drives the live shot.

**Stream Roll Cards** genuinely cannot run alone — the cards render *into* the
stream overlay — so it is a nested sub-feature, gated with `requiresFeature` and
grouped beneath its parent in the Control Center. It also carries the 12 MB
MediaPipe face detector, which only a table that wants framed portraits on a
stream should pay attention to.

**Targeting Lines** is the one that surprised us. The arcs draw on *every*
client that can see both tokens — there is a per-player toggle and an audience
setting — so a table with no capture login still wants them. Burying combat VFX
behind an OBS rig would hide the part of this module most tables would use, so
it is a sibling with its own prefix, its own settings and its own editor.

## Setup

1. Enable **Stream Client** in the GLUniverse Suite control centre.
2. Open the suite's scene-control group and launch **Stream Control Room**.
3. Pick the dedicated stream user under **Stream user** (GM only).
4. Log in as that user in the capture browser or OBS.
5. Accept the startup prompt, or choose **Always Enter Stream Mode**.

`Ctrl+Alt+S` restores normal Foundry UI on the stream client — the panic button
for a capture login whose interface is hidden.

## Directors

A GM may appoint trusted players as directors, so a co-host can run the camera,
chat and overlays from their own login.

**Two settings are never delegated.** `streamUserId` and
`trustedDirectorUserIds` decide *who the feature answers to*; that is world
administration, not directing, and they stay GM-only. Everything else a director
touches — camera, chat, dialogs, UI rules, auto-start — is delegable.

A director's writes travel on a channel Foundry's **server** polices: the
request is recorded as a flag on the requester's own User document, and a GM
sees `updateUser` and performs the write, re-deriving the author from the
document rather than reading an id out of the payload. Commands (start, stop,
restore, reframe) use the same channel.

If Foundry refuses a non-GM writing their own flag, delegation reports
unavailable and the panel goes read-only for non-GMs. The failure mode is
"trusted directors do not work", never "trusted directors work insecurely".

## Camera modes

- **Manual/free** — does not move the stream camera.
- **Scene/full background** — fits or fills the scene background.
- **Tracked token(s)** — follows tokens tracked by hand from the token HUD.
- **Party only** — visible player-owned tokens, plus tracked ones.
- **Visible combatants** — visible combatants, plus tracked ones.
- **Active turn only** — only the combatant whose turn it is.
- **Spotlight active token** — in combat, centres the active token at a fixed
  zoom, widening only as far as **Min zoom** to hold its targets.

**Pan speed** is grid squares per second and applies to every mode.
**Travel zoom-out** (spotlight only) is how far a flight zooms out when the
spotlight crosses the map; 1 turns flights off. Moves blend — a destination that
changes mid-flight redirects rather than restarting.

The camera never interferes with token movement: it reacts to committed updates
only and stays off the canvas during a drag or ruler.

## Targeting lines

An arc from the combatant whose turn it is to each token it targets, with a
dark rim for busy maps, a band in the relationship colour and a one-pixel
hairline.

- **Player turns** show that player's standing targets as soon as the turn starts.
- **GM turns** do not reuse the GM's carried targets from the previous NPC.
- **Back-to-back turns for one player** hand the line over: it retracts into the
  first token while the reticle stays up dimmed, then relaunches from the next.
- **Colours** follow disposition. Secret dispositions count as neutral, so a
  line never reveals a hidden allegiance.
- **Visible to** — everyone / GMs and the stream / stream only. **The last two
  options are absent when Stream Client is disabled**, since there is no stream
  client to be an audience; a world that stored one falls back to *everyone* on
  read rather than going blank.
- Each player can hide lines on their own screen (`tgt.showLines`, client-scoped,
  reachable from the suite control centre).

## Roll cards

In PF2e worlds the chat overlay shows compact cards instead of cloned chat
cards: player, character, check, target, natural d20, DC, total and degree of
success. Damage merges under its attack, spells update in place, rerolls rewrite
their card, and criticals crack in gold or red using the suite's Broken-condition
shader.

Character art is framed on the face automatically — MediaPipe's detector, with
smartcrop as a fallback. A GM can set the framing by hand in the control panel's
**Frame Portraits**, or from any actor sheet's **Frame For Stream** header
button. A GM roll with no art of its own can show a chosen picture, framed the
same way.

Card size follows the stream's width and the **Roll card size** slider (default
50%). That slider lives in the stream client's `chatSettings`, not here: it
scales the overlay, which the stream client owns.

## Motion

Everything animates on the suite's shared anime.js engine. **Nothing here
touches that engine**, its speed or its main loop — it is shared with Insight,
the initiative tracker, the resource bars and the rest of the suite. Canvas work
that must land in the canvas's own frame is driven from a PIXI ticker callback
instead.

The suite deliberately ignores the OS `prefers-reduced-motion` preference, so
the standalone module's check for it is gone. Foundry's own photosensitive mode
is a setting somebody turned on deliberately, and is honoured: overlays and
targeting lines switch to calm variants. The stream camera does not — it is the
directed shot. Set **Travel zoom-out** to 1 for a calmer camera.

## Migrating from the standalone module

Settings and document flags carry over automatically on first load as a GM:
seven stream settings, two targeting settings, the default roll art, per-scene
tracked tokens and per-actor portrait framings.

World documents only. A compendium actor dragged onto the canvas becomes a world
actor and is re-framed there; unlinked token actors are not swept. Old flags are
left in place rather than deleted, so a world that gets rolled back still works
with the standalone module.

Nothing is overwritten: a setting the GM has already changed in the suite is
left alone.

## Validation

```bash
node tools/stream-check.mjs          # source-shape invariants
node --test tests/*.test.mjs         # 83 unit tests (directory mode is unsupported)
```

`stream-check` covers what a diff cannot show: import bindings across the
feature boundary, `stream` never importing a child, hook names that would
silently disconnect an emitter from its listener, the card feed registering one
phase too late, the crack re-forking from core, shader uniforms declared and
never written, legacy remaps pointing at unregistered keys, the two settings
that must never be delegable, raw socket use, the engine takeover, OS
reduced-motion creeping back, runtime-built i18n keys, and the usual CSS drift.

Neither tool can show you how any of this **looks**. The camera flights, the
targeting arcs and the roll cards need a real session.

See also: `docs/FEATURE_CONTRACT.md`, `docs/DESIGN_SYSTEM.md`.
