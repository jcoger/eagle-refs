#!/usr/bin/env node
/**
 * tag: tag every item in the library with a vision model, plus every section of every
 * full-page capture, plus a photo pass on photographs. Results land in the data folder
 * under tags/. Nothing is written to Eagle: that is the write-back step.
 *
 *   eagle-refs tag --dry-run        # counts + price, zero calls
 *   eagle-refs tag --sample 100     # a spread of 100 items + a contact sheet to look at
 *   eagle-refs tag                  # everything not tagged yet
 *   eagle-refs tag --sections-only  # just pass 2, e.g. alongside a running item pass
 *   eagle-refs tag --retag-surface "social post" [--retag-social] [--retag-tag <tag>] [--dry-run]
 *                                   # tag again what an older vocabulary called this surface, every
 *                                   # save from a social host, and/or every item carrying an Eagle tag
 *                                   # (old answers kept in tags/items/.retag/)
 *
 * Passes: 1 items, 2 sections of full pages (not posts), 3 photo, 4 content (lib/content.mjs:
 * the words and build of a saved post).
 *
 * Resumable: one JSON per item (tags/items/<id>.json), per sectioned page
 * (tags/sections/<id>.json), per photo and per post. A re-run only pays for what is missing.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, data, libraryPath } from "../lib/config.mjs";
import { readLibrary, readFolderPaths, sourceOf, isTall } from "../lib/library.mjs";
import { prepImages, prepReading, prepSections, prepThumb } from "../lib/prep.mjs";
import { buildPrompt, parseAnswer } from "../lib/prompt.mjs";
import { SECTION_SURFACES } from "../lib/vocab.mjs";
import { photoTarget, buildPhotoPrompt, parsePhoto } from "../lib/photo.mjs";
import { contentTarget, buildContentPrompt, parseContent, settle } from "../lib/content.mjs";
import { SOCIAL_HOSTS } from "../lib/social.mjs";
import { fetchTweet, tweetIdOf, tweetText } from "../lib/x.mjs";
import { see, shortError } from "../lib/openrouter.mjs";
import { renderTagSheet } from "../lib/tag-sheet.mjs";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const MODEL = flag("model", config().models.tag);
const CONC = Number(flag("concurrency", 8));
const OUT = data("tags");
const IMG = join(OUT, "img");
for (const d of ["items", "sections", "img", "content"]) mkdirSync(join(OUT, d), { recursive: true });

// Measured on the v2 bench, 2026-09-23 (README): GLM per image and per 2-slice page.
const RATE = { image: 0.0004, page: 0.00079, section: 0.0004, content: 0.0008 };

const { items: all } = readLibrary();
const VIDEO = new Set(["mp4", "mov", "m4v", "webm"]);

// Content folders (config "content.folders"), resolved to ids from the library's own
// metadata.json, so this works with Eagle closed. A sub-folder counts too.
const CONTENT_FOLDERS = config().content.folders;
const contentFolderIds = (() => {
  if (!CONTENT_FOLDERS.length) return new Set();
  const paths = readFolderPaths(libraryPath());
  const ids = new Set([...paths].filter(([, p]) => CONTENT_FOLDERS.some((f) => p === f || p.startsWith(`${f}/`))).map(([id]) => id));
  const found = new Set([...paths.values()]);
  for (const f of CONTENT_FOLDERS) if (!found.has(f)) console.log(`  content folder "${f}" is not in the library (yet)`);
  return ids;
})();
const loadItem = (id) => { const f = join(OUT, "items", `${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
const contentOf = (it) => contentTarget(it, loadItem(it.id)?.parsed?.tags, contentFolderIds);

// --- which items --------------------------------------------------------------
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function shuffle(a, r) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

/** A spread, not a random scoop: full pages, untagged and tagged saves, video and PDF all get a look. */
function sampleOf(n) {
  const r = rng(11);
  const groups = [
    [20, (it) => isTall(it)],
    [30, (it) => !it.tags.length && !isTall(it)],
    [30, (it) => it.tags.length && !isTall(it)],
    [5, (it) => VIDEO.has(it.ext)],
    [5, (it) => it.ext === "pdf"],
  ];
  const pick = new Map();
  for (const [k, pred] of groups) for (const it of shuffle(all.filter(pred), r).slice(0, k)) pick.set(it.id, it);
  for (const it of shuffle(all, r)) { if (pick.size >= n) break; pick.set(it.id, it); }
  return [...pick.values()].slice(0, n);
}

const sampleFile = join(OUT, "sample.json");
let targets;
if (flag("sample")) {
  const n = Number(flag("sample"));
  const saved = existsSync(sampleFile) ? JSON.parse(readFileSync(sampleFile, "utf8")) : null;
  const ids = saved?.length === n ? saved : sampleOf(n).map((i) => i.id);
  writeFileSync(sampleFile, JSON.stringify(ids, null, 2));
  const byId = new Map(all.map((i) => [i.id, i]));
  targets = ids.map((id) => byId.get(id)).filter(Boolean);
} else targets = all;
// A site capture's recording is described by watching it (capture.mjs); its first frame is the page
// before it loads, so tagging that frame says "empty grey page". The full-page image beside it is tagged instead.
targets = targets.filter((it) => !(it.tags.includes("site capture") && VIDEO.has(it.ext)));

// --- retag: answers an older vocabulary gave ---------------------------------------
// Moves each matching tags/items/<id>.json to tags/items/.retag/ (the undo: move it back),
// so passes 1 and 4 run again on those items. Everything else stays cached.
const RETAG_SURFACE = flag("retag-surface");
const RETAG_SOCIAL = has("retag-social");
const RETAG_TAG = flag("retag-tag");
if (RETAG_SURFACE || RETAG_SOCIAL || RETAG_TAG) {
  const match = targets.filter((it) => {
    const prev = loadItem(it.id);
    // Already re-tagged once: its oldest answer is the undo, so it is never overwritten.
    if (!prev?.parsed || existsSync(join(OUT, "items", ".retag", `${it.id}.json`))) return false;
    return (RETAG_SURFACE && prev.parsed.tags?.surface === RETAG_SURFACE) || (RETAG_SOCIAL && SOCIAL_HOSTS.has(sourceOf(it.url))) || (RETAG_TAG && it.tags.includes(RETAG_TAG));
  });
  const est = match.reduce((s, it) => s + (isTall(it) ? RATE.page : RATE.image), 0);
  console.log(`retag: ${match.length} items${RETAG_SURFACE ? ` (surface "${RETAG_SURFACE}")` : ""}${RETAG_SOCIAL ? " (social hosts)" : ""}${RETAG_TAG ? ` (tag "${RETAG_TAG}")` : ""}, pass 1 ~$${est.toFixed(2)} plus the content pass on whatever comes back as content (~$${RATE.content}/item)`);
  if (has("dry-run")) { console.log("  dry run only, nothing moved, zero API calls made."); process.exit(0); }
  mkdirSync(join(OUT, "items", ".retag"), { recursive: true });
  for (const it of match) renameSync(join(OUT, "items", `${it.id}.json`), join(OUT, "items", ".retag", `${it.id}.json`));
  console.log(`  moved ${match.length} old answers to ${join(OUT, "items", ".retag")}`);
}

const tall = targets.filter((it) => isTall(it) && it.filePath);
console.log(`tag: ${targets.length} items (${tall.length} full-page), model ${MODEL}`);

if (has("dry-run")) {
  // Section count needs the scaled height only: 1024-wide squares at 15% overlap.
  const slices = tall.reduce((s, it) => s + Math.max(1, Math.ceil((it.height * (1024 / it.width) - 1024 * 0.35) / (1024 * 0.85))), 0);
  const est = (targets.length - tall.length) * RATE.image + tall.length * RATE.page + slices * RATE.section;
  console.log(`  ~${slices} sections\n  estimated spend: $${est.toFixed(2)} (GLM rates measured 2026-09-23)\n\n  dry run only, zero API calls made.`);
  process.exit(0);
}

const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error("OPENROUTER_API_KEY is not set. Put it in a .env next to your eagle-refs.config.json."); process.exit(1); }

let spend = 0, calls = 0, errors = 0, firstError = null;
async function pool(list, fn) {
  const q = [...list];
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, q.length) }, async () => {
    while (q.length) { await fn(q.shift()); done++; process.stdout.write(`\r  ${done}/${list.length}  $${spend.toFixed(3)}  errors ${errors}   `); }
  }));
  console.log();
}

// --- pass 1: items -----------------------------------------------------------------
console.log("pass 1: items");
if (!has("sections-only")) await pool(targets, async (it) => {
  const file = join(OUT, "items", `${it.id}.json`);
  let prev = null;
  if (existsSync(file)) {
    prev = JSON.parse(readFileSync(file, "utf8"));
    // Invalid answers get one more try, not one per run: the enrich job runs on every save.
    if (prev.parsed?.valid || prev.error === "no image" || (prev.attempts ?? 1) >= 2) return;
  }
  const imgs = prepImages(it, IMG);
  if (!imgs.length) { writeFileSync(file, JSON.stringify({ id: it.id, ok: false, error: "no image" })); return; }
  const res = await see({ model: MODEL, prompt: buildPrompt(it, imgs.length, null, { title: true }), images: imgs, key });
  calls++; spend += res.cost ?? 0;
  if (!res.ok) { errors++; firstError ??= res.error; return; } // not cached: retried next run
  writeFileSync(file, JSON.stringify({ id: it.id, model: MODEL, at: new Date().toISOString(), cost: res.cost, ms: res.ms, attempts: (prev?.attempts ?? (prev ? 1 : 0)) + 1, parsed: parseAnswer(res.text) }, null, 2));
});

// --- pass 2: sections of full-page captures -----------------------------------------
console.log("pass 2: sections");
// A long post, thread or feed is read as one post (pass 4), never cut into page sections.
// Decided after pass 1 has answered, so its kind is known.
await pool(tall.filter((it) => !contentOf(it)), async (it) => {
  const file = join(OUT, "sections", `${it.id}.json`);
  if (existsSync(file)) return;
  let slices;
  try { slices = prepSections(it, IMG); }
  catch (e) { errors++; console.log(`\n  skipped ${it.id}: ${e.message}`); return; } // one bad page never stops the run
  const out = [];
  for (const s of slices) {
    const res = await see({ model: MODEL, prompt: buildPrompt(it, 1, s, { title: true }), images: [s.path], key });
    calls++; spend += res.cost ?? 0;
    if (!res.ok) { errors++; firstError ??= res.error; return; } // whole page retried next run, so sections stay complete
    out.push({ n: s.n, total: s.total, y0: s.y0, y1: s.y1, crop: s.path, cost: res.cost, parsed: parseAnswer(res.text, { surfaces: SECTION_SURFACES }) });
  }
  writeFileSync(file, JSON.stringify({ id: it.id, model: MODEL, at: new Date().toISOString(), sections: out }, null, 2));
});

// --- pass 3: the photo pass for new photos and photo-led designs (lib/photo.mjs) -----
// Only items with main tags and no photo result yet, so it is a no-op when nothing is new.
// Gemini by default for this pass: it judges light better than GLM (README, "Photo pass").
if (!flag("sample") && !has("sections-only")) {
  const PHOTO_MODEL = config().models.photo;
  const PDIR = join(OUT, "photo");
  mkdirSync(PDIR, { recursive: true });
  const todo = targets
    .map((it) => { const f = join(OUT, "items", `${it.id}.json`); return { it, res: existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null }; })
    .filter(({ it, res }) => res?.parsed?.valid && photoTarget(res.parsed.tags) && !existsSync(join(PDIR, `${it.id}.json`)));
  console.log(`pass 3: photo (${todo.length} new)`);
  await pool(todo, async ({ it, res }) => {
    const target = photoTarget(res.parsed.tags);
    const img = prepImages(it, IMG)[0];
    if (!img) return;
    const r = await see({ model: PHOTO_MODEL, prompt: buildPhotoPrompt(it, target), images: [img], key });
    calls++; spend += r.cost ?? 0;
    if (!r.ok) { errors++; firstError ??= r.error; return; }
    const ph = parsePhoto(r.text);
    writeFileSync(join(PDIR, `${it.id}.json`), JSON.stringify({ id: it.id, model: PHOTO_MODEL, target, at: new Date().toISOString(), cost: r.cost, valid: ph.valid, photo: ph.photo, note: ph.note, off: ph.off }, null, 2));
  });
}

// --- pass 4: the content pass for saved posts (lib/content.mjs) -----------------------
// Runs in --sample mode too, so the contact sheet shows the read.
if (!has("sections-only")) {
  const CONTENT_MODEL = flag("content-model", config().models.content);
  const CDIR = join(OUT, "content");
  const xLedger = data("x/ledger.jsonl");
  const gone = new Set(existsSync(xLedger) ? readFileSync(xLedger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.status === "unavailable").map((l) => l.id) : []);
  // An invalid read (broken JSON) gets one more try, as pass 1 does; then it stays as it is.
  const prevOf = (id) => { const f = join(CDIR, `${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
  const todo = targets.map((it) => ({ it, target: contentOf(it), prev: prevOf(it.id) })).filter(({ target, prev }) => target && (!prev || (!prev.valid && (prev.attempts ?? 1) < 2)));
  console.log(`pass 4: content (${todo.length} new, model ${CONTENT_MODEL})`);
  let lastX = 0;
  const tweetFor = async (it) => {
    const id = tweetIdOf(it.url);
    if (!id || gone.has(id)) return null;
    // One call at a time, 500ms apart, like x.mjs: the embed endpoint is X's, not ours.
    const wait = lastX + 500 - Date.now();
    lastX = Math.max(Date.now(), lastX + 500);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const t = await fetchTweet(id);
      return t.unavailable ? null : { text: tweetText(t), author: t.user?.screen_name ?? null };
    } catch { return null; } // the image read stands
  };
  await pool(todo, async ({ it, target, prev }) => {
    const { paths, truncated } = prepReading(it, IMG);
    if (!paths.length) return;
    const tweet = await tweetFor(it);
    const r = await see({ model: CONTENT_MODEL, prompt: buildContentPrompt(it, { tiles: paths.length, truncated, tweet, folder: target === "folder" }), images: paths, key });
    calls++; spend += r.cost ?? 0;
    if (!r.ok) { errors++; firstError ??= r.error; return; }
    const c = parseContent(r.text);
    writeFileSync(join(CDIR, `${it.id}.json`), JSON.stringify({ id: it.id, model: CONTENT_MODEL, target, at: new Date().toISOString(), cost: r.cost, attempts: (prev?.attempts ?? (prev ? 1 : 0)) + 1, valid: c.valid, truncated, tiles: paths.length,
      tweet: Boolean(tweet?.text), content: c.valid ? settle(it, c, tweet) : null, read: c.content ?? null, shapeLeaks: c.shapeLeaks ?? [], off: c.off ?? [], ...(c.error ? { error: c.error } : {}) }, null, 2));
  });
}

console.log(`\n  calls ${calls}, errors ${errors}${firstError ? ` (retried next run; first: ${shortError(firstError)})` : ""}, spend this run $${spend.toFixed(3)}`);

// --- contact sheet (sample runs) ----------------------------------------------------
if (flag("sample")) {
  const load = (d, id) => { const f = join(OUT, d, `${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
  const rows = targets.map((it) => ({ it, thumb: prepThumb(it, IMG), result: load("items", it.id), sections: load("sections", it.id), content: load("content", it.id) }));
  const html = renderTagSheet({ rows, model: MODEL, imgDir: IMG });
  writeFileSync(join(OUT, "sample-sheet.html"), html);
  console.log(`  sheet: ${join(OUT, "sample-sheet.html")}`);
}
