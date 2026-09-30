#!/usr/bin/env node
/**
 * writeback: put the model's tags and notes onto the items in Eagle, so they show
 * while browsing and Eagle's AI Search can use them.
 *
 *   eagle-refs writeback                    # dry run: what would change, zero writes
 *   eagle-refs writeback --run --sample 20  # 20 varied items, to look at in Eagle first
 *   eagle-refs writeback --run              # everything not yet written (resumable)
 *   eagle-refs writeback --undo             # take back every tag and note this tool added
 *   eagle-refs writeback --photo [--run]    # the photo pass: light, shot, treatment + a note line
 *   eagle-refs writeback --sections [--run] # full pages: tag what sections they contain
 *   eagle-refs writeback --motion [--run]   # GIFs and videos: motion type, trigger, measured timing
 *   eagle-refs writeback --uses [--run]     # what you saved it FOR (config "uses", lib/uses.mjs)
 *   eagle-refs writeback --names [--run]    # readable names from `names`; --undo --names restores the old ones
 *   (--undo with one of --sections, --motion, --uses, --names takes back only that one)
 *
 * --sections puts each full-page capture's section types on the page itself (group
 * "Sections"), using the same tag names as single saves, so one "pricing" filter in Eagle
 * finds saved pricing screenshots AND every page with a pricing section. Crops never
 * become Eagle items; section-level search lives in refs.mjs.
 *
 * Rules:
 * - Add only. Your own tags are never removed or renamed.
 * - Plain tags ("hero", "dark", "card grid"), grouped into Eagle tag groups per facet.
 *   No colours on the groups.
 * - Notes get "<description>\n\nMove: <move>" only where the notes field is empty.
 * - Blank Eagle-clipper captures get one tag, "incomplete capture", and nothing else.
 * - An item already in the ledger is never written again, so a tag you delete stays deleted.
 * Writes go through Eagle's V2 API into the OPEN library, which must be the configured one.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, data, libraryName, libraryPath } from "../lib/config.mjs";
import { openLibrary, getItems, updateItem } from "../lib/eagle-api.mjs";
import { readLibrary } from "../lib/library.mjs";

const OUT = data("writeback");
// Eagle's API only ever writes to the library that is open, so every write checks it first.
const isConfigured = (open) => String(open).replace(/\/+$/, "") === libraryPath();
mkdirSync(OUT, { recursive: true });
const LEDGER = join(OUT, "ledger.jsonl");
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

// Facet -> Eagle tag group. A value that appears in two facets goes to the first.
const GROUPS = [["kind", "Kind"], ["surface", "Surface"], ["platform", "Platform"], ["theme", "Theme"],
  ["type", "Typeface"], ["style", "Style"], ["pattern", "Pattern"], ["component", "Component"], ["industry", "Industry"]];
const SKIP = new Set(["none", "unclear"]);
// Where you already have a spelling for the same idea, write yours (config "tagAliases").
const ALIAS = config().tagAliases;
const BLANK_TAG = "incomplete capture";

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const ledger = existsSync(LEDGER) ? readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
// Replay the ledger in order: an undo marker clears what came before it for that item.
const written = new Set(), photoWritten = new Set(), sectionsWritten = new Set(), motionWritten = new Set(), mainNote = new Map();
// Uses are per item AND per use: a second use added later still lands on an item that has the first.
const usesWritten = new Map();
const namesWritten = new Set();
// The newest note this tool wrote on each item: another line may only go on a note nobody has edited since.
const lastNote = new Map();
for (const l of ledger) {
  // A sections-only undo leaves the main and photo writes standing.
  if (l.undone && l.scope === "uses") { usesWritten.delete(l.id); continue; }
  if (l.undone && l.scope === "names") { namesWritten.delete(l.id); continue; }
  if (l.undone && (l.scope === "sections" || l.scope === "motion")) { (l.scope === "motion" ? motionWritten : sectionsWritten).delete(l.id); if ("note" in l) lastNote.set(l.id, l.note); continue; }
  if (l.undone) { written.delete(l.id); photoWritten.delete(l.id); sectionsWritten.delete(l.id); motionWritten.delete(l.id); usesWritten.delete(l.id); namesWritten.delete(l.id); mainNote.delete(l.id); lastNote.delete(l.id); continue; }
  if (l.note) lastNote.set(l.id, l.note);
  if (l.photo) photoWritten.add(l.id);
  else if (l.sections) sectionsWritten.add(l.id);
  else if (l.motion) motionWritten.add(l.id);
  else if (l.names) namesWritten.add(l.id);
  else if (l.uses) { const u = usesWritten.get(l.id) ?? usesWritten.set(l.id, new Set()).get(l.id); for (const t of l.added ?? []) u.add(t); for (const t of l.planned ?? []) u.add(t); }
  else { written.add(l.id); if (l.note) mainNote.set(l.id, l.note); }
}
const PHOTO = has("photo");
const SECTIONS = has("sections");
// --motion: what the motion pass (motion.mjs) found in GIFs and videos: group "Motion" + a note line.
const MOTION = has("motion");
// --uses: what you saved it FOR (lib/uses.mjs), from your tag, the page title or a folder. Group "Use".
const USES = has("uses");
// --names: readable names from names.mjs, only where the item still has the name it was saved with.
const NAMES = has("names");
// --repair-blank: items that got only "incomplete capture" under an earlier, looser blank rule
// (8x8, which flagged 55 of 63 wrongly) and are not blank under the current one.
const REPAIR = has("repair-blank");
// The photo pass (tag, pass 3) gets its own groups. "none" and "unclear" are never tags.
const PHOTO_GROUPS = [["shot", "Shot"], ["light", "Light"], ["treatment", "Treatment"], ["framing", "Framing"], ["people", "People"]];

// The index already joins tags, blank flags and item ids.
const records = readFileSync(data("index/refs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const index = records.filter((r) => r.record === "item");
// Section records by page, top to bottom. Blank sections never reach the index.
const sectionsOf = new Map();
for (const s of records) if (s.record === "section") (sectionsOf.get(s.parent) ?? sectionsOf.set(s.parent, []).get(s.parent)).push(s);
for (const list of sectionsOf.values()) list.sort((a, b) => a.position.n - b.position.n);

function planFor(r) {
  if (r.blank) return { tags: [BLANK_TAG], groups: {}, note: null };
  if (!r.tagged) return null;
  const tags = [];
  const groups = {};
  for (const [facet, group] of GROUPS) {
    for (let v of list(r[facet])) {
      if (!v || SKIP.has(v)) continue;
      v = ALIAS[v] ?? v;
      if (tags.includes(v)) continue;
      tags.push(v);
      groups[v] = group;
    }
  }
  const note = r.description ? `${r.description}${r.move ? `\n\nMove: ${r.move}` : ""}` : null;
  return { tags, groups, note };
}

function planPhoto(r) {
  if (!r.light || r.blank) return null;
  const tags = [], groups = {};
  for (const [facet, group] of PHOTO_GROUPS) {
    for (const v of list(r[facet])) {
      if (!v || SKIP.has(v) || tags.includes(v)) continue;
      tags.push(v); groups[v] = group;
    }
  }
  return tags.length ? { tags, groups, photoLine: r.photoNote ? `Photo: ${r.photoNote}` : null } : null;
}

// Sections nearly every page has. As tags they would bury the real single saves under those
// names (a "hero" filter returning 830 full pages), so they go in the note line only.
// Share of 991 pages in one reference library: hero 84%, feature sections 78%, footer 63%, content 43%.
// nav (4 pages) is part of the hero, not a section anyone filters for.
const SECTION_NOTE_ONLY = new Set(["hero", "feature sections", "footer", "content", "nav"]);

function planSections(r) {
  const secs = sectionsOf.get(r.id);
  if (!secs?.length || r.blank) return null;
  const order = [];
  for (const s of secs) {
    const v = ALIAS[s.surface] ?? s.surface;
    if (!v || SKIP.has(v)) continue;
    if (order.at(-1) !== v) order.push(v); // "feature sections" three times in a row reads once
  }
  if (!order.length) return null;
  const tags = [...new Set(order)].filter((t) => !SECTION_NOTE_ONLY.has(t));
  return { tags, groups: Object.fromEntries(tags.map((t) => [t, "Sections"])), sectionsLine: `Sections, top to bottom: ${order.join(", ")}.` };
}

// Trigger values read badly alone as tags ("tap"), so they say when: "on tap".
const TRIGGER_TAG = { tap: "on tap", swipe: "on swipe", scroll: "on scroll", hover: "on hover", drag: "on drag", load: "on load", "auto loop": "auto loop" };
function planMotion(r) {
  if (!r.motionKind || r.blank) return null;
  const tags = [r.motionKind, TRIGGER_TAG[r.trigger]].filter(Boolean);
  return { tags, groups: Object.fromEntries(tags.map((t) => [t, "Motion"])), motionLine: `Motion: ${r.motionWhat} Timing (measured): ${r.motionTiming}.` };
}

function planNames(r) {
  if (namesWritten.has(r.id)) return null;
  const f = data("tags/names", `${r.id}.json`);
  if (!existsSync(f)) return null;
  const n = JSON.parse(readFileSync(f, "utf8"));
  return n.name && n.name !== n.original ? { tags: [], groups: {}, rename: { from: n.original, to: n.name } } : null;
}

function planUses(r) {
  const tags = (r.uses ?? []).filter((u) => !usesWritten.get(r.id)?.has(u));
  return tags.length ? { tags, groups: Object.fromEntries(tags.map((t) => [t, "Use"])) } : null;
}

// ---------------------------------------------------------------- undo
if (has("undo")) {
  const open = await openLibrary();
  if (!isConfigured(open)) { console.error(`Open library is ${open}; open ${libraryName()} in Eagle first.`); process.exit(1); }
  // Newest first, so a photo line comes off before the note it was appended to.
  // --undo --sections takes back only the Sections roll-up.
  const live = ledger.filter((l) => !l.undone && (!SECTIONS || l.sections) && (!MOTION || l.motion) && (!USES || l.uses) && (!NAMES || l.names) && (l.photo ? photoWritten : l.sections ? sectionsWritten : l.motion ? motionWritten : l.uses ? usesWritten : l.names ? namesWritten : written).has(l.id)).reverse();
  let n = 0;
  for (let i = 0; i < live.length; i += 200) {
    const chunk = live.slice(i, i + 200);
    const cur = new Map(((await getItems({ ids: chunk.map((l) => l.id), limit: 200, fields: ["id", "name", "tags", "annotation"] })).data ?? []).map((it) => [it.id, it]));
    for (const l of chunk) {
      const it = cur.get(l.id);
      if (!it) continue;
      const tags = it.tags.filter((t) => !l.added.includes(t));
      const fields = { id: l.id, tags };
      // A name goes back only if nobody has renamed the item since.
      if (l.names && l.name && it.name === l.name) fields.name = l.prevName;
      if (l.note && it.annotation === l.note) fields.annotation = (l.sections || l.motion) ? (l.prevNote ?? "") : l.photo ? l.note.replace(/\s*Photo: [\s\S]*$/, "") : "";
      await updateItem(fields);
      appendFileSync(LEDGER, JSON.stringify({ id: l.id, undone: true, ...(l.uses ? { scope: "uses" } : {}), ...(l.names ? { scope: "names" } : {}), ...((l.sections || l.motion) ? { scope: l.sections ? "sections" : "motion", ...("annotation" in fields ? { note: fields.annotation } : {}) } : {}), at: new Date().toISOString() }) + "\n");
      n++;
    }
  }
  console.log(`undone: ${n} items (tag groups left in place; remove them in Eagle if wanted)`);
  process.exit(0);
}

// ---------------------------------------------------------------- plan
const lastMain = new Map();
for (const l of ledger) { if (l.undone) lastMain.delete(l.id); else if (!l.photo) lastMain.set(l.id, l); }
let candidates = REPAIR
  ? index.filter((r) => { const l = lastMain.get(r.id); return l && l.added?.length === 1 && l.added[0] === BLANK_TAG && !r.blank && r.tagged; })
      .map((r) => ({ r, plan: planFor(r) }))
  : PHOTO
  ? index.filter((r) => !photoWritten.has(r.id)).map((r) => ({ r, plan: planPhoto(r) })).filter((x) => x.plan)
  : SECTIONS
  ? index.filter((r) => !sectionsWritten.has(r.id)).map((r) => ({ r, plan: planSections(r) })).filter((x) => x.plan)
  : MOTION
  ? index.filter((r) => !motionWritten.has(r.id)).map((r) => ({ r, plan: planMotion(r) })).filter((x) => x.plan)
  : USES
  ? index.map((r) => ({ r, plan: planUses(r) })).filter((x) => x.plan)
  : NAMES
  ? index.map((r) => ({ r, plan: planNames(r) })).filter((x) => x.plan)
  : index.filter((r) => !written.has(r.id)).map((r) => ({ r, plan: planFor(r) })).filter((x) => x.plan);
if (flag("sample")) {
  // A spread: one of each kind first, then blanks, App Store, full pages, then fill.
  const n = Number(flag("sample"));
  const pick = new Map();
  const add = (x) => { if (pick.size < n) pick.set(x.r.id, x); };
  for (const k of ["site", "product", "graphic", "brand", "type", "motion", "photo-art"]) candidates.filter((x) => x.r.kind === k).slice(0, 2).forEach(add);
  candidates.filter((x) => x.r.blank).slice(0, 1).forEach(add);
  candidates.filter((x) => x.r.app && x.r.surface === "app store listing").slice(0, 2).forEach(add);
  candidates.filter((x) => x.r.sections > 0).slice(0, 2).forEach(add);
  candidates.forEach(add);
  candidates = [...pick.values()];
}

const newTags = new Set(candidates.flatMap((x) => x.plan.tags));
const perItem = candidates.reduce((s, x) => s + x.plan.tags.length, 0) / Math.max(1, candidates.length);
console.log(`writeback: ${candidates.length} items to write (${written.size} already written)`);
console.log(`  ~${perItem.toFixed(1)} tags per item, ${newTags.size} distinct tags, notes on items whose notes are empty`);
console.log(`  blank captures tagged "${BLANK_TAG}": ${candidates.filter((x) => x.r.blank).length}`);
for (const x of candidates.slice(0, NAMES ? 8 : 3)) console.log(`  e.g. "${x.r.name.slice(0, 50)}" -> ${NAMES ? `"${x.plan.rename.to}"` : x.plan.tags.join(", ")}`);

// A Sections line goes on a note only if it is empty or still exactly what this tool wrote.
const sectionsNoteFor = (id, curNote, line) => {
  if (curNote.includes(line)) return null;
  if (!curNote.trim()) return line;
  return lastNote.get(id) === curNote ? `${curNote}\n\n${line}` : null;
};

if (SECTIONS && !has("run")) {
  // Read the notes as they sit on disk now (read-only) to say which notes get the line.
  const onDisk = new Map(readLibrary().items.map((it) => [it.id, it]));
  const count = new Map();
  let appendNote = 0, keepNote = 0, gone = 0;
  const rows = [];
  for (const { r, plan } of candidates) {
    const it = onDisk.get(r.id);
    if (!it) { gone++; continue; }
    for (const t of plan.tags) count.set(t, (count.get(t) ?? 0) + 1);
    const n = sectionsNoteFor(r.id, it.annotation ?? "", plan.sectionsLine);
    n ? appendNote++ : keepNote++;
    const newTags = plan.tags.filter((t) => !it.tags.includes(t));
    rows.push(`| ${r.name.replace(/\|/g, "/").slice(0, 70)} | ${newTags.join(", ") || (plan.tags.length ? "(already tagged)" : "(note only)")} | ${plan.sectionsLine.replace("Sections, top to bottom: ", "")} | ${n ? "adds line" : "left alone"} |`);
  }
  console.log(`\n  section tags across the pages (group "Sections"):`);
  for (const [t, n] of [...count].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${t}`);
  console.log(`\n  notes: ${appendNote} get a "Sections, top to bottom" line; ${keepNote} left alone (you edited them, or the line is there)`);
  if (gone) console.log(`  ${gone} pages no longer in the library (deleted since the index was built), skipped`);
  const file = join(OUT, "sections-dry-run.md");
  writeFileSync(file, `# Sections roll-up, dry run (${new Date().toISOString().slice(0, 10)})\n\n${rows.length} full-page captures. Tags are added to the page; nothing is removed.\n\n| Page | Tags added | Sections, top to bottom | Note |\n|---|---|---|---|\n${rows.join("\n")}\n`);
  console.log(`  every page: ${file}`);
}

if (!has("run")) { console.log("\n  dry run only, nothing written to Eagle."); process.exit(0); }

// ---------------------------------------------------------------- write
const open = await openLibrary();
if (!isConfigured(open)) { console.error(`Open library is ${open}; open ${libraryName()} in Eagle first. Nothing written.`); process.exit(1); }

let done = 0, notes = 0, failed = 0;
const q = [...candidates];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (q.length) {
    const batch = q.splice(0, 20);
    // Read the item as Eagle has it NOW, so a tag you added a minute ago survives.
    const cur = new Map(((await getItems({ ids: batch.map((x) => x.r.id), limit: 20, fields: ["id", "name", "tags", "annotation"] })).data ?? []).map((it) => [it.id, it]));
    for (const { r, plan } of batch) {
      const it = cur.get(r.id);
      if (!it) { failed++; continue; } // deleted since the index was built
      const base = REPAIR ? it.tags.filter((t) => t !== BLANK_TAG) : it.tags;
      const added = plan.tags.filter((t) => !base.includes(t));
      const fields = { id: r.id, tags: [...base, ...added] };
      const curNote = it.annotation ?? "";
      let newNote = null;
      if (PHOTO) {
        // Append only to a note this tool wrote and nobody has edited since, or to an empty one.
        if (plan.photoLine && !curNote.includes(plan.photoLine)) {
          if (!curNote.trim()) newNote = plan.photoLine;
          else if (lastNote.get(r.id) === curNote) newNote = `${curNote}\n\n${plan.photoLine}`;
        }
      } else if (SECTIONS) newNote = sectionsNoteFor(r.id, curNote, plan.sectionsLine);
      else if (MOTION) newNote = sectionsNoteFor(r.id, curNote, plan.motionLine);
      else if (plan.note && !curNote.trim()) newNote = plan.note;
      const setNote = Boolean(newNote);
      if (setNote) fields.annotation = newNote;
      // Rename only if it still carries the name it was saved with: a name you gave it stays.
      const renamed = NAMES && it.name === plan.rename.from;
      if (renamed) fields.name = plan.rename.to;
      try {
        await updateItem(fields);
        // Sections: a tag the page already had still belongs in the Sections group.
        appendFileSync(LEDGER, JSON.stringify({ id: r.id, ...(PHOTO ? { photo: true } : {}), ...(SECTIONS ? { sections: true, ...(setNote ? { prevNote: curNote } : {}) } : {}), ...(MOTION ? { motion: true, ...(setNote ? { prevNote: curNote } : {}) } : {}), ...(USES ? { uses: true, planned: plan.tags } : {}), ...(NAMES ? { names: true, ...(renamed ? { prevName: it.name, name: plan.rename.to } : { skipped: "renamed by hand since" }) } : {}), ...(REPAIR ? { repair: true, removed: [BLANK_TAG] } : {}), added, note: setNote ? newNote : null, prevTags: it.tags, groups: Object.fromEntries((SECTIONS || MOTION || USES ? plan.tags : added).map((t) => [t, plan.groups[t] ?? null])), at: new Date().toISOString() }) + "\n");
        done++; if (setNote) notes++;
      } catch (e) { failed++; console.log(`\n  FAILED ${r.id}: ${e.message}`); }
    }
    process.stdout.write(`\r  written ${done}/${candidates.length}   `);
  }
}));
console.log();

// ---------------------------------------------------------------- tag groups
// Tags exist in Eagle once they sit on an item, so groups are filled after the writes.
const all = readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.groups);
const wantByGroup = {};
for (const l of all) for (const [t, g] of Object.entries(l.groups)) if (g) (wantByGroup[g] ??= new Set()).add(t);
const res = await fetch("http://localhost:41595/api/v2/tagGroup/get").then((r) => r.json());
const existing = new Map((res.data?.data ?? res.data ?? []).map((g) => [g.name, g]));
const post = (p, b) => fetch(`http://localhost:41595/api/v2/tagGroup/${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
for (const [, name] of [...GROUPS, ...PHOTO_GROUPS, ["sections", "Sections"], ["motion", "Motion"], ["uses", "Use"]]) {
  const want = [...(wantByGroup[name] ?? [])];
  if (!want.length) continue;
  const g = existing.get(name);
  const r = g
    ? await post("addTags", { groupId: g.id, tags: want.filter((t) => !g.tags.includes(t)) })
    : await post("create", { name, tags: want, description: "Added by eagle-refs" });
  if (r.status !== "success") console.log(`  tag group ${name}: ${r.message ?? JSON.stringify(r).slice(0, 120)}`);
}

// ---------------------------------------------------------------- verify
const ids = candidates.map((x) => x.r.id);
let ok = 0;
for (let i = 0; i < ids.length; i += 200) {
  const got = (await getItems({ ids: ids.slice(i, i + 200), limit: 200, fields: ["id", "name", "tags"] })).data ?? [];
  const byId = new Map(got.map((it) => [it.id, it]));
  for (const x of candidates.slice(i, i + 200)) if (x.plan.tags.every((t) => byId.get(x.r.id)?.tags.includes(t)) && (!NAMES || byId.get(x.r.id)?.name === x.plan.rename.to)) ok++;
}
console.log(`written ${done}, notes set ${notes}, failed ${failed} | verified: ${ok}/${candidates.length} items carry every planned tag`);
console.log(`ledger: ${LEDGER}`);
