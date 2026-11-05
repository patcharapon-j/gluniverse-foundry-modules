# Insight

A private message from the GM that lands on one player's screen (or a few),
that they cannot miss, and that reads the same in any campaign. "The hairs on
your neck rise." "You recognise the sigil." Recall Knowledge uses it to hand a
player the paragraph they earned.

## The arrival

Four beats on one anime.js timeline (`module/notification.mjs`, `TIMINGS`):

1. **The edge.** The room dims toward its edges, the accent rises from all four
   sides, one hairline traces the screen. It lands first and alone, so a player
   looking at their sheet catches it in the corner of their eye.
2. **The cut.** A rule of light draws out from the centre, wider than the card.
3. **The card.** It opens down out of the cut, and one light crosses it.
4. **The words**, in reading order: the label, "Only you", the title, a picture,
   the body, the control.

Then the edge breathes (opacity only) until the player acknowledges. Leaving
starts from whatever is on screen, so an early click never jumps.

The stylesheet holds only resting values. Every animated node is hidden until
its beat by one rule, and `insight-settled` is the resting state on its own,
which the static reference sheet uses. There are no stylesheet keyframes in the
arrival, so a renamed class cannot silently drop a beat.

Speed is a client setting: Normal, Fast (half the durations, tighter beats),
Instant. All of it follows the suite's motion tier; at tier none the card simply
appears and nothing loops.

When the card has settled and nothing else has the keyboard, the Acknowledge
button takes focus without a ring, so Enter or Space answers it. A player typing
in chat keeps their caret.

## The card

A black plate with the suite's chamfer, a solid tone tag naming the sense
(the GM's label, or "Insight"), "Only you" opposite it so the player knows the
table cannot see it, an optional title and picture, the body, and a foot with
the queue count ("2 more waiting") and the one control.

The skin is Ink and Signal (DESIGN.md): core's `--gl-is-*` values aliased as
`--insight-*` on the two roots (`.insight-stage`, `.insight-compose`), never on
`:root`. Every lit part of the arrival reads one tone, `--insight-tone`, set by
the preset: Dreadlight is paper (white light out of a black room), Fantasy is
amber. A preset may set only `PRESET_VARS` in `module/themes.mjs` (the tone,
the edge's per-hue correction `--insight-burn` / `--insight-reach-x/y`, and the
body style), because the edge is the one place a hue covers a whole screen.
A preset another module registered against the old `--gl-accent` still lands:
`registerTheme` reads that value as the tone. The arrival is a cinematic beat,
so it is the one place this skin lets light spill; the compose window is flat.

Screen Edge Alert is a client setting: Full, Subtle (no vignette, half burn,
shorter reach), Off (the card alone).

## Sending

The GM's scene control opens the compose window: a chip per connected user (in
their own Foundry colour), an optional label, the message. A blank line starts
a new paragraph; `<b>` and `<i>` work. The window keeps the draft when someone
connects or leaves.

One card can go to several people at once. Beside "Send to" sit quick picks:
All players, Selected (the connected players who own the tokens the GM has
selected), Targets (the same for the GM's targets) and None. The picks add to
what is ticked, so "Selected" then a click on one more chip works. The Send
button counts who it will reach ("Send to 3").

By default each card still reads "Only you", which is the GM's call: three
players can each believe they alone noticed. "Show who else got it" (two or
more recipients) swaps that tag for "With Kai and Mira", or "With 4 others"
past two names, so the table knows who to talk to. The payload carries only
`shared: true`; each receiver names the others from its own user list
(`module/recipients.mjs`), so a payload can never put a made-up name there.

`sendNotification({ targets, title, body, sense, image, theme, shared })` in
`module/socket.mjs` is the one way out (Recall Knowledge calls it). It is GM
only, and it emits with `recipients`, so the server delivers the payload to the
named users and nobody else.

## Who sees what

- A payload is shown only when the server-attested sender is a GM and this
  user is named in it (`accepts`). A player cannot put a card on anyone's
  screen.
- The body is reduced to a bare-tag allow-list (`p br b strong i em u s del
  code`, no attributes) on the receiving side (`module/body.mjs`). Well formed
  entities pass through, so Recall Knowledge's escaped paragraph arrives
  unchanged.
- Cards queue one at a time; the same id twice is one card.

## Checks

```bash
node tools/insight-check.mjs
node tools/insight-destiny-motion-check.mjs
node tools/recall-check.mjs
node tools/insight-preview.mjs && node tools/preview-server.mjs 8973
```

The preview is `/.preview/insight.html` (`speed`, `only=a,f`, `zoom`). The
motion workshop (`/tools/templates/motion-preview.html`, Run browser checks)
plays the real timeline in a browser.

Only a live session proves the socket (`meta.attested` and `recipients` are the
server's), the sound, and how the edge sits over a real map and Foundry's UI.
