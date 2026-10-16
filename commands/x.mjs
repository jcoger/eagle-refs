#!/usr/bin/env node
/**
 * x: a saved tweet becomes its media. Save a tweet the way you already do (Eagle's web clipper,
 * paste-link or "Save URL"); the background job asks X what the tweet holds and:
 *   - adds its video (GIFs too) next to the save, for the motion pass to read
 *   - adds its photos, when what you saved was only the link (a bookmark item)
 *   - moves what is left over to Eagle's Trash: the bookmark, and a still that is just the video's
 *     frame. Your own tags, star, folders and note move onto the media first. A tweet with no
 *     media keeps its bookmark.
 *
 *   eagle-refs x --dry-run      # what it would add and move to the Trash. Writes nothing.
 *   eagle-refs x --sample 3     # the first 3 tweets only
 *   eagle-refs x                # everything not done yet
 *
 * Each tweet is checked once: a tweet with no media, or one X says is gone, is recorded so it is
 * never asked about again. A failed call is not recorded and is tried next run. Calls are paced
 * half a second apart, because the endpoint is X's public embed endpoint, not an API (lib/x.mjs).
 * Trashed items stay restorable in Eagle until you empty its Trash; the ledger lists every one.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { data, libraryName, libraryPath } from "../lib/config.mjs";
import { readLibrary } from "../lib/library.mjs";
import { openLibrary, addItems, updateItem, moveToTrash } from "../lib/eagle-api.mjs";
import { tweetIdOf, fetchTweet, videosOf, photosOf, tweetText } from "../lib/x.mjs";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i !== -1 ? argv[i + 1] : null; };
const TAG = "from: X";
const PACE_MS = 500;
const DIR = data("x");
const LEDGER = data("x/ledger.jsonl");
mkdirSync(DIR, { recursive: true });

const VIDEO = new Set(["mp4", "mov", "m4v", "webm"]);
const BOOKMARK = "url"; // what Eagle's "Save URL" makes: a link with a thumbnail, no media
const { items } = readLibrary();
const readJsonl = (f) => existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const ledger = readJsonl(LEDGER);
const last = new Map(ledger.map((l) => [l.id, l]));
const settled = new Set(ledger.filter((l) => l.merged).map((l) => l.id));

// What the write-back put on items is the tool's, not yours: only your own tags and note move.
const toolTags = new Map(), toolNotes = new Map();
for (const l of readJsonl(data("writeback/ledger.jsonl"))) {
  for (const t of l.added ?? []) (toolTags.get(l.id) ?? toolTags.set(l.id, new Set()).get(l.id)).add(t);
  if (l.note) (toolNotes.get(l.id) ?? toolNotes.set(l.id, new Set()).get(l.id)).add(l.note.trim());
}

const tweets = new Map(); // tweet id -> { saves (images and bookmarks), videos }
for (const it of items) {
  const id = tweetIdOf(it.url);
  if (!id) continue;
  const t = tweets.get(id) ?? tweets.set(id, { saves: [], videos: [] }).get(id);
  (VIDEO.has(it.ext) ? t.videos : t.saves).push(it);
}
const ours = new Set(ledger.flatMap((l) => l.eagleIds ?? []));
// To do: tweets never checked (unless you saved the video yourself), and tweets with media whose
// leftovers are not cleaned up yet (the backfill, and a bookmark saved after an earlier check).
let todo = [...tweets].filter(([id, t]) => {
  if (settled.has(id) || !t.saves.length) return false;
  const l = last.get(id);
  if (!l) return !t.videos.some((v) => !ours.has(v.id));
  return l.status === "added" || (l.status === "no video" && t.saves.some((s) => s.ext === BOOKMARK));
});
if (flag("sample")) todo = todo.slice(0, Number(flag("sample")));

const DRY = has("dry-run");
if (!todo.length) {
  console.log(`x: 0 saved tweets to check (${tweets.size} tweets saved, ${settled.size} done, ${ledger.length} checks recorded)`);
  process.exit(0);
}
if (!DRY) {
  const open = await openLibrary().catch(() => null);
  if (!open) { console.log(`x: Eagle is closed; ${todo.length} tweets wait`); process.exit(0); }
  if (String(open).replace(/\/+$/, "") !== libraryPath()) { console.log(`x: open library is ${open}; open ${libraryName()} in Eagle first. ${todo.length} tweets wait`); process.exit(0); }
}

const record = (entry) => appendFileSync(LEDGER, JSON.stringify({ ...entry, at: new Date().toISOString() }) + "\n");
const sameShape = (a, b) => a.width && a.height && b.width && b.height && Math.abs(a.width / a.height - b.width / b.height) < 0.02;
const ownTags = (it) => it.tags.filter((t) => t !== TAG && !toolTags.get(it.id)?.has(t));
const ownNote = (it) => { const n = (it.annotation ?? "").trim(); return n && !toolNotes.get(it.id)?.has(n) ? n : ""; };
const union = (...lists) => [...new Set(lists.flat())];

async function download(url, file) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`media download: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

let videosAdded = 0, photosAdded = 0, trashed = 0, none = 0, fine = 0, gone = 0, failed = 0, firstError = null;
for (const [id, t] of todo) {
  try {
    const tweet = await fetchTweet(id);
    if (tweet.unavailable) { gone++; if (!DRY) record({ id, status: "unavailable", why: tweet.unavailable }); continue; }
    const vids = videosOf(tweet), photos = photosOf(tweet);
    const images = t.saves.filter((s) => s.ext !== BOOKMARK), bookmarks = t.saves.filter((s) => s.ext === BOOKMARK);
    const needVideos = vids.length > 0 && !t.videos.length;
    const needPhotos = photos.length > 0 && bookmarks.length > 0 && !images.length;
    // A still with the video's shape and no photo of that shape is the video's frame, not a photo.
    const frames = images.filter((img) => vids.some((v) => sameShape(v, img)) && !photos.some((p) => sameShape(p, img)));
    const hasMedia = vids.length > 0 || photos.length > 0;
    const leftovers = hasMedia ? [...bookmarks, ...frames] : [];
    if (!needVideos && !needPhotos && !leftovers.length) {
      hasMedia ? fine++ : none++; // fine: its media is already in Eagle and nothing is left over
      if (!DRY) record({ id, status: hasMedia ? "added" : "no video", merged: true }); continue;
    }

    const who = tweet.user?.screen_name ?? "x";
    // Line breaks collapse to spaces: Eagle drops them from names, which ran words together.
    const words = tweetText(tweet);
    const said = words.replace(/\s+/g, " ").trim().replace(/^(@\w+\s+)+/, ""); // a reply opens with the handles it answers
    const link = `https://x.com/${who}/status/${id}`;
    const byline = `@${who} on X, ${String(tweet.created_at ?? "").slice(0, 10)}`;
    // " · " not ":": Eagle strips colons from item names.
    const nameFor = (fallback, n, of) => `@${who} · ${said.slice(0, 70) || fallback}${said.length > 70 ? "…" : ""}${of > 1 ? ` · ${n} of ${of}` : ""}`;
    // What moves from the leftovers onto the media: your tags, folders, star and note.
    const carry = { tags: union(...leftovers.map(ownTags)), folders: union(t.saves[0].folders ?? [], ...leftovers.map((s) => s.folders ?? [])),
      star: Math.max(0, ...leftovers.map((s) => s.star ?? 0)), notes: union(leftovers.map(ownNote).filter(Boolean)) };
    const yourNote = carry.notes.length ? `\n\nYour note on the save: ${carry.notes.join("\n\n")}` : "";

    if (DRY) {
      console.log(`${link}\n  add: ${needVideos ? `${vids.length} video` : ""}${needVideos && needPhotos ? ", " : ""}${needPhotos ? `${photos.length} photo` : ""}${!needVideos && !needPhotos ? "nothing (already there)" : ""}`
        + `\n  to Trash: ${leftovers.map((s) => `${s.id} (${s.ext === BOOKMARK ? "bookmark" : "video frame"})`).join(", ") || "nothing"}`
        + (carry.tags.length || carry.star || carry.notes.length ? `\n  carried over: ${[carry.tags.length && `tags ${carry.tags.join(", ")}`, carry.star && `${carry.star} stars`, carry.notes.length && "your note"].filter(Boolean).join("; ")}` : ""));
      continue;
    }

    const newIds = [];
    const add = async (file, name, annotation) => {
      const r = await addItems([{ path: file, name, website: link, tags: union([TAG], carry.tags), annotation, folders: carry.folders }]);
      const eid = r.ids?.[0] ?? null;
      if (eid && carry.star) await updateItem({ id: eid, star: carry.star });
      newIds.push(eid);
    };
    if (needVideos) for (const [n, v] of vids.entries()) {
      const file = await download(v.url, `${DIR}/${id}${vids.length > 1 ? `-${n + 1}` : ""}.mp4`);
      await add(file, nameFor(v.kind === "gif" ? "GIF" : "video", n + 1, vids.length), `${words}\n\n${byline}${v.seconds ? `, ${v.seconds} s` : ""}.${yourNote}`);
      videosAdded++;
    }
    if (needPhotos) for (const [n, p] of photos.entries()) {
      const file = await download(p.url, `${DIR}/${id}-photo${photos.length > 1 ? `-${n + 1}` : ""}.${p.ext}`);
      await add(file, nameFor("photo", n + 1, photos.length), `${words}\n\n${byline}.${yourNote}`);
      photosAdded++;
    }
    // Media added on an earlier run (the backfill): the carried tags, folders, star and note go onto it now.
    if (!needVideos && !needPhotos && (carry.tags.length || carry.star || carry.notes.length || carry.folders.length)) {
      for (const v of t.videos) {
        await updateItem({ id: v.id, tags: union(v.tags, carry.tags), folders: union(v.folders ?? [], carry.folders),
          ...(carry.star > (v.star ?? 0) ? { star: carry.star } : {}), ...(yourNote && !(v.annotation ?? "").includes(yourNote.trim()) ? { annotation: `${v.annotation ?? ""}${yourNote}` } : {}) });
      }
    }
    // Last, once the media is safely in Eagle.
    if (leftovers.length) { await moveToTrash(leftovers.map((s) => s.id)); trashed += leftovers.length; }
    record({ id, status: needVideos || t.videos.length ? "added" : "photos added", eagleIds: [...(ours.has(t.videos[0]?.id) ? t.videos.map((v) => v.id) : []), ...newIds],
      author: who, trashed: leftovers.map((s) => ({ id: s.id, ext: s.ext, name: s.name })), merged: true });
  } catch (e) {
    failed++; firstError ??= e.message; // not recorded: tried again next run
  } finally {
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
}
if (DRY) console.log(`x: dry run, ${todo.length} tweets planned above, nothing written`);
else console.log(`x: ${todo.length} tweets checked, ${videosAdded} videos and ${photosAdded} photos added, ${trashed} leftovers moved to Eagle's Trash, ${fine} already right, ${none} had no media (bookmark kept), ${gone} unavailable, ${failed} failed${firstError ? ` (retried next run; first: ${firstError.slice(0, 80)})` : ""}`);
