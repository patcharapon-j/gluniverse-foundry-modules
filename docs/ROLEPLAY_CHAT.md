# Roleplay Chat

Feature id `roleplay-chat`, settings prefix `rp.`, i18n `GLRP.*`, CSS prefix `glrp-`.
Any system, Foundry v14 only (it speaks v14's chat API), off by default.

At a real table you hear who is speaking, see who they are looking at, and know
when somebody steps out of the scene to ask for the crisps. Online, all of that
collapses into one chat log. This feature gives it back, and adds two things a
physical table cannot do: a line hangs over the character who said it, and a
thought can be shown without anyone saying it aloud.

## What the player sees

**The look.** Black plates with paper type and the suite's chamfer on the lower
right corner, quiet enough for any campaign. The only colour is the tone of the
line: Say is paper, Do amber, Think lilac, the Narrator and table talk steel.
Every line carries its tone the same way, as a spine down its left edge, in the
box, the log, the balloon and the caption lane alike: solid for Say, a heavier
bar for Do, dashed for Think.

**The switch.** One plate above the chat box. The top row is the speaker chip
("AS Seri Valen"), or, for somebody with nobody to speak as, why the strip is
locked. The bottom row is the mode strip: `OOC | Say | Do | Think` for a
character, `OOC | Narrate` for the Narrator, each tab with its own icon. The
pressed tab sits on a slab of its tone, and when the mode changes the slab slides
from the old tab to the new one, carrying its colour across. Out of character the
chip steps back. The keys are on each tab's tooltip; there is no hint line under
the box any more, which gives the sidebar's log that row back.

**The box** reads like the line it will become, so the mode shows without colour
too:

| Mode | Box |
| --- | --- |
| Say | A solid spine, the line between quotation marks |
| Do | A heavier amber spine, the speaker's bold name in front, the narrated serif |
| Think | A dashed spine, the narrated serif in lilac |
| Narrator | A steel spine, the narrated serif |
| OOC | No spine, only the box's hairline |

In character, a header inside the box names who is speaking and how ("SERI VALEN
· SAYS"), and the box sets the line the way the log will print it: Say between
quotation marks, Do after the speaker's bold name, Do and Think in the narrated
serif italic. Nothing is drawn while the box is empty, so the marks never sit
beside Foundry's placeholder. The header and the name are custom properties the
composer sets on the box (`--glrp-head`, `--glrp-speaker`).

**Asides.** Inside a Say line, `*draws her blade*` is an action rather than
words: "Hold the line! *draws her blade* Run!" prints as “Hold the line!” *draws
her blade* “Run!”, with the aside in the narrated voice and the Do hue. It works
in the log, on the bubble, in the caption lane and on the stream card. The rule is
`splitAsides` / `asideRuns` in `core/rp-mode.mjs`: a star pair holding at least
one non-space character, no newline and no markup; `**` is never an aside, and a
star touching a Latin letter or digit on its outside is arithmetic ("2*3*4").
Thai beside a star still counts, because Thai runs words together. Stars in a
thought or a Do line are left as typed. The message stores the stars, so nothing
is lost on a client without the feature.

**Typing.** While a player writes an in-character line, a small "…" pill sits on
their token's top-right corner for everyone who can see that token, and leaves
when the line arrives. See [Privacy](#privacy) for what it carries.

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
| Say | A black plate over the token with a tail onto it, the name above the line |
| Do | A caption under the token, in serif italic, led by the name in amber |
| Think | A plate with a dashed spine, trailing two beads, in lilac serif italic |
| Narrator | A film subtitle in the caption lane above the hotbar |
| OOC | Nothing. The log only |

A line whose token is not on the viewed scene, is hidden, cannot be seen, or is
off screen goes to the caption lane instead, with the speaker's portrait. A line
lives 4 s plus 60 ms per character, capped at 12 s. Up to two lines stack on a
token and three in the lane; an older line dims, the oldest leaves.

Bubbles scale with the square root of the canvas zoom, clamped to 0.8 to 1.15, so
they stay legible zoomed out and do not swamp the map zoomed in. They carry no
backdrop blur: they move with every pan, and a blur under a moving element is
redrawn on every frame. The lane is centred over the hotbar, never under an open
sidebar (`laneBox`), and follows the suite's Interface Scale.

**The chat log.** An in-character entry keeps Foundry's element (timestamp,
delete button, anything another module added) and swaps the sender line for a
head on one line: portrait, name, and what kind of line it is (Says, Does,
Thinks). Say is quoted, Do and Think are in the narrated voice, the Narrator is
centred between hairlines like a line of a book, with no spine. A Do line's name
is put in front as nodes, inside the line's first paragraph when it has one, so
the body Foundry rendered is never re-parsed. An out-of-character entry keeps Foundry's look
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
is put back by every renderer, so it is never doubled. Thai runs words together,
so a Thai name typed straight onto a Thai line ("น้ำฝนหยิบแผนที่") is cut too. The
limit is a short Thai name that is also the start of a longer word: a speaker
named "น้ำ" writing "น้ำฝนตก" loses "น้ำ".

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

**The typing indicator** carries a scene id and a token id over the suite socket
and nothing else: no text, no name. It is still a claim about somebody, so a
receiver draws it only when the server's attested sender (`meta.attested`) is a
GM or owns the token's actor, and only over a token that viewer can see
(`acceptTyping`). A writer announces nothing for a whisper or a blind line, a
hidden token, the Narrator, OOC or a slash command (`shouldAnnounceTyping`). It
pings at most every 2.5 s while text is in the box and says it stopped when the
box empties, the line is sent or the mode leaves character; a receiver drops a
pill after 6.5 s without a ping, so a client that closes mid-sentence leaves
nothing behind. It follows the same switches as bubbles (the client's own
**Bubbles and captions**, and the stream login's suppression), and the world
setting **Typing indicator** (`rp.typing`, on by default) turns it off for
everyone.

## The stream

A line from this feature becomes a stream chat card through the shared reader,
`stream-cards/text/read-text.js`, described in [STREAM.md](STREAM.md#plain-rolls-and-chat-text).
Say is speech, Do an emote, Think its own `thought` row, Narrator a narration
card on the speech row, OOC out of character (off by default). The card takes the
mode's tone colour from `styles/roleplay-chat.css`. A spoken line's asides ride
the card model as `text.runs` and are built as `.glus-rc-aside` spans through
text nodes, never markup.

**Thai.** The suite bundles the Thai subset of Google Sans (`--gl-thai`, see
DESIGN_SYSTEM.md rule 7) and every stack here names it straight after its Latin
face. Cormorant has no Thai, so a Thai word in a serif line comes from Google
Sans, brought level with the serif's x-height by `font-size-adjust: ex-height
from-font`. That property is reset by the `font` shorthand, so its rules sit after
the ones that set the font. Names that clip (`overflow: hidden` on a tight line
box) are given room for Thai tone marks above the line. On the stream, a short
line is set larger (`quoteSize`), counting Thai stacked marks as no width.

On the stream login itself, bubbles and captions are **off** unless the GM turns
on **Bubbles on the stream** (`rp.streamBubbles`, a world setting, in the Control
Room under Roleplay Chat). The roll cards already show the line, and a capture
with both shows it twice. The section is GM only.

## Files

```
scripts/core/rp-mode.mjs                 the mode flag and the aside rule
scripts/features/roleplay-chat/
  index.mjs        adapter and lifecycle
  constants.mjs    ids, setting keys, hooks, CSS names
  model.mjs        PURE: modes, composer state, slash parsing, message data,
                   speakers, privacy, routing, timing, zoom, key matching, i18n
  render.mjs       PURE: every piece of markup, escaped
  settings.mjs     settings and keybindings
  speaker.mjs      who is speaking, the picker
  identity.mjs     a message's shown name and art, hidden-name rule
  composer.mjs     the bar, the box's keys, the picker's keys
  send.mjs         intercepting a typed line, /think
  log.mjs          the chat log entry
  overlay.mjs      bubbles, captions, the lane, the typing pill
  typing.mjs       the typing indicator's socket, both ends
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
chat box into `#chat-notifications`, a two-row grid. The bar is given a row of its
own there (`#chat-notifications:has(> .glrp-bar)`); without it it lands in the
message row and pushes the box off screen. The bar carries its own glass for the
same reason: there is no sidebar behind it, and several systems make the sidebar
transparent anyway. The glass and the chamfer are on the bar's `::before`, because
a clip-path on the bar itself would clip the picker that opens above it.

**`renderChatInput` fires every time the box moves** (sidebar, popout,
notifications). The bar is a single element, moved to sit before whichever box
Foundry just rendered.

**The bar repaints only when its markup changes.** A dozen hooks ask for a render.
Rebuilding on every one reset the picker's scroll, dropped the hover and would
replay the slab's slide for a mode that never moved. When the pressed tab does
move, `composer.mjs` hands the new slab the old position and tone (`--glrp-from`,
`--glrp-from-tone`) and `glrp-ink-slide` takes it there; the label it is heading
for keeps its tone until the slab arrives (`glrp-tab-on`), or it would be ink on
black for a moment.

**Foundry's message mode is a client setting.** It fires `clientSettingChanged`,
not `updateSetting`. A writer who switches to a whisper mid-sentence takes the
"…" down there and then (`refreshTyping`), rather than at the next keystroke.

**A stack replaced by another shape still has an element.** A Think arriving over
a token whose Say is still leaving builds a new stack under the same key; the old
one's element is removed when its last line has left, map or no map.

**Bubbles are placed on the PIXI ticker** from `canvas.stage.worldTransform`, the
pattern pf2e-odds' line badges use. They are DOM, so they stay crisp at any zoom
and take the suite's type, but they must be re-placed every frame the canvas
moves; a token that becomes hidden hides its bubble on the next frame.

**The 3D view covers the board.** While Diorama's view is open, the stage
transform names a spot on a board nobody can see, so bubbles are placed from
Diorama's api (`api.features.diorama`: `isOpen`, `tokenAnchor`, `project`)
instead. Say and Think hang over the standee's head, Do sits at its feet on the
3D ground (the token's centre projected at its elevation), the typing pill beside
the head. The scale is the view's screen px per scene px around the token, fed
through the same `overlayScale` clamp. Placement runs on animation frames while
the view is open and something is up, because the 3D camera and a hopping standee
move with no canvas frame behind them; each loop notices the view opening or
closing and hands over. A token Foundry hides from the viewer, or one with no
standee on their board (`tokenAnchor` null), gets no bubble and no pill, and a new
line for it goes to the caption lane. The bubble layer is `--gl-z-sticky`, above
the view's `--gl-z-base`. Every access is guarded, so the feature runs the same
with Diorama off or absent.

**The leave animation is timed in JS.** A line is removed `LEAVE_MS` after it
starts leaving, which must cover `--gl-d-glide`. The check compares the two.

**Foundry clips the chat box.** `#chat-message` is `overflow: hidden` at a fixed
height, so the Say tail and the Think puffs are drawn inside the box's own bottom
padding, not hung below it. The box's content is absolutely placed inside its
container, so the header moves it down with `top`, never padding: a padded line
would scroll under the header.

**An empty box is `<p><br></p>`.** The in-box quotes and Do name are drawn only
when the box is not that, or they sit beside Foundry's placeholder, and a mark
drawn after the paragraph's break lands on a line of its own.

**The typing pill is placed by its own transform.** `.glrp-enter`'s rising
entrance animates `transform`, which would overwrite it; the pill fades in
instead.

**`font-size-adjust` is inherited as a number.** An aside's adjust is computed
from the serif and inherited by its quote marks, which shrinks them on the sans;
the marks reset it.

## Validation

```bash
node tools/roleplay-chat-check.mjs
```

Zero problems required. It imports the pure modules under Node and pins: purity
and nothing at import; the styles, flags and filter rows agreeing across
`rp-mode`, the model, `read-text` and the chat filter; message building, slash
parsing, the composer cycle and speaker resolution; privacy and routing; timing,
stacking and `LEAVE_MS`; key matching; Thai names on Do lines; the aside rule
and its quote edges; the composer's header, icons and in-box marks; the typing
indicator's announce and accept rules and its socket shape; that every markup string is escaped and
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
