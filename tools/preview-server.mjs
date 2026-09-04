/**
 * Minimal static server for the local preview pages under .preview/.
 * Exists only so the harness runs as a real page with a live WebGL context —
 * a file:// snapshot does not execute its module script.
 *
 *   node tools/preview-server.mjs [port]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.argv[2] || 8931);
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  /* normalize() hands back a backslash for "/" on Windows, so test both. */
  const path = join(ROOT, rel === "/" || rel === "\\" ? ".preview/bars.html" : rel);
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log("preview server on http://localhost:" + PORT + "/"));
