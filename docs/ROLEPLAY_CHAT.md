# Roleplay Chat

Feature id `roleplay-chat`, settings prefix `rp.`, i18n `GLRP.*`, CSS prefix `glrp-`.
Any system, off by default.

At a real table you hear who is speaking, see who they are looking at, and know
when somebody steps out of the scene to ask for the crisps. Online, all of that
collapses into one chat log. This feature gives it back, and adds two things a
physical table cannot do: a line hangs over the character who said it, and a
thought can be shown without anyone saying it aloud.

## What the player sees

**The switch.** A bar above the chat box: `OOC | In character`, the speaker chip,
and, in character, `Say | Do | Think`. The box is tinted by the mode, and Do and
Think are typed in the narrated serif italic, so the line reads in the voice it
will appear in before it is sent. Under the box, a hint names the two keys.

| Key | Does |
| --- | --- |
| Alt+Q | Out of character / in character |
| Alt+W | Say, Do, Think, in turn |

Both are Foundry keybindings (`rp.toggleIc`, `rp.cycleMode`) and can be rebound.
Foundry does not run keybindings while a text field has focus, so the box carries
a keydown listener of its own that matches the *configured* bindings; a rebound
key works in the box too.

**Slash commands** post one line without moving the switch: `/ooc`, `/ic`,
`/em`, `/emote`, `/me`, `/think`. `/w` and every other Foundry command are left
alone. `/think` is registered in `ChatLog.CHAT_COMMANDS` so it also works from a
macro.

**The speaker.** A player speaks as their assigned character, or picks another
actor they own from the chip. A GM's chip follows the selected token (`AUTO`),
or is pinned (`PINNED`) to any token on the viewed scene or to the **Narrator**.
A pin survives a scene change and is listed as off scene; its lines go to the
caption lane. While the Narrator speaks, Say/Do/Think are hidden and every
in-character line is narration.

**Over the canvas.**

| Mode | Drawn as |
| --- | --- |
| Say | A glass balloon over the token, with the name |
| Do | A caption under the token, in serif italic, led by the name |
| Think | A cloud over the token, trailing two puffs, in serif italic |
| Narrator | A film subtitle in the caption lane above the hotbar |
| OOC | Nothing. The log only |

A line whose token is not on the viewed scene, is hidden, cannot be seen, or is
off screen goes to the caption lane instead, with the speaker's portrait. A line
lives 4 s plus 60 ms per character, capped at 12 s. Up to two lines stack on a
token and three in the lane; an older line dims, the oldest leaves.

Bubbles scale with the square root of the canvas zoom, clamped to 0.8 to 1.15, so
they stay legible zoomed out and do not swamp the map zoomed in. The lane follows
the suite's Interface Scale.

**The chat log.** An in-character entry keeps Foundry's element (timestamp,
delete button, anything another module added) and swaps the sender line for a
head: portrait, name, and what kind of line it is (Says, Does, Thinks). Say is
quoted, Do and Think are in the narrated voice, the Narrator is centred between
thin rules like a line of a book. An out-of-character entry keeps Foundry's look
and gains an OOC tag beside the name.

## What it posts

| Mode | Style | Flag | Speaker |
| --- | --- | --- | --- |
| Say | IC | `rp.mode: "say"` | the actor / token |
| Do | EMOTE | `rp.mode: "do"` | the actor / token |
| Think | IC | `rp.mode: "think"` | the actor / token |
| Narrator | IC | `rp.mode: "narrator"` | alias "Narrator", no actor, no token |
| OOC | OOC | `rp.mode: "ooc"` | none |

The flag is `flags["gluniverse-foundry-modules"].rp.mode`, read and written only
through `core/rp-mode.mjs` (`rpModeOf`, `rpModeFlags`), which accepts both the
nested and the dotted shape. A Do line is stored **without** the speaker's name
at its front (typing "Seri draws her blade" stores "draws her blade"); the name
is put back by every renderer, so it is never doubled.

Every message is created with `chatBubble: false`. Foundry otherwise draws its
own bubble for an IC message from the client that receives it, which would put
two bubbles over the token and draw one for a viewer this feature has refused.

## Privacy

Visibility follows the message exactly. Nothing is drawn over the canvas, and no
log entry is restyled, for a viewer who cannot read the message
(`model.canView`: whisper recipients, the author and GMs; a blind roll only for
GMs). A head is never added over a body Foundry has already replaced, because it
would name the speaker of a line the viewer was not sent.

Typed text follows Foundry's own message mode (Public, Private GM, Blind, Self),
so a whispered Do is a whispered Do. A slash command always posts publicly, as
Foundry's own `/ic` and `/emote` do. Foundry's "In character" message mode button
is hidden while the feature runs, because the switch is the in-character control
and two would disagree; a client left on it is reset to Public.

A speaker whose name players may not read is "Unknown" to them, in the log, on
the bubble and on the stream, and keeps their portrait. The rule is one function,
`speakerNameHidden` in `stream-cards/text/read-text.js`. On PF2e it reads the
token's `playersCanSeeName` and the system's name visibility setting. Elsewhere
it reads the token's display name: Hover and Always are readable, anything else
is hidden. GMs always see the real name, with a small mark beside it.

## The stream

A line from this feature becomes a stream chat card through the shared reader,
`stream-cards/text/read-text.js`, described in [STREAM.md](STREAM.md#plain-rolls-and-chat-text).
Say is speech, Do an emote, Think its own `thought` row, Narrator a narration
card on the speech row, OOC out of character (off by default). The card takes the
mode's tone colour from `styles/roleplay-chat.css`.

On the stream login itself, bubbles and captions are **off** unless the GM turns
on **Bubbles on the stream** (`rp.streamBubbles`, a world setting, in the Control
Room under Roleplay Chat). The roll cards already show the line, and a capture
with both shows it twice. The section is GM only.

## Files

```
scripts/core/rp-mode.mjs                 the mode flag: names, reader, writer
scripts/features/roleplay-chat/
  index.mjs        adapter and lifecycle
  constants.mjs    ids, setting keys, hooks, CSS names
  model.mjs        PURE: modes, composer state, slash parsing, message data,
                   speakers, privacy, routing, timing, zoom, key matching, i18n
  render.mjs       PURE: every piece of markup, escaped
  settings.mjs     settings and keybindings
  speaker.mjs      who is speaking, the picker
  identity.mjs     a message's shown name and art, hidden-name rule
  composer.mjs     the bar, the hint, the box's keys
  send.mjs         intercepting a typed line, /think
  log.mjs          the chat log entry
  overlay.mjs      bubbles, captions, the lane
  panel.mjs        the Control Room section
scripts/features/stream-cards/text/read-text.js   PURE: the shared text reader
styles/roleplay-chat.css
templates/roleplay-chat/section.hbs
lang/roleplay-chat.en.json
```

## Seams that fail silently

**A typed line is intercepted only when the chat box sent it.** Foundry calls
`ChatLog#processMessage` for the box and for every chat macro. The `chatMessage`
hook therefore acts only while the box is *armed* by an Enter keydown in it,
cleared on the next task. Without that, a macro that posts "/r 1d20" in a player's
name would be rewritten as their character saying it.

**The hook returns false only when it handled the line.** Returning false tells
Foundry the message was dealt with, and Foundry clears the box and files the line
in history. A user with nobody to speak as is out of character, so their plain
text posts as OOC; `/ic`, `/em` or `/think` with no speaker returns nothing, so
Foundry's own error is what they see and their text stays in the box rather than
being silently eaten.

**The notification area is a grid.** With the sidebar collapsed, Foundry moves the
chat box into `#chat-notifications`, a two-row grid. The bar and the hint are given
rows of their own there (`#chat-notifications:has(> .glrp-bar)`); without it they
land in the message row and push the box off screen. The bar carries its own glass
for the same reason: there is no sidebar behind it, and several systems make the
sidebar transparent anyway.

**`renderChatInput` fires every time the box moves** (sidebar, popout,
notifications). The bar and the hint are single elements, moved to sit beside
whichever box Foundry just rendered.

**Bubbles are placed on the PIXI ticker** from `canvas.stage.worldTransform`, the
pattern pf2e-odds' line badges use. They are DOM, so they stay crisp at any zoom
and take the suite's type, but they must be re-placed every frame the canvas
moves; a token that becomes hidden hides its bubble on the next frame.

**The leave animation is timed in JS.** A line is removed `LEAVE_MS` after it
starts leaving, which must cover `--gl-d-glide`. The check compares the two.

## Validation

```bash
node tools/roleplay-chat-check.mjs
```

Zero problems required. It imports the pure modules under Node and pins: purity
and nothing at import; the styles, flags and filter rows agreeing across
`rp-mode`, the model, `read-text` and the chat filter; message building, slash
parsing, the composer cycle and speaker resolution; privacy and routing; timing,
stacking and `LEAVE_MS`; key matching; that every markup string is escaped and
every class it emits has a rule; the CSS rules of the design system; every
literal and dynamic `GLRP.*` key; and the wiring (`module.json`, the feature
index, the GM-only panel section, off by default).

The stream side is covered by `node tools/stream-check.mjs` and
`node --test tests/stream-text-reader.test.mjs tests/stream-chat-filter.test.mjs tests/pf2e-basic-cards.test.mjs`.

To see it:

```bash
node tools/roleplay-chat-preview.mjs && node tools/preview-server.mjs
```

then `/.preview/roleplay-chat.html` (`?only=1|2|3` for one section). It draws the
shipped markup, model and stream cards: a player's screen with every mode, the
switch in each state, and the stream cards. It cannot show Foundry's own chat
log or box; only a live session does.
