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
 *
 * Resumable: one JSON per item (tags/items/<id>.json) and per sectioned page
 * (tags/sections/<id>.json). A re-run only pays for what is missing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, data } from "../lib/config.mjs";
import { readLibrary, isTall } from "../lib/library.mjs";
import { prepImages, prepSections, prepThumb } from "../lib/prep.mjs";
import { buildPrompt, parseAnswer } from "../lib/prompt.mjs";
import { SECTION_SURFACES } from "../lib/vocab.mjs";
import { photoTarget, buildPhotoPrompt, parsePhoto } from "../lib/photo.mjs";
import { see, shortError } from "../lib/openrouter.mjs";
import { renderTagSheet } from "../lib/tag-sheet.mjs";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const MODEL = flag("model", config().models.tag);
const CONC = Number(flag("concurrency", 8));
const OUT = data("tags");
const IMG = join(OUT, "img");
for (const d of ["items", "sections", "img"]) mkdirSync(join(OUT, d), { recursive: true });

// Measured on the v2 bench, 2026-09-23 (README): GLM per image and per 2-slice page.
const RATE = { image: 0.0004, page: 0.00079, section: 0.0004 };

const { items: all } = readLibrary();
const VIDEO = new Set(["mp4", "mov", "m4v", "webm"]);

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
await pool(tall, async (it) => {
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

console.log(`\n  calls ${calls}, errors ${errors}${firstError ? ` (retried next run; first: ${shortError(firstError)})` : ""}, spend this run $${spend.toFixed(3)}`);

// --- contact sheet (sample runs) ----------------------------------------------------
if (flag("sample")) {
  const load = (d, id) => { const f = join(OUT, d, `${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
  const rows = targets.map((it) => ({ it, thumb: prepThumb(it, IMG), result: load("items", it.id), sections: load("sections", it.id) }));
  const html = renderTagSheet({ rows, model: MODEL, imgDir: IMG });
  writeFileSync(join(OUT, "sample-sheet.html"), html);
  console.log(`  sheet: ${join(OUT, "sample-sheet.html")}`);
}
