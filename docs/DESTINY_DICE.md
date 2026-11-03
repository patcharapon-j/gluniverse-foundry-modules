# Destiny Dice

A d6 fate die thrown with a PF2e check. An opportunity is a narrative edge and
adds nothing; a complication or a blank adds the number the GM set for that
face. The default die is two +4/+2 complications, two blanks and two
opportunities.

## How a fate gets onto a check

There is one road, `applyFate()` in `apply.mjs`, and two ways to reach it.

- The Fated Roll switch in PF2e's check dialog adds the roll option
  `glddf:fated-roll` to the check's own options. PF2e copies it into
  `flags.pf2e.context.options`, and the author's client throws the fate die
  from `createChatMessage`. A hero point reroll carries the option over,
  because PF2e clones the context.
- Add Fate Die in the chat message's context menu, for the GM or the author.

`applyFate` waits for the check's own dice, throws the fate die through Dice So
Nice to the check's own audience (whisper, blind), reads the flag again after
the die lands, then writes the fate, the new total and PF2e's new outcome in
one update. An in-flight set and the flag stop a second fate on one check.
Initiative is excluded: the tracker would never see the bonus.

## What a viewer sees

The strip is drawn by `renderChatMessageHTML` from the `dd.fate` flag through
`view.mjs`. It is skipped on a message the viewer cannot read. The line that
says the fate changed the result ("Failure > Success") follows PF2e's own
"show check outcomes" setting, because it is the degree in words.

The degree is PF2e's rule: `shiftDegree()` in `fate.mjs` applies the natural
20/1 step and then the check's stored `dosAdjustments` (Juggernaut and the
like), so the strip and the card agree.

## The die

The six faces are baked at startup from the face table (`raster.mjs`), so the
die always shows what the table says. The body is Dice So Nice's glass, and
the bump map is its transmission mask (`smoothstep(0.6, 0.9)`): the field sits
above 0.9 so the face is glass, and the glyph and frame sit below 0.6 so they
are solid. A face with a custom image is baked solid so the art does not smear
into the glass. Data URLs carry a `#face.png` suffix to pass DSN's image test.

Die Glow at 0 sends no emissive at all. DSN ignores an intensity of 0, and any
non-black emissive puts the whole tray on its bloom path for the throw.

## Checks

```bash
node tools/destiny-dice-check.mjs
node tools/insight-destiny-motion-check.mjs
node tools/destiny-dice-preview.mjs && node tools/preview-server.mjs 8981
```

The preview is `/.preview/destiny.html` (`view=all|chat|dialog|config|die`,
`preset`, `tier`, `glow`, `checks=1` for the shared browser checks). Run the
browser checks in a visible tab or real-time headless Chrome: a throttled tab
or `--virtual-time-budget` starves Insight's timers.

Only a live session proves the DSN throw itself, the dialog inside PF2e's real
window, and the hero point reroll path.
