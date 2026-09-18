/**
 * GLUniverse Suite — the stability weave, as the world sees it.
 *
 * The instability the party is standing in, drawn as a weave fraying around the
 * label that names it in the time-tracker HUD. It is the standing cost of the
 * feature — it runs for as long as the party is somewhere unstable, which can be
 * a whole session — and everything about it is shaped by that.
 *
 * It was a fragment shader, and the reason it is not one any more is the useful
 * part. A WebGL context is a heavy thing to hold open all evening so that a
 * strip twenty pixels tall can draw four wavy lines: it carries a compiled
 * program that has to be warmed off-screen at load or the first level change of
 * the session stutters, a colour ramp that has to be pushed as uniforms by hand
 * because GLSL cannot read a CSS custom property, a device-pixel size that has
 * to be recomputed against `devicePixelRatio` AND the suite's Interface Scale
 * zoom, and a draw every frame. Four SVG paths carry none of it. The colour is
 * `--gl-accent`, inherited from the chip, so a retheme and a level change both
 * arrive by themselves; a CSS pixel is a CSS pixel, so a hairline can never go
 * sub-pixel and there is no zoom arithmetic to get wrong; there is nothing to
 * compile, so there is nothing to warm; and the drift is one compositor
 * transform per thread.
 *
 * What it is NOT is less of an effect. The ladder is the same vocabulary drawn
 * the same way — threads through the label that loosen at Fraying, part at
 * Unbound and snap into splayed fibres at Unraveling, reaching further around
 * the word as it worsens — and the numbers behind it are the shader's own,
 * converted out of its field units into CSS pixels in `weave-shape.mjs`.
 *
 * It is deliberately NOT the suite's glass fracture (`core/fx-glsl.mjs`). It ran
 * that field once, and a world coming apart then read as one more thing being
 * broken: a broken creature's token, its initiative card and its health bar all
 * carry that crack. Instability is its own picture.
 *
 * This module is only the half that reads the world — the level, the client's
 * ambient preference, and whether the GM has concealed it. `weave-render.mjs`
 * is the half that draws, and it knows nothing about Foundry, so the preview
 * page can run the real renderer instead of a copy of it.
 *
 * AT STABLE THERE IS NOTHING AT ALL: no element, no timer, no tween. The shader
 * had to keep a warmed context alive there so that leaving Stable did not
 * stutter; there is nothing to warm now, so the rest state is genuinely free.
 */

import { chaosFor } from "./levels.mjs";
import { ambientEnabled, isConcealed, visibleLevel } from "./settings.mjs";
import { WeaveRenderer } from "./weave-render.mjs";
import { weaveParams } from "./weave-shape.mjs";

let renderer = null;
let container = null;

/** What the world currently asks for: 0 at Stable, with the ambient preference
 *  and conceal both able to close it on this client alone. */
function wantedChaos() {
  const level = visibleLevel();
  if (!ambientEnabled()) return 0;
  if (isConcealed() && !game.user.isGM) return 0;
  return chaosFor(level);
}

/**
 * Bring the weave into line with the current level, settings and permissions.
 *
 * `container` is the freshly painted `.glas-stability` the chip now lives in;
 * omitted, the weave stays where it is.
 */
export function syncWeave(host = null) {
  if (host) container = host;
  const chaos = wantedChaos();

  if (chaos <= 0) {
    // Close, then go. The spread is what lets the table notice the world
    // settling rather than be told it did, so the element outlives the decision
    // by exactly one fade.
    renderer?.render(weaveParams(0), () => destroyWeave());
    return;
  }

  renderer ??= new WeaveRenderer();
  if (container) renderer.attach(container);
  renderer.render(weaveParams(chaos));
}

export function destroyWeave() {
  renderer?.destroy();
  renderer = null;
  container = null;
}
