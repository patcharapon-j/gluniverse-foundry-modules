# Stream Pacer

Table pacing for a GM running a live game, a stream or a long session. It answers
four questions on every screen at once: who wants to talk, what the GM is asking
for, how the room feels, and whether everyone is still okay.

## What players and the GM see

**The signal band** is a stack of lanes across the top of the screen. Each lane
is one thing the table needs to know right now, with running text, the people it
is about and the buttons that answer it. Highest priority first:

| Lane | Who sees it | What it says |
| --- | --- | --- |
| Safety | GM | Raised yellow and red lights, by name. A red the GM has not acknowledged frames the whole screen. |
| Check-in | GM and players | The GM asked how everyone is doing. Players answer with their lamp; the GM sees the tally. |
| Dire Peril | everyone not peril-exempt | The stakes are real. Opens with a full-screen splash. |
| Call | everyone, loudest for the people asked | Wrap up, a countdown, or a ready check. A call can name players. |
| Hands | GM | The queue of raised hands, then holds ("Need time"). |
| Mine | a player | Your own hand or hold, and your place in line. |
| Campfire | everyone | A slow scene. Take your time. |

Priority is drawn as scale, not only as order. The first lane that is not calm
**leads**: it breaks out past the others, stands 64px tall and carries a wash of
its tone. It does not run its text, it states it: a still headline (the title,
and under it the count or the first phrase), with a countdown's clock moved into
it as a 40px numeral and the whole plate filled with the tone and draining left
to right. Every lane under it is a slim 38px row of the queue that keeps its
running text. `band.js` sets `is-lead`; a leaving lead keeps it, so it exits at
its own size. A calm lane (the campfire) never leads, except a call everyone
answered, which keeps the stage with its Move on. When the clock, faces and
actions leave a queue row's text too little room to read, the text hides and
the tag and clock say it alone.

The lead arrives as one hard wipe with its light on the edge and its headline
rising out of it; a queue row only drops into its slot, and every lane opens and
closes its slot so the stack slides instead of jumping. A few moments are played
on the transition, never on arrival (a late joiner sees the state, not a
celebration of it): a tally that moves knocks its number, everyone answering
locks the faces in one after another, a countdown's clock knocks once a second
in its last ten, and time up lands as a hit. Every length is in `MOTION`.

**The HUD** is a small draggable panel. The GM's has the calls, the room (campfire
and Dire Peril), the table with spotlight marks, and a footer to check in, lower
every hand and reset the marks. A player's sits over the map all session, so it
is two rows: Raise hand and Need time, then the traffic light with the current
answer beside it. Sound and desktop alerts are icons in the header, and the
header collapses the panel to one 32px line.

**The Dire Peril splash** is the old feature's full-screen stage, with the old
beats and timing, set in the skin's `--sp-font` and shot like a film: a
letter-by-letter montage, then the two words slam in over a WebGL danger field
(crimson plasma with hot filaments, light rays and embers, a one-pixel hex
lattice, hairline shock rings and an anamorphic streak on both hits) with corner
brackets, running hazard text and an outline marquee in depth. The title is a
wide cut letter with a lit lip, closes a lens fringe as it lands, and pushes in
slower than its room. It lasts `TIMING.perilStage`; every beat is a CSS
keyframe laid out as a share of that one length, which `playPerilSplash` writes
as `--sp-peril-stage` and unmounts at. It never takes a click. Ending the peril
ends the splash at once. The field (`peril-field.js`) is a suite surface, built
only on a client that can see the splash, warmed at idle, and the first thing
the frame budget sheds (`SHED_ORDER`); each client can turn it off
(`sp.perilWebGLEnabled`), and without it the splash plays as CSS with its own
shockwave ring.

**Spotlight is marks, not time.** Click a player's row to mark that they had the
spotlight; mark twice for a big one; right-click to take one back. The row two
or more marks behind everyone else is tagged Quiet.

## Reaching a player who is not looking

The old feature drew its prompts and hoped. A player with the tab in the
background never saw a wrap-up. Now:

- Every call, check-in, nudge and Dire Peril plays a sound the first time a
  client sees it (and never again on that client: heard ids are kept in
  `sessionStorage`).
- When the window is not focused, the tab title flashes and, if the player turned
  desktop alerts on, a silent system notification shows the call.
- Every client reports its presence to the GMs (here, idle, away). The GM's call
  lane and HUD show who it reached: offline, away, idle, here, seen, or answered.
  A client marks a call seen after it has been visible and focused for 1.2 s; an
  answer to a ready check also counts. **Nudge unseen** knocks on exactly the
  people it has not reached.

## State, and why the reset works now

| Where | What |
| --- | --- |
| User flag `flags[SUITE_ID].spPacer` (undotted, written whole) | `{ status, at, seen, answer }`: hand, hold, what the player has seen and answered |
| World settings `sp.call`, `sp.mood`, `sp.spotlight` | The GM's call, the room's mood, the marks |
| Socket, with `recipients` | Presence, nudges, safety lights, check-ins |

Documents converge: a reload or a late join draws the real state rather than
whatever was broadcast while it was away, and a late joiner is not played sounds
for anything older than 20 s. The old reset was a broadcast that missed anyone
not connected at that moment. Now the active GM alone resets the hands, holds,
call and mood when a scene is activated (`sp.resetOnSceneChange`), by writing
the documents every client reads. Marks only reset from the HUD, behind a confirm.

Hands and holds count only players who are online, so the GM is never offered
"Call on" for an empty chair. A disconnected player's flag stays stored and
comes back with them, silently.

## Safety

The traffic light is private. A light is never written to a document or setting,
both of which reach every client. It rides the socket to the active GMs who are
not safety-exempt, and a GM files it under the server-attested sender only.

The capture login is usually exempted from three things, separately: the band
and HUD (`sp.exemptUsers`), the Dire Peril splash (`sp.perilExemptUsers`, so a
stream can still show the splash while hiding the pacing), and the whole safety
tool (`sp.safetyExemptUsers`). A safety-exempt client never constructs the
`SafetyDesk`, so it draws no lamp, lane, frame or cue and is left out of every
recipient list. Exempting a real person from safety removes their way to signal
distress; both hints say so and the check holds them to it.

## Sounds

Thirteen cues from the Boombox library, picked with earshot (`rank` against a
written description of each cue, then `realness`), trimmed, loudness-matched to
about -16 LUFS (the countdown tick at -21, the peril hit at -15) and encoded as
mono 48 kHz Vorbis. 184 KB in all, in `assets/stream-pacer/`.

| Cue | Source |
| --- | --- |
| hand | Petite Keys, Notification 01 |
| wrap | Palm Gong Soft 01 |
| countdown | Small Gong Hit 02 |
| tick | Tiny Woodblock 03 |
| timeup | Palm Gong Strike 07 |
| ready | Piano Notes, Anticipation 02 |
| allready | Playful Keys, Bloom 01 |
| campfire | Match Strike 02 |
| peril | Consequence Hit Heavy |
| nudge | Hollow Door, Knock x3 |
| checkin | Gentle Tone |
| yellow | Kalimba Alert, Muted |
| red | Tinny Alert |

Each client has a sound toggle and a volume. Cues play on Foundry's interface
channel.

## What changed from the old feature

Removed: time-based spotlight tracking, the dossier card, the hand-raise sidebar,
the appearance and theme settings, the campfire's WebGL renderer, and the
pacer's own socket handler. The Dire Peril splash and its WebGL field were
brought back after the remake, in the skin's type. Kept and rebuilt: countdowns, wrap-up, ready
check, hand raise, Need time, campfire, Dire Peril with its GM-editable text, the
safety lights and check-in, and all three exemption lists. Added: named calls,
reach tracking and nudges, sounds, title flash and desktop alerts, spotlight
marks, keybindings (Alt+H raise hand, Alt+W wrap up, Alt+R ready check, and an
unbound End call), and quick-search entries.

Settings carried over from the standalone module by the suite's migration: the
four Dire Peril texts, the peril WebGL toggle, the default countdown, reset on scene change, the bars and
peril exemption lists, and the HUD position. Old appearance settings are left
behind on purpose: there is one look now (docs/adr/0003-stream-pacer-skin.md).

## Checking it

```bash
node tools/stream-pacer-check.mjs
node tools/clocks-pacer-motion-check.mjs
node tools/pacer-preview.mjs && node tools/preview-server.mjs
```

Then open `/.preview/pacer.html?scene=gm` (also `countdown`, `ready`, `player`,
`checkin`, `peril`, `calm`; add `&live=1` to watch lanes arrive one by one).
`moments` plays a 24 s GM session that runs every band moment once. `peril`
replays the splash on a loop; `&at=<ms>` freezes it at that moment instead. The motion
workshop's browser checks (`tools/templates/motion-preview.html`) cover the band's
lane order and the splash. Nothing here proves the socket round trip, presence
or the desktop notification; those need a session with a second login.
