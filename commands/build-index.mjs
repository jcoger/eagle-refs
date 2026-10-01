#!/usr/bin/env node
/**
 * build-index: turn the library + the tagging results into one searchable file for
 * agents: index/refs.jsonl in the data folder, one record per item and one per section
 * of a full-page capture. Read-only on the library; rebuild any time (seconds, plus a
 * one-time blank check per image, cached).
 *
 *   eagle-refs index
 *
 * Merges three sources per item: Eagle's own metadata (name, source link, saved date,
 * stars, your tags), the model's tags/description/move, and code facts (blank-capture
 * flags, live and as-saved links). `record` is item|section; `type` is the typeface facet.
 * Your own tags are kept apart as humanTags and never mixed with model tags.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { data, libraryName, libraryPath } from "../lib/config.mjs";
import { readLibrary, readFolderPaths, sourceOf, isTall } from "../lib/library.mjs";
import { usesOf } from "../lib/uses.mjs";
import { luma } from "../lib/luma.mjs";
import { timeline } from "../lib/motion.mjs";

const LIBRARY = libraryName();
const TAGS = data("tags");
const OUT = data("index");
const IMG = join(TAGS, "img");
mkdirSync(OUT, { recursive: true });

// Where a saved URL is a gallery or a social post, not the live site itself.
const NOT_LIVE = new Set([
  "land-book.com", "landingfolio.com", "pagecollective.com", "saaslandingpage.com", "lapa.ninja",
  "godly.website", "siteinspire.com", "awwwards.com", "onepagelove.com", "cta.gallery",
  "bentogrids.com", "medium.muz.li", "muz.li", "landingrabbit.com", "deck.gallery",
  "reallygoodemails.com", "mobbin.com", "screenlane.com", "dribbble.com", "cdn.dribbble.com",
  "x.com", "twitter.com", "instagram.com", "pinterest.com", "behance.net", "are.na", "cosmos.so",
  "facebook.com", "linkedin.com", "youtube.com", "imgur.com", "fontsinuse.com",
  // Private to the account that saved it: a link only its owner can open is not a live site.
  "mail.google.com", "docs.google.com", "drive.google.com",
  "assets.fontsinuse.com", "iosicongallery.com", "apps.apple.com", "tiktok.com", "threads.net",
]);
const isLive = (host) => host && !NOT_LIVE.has(host) && !/pinimg|cdn|cloudfront|amazonaws|b-cdn|stackpathdns|googleusercontent/.test(host);

// Tags the write-back put on items. They are the model's tags, so they must not come back
// in as yours: that double-counted every match. `added` only ever holds tags the item did
// not already have, so subtracting them never drops one of your own.
const WB_LEDGER = data("writeback/ledger.jsonl");
const toolTags = new Map();
if (existsSync(WB_LEDGER)) {
  for (const l of readFileSync(WB_LEDGER, "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x))) {
    if (!l.added) continue;
    if (!toolTags.has(l.id)) toolTags.set(l.id, new Set());
    for (const t of l.added) toolTags.get(l.id).add(t);
  }
}
const load = (d, id) => { const f = join(TAGS, d, `${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
const firstImage = (it) => {
  for (const suffix of ["top", "0"]) { const p = join(IMG, `${it.id}-${suffix}.jpg`); if (existsSync(p)) return p; }
  return it.thumbPath;
};

// --- blank checks, cached by path + mtime ------------------------------------------
const lumaFile = join(OUT, "luma.json");
const lumaCache = existsSync(lumaFile) ? JSON.parse(readFileSync(lumaFile, "utf8")) : {};
const jobs = [];
const blankOf = (p) => {
  if (!p || !existsSync(p)) return null;
  const k = `v2|${p}|${statSync(p).mtimeMs}`; // v2: 32x32 strict rule
  if (!(k in lumaCache)) jobs.push(k);
  return k;
};

const { items } = readLibrary();
// Folder paths, for what you saved things FOR (lib/uses.mjs). Never a model's call.
const folderPath = readFolderPaths(libraryPath());
const pending = [];
for (const it of items) {
  const tagged = load("items", it.id);
  const sections = isTall(it) ? load("sections", it.id) : null;
  const img = firstImage(it);
  pending.push({ it, tagged, sections, img, imgKey: blankOf(img), secKeys: (sections?.sections ?? []).map((s) => blankOf(s.crop)) });
}
const q = [...new Set(jobs)];
let done = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (q.length) {
    const k = q.shift();
    try { lumaCache[k] = (await luma(k.split("|")[1])).blank; } catch { lumaCache[k] = false; }
    if (++done % 250 === 0) process.stdout.write(`\r  blank checks ${done}/${jobs.length}   `);
  }
}));
writeFileSync(lumaFile, JSON.stringify(lumaCache));

// --- records ------------------------------------------------------------------
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);
const records = [];
let untagged = 0, blankItems = 0, blankSections = 0;

for (const { it, tagged, sections, img, imgKey, secKeys } of pending) {
  const p = tagged?.parsed;
  if (!p?.valid) { untagged++; }
  const host = sourceOf(it.url);
  const liveUrl = isLive(host) ? it.url : null;
  // "from: <source>" tags record where an item came from (a merged library, a sync).
  // Items tagged "App Store" are store listings named "<App> · ...".
  const from = it.tags.find((t) => t.startsWith("from: "))?.slice(6) ?? null;
  const mine = toolTags.get(it.id);
  const humanTags = it.tags.filter((t) => !t.startsWith("from: ") && t !== "App Store" && !mine?.has(t));
  const isAppStore = it.tags.includes("App Store");
  const blank = imgKey ? Boolean(lumaCache[imgKey]) : false;
  if (blank) blankItems++;
  const base = {
    library: LIBRARY,
    name: it.name,
    source: host || null,
    url: it.url || null,
    liveUrl,
    // Wayback resolves to the snapshot nearest the date it was saved.
    asSavedUrl: liveUrl && it.addedAt ? `https://web.archive.org/web/${day(it.addedAt).replace(/-/g, "")}/${liveUrl}` : null,
    savedAt: day(it.addedAt),
    star: it.star || 0,
    humanTags,
    from,
    // All tags, not only yours: once a use is written as a tag it survives a rename of the page-title name.
    uses: usesOf({ name: it.name, url: it.url, tags: it.tags, folderPaths: it.folders.map((f) => folderPath.get(f)).filter(Boolean) }),
    // The name it was saved with, when names.mjs has since renamed it (a search for the old name still hits).
    savedAs: (() => { const n = load("names", it.id); return n?.name && it.name !== n.original ? n.original : null; })(),
    file: it.filePath,
  };
  const ph = load("photo", it.id);
  const photo = ph?.valid && ph.photo.shot !== "none"
    ? { shot: ph.photo.shot, light: ph.photo.light, treatment: ph.photo.treatment, framing: ph.photo.framing, people: ph.photo.people, photoNote: ph.note }
    : {};
  // The motion pass (motion.mjs): what moves (model) and when (measured by code).
  const mo = load("motion", it.id);
  const motion = mo?.parsed?.valid && mo.parsed.kind !== "none"
    ? { motionKind: mo.parsed.kind, trigger: mo.parsed.trigger, motionWhat: mo.parsed.whatMoves, motionMove: mo.parsed.move,
        motionMoveClean: Boolean(mo.parsed.move) && !mo.parsed.moveBanned?.length, motionTiming: timeline(mo.measured), moves: mo.measured.moves, clipSeconds: mo.measured.seconds }
    : {};
  records.push({
    record: "item",
    id: it.id,
    ...base,
    ...(p?.tags ?? {}),
    ...photo,
    ...motion,
    description: p?.description ?? "",
    move: p?.move ?? "",
    moveClean: Boolean(p?.move) && !p?.moveBanned?.length,
    app: isAppStore ? it.name.split(" · ")[0] : (p?.app || null),
    visibleText: p?.visibleText || null,
    image: blank ? null : img,
    width: it.width, height: it.height, ext: it.ext,
    sections: sections?.sections?.length ?? 0,
    tagged: Boolean(p?.valid),
    blank,
  });
  (sections?.sections ?? []).forEach((s, i) => {
    const sb = secKeys[i] ? Boolean(lumaCache[secKeys[i]]) : false;
    if (sb) { blankSections++; return; } // a black slice is not a reference
    if (!s.parsed?.valid) return;
    records.push({
      record: "section",
      id: `${it.id}#${s.n}`,
      parent: it.id,
      ...base,
      ...s.parsed.tags,
      description: s.parsed.description,
      move: s.parsed.move,
      moveClean: Boolean(s.parsed.move) && !s.parsed.moveBanned?.length,
      image: s.crop,
      position: { n: s.n, of: s.total, y0: s.y0, y1: s.y1 },
    });
  });
}

writeFileSync(join(OUT, "refs.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
const meta = {
  builtAt: new Date().toISOString(),
  items: items.length,
  tagged: items.length - untagged,
  sections: records.filter((r) => r.record === "section").length,
  blankItems, blankSections,
  withLiveUrl: records.filter((r) => r.record === "item" && r.liveUrl).length,
  withPhotoPass: records.filter((r) => r.record === "item" && r.light).length,
  withMotion: records.filter((r) => r.record === "item" && r.motionKind).length,
  withUse: records.filter((r) => r.record === "item" && r.uses?.length).length,
};
writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 2));
console.log(`\nindex: ${JSON.stringify(meta)}\n  ${join(OUT, "refs.jsonl")}`);
