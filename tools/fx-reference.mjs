/**
 * Spellsprite's reference bench: fetches the pixelfx reference effects and
 * writes a page that plays our effects beside them on the same PF2e event.
 *
 *   node tools/fx-reference.mjs && node tools/preview-server.mjs
 *   then /.preview/fx-reference.html
 *
 * pixelfx (github.com/patch-gg/pixelfx, MIT, Patch and Hugo Duprez) is a
 * reference to study, never shipped: it is cloned at a pinned commit into
 * .reference/pixelfx/ (gitignored) and the page imports it from there through
 * the preview server. The spellsprite-craft skill says how to use the bench;
 * this tool also confirms every effect that skill's reference map names exists
 * at the pinned commit, since a map pointing at a missing file sends the next
 * draft to study nothing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO = "https://github.com/patch-gg/pixelfx.git";
const PIN = "a84159688af3ca37a4be05a0d422b94451b2e24e"; // 2026-10-31, v0.3.0
const DEST = join(ROOT, ".reference/pixelfx");
const git = (...a) => execFileSync("git", ["-C", DEST, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function fetchReference() {
  if (existsSync(join(DEST, ".git"))) {
    try { if (git("rev-parse", "HEAD") === PIN) return "already at " + PIN.slice(0, 7); } catch { /* refetch below */ }
  } else {
    mkdirSync(DEST, { recursive: true });
    git("init", "-q");
    git("remote", "add", "origin", REPO);
  }
  git("fetch", "-q", "--depth", "1", "origin", PIN);
  git("checkout", "-q", "--detach", "FETCH_HEAD");
  return "fetched " + PIN.slice(0, 7);
}

/** Every `category/name` (or `category/*`) the skill's reference map names must exist. */
function checkSkillMap() {
  const skill = readFileSync(join(ROOT, ".claude/skills/spellsprite-craft/SKILL.md"), "utf8");
  const map = skill.slice(skill.indexOf("## 5. Reference map"));
  const ids = [...new Set([...map.matchAll(/`([a-z]+)\/([a-z*-]+)`/g)].map((m) => m[1] + "/" + m[2]))];
  const fx = join(DEST, "src/fx");
  const missing = ids.filter((id) => {
    const [cat, name] = id.split("/");
    if (!existsSync(join(fx, cat))) return true;
    const files = readdirSync(join(fx, cat)).filter((f) => f.endsWith(".js") && f !== "_lib.js");
    if (name === "*") return files.length === 0;
    if (name.endsWith("-*")) return !files.some((f) => f.startsWith(name.slice(0, -1)));
    return !files.includes(name + ".js");
  });
  return { ids, missing };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spellsprite reference bench</title>
<style>
body{margin:0;padding:16px;background:#121118;color:#ebe9f2;font:13px/1.45 ui-sans-serif,system-ui,sans-serif}
.cmp{display:flex;flex-direction:column;gap:12px;max-width:960px;margin:auto}
h1{margin:0;font-size:18px;font-weight:600}.lede{margin:0;color:#9a96a8;max-width:75ch}
.bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.bar button{font:inherit;font-size:12px;padding:5px 10px;border-radius:4px;border:1px solid #2d2a38;background:#1e1c27;color:#ebe9f2;cursor:pointer}
.bar button.on{background:#8c86ff;color:#121118;border-color:#8c86ff}
.seg{display:inline-flex}.seg button{border-radius:0}.seg button:first-child{border-radius:4px 0 0 4px}.seg button:last-child{border-radius:0 4px 4px 0}.seg button+button{margin-left:-1px}
.lbl{font-size:11px;color:#9a96a8;margin:0 2px 0 6px;letter-spacing:.06em;text-transform:uppercase}
.pane{display:flex;flex-direction:column;gap:4px}.pane h3{margin:0;font-size:13px;font-weight:600}.pane h3 span{font-weight:400;color:#9a96a8}
canvas{width:100%;height:auto;image-rendering:pixelated;border-radius:4px;display:block;background:#000}
#note{font-size:12px;color:#9a96a8;font-family:ui-monospace,monospace}
#err{white-space:pre-wrap;color:#ff8a80;font-family:ui-monospace,monospace}
</style></head><body>
<div class="cmp">
  <h1>Spellsprite reference bench</h1>
  <p class="lede">Top: Spellsprite as shipped. Bottom: the pixelfx reference effect on the same PF2e event, staged on our timeline and drawn through our layers. If the bottom is bigger, denser, brighter or livelier, the top is not done. pixelfx is a side view, so its floor rings read wrong here: study them, don't copy them.</p>
  <div class="bar" id="tabs"></div>
  <div class="bar">
    <span class="lbl">Floor</span><span class="seg" id="floor"><button class="on" data-v="dungeon">Dungeon</button><button data-v="parchment">Parchment</button></span>
    <span class="lbl">Light</span><span class="seg" id="light"><button class="on" data-v="banded">Banded (ours)</button><button data-v="smooth">Smooth (theirs)</button></span>
    <span class="lbl">Palette</span><span class="seg" id="pal"><button class="on" data-v="theirs">Theirs</button><button data-v="ours">Our ramps</button></span>
    <span class="lbl">Speed</span><span class="seg" id="speed"><button data-v="0.25">¼×</button><button data-v="0.5">½×</button><button class="on" data-v="1">1×</button></span>
    <button id="again">Replay</button><button id="seed">New seed</button>
  </div>
  <div id="note"></div>
  <div class="pane"><h3>Spellsprite <span>· shipped</span></h3><canvas id="ours"></canvas></div>
  <div class="pane"><h3>Reference <span>· pixelfx (MIT, Patch &amp; Hugo Duprez), staged on our timeline</span></h3><canvas id="port"></canvas></div>
  <div id="err" hidden></div>
</div>
<script>
addEventListener("error", (e) => { const el = document.getElementById("err"); el.hidden = false; el.textContent += String(e.error?.stack ?? e.message) + "\\n"; });
addEventListener("unhandledrejection", (e) => { const el = document.getElementById("err"); el.hidden = false; el.textContent += String(e.reason?.stack ?? e.reason) + "\\n"; });
</script>
<script type="module" src="/tools/templates/fx-reference-page.mjs"></script>
</body></html>`;

console.log("pixelfx reference: " + fetchReference());
const { ids, missing } = checkSkillMap();
if (missing.length) { console.error(`spellsprite-craft reference map names ${missing.length} effect(s) missing at ${PIN.slice(0, 7)}: ${missing.join(", ")}`); process.exitCode = 1; }
else console.log(`reference map: all ${ids.length} effects present`);
mkdirSync(join(ROOT, ".preview"), { recursive: true });
writeFileSync(join(ROOT, ".preview/fx-reference.html"), PAGE);
console.log("wrote .preview/fx-reference.html — serve with node tools/preview-server.mjs, open /.preview/fx-reference.html");
