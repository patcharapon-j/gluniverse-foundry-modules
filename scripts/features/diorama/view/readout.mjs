/**
 * Diorama — the view's cost readout as label/value rows, shared by the
 * Graphics panel and the perf overlay's Diorama section. Pure: it formats what
 * `DioramaRenderer#profile()` returns and takes its localiser as an argument.
 */

const ms = (v) => (v == null ? null : `${v.toFixed(v < 10 ? 2 : 1)} ms`);
const count = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)} M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)} k` : String(v));

/**
 * @param {ReturnType<import("../render/renderer.mjs").DioramaRenderer["profile"]>|null} p
 * @param {(key:string)=>string} T  localise
 * @returns {Array<[string, string]>}
 */
export function readoutRows(p, T) {
  if (!p) return [[T("GLDIO.graphics.readout.view"), T("GLDIO.graphics.readout.closed")]];
  const na = T("GLDIO.graphics.readout.na");
  const shed = p.shed?.level ? `${p.shed.level} / ${p.shed.of} (${p.shed.name})` : T("GLDIO.graphics.readout.none");
  return [
    [T("GLDIO.graphics.readout.gpu"), p.gpuSupported ? (ms(p.gpuMs) ?? "…") : na],
    [T("GLDIO.graphics.readout.cpu"), ms(p.cpuMs) ?? "…"],
    [T("GLDIO.graphics.readout.fps"), p.fps ? String(p.fps) : T("GLDIO.graphics.readout.still")],
    [T("GLDIO.graphics.readout.calls"), count(p.calls)],
    [T("GLDIO.graphics.readout.triangles"), count(p.triangles)],
    [T("GLDIO.graphics.readout.shadows"), String(p.shadowsPerSec)],
    [T("GLDIO.graphics.readout.shed"), shed],
  ];
}
