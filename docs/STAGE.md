# Stage

A cinematic stage for a voice-played table. The GM puts characters on stage,
in the room the scene shows; they are lit by that room. There is no dialogue
box and no quotes: the only text the stage draws is a name card when the camera
pushes in. Call-ins come over the comms. The GM drives everything from one
panel, the Director; players only watch.

## Pieces

```
scripts/features/stage/
  index.mjs, main.mjs   adapter, hooks, the public api (Theatre's bridge)
  settings.mjs          every key (stage.*), registered unconditionally
  model.mjs             normalizers: cast, stage, layout, comms (+ legacy migration)
  store.mjs             the ONLY reader/writer of Stage's values
  channel.mjs           gestures (nod, shake, hop, tremble, lean) over the socket
  overlay.mjs           the host: Foundry in, frames out
  director.mjs          pure: state → one frame (marks, camera, fades, gestures)
  stage-dom.mjs         pure DOM: the canvas and the name card
  timing.mjs            relight timing carried in update options
  asset.mjs             pixel-readable image loading (CORS retry, taint memo)
  light/
    probe.mjs           a picture → numbers describing its light
    backdrop.mjs        a picture → blur levels, bloom, env map, probe; cover maps
    shape.mjs           a character's art → edge / body / soft alpha fields
    rig.mjs             the scene light (stored) → a rig (what the shaders use)
  render/
    shaders.mjs         six GLSL programs + their uniform lists
    gl.mjs              StageGL: one WebGL2 context, draws a frame
    dom-fallback.mjs    the lite renderer: the same frame as plain images
    assets.mjs          prepares art and backdrops for upload
  comms/comms-overlay.mjs   the call-in stack (pure DOM)
  apps/director-app.mjs     the GM's panel
  search.mjs                finding a character, casting an Actor, bringing them in
```

`render/`, `light/`, `comms/`, `director.mjs`, `model.mjs`, `stage-dom.mjs` and
`timing.mjs` read no Foundry global. The preview page drives those exact files.

## Stored values

| key | scope | what |
|---|---|---|
| `stage.cast` | world | the characters: name, epithet, art, facing, height, nudges, face, comms tint |
| `stage.state` | world | shown or not, who is on which mark (and whether as a silhouette), focus, wide/close, push/cut |
| `stage.layout` | world | figure height, floor line, mark span, when name cards show |
| `stage.comms` | world | open calls, who is speaking |
| `stage.commsLayout` | world | edge, alignment, style (holo / radio / clean), size |
| `stage.quality` | client | full (lit) or lite (plain pictures) |
| `stage.breath` | world | an idle breathing sway on the cast (off by default) |
| scene flag `stage.light` | scene | the scene's light: mood, dials, picture override |

All world values are GM-written through `store.mjs` and read back through a
normalizer, so a stale or hand-edited value comes back complete. The scene light
is written as a **forced replacement** (`ForcedReplacement` on v14, `==key` on
v13): Foundry merges a nested update, so a key the new light lacked would
otherwise survive.

## The light

The GM sets a **mood** and a few dials per scene. The mood is `auto` (read the
room from the backdrop picture), a preset room (day, golden, dusk, night, fire,
neon, storm), or `off` (the art as painted). `resolveRig` turns the light plus
the backdrop's probe into a rig; `mood: off` and `strength: 0` are exactly the
identity rig.

| dial | does |
|---|---|
| strength | how much of the whole look applies |
| match | how far the cast is pulled into the room: its hue, its saturation (following the room's own), its level |
| key | a soft key light from the room's brightest direction |
| rim | the near-white stroke just outside the silhouette, and the coloured rims |
| glow | the room's glow: halo beyond the stroke, diffusion, wrap, background bloom |
| blur | how soft the room is behind the cast (the close-up softens it further) |
| grain | film grain |

`darkness` lets the scene's darkness level dim the cast and the room; `flicker`
lets a firelit room flicker.

### What a frame is

1. **Backdrop**: the picture, cover-fit, mixed between a sharp, a mid (640 px,
   blurred 2.5) and a soft (320 px, blurred 4.5) level by `blur`, plus bloom.
   All blurs are done in linear light on the CPU once per picture. A change of
   picture cross-fades over `TIMING.backdrop`, landing with the relight.
2. **Floor shade** under the cast.
3. **Shadows**, all before any figure, so one never lands on another.
4. **Figures**, back to front. Each is graded into the room (saturation toward
   the room's hue, three-way tint, a log-contrast that keeps the painting's
   darks, a soft shoulder), lit by the key and up to two rims that follow the
   room's lights round the form, wrapped and haloed with the room's own light
   read from the env map, and outlined with a stroke measured in **screen pixels**
   (`uStrokePx`, dilated from the alpha) so it stays a hairline at every size.
   Cut edges (art cropped by its frame) get no stroke and no rim.
5. **Veil**: the room's bloom over everything, screened on.
6. **Grain**: a 2× modulate, reseeded at 24 fps.
7. **Vignette and letterbox**.

Every art sample is `textureLod` at a level chosen from the art's size on
screen, which keeps the look identical at every zoom and avoids implicit
derivatives in divergent shader flow.

## Choreography

`director.mjs` is pure: given the cast, the stage state, the layout, the art
info and the room, `step(now)` returns a frame. Entrances slide in from the
nearer edge; exits leave the same way; restaging glides; characters turn to face
into the scene; focus dims and softens everyone else; the close-up pushes the
camera in on the character's head (the face locator's head box, else the shape's
own) and shows the name card. Gestures are moments, never stored: the GM's
client plays one at once and broadcasts it; every other client honours it only
from a sender `meta.attested` says is a GM.

A character can stand as a **silhouette** (`masked` on their mark: entered that
way from the Director's roster, or toggled on stage) while the GM describes
them: the room's deepest shade with only the rim light, the outline and the halo
on it, and no name card. Revealing lifts the dark off like smoke, from the feet
first in soft drifting patches, never along a line (`TIMING.reveal`, eased on
a sine so it neither snaps in nor stops dead); the name card arrives with it. The lite renderer
darkens the picture instead. The art is still in the world's data, so this is
staging, not a secret a player cannot dig out.

Shedding is `Budget.ladder("stage", SHED_ORDER)`, cheapest loss first: grain,
flicker, breath, halo, focus blur, shadows. The WebGL context is
registered with `Surfaces`; a released or lost context is rebuilt on a fresh
canvas from the prepared assets the host keeps.

## Theatre

Theatre reaches Stage only through the feature api, under the old grade names:
`gradeUpdateData` (= `lightUpdateData`), `tweenUpdateOptions`, `gradeFromSrc`
(a light whose picture is the shot's image) and `readSceneGrade` (= `readLight`).
A cut writes the light in the same scene update as `th.state`, with the relight
timing in the update options, so every client relights at the timeline's beat.
While the stage is up it owns the frame: it draws the shot's picture itself,
softened, behind the cast.

It has to draw the **same** picture Theatre was showing, or bringing the cast on
re-frames and re-grades the room and the cast is lit by a room nobody is looking
at. So the light carries `picture` (`light/picture.mjs`): the shot's crop focus
and its treatment's exposure, saturation, tint and blur. The read the backdrop
maps are made from is graded with it before anything is measured, so the probe
(the room the cast is lit by), the bloom and the blur levels are the graded
picture; the shader grades the sharp level the same way, in Theatre's order on
encoded values. The backdrop is cropped about the focus as Theatre's
`coverRect` crops it, and the picture's blur is a floor under the light's
(`max`), so it holds with the light off. A backdrop is held under
`pictureKey(src, picture)`, so one image shown two ways is two backdrops. The
vignette and letterbox are not carried: Stage frames its own, and Theatre's bars
sit in its overlay above. The picture is the shot's, not the light's: Reset in
the Director keeps it, and Clear or Browse drops it with the image.

## Search

Every roster in the Director (Stage, Cast, Comms) has a search box. It filters
the cast by name and title and, under it, offers the world's Actors that are not
cast yet (matched on the actor UUID an entry was made from, so nobody is cast
twice). Enter acts on the first match: Stage brings them on (Shift+Enter:
masked), Cast opens them, Comms calls them in. A world Actor is cast first, then
brought on. Esc clears.

The same search feeds the suite's quick palette (`core/quick-palette.mjs`,
Ctrl+K, GM only) as two groups, the cast and the world's actors. Enter brings a
character on (or takes them off), Ctrl+Enter pushes in on them, Shift+Enter calls
them in (or hangs up), Alt+Enter brings them on masked (or toggles the mask).
`search.mjs` is the one statement of all of it; every write goes through the
store.

## Assets

The art and the backdrop must be **pixel-readable**: from this server, or from a
host that sends CORS headers (S3: allow `GET` from the Foundry origin). An
unreadable character is left off the lit stage with one warning; the lite
renderer draws plain pictures and needs no pixels.

## Checking it

```bash
node tools/stage-check.mjs
node tools/stage-preview.mjs --assets=<dir> && node tools/preview-server.mjs
```

The check drives the normalizers, the migration, the rig across every mood ×
darkness × probe, the backdrop pipeline, the director (entrance, rapid
restaging, close-up, gestures, full shedding, cross-fade), the relight timing,
the forced-replacement write; it requires every uniform declared, listed and
written, every frame field the renderer reads produced, every shed name in
`SHED_ORDER`, every runtime-built i18n family complete, and the pure modules
free of Foundry globals. It cannot compile GLSL: serve the preview and look
(`?view=1..5` shows the shader's debug views: normals, rim light, occlusion,
the light alone, outline and halo).
