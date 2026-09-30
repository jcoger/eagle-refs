#!/usr/bin/env node
/**
 * refs: search your visual reference library from any agent. Works with Eagle closed:
 * it reads index/refs.jsonl in the data folder (eagle-refs index builds it).
 *
 *   eagle-refs search "dark fintech hero with a device mockup" [--kind site] [--surface hero,pricing]
 *        [--platform ios] [--only item|section] [--use "<a use from your config>"] [--limit 8] [--json]
 *   eagle-refs show <id|Eagle link ...>  # what you pointed at (Eagle: Edit > Copy Link)
 *   eagle-refs like <id|Eagle link> [--any-kind] [--limit 8]  # more like this one
 *   eagle-refs frames <id|Eagle link>    # on demand: frames + speed row per measured move, for a motion spec
 *   eagle-refs stats                     # what the library holds, by kind and surface
 * (Run directly, this file takes the same commands, with `motion` for `frames`.)
 *
 * Filters are hard: pass only the reliable ones (kind, platform; surface when the
 * ask names an exact screen or section type). Everything else in the query RANKS.
 * Output is text first; open the image paths of the few that read right.
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { data } from "../lib/config.mjs";
import { changeCurve } from "../lib/motion.mjs";
import { useQueryWords } from "../lib/uses.mjs";

const INDEX = data("index/refs.jsonl");
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);

if (!existsSync(INDEX)) { console.error("No index yet. Run: eagle-refs index"); process.exit(1); }
const all = readFileSync(INDEX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// An item id from anything you paste: Eagle's Copy Link (http://localhost:41595/item?id=ID),
// the eagle://item/ID scheme, or a bare id.
const idFrom = (a) => (/[?&]id=([A-Z0-9]+)/i.exec(a)?.[1] ?? a.replace(/^eagle:\/\/item\//, "")).trim();
const ids = () => argv.slice(1).filter((a) => !a.startsWith("--")).map(idFrom).filter(Boolean);
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const norm = (s) => ` ${String(s ?? "").toLowerCase().replace(/[^a-z0-9&+-]+/g, " ").replace(/\s+/g, " ").trim()} `;
const STOP = new Set("a an the and or of for with to in on at by from that this these those like show me find some any my our your i we want need looking look references reference examples example ideas idea".split(" "));
const stem = (w) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
// A few words people use that the vocabulary spells differently.
const ALIAS = { website: "site", web: "desktop web", mobile: "ios", iphone: "ios", app: "product", screen: "product",
  logo: "logo", mark: "logo", typeface: "type", font: "type", slide: "deck slide", deck: "deck slide",
  dark: "dark", "dark mode": "dark", photography: "photo", photo: "photo", pitch: "deck slide", poster: "poster",
  checkout: "checkout", paywall: "paywall", pricing: "pricing", onboarding: "onboarding", bento: "bento",
  flash: "direct flash", window: "window light", "golden": "golden hour", "b&w": "black and white", "black & white": "black and white",
  // Words that stand for one of your uses (config "uses" > "queryWords").
  ...useQueryWords() };

// Tag facets and how much a query match on each is worth.
const WEIGHT = { surface: 6, light: 6, component: 4, pattern: 4, shot: 4, style: 3, industry: 3, theme: 6, treatment: 3, framing: 3, type: 2, kind: 2, platform: 2, people: 2, motionKind: 5, trigger: 2, uses: 6 };
// Asking for motion at all ("animation", "transition", "gif") favours clips the motion pass read.
const MOTION_WORDS = / (animat\w*|motion|moving|interaction|transition|gif|video|loop|micro-interaction) /;

function score(r, q, qTokens, nots = []) {
  let s = 0;
  const hits = [];
  for (const [facet, w] of Object.entries(WEIGHT)) {
    for (const v of list(r[facet])) {
      if (!v || v === "none" || v === "unclear") continue;
      if (q.includes(norm(v))) { s += w; hits.push(v); }
      if (nots.includes(v)) s -= w;
    }
  }
  // Asking for dark means light results are wrong, not just unrewarded (and the reverse).
  // Mixed stays neutral: a dark bento card on a light page still answers "dark bento".
  const opposite = { dark: "light", light: "dark" }[r.theme];
  if (opposite && q.includes(norm(opposite)) && !q.includes(norm(r.theme))) s -= WEIGHT.theme;
  // The people facet says solo/pair/crowd, never "people", so "no people" needs its own rule.
  if (nots.some((w) => w === "people" || w === "person" || w === "faces") && r.people && r.people !== "none") s -= WEIGHT.surface;
  if (r.motionKind && MOTION_WORDS.test(q)) { s += 4; hits.push("motion"); }
  for (const t of r.humanTags ?? []) if (q.includes(norm(t))) { s += 3; hits.push(t); }
  if (r.app && q.includes(norm(r.app))) { s += 5; hits.push(r.app); }
  const text = norm(`${r.name} ${r.savedAs ?? ""} ${r.description} ${r.move} ${r.photoNote ?? ""} ${r.motionWhat ?? ""} ${r.motionMove ?? ""} ${r.visibleText ?? ""} ${r.app ?? ""}`);
  const words = new Set(text.trim().split(" ").map(stem));
  const moveWords = new Set(norm(`${r.move} ${r.photoNote ?? ""} ${r.motionMove ?? ""}`).trim().split(" ").map(stem));
  for (const t of qTokens) if (words.has(t)) s += moveWords.has(t) ? 1.5 : 1;
  s += (r.star ?? 0) * 0.8;
  return { s, hits };
}

function search(query, opts = {}) {
  // "not SaaS", "no people", "without gradients": the word after is a reason to rank
  // lower, not a match. Agents write briefs this way.
  const nots = [];
  query = query.replace(/\b(?:not|no|without|avoid)\s+([a-z0-9&+-]+)/gi, (_, w) => { nots.push(w.toLowerCase()); return " "; });
  let q = norm(query);
  for (const [k, v] of Object.entries(ALIAS)) if (q.includes(norm(k)) && !q.includes(norm(v))) q += `${v} `;
  const qTokens = [...new Set(q.trim().split(" ").filter((w) => w && !STOP.has(w)).map(stem))];
  const want = (name) => flag(name)?.split(",").map((x) => x.trim().toLowerCase());
  const [kinds, surfaces, platforms, themes, only, uses] = [opts.kinds ?? want("kind"), want("surface"), want("platform"), want("theme"), flag("only"), want("use")];

  const pool = all.filter((r) =>
    !r.blank && (r.record === "section" || r.tagged) && !opts.exclude?.has(r.id) && !opts.exclude?.has(r.parent) &&
    (!kinds || kinds.includes(r.kind)) && (!surfaces || surfaces.includes(r.surface)) &&
    (!platforms || platforms.includes(r.platform)) && (!themes || themes.includes(r.theme)) &&
    (!only || r.record === only) && (!uses || uses.some((u) => r.uses?.includes(u))));

  const ranked = pool.map((r) => ({ r, ...score(r, q, qTokens, nots) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  // At most 2 results per page, so one long capture cannot fill the list.
  const perPage = new Map();
  const out = [];
  for (const x of ranked) {
    const page = x.r.parent ?? x.r.id;
    const n = perPage.get(page) ?? 0;
    if (n >= 2) continue;
    perPage.set(page, n + 1);
    out.push(x);
    if (out.length >= Number(flag("limit", 8))) break;
  }
  return { out, matched: ranked.length, pool: pool.length };
}

function print({ out, matched, pool }, query) {
  if (has("json")) { console.log(JSON.stringify(out.map((x) => ({ score: +x.s.toFixed(1), matchedTags: x.hits, ...x.r })), null, 2)); return; }
  const shown = query === "shown";
  if (!shown) console.log(`refs: "${query}"  ${matched} matches in ${pool} candidates, showing ${out.length}\n`);
  out.forEach(({ r, s }, i) => {
    const tags = [r.kind, r.surface, r.platform, r.theme, r.industry !== "unclear" ? r.industry : null].filter(Boolean).join(" · ");
    const where = r.record === "section" ? `section ${r.position.n}/${r.position.of} of "${r.name}"` : `"${r.name}"`;
    console.log(`${i + 1}. [${tags}] ${where}  (${[r.source, r.savedAt, r.star ? "★".repeat(r.star) : null].filter(Boolean).join(", ")})${shown ? "" : `  score ${s.toFixed(1)}`}`);
    if (r.description) console.log(`   ${r.description}`);
    if (r.move) console.log(`   Move: ${r.move}${r.moveClean ? "" : "  (names a look, read with care)"}`);
    const extra = [...list(r.style), ...list(r.pattern), ...list(r.component)].filter((v) => v && v !== "none");
    if (extra.length) console.log(`   Also: ${extra.join(", ")}`);
    if (r.light) console.log(`   Photo: ${[r.light, r.shot, r.people, ...list(r.treatment), ...list(r.framing)].filter((v) => v && v !== "unclear" && v !== "none").join(", ")}${r.photoNote ? `. ${r.photoNote}` : ""}`);
    if (r.uses?.length) console.log(`   Use: ${r.uses.join(", ")}`);
    if (r.motionKind) console.log(`   Motion: ${r.motionKind}, ${r.trigger}. ${r.motionWhat}\n   Timing (measured): ${r.motionTiming}\n   Motion move: ${r.motionMove}${r.motionMoveClean ? "" : "  (names a look, read with care)"}`);
    if (r.humanTags?.length) console.log(`   your tags: ${r.humanTags.join(", ")}`);
    console.log(`   Image: ${r.image ?? "(none)"}`);
    if (r.liveUrl) console.log(`   Live: ${r.liveUrl}   As saved: ${r.asSavedUrl}`);
    else if (r.url) console.log(`   Source: ${r.url}`);
    console.log(`   id: ${r.id}\n`);
  });
}

if (cmd === "search") {
  const query = argv.slice(1).filter((a, i, arr) => !a.startsWith("--") && !(i > 0 && arr[i - 1].startsWith("--"))).join(" ");
  print(search(query), query);
} else if (cmd === "show") {
  // Eagle's Edit > Copy Link gives eagle://item/<id>; take those, bare ids, or several at once.
  const found = ids().map((id) => all.find((x) => x.id === id) ?? id);
  if (has("json")) console.log(JSON.stringify(found, null, 2));
  else {
    for (const r of found.filter((r) => typeof r === "string")) console.log(`no record ${r} (not indexed yet? the background job adds new saves within a minute or two)\n`);
    const recs = found.filter((r) => typeof r !== "string");
    if (recs.length) print({ out: recs.map((r) => ({ r, s: 0 })), matched: recs.length, pool: recs.length }, "shown");
    for (const r of recs) {
      const secs = all.filter((x) => x.parent === r.id);
      if (secs.length) console.log(`Sections of "${r.name}", top to bottom: ${secs.map((x) => `${x.position.n}. ${x.surface}`).join(", ")}  (ids ${r.id}#1...#${secs.length})\n`);
    }
  }
} else if (cmd === "like") {
  // More like this: the item's own tags and move line become the query, same kind unless --any-kind.
  const r = all.find((x) => x.id === ids()[0]);
  if (!r) { console.log(`no record ${ids()[0] ?? "(give an id or an Eagle link)"}`); process.exit(1); }
  const facets = ["surface", "platform", "theme", "type", "style", "pattern", "component", "industry", "shot", "light", "treatment", "framing"];
  const q = [...facets.flatMap((f) => list(r[f])), r.move ?? ""].filter((v) => v && v !== "none" && v !== "unclear").join(" ");
  print(search(q, { kinds: has("any-kind") ? null : [r.kind], exclude: new Set([r.id, r.parent].filter(Boolean)) }), `like "${r.name}"`);
} else if (cmd === "motion") {
  // On demand: dense frames around each measured move, plus its speed row, so the agent in the
  // session reads timing, easing, stagger and overshoot itself. No model call and no spend here.
  const r = all.find((x) => x.id === ids()[0]);
  if (!r) { console.log(`no record ${ids()[0] ?? "(give an id or an Eagle link)"}`); process.exit(1); }
  if (!r.moves?.length) { console.log(`no measured motion for "${r.name}": not a clip, nothing moves, or the motion pass has not reached it yet`); process.exit(0); }
  const dir = data("motion-detail", r.id);
  mkdirSync(dir, { recursive: true });
  // Busy clips: the six longest moves, kept in time order.
  const pick = r.moves.length > 6 ? [...r.moves].sort((a, b) => b.ms - a.ms).slice(0, 6).sort((a, b) => a.start - b.start) : r.moves;
  const curve = changeCurve(r.file, Math.min(60, (r.clipSeconds ?? 60) + 1));
  console.log(`MOTION DETAIL: "${r.name}" (${r.clipSeconds} s)\n${r.motionWhat ?? ""}\nMeasured: ${r.motionTiming}\n`);
  pick.forEach((m, k) => {
    const a = Math.max(0, m.start - 0.1), b = Math.min(r.clipSeconds ?? m.end + 0.1, m.end + 0.1), dur = b - a;
    const n = Math.max(6, Math.min(24, Math.ceil(dur * 30))), fps = n / dur, rows = Math.ceil(n / 6);
    const png = join(dir, `move-${k + 1}.png`);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", a.toFixed(3), "-t", dur.toFixed(3), "-i", r.file,
      "-vf", `fps=${fps.toFixed(3)},scale=240:-2,tile=6x${rows}:padding=6:margin=6:color=white`, "-frames:v", "1", png]);
    const seg = curve.slice(Math.floor(a * 30), Math.ceil(b * 30));
    const top = Math.max(...seg, 0.001);
    console.log(`Move ${k + 1}: ${m.start}-${m.end} s, ${m.ms} ms, ${m.feel}`);
    console.log(`  frames: ${png}`);
    console.log(`  read left to right, top to bottom: ${n} frames, one every ${Math.round(1000 / fps)} ms, from ${Math.round(a * 1000)} ms`);
    console.log(`  speed, every 33 ms (0-9): ${seg.map((v) => Math.round((v / top) * 9)).join(" ")}\n`);
  });
  console.log(`Read every frame sheet, then write a MOTION SPEC per move: what moves; duration in ms; delay between elements (stagger);
easing as a cubic-bezier checked against the speed row (peak early = ease-out, late = ease-in, flat = linear);
overshoot or settle if a frame passes the resting position. Cite this item's id.`);
} else if (cmd === "stats") {
  const count = (f, rs) => Object.entries(rs.reduce((m, r) => ((m[r[f]] = (m[r[f]] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const items = all.filter((r) => r.record === "item" && r.tagged && !r.blank);
  console.log(`items ${items.length} tagged (of ${all.filter((r) => r.record === "item").length}), sections ${all.filter((r) => r.record === "section").length}`);
  console.log("kind:", count("kind", items).map(([k, n]) => `${k} ${n}`).join(" · "));
  console.log("surface:", count("surface", items).slice(0, 30).map(([k, n]) => `${k} ${n}`).join(" · "));
  console.log("section surface:", count("surface", all.filter((r) => r.record === "section")).map(([k, n]) => `${k} ${n}`).join(" · "));
} else {
  console.log("usage: eagle-refs search \"<what you need>\" [--kind k] [--surface s] [--platform p] [--theme t] [--only item|section] [--use u] [--limit n] [--json]\n       eagle-refs show <id|Eagle link ...>\n       eagle-refs like <id|Eagle link> [--any-kind]\n       eagle-refs frames <id|Eagle link>\n       eagle-refs stats");
}
