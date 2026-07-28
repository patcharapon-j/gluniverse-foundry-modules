# Converting an existing statblock

The **convert** path. The user pastes a statblock — from a PDF, Archives of
Nethys, a third-party book, a homebrew doc — and wants it in importer format.

**The prime directive of this path is fidelity.** You are transcribing, not
designing. Do not add an engine, do not add functions, do not rebalance numbers,
do not invent abilities. If the source is unbalanced, transcribe it and say so
in one line afterwards.

The only thing you *may* change without asking is pre-Remaster vocabulary, and
you must list what you changed.

## Procedure

1. **Identify the source's era.** Look for `flat-footed`, `negative`/`positive`
   damage, alignment traits (`CE`, `LG`, `N`), spell school traits
   (`necromancy`, `evocation`), "Attack of Opportunity". Any of these means
   pre-Remaster.
2. **Transcribe the head** — level, rarity, size, traits, Perception, senses,
   languages, skills, ability modifiers, AC, saves, HP, immunities, weaknesses,
   resistances, speed.
3. **Transcribe strikes** into `## Attacks`. The `1` / `2` glyph before an
   ability name in a PDF is its action cost.
4. **Transcribe abilities** into `## Actions`, mapping the glyphs:
   - no glyph, or "Constant"/"Aura" → `Type: passive`
   - one action glyph → `Type: action`, `Actions: 1`
   - two / three → `Actions: 2` / `3`
   - "Trigger …" present → `Type: reaction`
   - a free-action diamond → `Type: free`
5. **Transcribe spellcasting** into `## Spellcasting`, one entry per tradition
   and preparation type. Use exact official spell names so they match the
   compendium.
6. **Auras** go in `## Effects` with a `Radius:`.
7. **Verify**: `node tools/parse-check.mjs <file>`, and resolve every warning.
8. **Report** what you normalised and anything you could not represent.

## Remaster normalisation table

Apply these silently but list them in the report.

| Pre-Remaster | Remaster |
|---|---|
| `flat-footed` | `off-guard` |
| `negative` damage / energy | `void` |
| `positive` damage / energy | `vitality` |
| `negative healing` | `void healing` |
| Alignment traits `CE` `CN` `CG` `LE` `LN` `LG` `NE` `NG` `N` | Delete. Use `holy` / `unholy` only where the source clearly means a fiend or celestial. |
| Alignment damage (`good`, `evil`, `lawful`, `chaotic` damage) | `spirit` damage, with `holy` or `unholy` on the ability |
| Spell school traits (`abjuration`, `conjuration`, `divination`, `enchantment`, `evocation`, `illusion`, `necromancy`, `transmutation`) | Delete. Schools no longer exist. |
| `Attack of Opportunity` | **`Reactive Strike`** |
| `Athletics check to Grapple/Trip/Shove` | Keep the check; the actions are unchanged |
| `magical` on a creature ability | Usually becomes the specific tradition trait: `arcane`, `divine`, `occult`, `primal` |
| `Cast a Spell` requiring both `somatic` and `verbal` | `concentrate` + `manipulate` |
| Deity/plane names: `Chaotic Evil outsider` etc. | Creature type traits only: `fiend`, `celestial`, `monitor` |
| Language `Abyssal` / `Infernal` | `Chthonian` / `Diabolic` |
| Language `Celestial` | `Empyrean` |
| Language `Draconic` | `Draconic` (unchanged) |
| Language `Terran` / `Auran` / `Aquan` / `Ignan` | `Petran` / `Sussuran` / `Thalassic` / `Pyric` |
| Language `Undercommon` | `Sakvroth` |
| Language `Giant` | `Jotun` |
| Language `Gnoll` | `Kholo` |
| `Gnoll` creature | `Kholo` |

If a rename is ambiguous — the source's `magical` could be any tradition —
choose the one the creature's other traits imply and say which you chose.

## Things that will not transcribe cleanly

Say so explicitly rather than approximating in silence:

- **Bespoke attack-effect riders** (venoms, diseases, curses). Only `grab`,
  `improved-grab`, `knockdown`, `improved-knockdown`, `push` and
  `improved-push` resolve as `Effects:` slugs. Put everything else in the
  strike's `Description:` and, if it is a full poison track, give it its own
  `## Actions` block with the stages written out.
- **Critical-hit-only damage.** The NPC strike model cannot represent it as a
  damage category; it is preserved as text and the parser warns.
- **Spells not in the compendium.** Homebrew or third-party spells are dropped
  with a warning. Re-express short ones as `## Actions` abilities.
- **Regeneration / rejuvenation with conditions.** Transcribe as an action; the
  deactivation clause is prose.
- **Anything keyed to a subsystem the source book defines.** Transcribe the text
  and flag that the subsystem does not come with it.

## Third-party sources

Third-party statblocks are frequently off-benchmark. Transcribe faithfully, then
add one short note comparing the key numbers against
`references/benchmarks.md` — for example: "AC 23 at level 6 is Moderate; HP 140
is well above the High band of 123, so this fights longer than its level
suggests."

Do not silently correct it. The user asked for a conversion.

## Offering the upgrade

After a faithful conversion, if the creature is clearly a set-piece — a named
boss, a recurring villain, a lieutenant — you may offer **one line**:

> Want me to give this an `## Engine` section and tag its six functions so the
> Ultimates counter works?

Do not do it unasked, and do not make the offer for rank-and-file creatures.
