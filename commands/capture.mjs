#!/usr/bin/env node
/**
 * capture: record how a live site moves, section by section, and put it in Eagle.
 *
 *   eagle-refs capture             # every save in the "Capture motion" folder not captured yet
 *   eagle-refs capture --dry-run   # what is waiting, zero calls
 *   eagle-refs capture <url>       # one site, report only, nothing goes into Eagle
 *
 * Drop any save whose link is a live site into the Eagle folder "Capture motion" (any parent;
 * config "capture.folder" renames it). The background job records the site, a model reads each
 * section, and two new items land in the same folder: the recording, its note holding the page's
 * choreography section by section, and a full-page image the tagger then cuts into sections.
 * The save itself is never changed. Each site costs about 1 to 2 cents; recording is local.
 * Details: lib/capture.mjs. Needs Playwright (`npm install playwright-core`) and Chrome.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, data, libraryName, libraryPath } from "../lib/config.mjs";
import { readLibrary, readFolderPaths } from "../lib/library.mjs";
import { openLibrary, folderTree, addItems, getItems } from "../lib/eagle-api.mjs";
import { measure } from "../lib/motion.mjs";
import { shortError } from "../lib/openrouter.mjs";
import { capture, noteFor } from "../lib/capture.mjs";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const cfg = config();
const TAG = "site capture";
const LEDGER = data("capture/ledger.jsonl");
mkdirSync(data("capture"), { recursive: true });
const key = process.env.OPENROUTER_API_KEY;

// One URL by hand: report only.
const url = argv.find((a) => /^https?:\/\//.test(a));
if (url) {
  if (!key) { console.error("capture: OPENROUTER_API_KEY missing (put it in a .env next to eagle-refs.config.json)"); process.exit(1); }
  const dir = data("capture", new URL(url).hostname.replace(/^www\./, ""));
  const c = await capture(url, dir);
  console.log(`capture: ${url}: ${c.sections.length} sections, ${c.seconds} s, spend $${c.cost.toFixed(4)}\n  ${join(dir, "report.md")}`);
  process.exit(0);
}

// The queue: saves in the capture folder with a web link, not captured yet, not captures themselves.
const done = new Set(existsSync(LEDGER) ? readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).source) : []);
const paths = readFolderPaths(libraryPath());
const inFolder = (it) => it.folders.some((f) => { const p = paths.get(f) ?? ""; return p === cfg.capture.folder || p.endsWith(`/${cfg.capture.folder}`); });
const todo = readLibrary().items.filter((it) => inFolder(it) && /^https?:\/\//.test(it.url) && !it.tags.includes(TAG) && !done.has(it.id));

if (has("dry-run") || !todo.length) {
  console.log(`capture: ${todo.length} sites waiting in "${cfg.capture.folder}"${todo.length ? `, ~$${(todo.length * 0.015).toFixed(2)}` : ""}${todo.map((it) => `\n  ${it.url}`).join("")}`);
  process.exit(0);
}
if (!key) { console.error("capture: OPENROUTER_API_KEY missing (put it in a .env next to eagle-refs.config.json)"); process.exit(1); }

// One capture at a time: a run takes minutes, and its own adds to Eagle trigger the background job
// again, which would otherwise start recording the same queue. A lock over 2 hours old is stale.
const LOCK = data("capture/.lock");
try { if (Date.now() - statSync(LOCK).mtimeMs > 2 * 3600_000) rmSync(LOCK, { recursive: true }); } catch {}
try { mkdirSync(LOCK); } catch { console.log(`capture: another capture is running; ${todo.length} sites wait`); process.exit(0); }
process.on("exit", () => { try { rmSync(LOCK, { recursive: true }); } catch {} });

// The results go into Eagle, so the configured library has to be the open one.
const open = await openLibrary().catch(() => null);
if (!open) { console.log(`capture: Eagle is closed; ${todo.length} sites wait`); process.exit(0); }
if (String(open).replace(/\/+$/, "") !== libraryPath()) { console.log(`capture: open library is ${open}; open ${libraryName()} in Eagle first. ${todo.length} sites wait`); process.exit(0); }
const folderIds = new Map();
const walk = (fs, prefix) => { for (const f of fs ?? []) { const p = prefix ? `${prefix}/${f.name}` : f.name; folderIds.set(p, f.id); walk(f.children, p); } };
walk(await folderTree(), "");

let ok = 0, failed = 0, spend = 0, firstError = null;
for (const it of todo) {
  const host = new URL(it.url).hostname.replace(/^www\./, "");
  const dir = data("capture", it.id);
  try {
    const c = await capture(it.url, dir);
    spend += c.cost;
    const folder = it.folders.find((f) => { const p = paths.get(f) ?? ""; return p === cfg.capture.folder || p.endsWith(`/${cfg.capture.folder}`); });
    const base = { website: it.url, tags: [TAG], folders: folder ? [folder] : [] };
    const r = await addItems([
      { ...base, path: join(dir, "video.mp4"), name: `${host} · site motion`, annotation: noteFor(c) },
      { ...base, path: join(dir, "page.jpg"), name: `${host} · full page` },
    ]);
    const [videoId, pageId] = r.ids ?? [];
    // The recording's motion record, so the motion pass skips it and search finds it: measured
    // timing from code, the page's choreography from the read.
    if (videoId) {
      const kinds = c.sections.flatMap((s) => s.kinds), triggers = c.sections.flatMap((s) => s.triggers);
      const most = (l, d) => l.length ? [...l.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map())].sort((p, q) => q[1] - p[1])[0][0] : d;
      mkdirSync(data("tags/motion"), { recursive: true });
      writeFileSync(data("tags/motion", `${videoId}.json`), JSON.stringify({ id: videoId, model: c.model, at: c.at, cost: c.cost, measured: measure(join(dir, "video.mp4")),
        parsed: { valid: true, kind: most(kinds, "reveal"), trigger: most(triggers, "scroll"), whatMoves: c.page.choreography, move: c.page.signature[0] ?? "", moveBanned: c.moveBanned } }, null, 2));
      mkdirSync(data("tags/capture"), { recursive: true });
      writeFileSync(data("tags/capture", `${videoId}.json`), JSON.stringify({ id: videoId, source: it.id, ...c }, null, 2));
    }
    appendFileSync(LEDGER, JSON.stringify({ source: it.id, url: it.url, videoId, pageId, sections: c.sections.length, cost: c.cost, at: c.at }) + "\n");
    ok++;
  } catch (e) {
    // Not recorded: a site that failed (a timeout, a spent key) is tried again next run.
    failed++; firstError ??= shortError(e.message);
  }
}
// Confirm the new items exist in Eagle (adds can land a few seconds later).
const added = existsSync(LEDGER) ? readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(-ok).flatMap((l) => [l.videoId, l.pageId]).filter(Boolean) : [];
let seen = 0;
for (let t = 0; t < 6 && seen < added.length; t++) {
  seen = ((await getItems({ ids: added, limit: added.length, fields: ["id"] })).data ?? []).length;
  if (seen < added.length) await new Promise((r) => setTimeout(r, 3000));
}
console.log(`capture: ${ok} sites captured, ${failed} failed${firstError ? ` (retried next run; first: ${firstError})` : ""} | in Eagle: ${seen}/${added.length} items | spend this run $${spend.toFixed(3)}`);
