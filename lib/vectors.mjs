/**
 * Vector store: index/vectors.f32 (raw Float32 rows, one per record) beside
 * index/vectors.json (model, dims, the id of each row in order, and the key each was
 * made from). Raw floats, not JSON: 15k rows of 768 is 45 MB and loads in a blink.
 * vectors.json is written last and holds the byte length of vectors.f32 (`bytes`; older
 * stores lack it), so a half-finished save reads as "no store" rather than as wrong rows.
 * A rebuildable cache of the index; delete both files and `eagle-refs embed` redoes them.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { data } from "./config.mjs";

const F32 = () => data("index/vectors.f32");
const META = () => data("index/vectors.json");

/** { model, dims, ids, keys, rows, row(id) -> Float32Array | null }, or null when there is none (or it is torn). */
export function loadVectors() {
  if (!existsSync(F32()) || !existsSync(META())) return null;
  try {
    const m = JSON.parse(readFileSync(META(), "utf8"));
    const buf = readFileSync(F32());
    // Copy out of the Buffer so the floats are aligned.
    if (m.bytes != null && m.bytes !== buf.length) return null;
    const rows = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    if (rows.length !== m.ids.length * m.dims) return null; // an interrupted write: rebuild rather than trust it
    const at = new Map(m.ids.map((id, i) => [id, i]));
    return { ...m, rows, row: (id) => (at.has(id) ? rows.subarray(at.get(id) * m.dims, (at.get(id) + 1) * m.dims) : null) };
  } catch { return null; }
}

/** Write the whole store. Each file goes to a temp name first; the json is renamed last and is the commit point. */
export function saveVectors({ model, dims, ids, keys, vectors }) {
  mkdirSync(data("index"), { recursive: true });
  const rows = new Float32Array(ids.length * dims);
  vectors.forEach((v, i) => rows.set(v, i * dims));
  writeFileSync(`${F32()}.tmp`, new Uint8Array(rows.buffer));
  writeFileSync(`${META()}.tmp`, JSON.stringify({ model, dims, ids, keys, bytes: rows.byteLength }));
  renameSync(`${F32()}.tmp`, F32());
  renameSync(`${META()}.tmp`, META());
}

export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
export const vectorPath = () => F32();
