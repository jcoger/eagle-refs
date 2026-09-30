/**
 * Turn one Eagle item into the JPEG(s) a vision model sees. macOS `sips` only,
 * no image library.
 *
 * - Normal images: fit inside 1024px. Vision models bill by resolution, not
 *   bytes, so this caps cost without losing what a tagger needs.
 * - Full-page captures (taller than 2.5x wide): scale to 1024 wide, then cut a
 *   top slice and a middle slice. The whole page squeezed into one image is
 *   unreadable at any affordable size; the Eagle thumbnail is 320px wide.
 * - Video, SVG, PDF: Eagle's own thumbnail (its poster frame / render).
 */
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isTall } from "./library.mjs";

const RASTER = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "heic", "bmp", "tif", "tiff"]);
const W = 1024;
const SLICE_H = 1536;

const sips = (args) => execFileSync("sips", args, { stdio: "pipe" });
const hasAlpha = (p) => /hasAlpha: yes/.test(execFileSync("sips", ["-g", "hasAlpha", p], { encoding: "utf8" }));
/**
 * The file the model should see. Transparent images are flattened onto mid-grey
 * (lib/flatten.js): sips flattens onto white, which erased white-on-transparent logos.
 */
function sourceFor(item, cacheDir) {
  const flat = join(cacheDir, `${item.id}-flat.png`);
  if (existsSync(flat)) return flat;
  if (!hasAlpha(item.filePath)) return item.filePath;
  execFileSync("osascript", ["-l", "JavaScript", join(dirname(fileURLToPath(import.meta.url)), "flatten.js"), item.filePath, flat], { stdio: "pipe" });
  return flat;
}
const heightOf = (p) => Number(/pixelHeight: (\d+)/.exec(execFileSync("sips", ["-g", "pixelHeight", p], { encoding: "utf8" }))?.[1] ?? 0);

export function prepImages(item, cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const out = (n) => join(cacheDir, `${item.id}-${n}.jpg`);
  const raster = RASTER.has(item.ext) && item.filePath;
  if (!raster && !item.thumbPath) return [];
  const src = raster ? sourceFor(item, cacheDir) : item.thumbPath;

  try {
    if (raster && isTall(item)) {
      const scaledH = Math.round(item.height * (W / item.width));
      const full = join(cacheDir, `${item.id}-full.jpg`);
      if (!existsSync(full)) sips(["-s", "format", "jpeg", "-s", "formatOptions", "80", "--resampleWidth", String(W), src, "--out", full]);
      // Offset 1, never 0: sips treats --cropOffset 0 as "no offset" and crops the
      // CENTER (found 2026-09-23 on a page whose top was the only non-black part).
      const offsets = [1, Math.max(1, Math.round(scaledH / 2 - SLICE_H / 2))];
      return offsets.map((y, i) => {
        const p = join(cacheDir, `${item.id}-${i ? "mid" : "top"}.jpg`);
        if (!existsSync(p)) sips(["--cropToHeightWidth", String(SLICE_H), String(W), "--cropOffset", String(y), "0", full, "--out", p]);
        return p;
      });
    }
    const p = out(0);
    if (!existsSync(p)) sips(["-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", String(W), src, "--out", p]);
    return [p];
  } catch {
    // Formats sips cannot read (rare avif/heic variants): fall back to Eagle's thumbnail.
    if (!item.thumbPath || src === item.thumbPath) return [];
    const p = out(0);
    if (!existsSync(p)) sips(["-s", "format", "jpeg", "-Z", String(W), item.thumbPath, "--out", p]);
    return [p];
  }
}

/**
 * Cut a full-page capture into overlapping, screen-height sections (square at
 * 1024 wide, 15% overlap so a section cut at a boundary still appears whole in
 * one slice). Returns [{ path, n, total, y0, y1 }] with y in ORIGINAL pixels, so
 * an agent can say where on the page a section sits.
 */
export function prepSections(item, cacheDir, { overlap = 0.15 } = {}) {
  if (!isTall(item) || !item.filePath || !RASTER.has(item.ext)) return [];
  mkdirSync(cacheDir, { recursive: true });
  const scale = W / item.width;
  const full = join(cacheDir, `${item.id}-full.jpg`);
  if (!existsSync(full)) sips(["-s", "format", "jpeg", "-s", "formatOptions", "80", "--resampleWidth", String(W), sourceFor(item, cacheDir), "--out", full]);
  // Measure, never compute: on very tall pages sips rounds differently by a pixel,
  // which puts the last slice back on the bottom edge.
  const scaledH = heightOf(full);
  const step = Math.round(W * (1 - overlap));
  // sips silently returns the WHOLE image when a crop ends exactly on the bottom
  // edge (found 2026-09-23: 10 of 120 last slices were full pages). Stop 1px short.
  const lastTop = Math.max(0, scaledH - W - 1);
  const tops = [];
  // Start at 1, never 0: sips reads offset 0 as "center the crop" (see prepImages).
  for (let y = 1; y < scaledH - W * 0.35; y += step) tops.push(Math.min(y, lastTop));
  const uniq = [...new Set(tops)];
  return uniq.map((y, i) => {
    const h = Math.min(W, scaledH - y - 1);
    const p = join(cacheDir, `${item.id}-sec${String(i + 1).padStart(2, "0")}.jpg`);
    // Re-crop anything missing or wrong-sized, including bad crops cached before the fix.
    if (!existsSync(p) || heightOf(p) > W + 2) sips(["--cropToHeightWidth", String(h), String(W), "--cropOffset", String(y), "0", full, "--out", p]);
    if (heightOf(p) > W + 2) throw new Error(`section crop failed for ${item.id} slice ${i + 1}`);
    return { path: p, n: i + 1, total: uniq.length, y0: Math.round(y / scale), y1: Math.round((y + h) / scale) };
  });
}

/** Small preview for the contact sheet. */
export function prepThumb(item, cacheDir) {
  const [first] = prepImages(item, cacheDir);
  if (!first) return null;
  const p = join(cacheDir, `${item.id}-sheet.jpg`);
  if (!existsSync(p)) sips(["-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", "360", first, "--out", p]);
  return p;
}
