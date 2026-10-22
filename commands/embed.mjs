#!/usr/bin/env node
/**
 * embed: one vector per index record (an item or a section of a full page), made from its
 * image and its words together. This is what lets a search match on meaning. Needs the
 * index first; writes index/vectors.f32 + vectors.json in the data folder (lib/vectors.mjs).
 *
 *   eagle-refs embed --dry-run     # count + projected price, nothing sent
 *   eagle-refs embed --limit 200   # embed at most 200 new or changed records
 *   eagle-refs embed               # everything not embedded yet
 *
 * Incremental: a record is sent again only when its image, its words, the model or the
 * vector size changed. Rows for records that left the index are dropped. Progress is saved
 * every few batches, so a stopped run keeps what it paid for. A record whose words changed
 * keeps its old vector until the new one arrives. The run stops (saving first) on a refused
 * key or credit (401, 402, 403) or after several failed batches in a row, and one run at a
 * time holds a lock. It refuses to shrink the store by over a fifth unless --prune is given.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { config, data } from "../lib/config.mjs";
import { embed, recordInput, recordText, recordKey, priceFor } from "../lib/embed.mjs";
import { loadVectors, saveVectors, vectorPath } from "../lib/vectors.mjs";
import { shortError } from "../lib/openrouter.mjs";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const BATCH = 8;        // records per request: images are ~135 KB each, so a request stays near 1.5 MB
const CONCURRENCY = 4;
const SAVE_EVERY = 10;  // batches between saves
const MAX_FAILED_BATCHES = 5;   // in a row, then stop
const REFUSED = new Set([401, 402, 403]);   // a bad key or no credit: every later call fails the same way
const MAX_SHRINK = 0.2; // refuse to drop more than this share of existing rows without --prune
const STALE_LOCK_MS = 3600_000; // the lock is touched on every save; an hour without one means a dead run

const MODEL = config().models.embed;
const DIMS = config().embedDims;
const INDEX = data("index/refs.jsonl");
if (!existsSync(INDEX)) { console.error("embed: no index yet. Run: eagle-refs index"); process.exit(1); }

const records = readFileSync(INDEX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const hasImage = (r) => r.image && existsSync(r.image);
// Items and sections the tags read, plus site captures nobody tagged, when there is an image or words to embed.
const wanted = records.filter((r) => !r.blank && (r.record === "section" || r.tagged || r.capture) && (hasImage(r) || recordText(r)));

// What is already embedded. A store made with another model or size is not reusable.
// A record whose key changed keeps its old vector (marked by its old key) until the new one is made.
const old = loadVectors();
const reuse = old && old.model === MODEL && old.dims === DIMS ? old : null;
const have = new Map(); // id -> { key, vec }
const keyOf = new Map(wanted.map((r) => [r.id, recordKey(r, { model: MODEL, dimensions: DIMS })]));
if (reuse) reuse.ids.forEach((id, i) => { if (keyOf.has(id)) have.set(id, { key: reuse.keys[i], vec: reuse.row(id) }); });
const dropped = reuse ? reuse.ids.length - have.size : 0;
if (dropped > reuse?.ids.length * MAX_SHRINK && !has("prune")) {
  console.error(`embed: refusing to drop ${dropped} of ${reuse.ids.length} existing vectors (the index lost them; is it a partial rebuild?). Run eagle-refs index, or pass --prune to drop them.`);
  process.exit(1);
}

let todo = wanted.filter((r) => have.get(r.id)?.key !== keyOf.get(r.id));
const current = wanted.length - todo.length;
const limit = flag("limit");
if (limit) todo = todo.slice(0, Number(limit));
const price = priceFor(MODEL);

console.log(`embed: ${wanted.length} records, ${current} already done, ${todo.length} to embed, model ${MODEL} at ${DIMS} dims`);
if (has("dry-run")) {
  console.log(`  projected spend: $${(todo.length * price).toFixed(2)} (~$${(price * 1000).toFixed(2)} per 1,000 records)\n\n  dry run only, zero API calls made.`);
  process.exit(0);
}

const key = process.env.OPENROUTER_API_KEY;
if (!key && todo.length) { console.error("embed: OPENROUTER_API_KEY is not set. Put it in a .env next to your eagle-refs.config.json."); process.exit(1); }

// One run at a time, so a hand run and the background job never write the same files.
const LOCK = data(".embed.lock");
mkdirSync(config().dataDir, { recursive: true });
try { if (Date.now() - statSync(LOCK).mtimeMs > STALE_LOCK_MS) rmSync(LOCK, { recursive: true }); } catch {}
try { mkdirSync(LOCK); } catch { console.log("embed: skipped, another embed is running"); process.exit(0); }
process.on("exit", () => { try { rmSync(LOCK, { recursive: true }); } catch {} });

const save = () => {
  const ids = [...have.keys()];
  saveVectors({ model: MODEL, dims: DIMS, ids, keys: ids.map((id) => have.get(id).key), vectors: ids.map((id) => have.get(id).vec) });
  try { utimesSync(LOCK, new Date(), new Date()); } catch {}
};

let spend = 0, done = 0, failed = 0, firstError = null, batches = 0, badRun = 0, stopped = null;
const batchList = [];
for (let i = 0; i < todo.length; i += BATCH) batchList.push(todo.slice(i, i + BATCH));
const fail = (n, error) => { failed += n; firstError ??= error; };

// One request per batch. A batch that failed for a reason that may be about one record (too big, rate limit,
// a server error, a dropped connection) is retried record by record, so one bad image costs one record.
// Any other 4xx is our request, so splitting would only repeat it. Returns how many records failed.
async function send(list) {
  const inputs = [], sent = [];
  for (const r of list) {
    try { inputs.push(recordInput(r)); sent.push(r); } catch (e) { fail(1, e.message); }
  }
  if (!sent.length) return list.length;
  const res = await embed(inputs, { model: MODEL, dimensions: DIMS, key });
  if (res.ok) {
    spend += res.cost;
    sent.forEach((r, i) => have.set(r.id, { key: keyOf.get(r.id), vec: res.vectors[i] }));
    done += sent.length;
    return list.length - sent.length;
  }
  if (REFUSED.has(res.status)) { stopped ??= `${shortError(res.error)}`; fail(sent.length, res.error); return list.length; }
  const splittable = res.status === undefined || res.status === 413 || res.status === 429 || res.status >= 500;
  if (sent.length > 1 && splittable && !stopped) {
    let bad = list.length - sent.length;
    for (const r of sent) bad += await send([r]);
    return bad;
  }
  fail(sent.length, res.error);
  return list.length;
}

// Stop and keep the work if the run is interrupted.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { try { save(); } catch {} console.log(`\nembed: stopped, saved ${done} records`); process.exit(130); });

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batchList.length) }, async () => {
  while (batchList.length && !stopped) {
    const list = batchList.shift();
    try {
      const bad = await send(list);
      badRun = bad === list.length ? badRun + 1 : 0;
      if (badRun >= MAX_FAILED_BATCHES) stopped ??= `${MAX_FAILED_BATCHES} failed batches in a row (${shortError(firstError)})`;
      if (++batches % SAVE_EVERY === 0) save();
    } catch (e) {
      // A throw in here marks the batch failed; it must not take the run (and its paid-for vectors) down with it.
      fail(list.length, e.message);
      badRun++;
    }
    process.stdout.write(`\r  ${done}/${todo.length}  $${spend.toFixed(3)}  failed ${failed}   `);
  }
}));
if (todo.length) console.log();

// Rows for ids that left the index are not in `have`, so saving drops them.
if (todo.length || dropped) save();
console.log(`embed: ${done} records embedded, $${spend.toFixed(4)}${failed ? `, ${failed} failed (${shortError(firstError)})` : ""}${dropped ? `, dropped ${dropped} stale rows` : ""}${stopped ? `\n  stopped early: ${stopped}. What was done is saved; run it again after fixing that.` : ""}\n  ${vectorPath()}  (${have.size} vectors)`);
if (stopped) process.exit(1);
