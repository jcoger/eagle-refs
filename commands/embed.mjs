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
 * every few batches, so a stopped run keeps what it paid for.
 */
import { existsSync, readFileSync } from "node:fs";
import { config, data } from "../lib/config.mjs";
import { embed, recordInput, recordKey, priceFor } from "../lib/embed.mjs";
import { loadVectors, saveVectors, vectorPath } from "../lib/vectors.mjs";
import { shortError } from "../lib/openrouter.mjs";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const BATCH = 8;        // records per request: images are ~135 KB each, so a request stays near 1.5 MB
const CONCURRENCY = 4;
const SAVE_EVERY = 10;  // batches between saves

const MODEL = config().models.embed;
const DIMS = config().embedDims;
const INDEX = data("index/refs.jsonl");
if (!existsSync(INDEX)) { console.error("embed: no index yet. Run: eagle-refs index"); process.exit(1); }

const records = readFileSync(INDEX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const wanted = records.filter((r) => !r.blank && (r.record === "section" || r.tagged));

// What is already embedded and still current. A store made with another model or size is not reusable.
const old = loadVectors();
const reuse = old && old.model === MODEL && old.dims === DIMS ? old : null;
const have = new Map(); // id -> { key, vec }
const keyOf = new Map(wanted.map((r) => [r.id, recordKey(r, { model: MODEL, dimensions: DIMS })]));
if (reuse) reuse.ids.forEach((id, i) => { if (keyOf.get(id) === reuse.keys[i]) have.set(id, { key: reuse.keys[i], vec: reuse.row(id) }); });
const dropped = reuse ? reuse.ids.length - have.size : 0;

let todo = wanted.filter((r) => !have.has(r.id));
const limit = flag("limit");
if (limit) todo = todo.slice(0, Number(limit));
const price = priceFor(MODEL);

console.log(`embed: ${wanted.length} records, ${have.size} already done, ${todo.length} to embed, model ${MODEL} at ${DIMS} dims`);
if (has("dry-run")) {
  console.log(`  projected spend: $${(todo.length * price).toFixed(2)} (~$${(price * 1000).toFixed(2)} per 1,000 records)\n\n  dry run only, zero API calls made.`);
  process.exit(0);
}

const key = process.env.OPENROUTER_API_KEY;
if (!key && todo.length) { console.error("embed: OPENROUTER_API_KEY is not set. Put it in a .env next to your eagle-refs.config.json."); process.exit(1); }

const save = () => {
  const ids = [...have.keys()];
  saveVectors({ model: MODEL, dims: DIMS, ids, keys: ids.map((id) => have.get(id).key), vectors: ids.map((id) => have.get(id).vec) });
};

let spend = 0, done = 0, failed = 0, firstError = null, batches = 0;
const batchList = [];
for (let i = 0; i < todo.length; i += BATCH) batchList.push(todo.slice(i, i + BATCH));

// One request per batch. If a batch fails, try its records alone, so one bad image costs one record.
async function send(list) {
  const res = await embed(list.map(recordInput), { model: MODEL, dimensions: DIMS, key });
  if (res.ok) {
    spend += res.cost;
    list.forEach((r, i) => have.set(r.id, { key: keyOf.get(r.id), vec: res.vectors[i] }));
    done += list.length;
  } else if (list.length > 1) {
    for (const r of list) await send([r]);
  } else {
    failed++;
    firstError ??= res.error;
  }
}

// Stop and keep the work if the run is interrupted.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { save(); console.log(`\nembed: stopped, saved ${done} records`); process.exit(130); });

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batchList.length) }, async () => {
  while (batchList.length) {
    await send(batchList.shift());
    if (++batches % SAVE_EVERY === 0) save();
    process.stdout.write(`\r  ${done}/${todo.length}  $${spend.toFixed(3)}  failed ${failed}   `);
  }
}));
if (todo.length) console.log();

// Rows for ids that left the index are not in `have`, so saving drops them.
if (todo.length || dropped) save();
console.log(`embed: ${done} records embedded, $${spend.toFixed(4)}${failed ? `, ${failed} failed (${shortError(firstError)})` : ""}${dropped ? `, dropped ${dropped} stale rows` : ""}\n  ${vectorPath()}  (${have.size} vectors)`);
