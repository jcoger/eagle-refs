#!/usr/bin/env node
/**
 * x: the video behind every tweet you saved. Save a tweet the way you already do (Eagle's web
 * clipper or paste-link keeps its link); the background job finds the video and adds it to Eagle
 * next to the save. The motion pass then reads it like any other clip.
 *
 *   eagle-refs x --dry-run      # how many saved tweets are still to check. No network.
 *   eagle-refs x --sample 3     # check (and add the videos of) the first 3
 *   eagle-refs x                # everything not checked yet
 *
 * Each tweet is checked once: a tweet with no video, or one X says is gone, is recorded so it is
 * never asked about again. A failed call is not recorded and is tried next run. Calls are paced
 * half a second apart, because the endpoint is X's public embed endpoint, not an API (lib/x.mjs).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { data, libraryName, libraryPath } from "../lib/config.mjs";
import { readLibrary } from "../lib/library.mjs";
import { openLibrary, addItems } from "../lib/eagle-api.mjs";
import { tweetIdOf, fetchTweet, videosOf, tweetText } from "../lib/x.mjs";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i !== -1 ? argv[i + 1] : null; };
const TAG = "from: X";
const PACE_MS = 500;
const DIR = data("x");
const LEDGER = data("x/ledger.jsonl");
mkdirSync(DIR, { recursive: true });

const VIDEO = new Set(["mp4", "mov", "m4v", "webm"]);
const { items } = readLibrary();
const ledger = new Set(existsSync(LEDGER) ? readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id) : []);
// A tweet already has its video when any video item in the library carries that tweet's link.
const haveVideo = new Set(items.filter((it) => VIDEO.has(it.ext)).map((it) => tweetIdOf(it.url)).filter(Boolean));
const saves = new Map(); // tweet id -> the first save of it (its folders are where the video goes)
for (const it of items) {
  const id = tweetIdOf(it.url);
  if (id && !VIDEO.has(it.ext) && !saves.has(id)) saves.set(id, it);
}
let todo = [...saves].filter(([id]) => !haveVideo.has(id) && !ledger.has(id));
if (flag("sample")) todo = todo.slice(0, Number(flag("sample")));

const allTweets = new Set(items.map((it) => tweetIdOf(it.url)).filter(Boolean));
if (has("dry-run") || !todo.length) {
  console.log(`x: ${todo.length} saved tweets to check (${allTweets.size} tweets saved, ${haveVideo.size} already have their video, ${ledger.size} checked before)`);
  process.exit(0);
}

const open = await openLibrary().catch(() => null);
if (!open) { console.log(`x: Eagle is closed; ${todo.length} tweets wait`); process.exit(0); }
if (String(open).replace(/\/+$/, "") !== libraryPath()) { console.log(`x: open library is ${open}; open ${libraryName()} in Eagle first. ${todo.length} tweets wait`); process.exit(0); }

let added = 0, none = 0, gone = 0, failed = 0, firstError = null;
for (const [id, save] of todo) {
  try {
    const tweet = await fetchTweet(id);
    if (tweet.unavailable) { gone++; appendFileSync(LEDGER, JSON.stringify({ id, status: "unavailable", why: tweet.unavailable, at: new Date().toISOString() }) + "\n"); continue; }
    const vids = videosOf(tweet);
    if (!vids.length) { none++; appendFileSync(LEDGER, JSON.stringify({ id, status: "no video", at: new Date().toISOString() }) + "\n"); continue; }
    const who = tweet.user?.screen_name ?? "x";
    const words = tweetText(tweet);
    const link = `https://x.com/${who}/status/${id}`;
    const ids = [];
    for (const [n, v] of vids.entries()) {
      const res = await fetch(v.url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`video download: HTTP ${res.status}`);
      const file = `${DIR}/${id}${vids.length > 1 ? `-${n + 1}` : ""}.mp4`;
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      // A reply starts with the handles it answers ("@DannPetty @paper Man it seems..."); the name skips them.
      const said = words.replace(/^(@\w+\s+)+/, "");
      // " · " not ":": Eagle strips colons from item names.
      const name = `@${who} · ${said.slice(0, 70) || (v.kind === "gif" ? "GIF" : "video")}${said.length > 70 ? "…" : ""}`;
      const r = await addItems([{ path: file, name, website: link, tags: [TAG],
        annotation: `${words}\n\n@${who} on X, ${String(tweet.created_at ?? "").slice(0, 10)}${v.seconds ? `, ${v.seconds} s` : ""}.`, folders: save.folders }]);
      ids.push(r.ids?.[0] ?? null);
    }
    appendFileSync(LEDGER, JSON.stringify({ id, status: "added", eagleIds: ids, author: who, at: new Date().toISOString() }) + "\n");
    added += ids.length;
  } catch (e) {
    failed++; firstError ??= e.message; // not recorded: tried again next run
  } finally {
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
}
console.log(`x: ${todo.length} tweets checked, ${added} videos added, ${none} had no video, ${gone} unavailable, ${failed} failed${firstError ? ` (retried next run; first: ${firstError.slice(0, 80)})` : ""}`);
