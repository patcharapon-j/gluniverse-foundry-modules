# GLUniverse Stream

Three suite features, ported from the standalone `gluniverse-stream` module.

| Feature | Prefix | Requires | System |
|---|---|---|---|
| **Stream Client** (`stream`) | `stream.` | — | any |
| **Stream Roll Cards** (`stream-cards`) | `stream.card` | `stream` | pf2e, gluniverse-daggerheart |
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
  Under either of the two scope switches below the hand-off is skipped: the
  outgoing token's lines stay up, so nothing retracts and staging a hand-off
  would only hold the incoming lines back for a beat that shows nothing.
- **Show all, not just the current turn** (`showAllSources`, off) keeps every
  eligible token's lines standing at once instead of following the turn order.
- **Show outside combat** (`outOfCombat`, off) keeps drawing with no encounter
  running. There is no current turn then, so every source draws, whatever the
  switch above says.
- **Away from the active turn only player-controlled tokens draw.** Foundry
  records targets per *user*, not per creature. A player's selection is their
  standing intent for their own token, but a GM runs every NPC off one
  selection, so attributing it to each of them would put the same line on every
  creature the GM owns — five goblins, five arcs, one click. The acting creature
  is the one NPC that selection can be pinned to, which is why the turn is
  always a source even in the widened modes, and why a GM sees nothing from
  their NPCs outside combat. A player's own companion is the same ambiguity one
  level down and is accepted: a token's targets are its owners' targets, which
  is the rule `targetsOfToken` has always applied.
- **Colours** follow disposition. Secret dispositions count as neutral, so a
  line never reveals a hidden allegiance.
- **Visible to** — everyone / GMs and the stream / stream only. **The last two
  options are absent when Stream Client is disabled**, since there is no stream
  client to be an audience; a world that stored one falls back to *everyone* on
  read rather than going blank.
- Each player can hide lines on their own screen (`tgt.showLines`, client-scoped,
  reachable from the suite control centre).

## Roll cards

In PF2e and Daggerheart (`gluniverse-daggerheart`) worlds the chat overlay shows
compact cards instead of cloned chat cards: player, character, check, target,
the die, DC, total and outcome. Damage merges under its attack, spells update in
place, rerolls rewrite their card, and criticals crack in gold or red using the
suite's Broken-condition shader.

Each system has a reader of its own and one card draws them both. The overlay
holds one feed, asked for by system id: `registerCardFeed(system, factory)` in
`stream/extensions.mjs` keeps one factory per system, and `stream-cards`
registers both from its `onInit`. A world running any other system gets no feed
and clones Foundry's chat cards, exactly as before. The card reads a few optional
model fields only the Daggerheart reader sets (the duality die, an outcome named
by key, chips beside the player name, a feature's price); PF2e sets none of them
and its cards are unchanged.

Character art is framed on the face automatically: the suite's head locator
(see [FACE_FRAME.md](FACE_FRAME.md)), then MediaPipe's detector, then smartcrop. A GM can set the framing by hand in the control panel's
**Frame Portraits**, or from any actor sheet's **Frame For Stream** header
button. A GM roll with no art of its own can show a chosen picture, framed the
same way.

The look is setting-neutral, because the stream sits over whatever world the
table plays in. The strip is rounded glass with a 1px inner rule and a soft drop
shadow. Tone is a top rule that fades out to the right plus a quiet wash behind
the result, and a crit's light is a stronger wash rather than a glow. Everything
the card says, and every number on it, is set in Google Sans Flex; Cormorant
Garamond italic is kept for narrated text only (the emote, thought and narration
quote styles). Both roles (`--glus-sans`, `--glus-serif`) are declared on the
cards, never on `:root`. There are no cut corners, no monospace labels, no scan
line, sheen or text decode; things fade and rise into place, and the strip
unfolds inside its own rounded clip. The crit crack stays, since it is shared
with core. The wrapper a cloned chat card gets on any other world takes the same
radius and inner rule and nothing else; what is inside it is Foundry's.

Card size follows the stream's width and the **Roll card size** slider (default
50%). That slider lives in the stream client's `chatSettings`, not here: it
scales the overlay, which the stream client owns.

## Daggerheart

The reader is `stream-cards/daggerheart/read-message.js`, pure like the PF2e one;
`daggerheart/snapshot.js` is the only half that reads the world, and
`daggerheart/card-feed.js` keeps the cards in step. The system writes its whole
record onto the message (`flags["gluniverse-daggerheart"] = { plate, kind,
actorUuid, next, nextAct }`, from `postPlate()` in its `dice/rolls.ts`), and every
number on a plate was decided before the card was drawn, so the reader only reads
a plate and never re-derives one.

| The system posts | The stream shows |
|---|---|
| `duality` | The duality card. Hope's face on the left in gold, Fear's on the right in violet, in one die's footprint; the half that won is lit, both on a critical. The total is large and the headline is With Hope, With Fear or Critical. The card takes the outcome's tone: the warm signal for hope, a deep violet body for fear, gold and the gold crack for a critical. |
| `duality` thrown as a reaction (`plate.rxn`) | The same card with the duality thrown away: a neutral die and tone, and the verdict against the Difficulty as the headline. Its own chat filter row. |
| `adversary` | "◆ Adversary" (or Environment) in the player slot, the kept d20, the total, and Hit or Miss. A natural 20 is a critical. |
| `adversary` reaction | Nothing. The system whispers it to the GMs, and a whisper never reaches the stream. |
| `damage` | Merged under the attack that offered it as the damage row, marked physical or magic. A critical is labelled Critical: this system awards each die's maximum on top of the roll, so it is not "×2". |
| `card` (a card or feature posted from a sheet) | The action card: the feature's name large, the card it came from beside the verb, and its price ("Spend 1 Hope", "Mark 1 Stress") when the card has one unambiguous price. |
| `rest` | Nothing, deliberately: a rest summary is bookkeeping, and at roll-card weight it reads as a second roll nobody made. |
| A plain `/r`, the Focus refresh, a card's "roll a d4" | A plain roll card. |
| A line somebody typed, Roleplay Chat included | A text card, through the shared text reader. |
| Anything else | Nothing. Every kind above is named on purpose, because a null here looks exactly like the overlay being switched off. |

**The Difficulty.** The system prints a plate's Difficulty to the whole table, so
a player's roll shows it, with Success or Failure beside it; a GM's duality roll
never does. An adversary's attack is measured against its target's Evasion, and
that number shows only when the snapshot finds that the plate's target is a
player character (or companion) a player owns whose own Evasion it is: it is
already on their sheet. Aimed at anything else, both the number and the target's
name stay off. The plate stores the target by name only, so this is a name
lookup, and it fails closed.

**Updates arrive on the same message.** Unlike PF2e, this system never replaces a
message: the GM's Fear is claimed onto a fear roll (`claimed.fear`, set by the
active GM's client a moment after it posts) and a reroll rewrites the plate in
place (`dice/reroll.ts`). Both reach the stream as `updateChatMessage`, which the
overlay hands to the feed's optional `handleUpdate`. The claim adds a "+1 Fear"
chip beside the player name and touches nothing else on the card; a reroll
rewrites the result with the Reroll chip, after Dice So Nice has shown the new
die. The feed also reads the message again after the first dice wait, so a claim
or a reroll that lands while the dice are still tumbling is on the card from the
start.

**Damage names no attack.** The damage button reads the weapon off the attack
card and rolls a new message with no back-reference, so damage joins the most
recent card from the same actor that offered "Roll damage" (`nextAct`
`roll-damage` or `roll-foe-damage`, the latter only on a hit), within the same
60-second window PF2e uses. One damage roll per card: the system claims the
button when it is pressed, so the next one belongs to something else.

**Names and art.** A creature the GM runs whose token nameplate players cannot
read is "Unknown", with its art kept, by the shared `speakerNameHidden` rule fed
by the token's own display mode (this system has no world switch for hiding
names). A roll made from a sheet with no token on the scene reads the prototype
token's mode. The art is the portrait first, the system's own rule, for players
and adversaries alike; the Frame Portraits window frames that same picture in a
Daggerheart world.

There are no status cards in a Daggerheart world, and the Status Updates section
of the control panel is not drawn there.

## Plain rolls and chat text

In a PF2e or Daggerheart world the overlay clones no chat card at all — every new message goes
through the roll-card feed. So before these two kinds existed, a `/r 2d6+3` and a
line somebody typed reached the stream as *nothing*: the reader returned null, no
card was built, and the result is indistinguishable from the overlay being
switched off.

Both are cards now, in the same stack, under the same lifetime, with the same
top rule and the same framed art.

**A plain roll** is anything carrying dice that PF2e did not claim as a check, a
damage roll or a cast: `/r 2d6+3`, a macro roll, a system PF2e has no context
type for. It says the three things such a roll has to say and nothing else — what
was rolled, what each die came up, and the total. There is no degree of success,
because PF2e resolved none; the card is deliberately silent about outcome rather
than inventing one, exactly as [a check made against no DC](#what-the-roll-card-does-not-say)
is. The d20 is drawn only for a roll with exactly one d20 rolling exactly once
(the classic `1d20+N`) — a `10d20` has no natural, and a die showing one of its
ten results would be a lie about the roll. A natural 20 or 1 still cracks gold or
red, the same rule a check with no DC follows.

**A chat card** is something a person typed. Foundry's chat *style* is the whole
test: in character, an emote, or out of character. Style OTHER is refused, and
that refusal is the load-bearing part — OTHER is the default every ChatMessage
carries, so every roll, every PF2e item card and every module's status summary
would otherwise land on the stream at roll-card weight, with nothing to switch
off but the feature. The body is flattened to plain text in the reader and set
through `textContent` in the card: a message is arbitrary markup from any client
in the world, and the stream is the one screen in a session nobody is watching.
It is cut to three lines, so an arriving card cannot grow and move the stack
under it.

What reaches the stream is the **Chat Filter** (`stream/chat-filter.mjs`, the
`stream.chatFilter` setting): one row per content type, switched per author. The
typed rows are speech, emote, thought and out of character. Out of character
ships **off**: a "brb" is table talk, and on a recording it reads as the stream
leaking. A world that already stored the row keeps what it stored. The reader
consults the filter before it builds a model, so a row that is off costs nothing.

A chat card is read by `stream-cards/text/read-text.js`, one pure module shared
with [Roleplay Chat](ROLEPLAY_CHAT.md). When a line carries Roleplay Chat's mode
flag (`flags["gluniverse-foundry-modules"].rp.mode`) the flag wins over the chat
style: Say is speech, Do is an emote, Think is its own `thought` row (a thought
is not something the character said, so a table can keep it off the stream), the
Narrator rides the speech row as a narration card with no portrait, and OOC is
out of character. Without the flag the style decides, exactly as before. A line
whose speaker's name PF2e hides from players is attributed to "Unknown", by the
same `speakerNameHidden` rule Roleplay Chat applies over the token. A whispered or blind
line is never a card, from either reader.

## Status cards

A creature gaining or losing a condition gets its own card in the overlay: the
creature, and one row per condition with its value and which way it moved.

It is the **damage row's** size, not the roll card's, and that is the point. A
condition is a consequence; drawn at the same weight as the roll that caused it,
it reads as a second roll and the two compete for the same glance. Same `--u`,
same top rule, same glass, same framed art — the roll card's own framing
re-struck as a square (and cut round), so the head is in the frame rather than
pushed left by a crop shaped for an 8.2:4.4 box. A chip says its direction with a
mark and its value; the word is printed only for a condition that ended, since
"gained", "raised" and "eased" restate the mark and their room pushed a two-chip
card's second chip off the edge.

**One card per creature.** Everything that lands while a card is up folds into
it: frightened arriving and then ticking to 2 is one row reading "Frightened 2",
not two rows disagreeing about the same creature, and a condition that arrives
and ends inside one card's life is dropped rather than shown twice — the viewer
saw nothing happen, because nothing did.

Amber is pressure arriving, jade is pressure letting go. Nothing here tries to
decide whether a condition is *good* for the creature: PF2e does not say, and a
guess would be wrong about quickened or about a GM's own homebrew.

### What the GM chooses, and what they do not

In the Control Room, beside the shot: conditions, effects (off by default — there
are a great many), value moves, endings, player characters, visible creatures,
and how long a card stays up as a share of the chat overlay's lifetime. Every row
is read before a model is built, so a row that is off costs nothing.

**Observability is not one of those switches.** A condition is a document change
every client is told about, hidden token or not, so a status card about a
creature no player can see would be a leak that looks entirely correct on the
GM's own screen. A player-owned actor is always the party's business; anything
else is drawn only while it has a token on the scene that the GM has not hidden.
That is deliberately not a *sight* test — vision is per-player and per-token, and
would make the stream's answer depend on which login happens to be connected.
PF2e's own "players cannot see this creature's name" answer is honoured exactly
as the roll cards honour it: the art stays, the name goes.

### Why the value has to be remembered

Foundry's `updateItem` hook hands over the new values only, and `preUpdateItem`
fires solely on the client that made the change — never the stream client. So the
feed remembers each condition's value and primes itself from every observable
creature when stream mode starts. Without that, a frightened 2 ticking down to 1
cannot be told from one rising to 2, and every tick reads as an arrival.

## Flat checks

PF2e resolves a check's outcome itself and records it on the message *and* on the
roll; where it puts the DC is its own business. The card used to require a DC in
the message context before it would show a degree at all, and a flat check — the
DC 11 off a Concealed card, the DC 5 off Stupefied, a recovery check — is exactly
where the two part company. Every flat check on the stream therefore had no
Success and no Failure on it, while the card rendered perfectly.

The outcome PF2e recorded is read first now. Where a DC and a total are known but
the system reported no outcome, a flat check is still answerable, because the
rules give it no critical degrees, so the comparison is the whole answer. **No
other check type is guessed at**: the ±10 bands and the natural-20 shift are the
system's to apply, and inventing them here would put a degree on the stream that
the player's own chat card does not carry.

## What the roll card does not say

"Result", "Natural 20" and "Natural 1" are gone from the outcome box. They
restated the number already drawn on the die beside them, in the widest type on
the card, and the room they held came out of the skill, spell, action and target
on the left — the one line a viewer cannot reconstruct from anything else on
screen. The die keeps its gold and red tint, so a 20 and a 1 still announce
themselves; a card with no degree and no DC to show simply has no outcome box,
and the identity column takes the space.

A check whose chat flavor carries no heading (an inline `@Check` link, a
macro-rolled check) also stops headlining with PF2e's raw context type. The
reader is pure, so it cannot localise: it hands over a label key and the card
resolves it. A raw system identifier is not a phrase to put on a stream.

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
node --test tests/*.test.mjs         # unit tests (directory mode is unsupported)
```

To see the cards, `node tools/stream-cards-preview.mjs && node
tools/preview-server.mjs 8962`, then `/.preview/stream-cards.html`. It imports
the shipped `RollCard` and `StatusCard` against the shipped stylesheets, for
every card kind. Its Daggerheart section is not hand-built: each card is a
real-shaped message from `tests/fixtures/daggerheart/messages.mjs` (the ones the
tests read) put through the shipped reader. `?still` shows the settled state,
`?scale=0.5` the shipped default size, `?bg=bright` a pale floor, `?only=dh` the
Daggerheart columns alone.

`stream-check` covers what a diff cannot show: import bindings across the
feature boundary, `stream` never importing a child, hook names that would
silently disconnect an emitter from its listener, the card feed registering one
phase too late, the crack re-forking from core, shader uniforms declared and
never written, legacy remaps pointing at unregistered keys, the two settings
that must never be delegable, raw socket use, the engine takeover, OS
reduced-motion creeping back, runtime-built i18n keys, and the usual CSS drift.

For the cards it additionally pins the things above that a diff cannot show: the
three restated labels staying gone, the degree of success never being re-gated on
a DC in the message context, every status row having a reader *and* a control
*and* a label, observability never becoming a setting, `preUpdateItem` staying
out, the status hooks staying out of the per-overlay feed, the square framing on
the thumbnail, the managed-card property agreeing across the overlay and every
feed, and the status strip staying smaller than the roll card's.

For Daggerheart it pins a feed registered from `onInit` for each roll-card
system, the reader staying pure and gating through the chat filter and
`visibilityOf`, typed chat going through the shared text reader, every label key
the reader hands the card existing in both the lang file and the card's English
fallbacks, every Daggerheart kind filing under a row offered in that world, the
cloned-card path filing by the same kind, the rest summary staying a non-card,
and the Daggerheart stylesheet loading after the base card and staying inside
the card's look.

Neither tool can show you how any of this **looks**. The camera flights, the
targeting arcs and the roll cards need a real session.

See also: `docs/FEATURE_CONTRACT.md`, `docs/DESIGN_SYSTEM.md`.
