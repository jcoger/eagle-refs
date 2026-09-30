/**
 * Is an image blank? Eagle-clipper full-page captures sometimes render the top
 * of a page and leave the rest black (lazy-loaded content never loaded), and a
 * few render solid white. Those slices must never be served to an agent.
 *
 * Zero dependencies: sips shrinks the image to 32x32 and writes a BMP, which is
 * simple enough to read by hand. 32x32, and blank only when no pixel stands out.
 */
import { execFile } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
let n = 0;

export async function luma(path) {
  const out = join(tmpdir(), `eagle-luma-${process.pid}-${n++}.bmp`);
  await run("sips", ["-s", "format", "bmp", "-z", "32", "32", path, "--out", out]);
  const b = readFileSync(out);
  unlinkSync(out);
  const offset = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const h = Math.abs(b.readInt32LE(22));
  const bpp = b.readUInt16LE(28) / 8;
  const row = Math.ceil((w * bpp) / 4) * 4;
  const vals = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = offset + y * row + x * bpp; // BGR(A)
      vals.push(0.114 * b[i] + 0.587 * b[i + 1] + 0.299 * b[i + 2]);
    }
  }
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  // Blank means NOTHING stands out: no pixel 12+ away from the mean. The first rule (8x8,
  // spread < 4) flagged 55 of 63 items wrongly: minimal designs whose detail averaged away.
  const maxDev = Math.max(...vals.map((v) => Math.abs(v - mean)));
  return { mean: Math.round(mean), sd: Math.round(sd), maxDev: Math.round(maxDev), blank: maxDev < 12 };
}
