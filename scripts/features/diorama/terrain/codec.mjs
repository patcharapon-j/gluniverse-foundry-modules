/**
 * Diorama — terrain array codec.
 *
 * Typed arrays are stored in a scene flag as base64 of a run-length encoding.
 * Painted terrain is mostly long runs (a whole floor at 0, a plateau at 6q), so
 * a 60×60 map at 2×2 sub-cells (14 400 entries per layer) packs into a few KB.
 *
 * Pure and dependency-free (btoa/atob exist in browsers and Node ≥ 16).
 *
 * Format, per array: a little-endian stream of runs. Uint8 runs are
 * [count:u8, value:u8]; Int16 runs are [count:u16, value:i16]. A run never
 * exceeds the count field's maximum; a long run is split.
 */

function toBase64(bytes) {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function fromBase64(str) {
  const s = atob(String(str ?? ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** @param {Uint8Array} arr */
export function encodeU8(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 255) n++;
    out.push(n, v);
    i += n;
  }
  return toBase64(Uint8Array.from(out));
}

/**
 * @param {string} str
 * @param {number} length   expected length; the result is always exactly this long
 * @param {number} [fill=0] value for anything the stream does not cover
 */
export function decodeU8(str, length, fill = 0) {
  const out = new Uint8Array(length).fill(fill);
  let bytes;
  try { bytes = fromBase64(str); } catch { return out; }
  let o = 0;
  for (let i = 0; i + 1 < bytes.length && o < length; i += 2) {
    const n = bytes[i], v = bytes[i + 1];
    for (let k = 0; k < n && o < length; k++) out[o++] = v;
  }
  return out;
}

/** @param {Int16Array} arr */
export function encodeI16(arr) {
  const runs = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 65535) n++;
    runs.push(n, v);
    i += n;
  }
  const buf = new Uint8Array(runs.length * 2);
  const dv = new DataView(buf.buffer);
  for (let r = 0; r < runs.length; r += 2) {
    dv.setUint16(r * 2, runs[r], true);
    dv.setInt16(r * 2 + 2, runs[r + 1], true);
  }
  return toBase64(buf);
}

/**
 * @param {string} str
 * @param {number} length
 * @param {number} [fill=0]
 */
export function decodeI16(str, length, fill = 0) {
  const out = new Int16Array(length).fill(fill);
  let bytes;
  try { bytes = fromBase64(str); } catch { return out; }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  for (let i = 0; i + 3 < bytes.length && o < length; i += 4) {
    const n = dv.getUint16(i, true), v = dv.getInt16(i + 2, true);
    for (let k = 0; k < n && o < length; k++) out[o++] = v;
  }
  return out;
}
