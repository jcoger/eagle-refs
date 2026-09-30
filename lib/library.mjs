/**
 * Read an Eagle library straight from disk. READ-ONLY: Eagle owns these files,
 * and its docs say to change items through the API, never by editing
 * metadata.json. Reading is safe and needs no running Eagle.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { libraryPath } from "./config.mjs";

// Keep the library out of iCloud Drive and other synced folders: iCloud made conflict
// copies of Eagle's tag files and evicted images to placeholders (README, "Known constraints").

/** Every item in the library (the configured one unless `lib` is given). */
export function readLibrary(lib = libraryPath()) {
  const dir = join(lib, "images");
  const items = [];
  let unreadable = 0;
  for (const d of readdirSync(dir)) {
    if (!d.endsWith(".info")) continue;
    const base = join(dir, d);
    let m;
    // A few files are mid-write while Eagle runs; skip them rather than guess.
    try { m = JSON.parse(readFileSync(join(base, "metadata.json"), "utf8")); } catch { unreadable++; continue; }
    if (m.isDeleted) continue;
    const ext = (m.ext ?? "").toLowerCase();
    const files = readdirSync(base);
    const file = files.find((f) => f === `${m.name}.${m.ext}`)
      ?? files.find((f) => f.toLowerCase().endsWith(`.${ext}`) && !f.endsWith("_thumbnail.png"));
    const thumb = files.find((f) => f.endsWith("_thumbnail.png"));
    items.push({
      id: m.id,
      name: m.name,
      ext,
      width: m.width ?? 0,
      height: m.height ?? 0,
      tags: m.tags ?? [],
      url: m.url ?? "",
      annotation: m.annotation ?? "",
      folders: m.folders ?? [],
      star: m.star ?? 0,
      size: m.size ?? 0,
      addedAt: m.btime ?? m.modificationTime ?? 0,
      filePath: file ? join(base, file) : null,
      thumbPath: thumb ? join(base, thumb) : null,
    });
  }
  return { items, unreadable };
}

/** Folder id -> "Parent/Child" name path, from the library's metadata.json. */
export function readFolderPaths(lib) {
  const meta = JSON.parse(readFileSync(join(lib, "metadata.json"), "utf8"));
  const out = new Map();
  const walk = (fs, prefix) => {
    for (const f of fs ?? []) {
      const p = prefix ? `${prefix}/${f.name}` : f.name;
      out.set(f.id, p);
      walk(f.children, p);
    }
  };
  walk(meta.folders, "");
  return out;
}

export const sourceOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
};

/** Full-page scroll captures: taller than 2.5x their width. */
export const isTall = (it) => it.width > 0 && it.height / it.width > 2.5;
