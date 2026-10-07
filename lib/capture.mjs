/**
 * Site capture: how a live landing page moves, section by section. Eagle's web clipper saves
 * stills, so a page's choreography never reached the motion pass. Three sources, because each
 * sees what the others miss (tested on 3 sites, 2026-10-07):
 *
 * - THE PAGE ITSELF. A live browser lists every running animation (document.getAnimations()):
 *   CSS animations and transitions, and Web Animations, which is what Framer Motion uses for
 *   transform and opacity. Real duration, delay, easing and keyframes. Exact, but blind to
 *   motion drawn frame by frame in JavaScript or WebGL (GSAP, Lenis, three.js): on one site
 *   the page reported only hover colours while the whole story moved.
 * - A MODEL WATCHING EACH SECTION. One clip per ~8 s of the recording, at 15 fps (at 8 fps a
 *   ~100 ms glitch wipe read as a crossfade). It caught a 3D card tunnel, type-on prompts and
 *   a brand-shape wipe for about $0.0005 a section.
 * - ONE PAGE-LEVEL READ. Section by section, nobody sees that a page opens and closes on the
 *   same shape. A text-only pass over every section's notes names what spans the page.
 *
 * Needs Playwright (`npm install playwright-core`) and a browser it can drive: Google Chrome is
 * used if Playwright's own Chromium is not installed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config.mjs";
import { see } from "./openrouter.mjs";
import { MOTION_KINDS, TRIGGERS } from "./motion.mjs";
import { MOVE_BANNED } from "./vocab.mjs";

const VIEW = { width: 1440, height: 900 };
const SCROLL_PX_PER_S = 900;   // steady, so scroll-linked motion plays the same way on every site
const PAUSE_MS = 1400;         // per screen, so entrance animations can finish
const SETTLE_MS = 2500;        // after load, for the hero's own entrance
const MAX_SCREENS = 40;
const SECTION_MIN_S = 8;       // screens are grouped into clips of at least this long
const CLIP_FPS = 15;
const READS = 2;              // reads per section, merged (see readSections)

/** Playwright, from this package or from the folder holding the config (a private instance). */
async function playwright() {
  try { return await import("playwright-core"); } catch {}
  for (const base of [dirname(config().file), process.cwd()]) {
    try { return await import(pathToFileURL(createRequire(join(base, "package.json")).resolve("playwright-core")).href); } catch {}
  }
  throw new Error("site capture needs Playwright: run `npm install playwright-core` in the eagle-refs folder");
}

async function launch() {
  const pw = await playwright();
  const chromium = pw.chromium ?? pw.default?.chromium; // a CommonJS load nests it under default
  if (!chromium) throw new Error("playwright-core loaded without chromium; reinstall it");
  try { return await chromium.launch(); } catch (first) {
    try { return await chromium.launch({ channel: "chrome" }); } catch {
      throw new Error(`no browser to drive. Install Google Chrome, or run \`npx playwright-core install chromium\` (${first.message.split("\n")[0]})`);
    }
  }
}

// Runs inside the page before any of its scripts: logs each new animation once, with when and
// at what scroll position it was first seen.
function probe() {
  const seen = new WeakSet();
  const log = [];
  const t0 = performance.now();
  const describe = (el) => {
    if (!el || !el.tagName) return null;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const text = (el.innerText || el.getAttribute?.("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), cls, text, x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const sample = () => {
    for (const a of document.getAnimations({ subtree: true })) {
      if (seen.has(a)) continue;
      seen.add(a);
      let timing = {}, frames = [];
      try { timing = a.effect.getComputedTiming(); } catch {}
      try { frames = a.effect.getKeyframes().slice(0, 4).map(({ offset, easing, composite, computedOffset, ...props }) => ({ offset: computedOffset ?? offset, ...props })); } catch {}
      log.push({
        at: Math.round(performance.now() - t0), scrollY: Math.round(scrollY),
        type: a.constructor.name, name: a.animationName ?? a.transitionProperty ?? a.id ?? "",
        target: describe(a.effect?.target),
        duration: typeof timing.duration === "number" ? Math.round(timing.duration) : timing.duration,
        delay: Math.round(timing.delay ?? 0), easing: timing.easing, iterations: timing.iterations,
        frames,
      });
    }
  };
  setInterval(sample, 50);
  window.__capture = () => { sample(); return log; };
  window.__libs = () => ({
    gsap: Boolean(window.gsap), scrollTrigger: Boolean(window.ScrollTrigger), lenis: Boolean(window.lenis || document.querySelector("html.lenis")),
    framer: Boolean(document.querySelector("[data-framer-name], [data-framer-component-type]")),
    webflow: Boolean(document.documentElement.dataset.wfPage), lottie: Boolean(document.querySelector("lottie-player, dotlottie-player")),
    three: Boolean(window.THREE || document.querySelector("canvas[data-engine]")), canvas: document.querySelectorAll("canvas").length,
  });
}

/** Record one URL into `out`: video.mp4, page.jpg, and what the page reported. */
export async function record(url, out) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: VIEW, recordVideo: { dir: out, size: VIEW }, reducedMotion: "no-preference" });
    const page = await ctx.newPage();
    await page.addInitScript(probe);
    const timeline = [];
    const t0 = Date.now();
    const mark = async (what) => timeline.push({ t: Date.now() - t0, scrollY: await page.evaluate(() => Math.round(scrollY)), what });
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    await mark("loaded");
    // A cookie banner covers the page. Only ever decline: never accept on anyone's behalf.
    for (const label of [/^(reject|decline)( all)?$/i, /only (necessary|essential)/i, /^necessary only$/i]) {
      const b = page.getByRole("button", { name: label }).first();
      if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
    }
    await page.waitForTimeout(SETTLE_MS);
    await mark("hero");
    // One screen at a time with the mouse wheel (smooth-scroll libraries ignore scrollTo), then a pause.
    for (let i = 0; i < MAX_SCREENS; i++) {
      const before = await page.evaluate(() => scrollY);
      const step = VIEW.height * 0.85, ticks = 12;
      for (let k = 0; k < ticks; k++) { await page.mouse.wheel(0, step / ticks); await page.waitForTimeout((step / ticks / SCROLL_PX_PER_S) * 1000); }
      await page.waitForTimeout(PAUSE_MS);
      await mark(`screen ${i + 1}`);
      if ((await page.evaluate(() => scrollY)) - before < 20) break; // the bottom
    }
    const animations = await page.evaluate(() => window.__capture());
    const libs = await page.evaluate(() => window.__libs());
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, "page.jpg"), fullPage: true, type: "jpeg", quality: 80 }).catch(() => {});
    await ctx.close();
    const webm = readdirSync(out).find((f) => f.endsWith(".webm"));
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", join(out, webm), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart", "-an", join(out, "video.mp4")]);
    rmSync(join(out, webm));
    return { url, height, libs, animations, timeline };
  } finally {
    await browser.close();
  }
}

/** Screens grouped into sections of at least SECTION_MIN_S seconds: [{ t0, t1, from, to }] (s, px). */
export function sectionsOf(timeline) {
  const marks = timeline.filter((m) => m.what === "hero" || m.what.startsWith("screen"));
  const out = [];
  let cur = { t0: 0, from: 0 };
  for (const m of marks) {
    cur.t1 = m.t / 1000; cur.to = m.scrollY;
    if (cur.t1 - cur.t0 >= SECTION_MIN_S) { out.push(cur); cur = { t0: cur.t1, from: m.scrollY }; }
  }
  if (cur.t1 > cur.t0) (out.length && cur.t1 - cur.t0 < SECTION_MIN_S / 2 ? Object.assign(out.at(-1), { t1: cur.t1, to: cur.to }) : out.push(cur));
  return out.map((s, i) => ({ n: i + 1, ...s, t0: +s.t0.toFixed(1), t1: +s.t1.toFixed(1) }));
}

/** Framer Motion and others compile a spring to CSS linear() with dozens of points; say what it is. */
export function easingLabel(e = "") {
  if (!e.startsWith("linear(")) return e;
  const v = [...e.matchAll(/(-?\d*\.?\d+)(?:\s+[\d.]+%)?/g)].map((m) => Number(m[1]));
  if (v.length < 8) return e;
  const peak = Math.max(...v);
  return peak > 1.005 ? `spring, overshoots ${Math.round((peak - 1) * 100)}%` : "spring, no overshoot";
}

/** The animations' numbers worth reading: timing families (most used first) and staggers. */
export function timingOf(anims) {
  const real = anims.filter((a) => typeof a.duration === "number" && a.duration > 0 && a.iterations !== Infinity);
  const fam = new Map();
  for (const a of real) {
    const props = [...new Set(a.frames.flatMap((f) => Object.keys(f).filter((k) => k !== "offset")))].sort().join("+") || a.name || "?";
    const k = `${a.duration} ms, ${easingLabel(a.easing)}, ${props}`;
    fam.set(k, (fam.get(k) ?? []).concat(a));
  }
  const families = [...fam].sort((p, q) => q[1].length - p[1].length).map(([k, l]) => ({ timing: k, count: l.length }));
  const staggers = [];
  for (const [k, list] of fam) {
    const byStart = new Map();
    for (const a of list) { const s = Math.round(a.at / 250); (byStart.get(s) ?? byStart.set(s, []).get(s)).push(a); }
    for (const g of byStart.values()) {
      const d = [...new Set(g.map((a) => a.delay))].sort((p, q) => p - q);
      if (d.length < 3) continue;
      const steps = d.slice(1).map((v, i) => v - d[i]);
      staggers.push({ timing: k, items: d.length, step: Math.round(steps.reduce((s, v) => s + v, 0) / steps.length), delays: d.slice(0, 8) });
    }
  }
  return { reported: real.length, loops: anims.filter((a) => a.iterations === Infinity).length, families: families.slice(0, 8), staggers: staggers.slice(0, 6) };
}

const numbersText = (t) => !t.reported ? "none: this part's motion is drawn by JavaScript or WebGL, so read it from the video"
  : [...t.families.slice(0, 5).map((f) => `${f.count}x ${f.timing}`), ...t.staggers.slice(0, 3).map((s) => `stagger: ${s.items} items ${s.step} ms apart (${s.timing})`)].join("; ");

const parseJson = (text) => { try { return JSON.parse(/\{[\s\S]*\}/.exec(text ?? "")?.[0]); } catch { return null; } };
// Models sometimes answer a list field with one sentence: keep it rather than drop it.
const clean = (list) => (Array.isArray(list) ? list : typeof list === "string" ? [list] : []).map((s) => String(s).trim()).filter(Boolean);
const pick = (list, allowed) => clean(list).map((v) => v.toLowerCase()).filter((v) => allowed.includes(v));

/** What a model is asked about one section clip, with the page's own numbers alongside. */
/** When the page sits still inside a section's clip, in seconds from the clip's start. */
export function stillWindows(timeline, s) {
  const loaded = (timeline.find((m) => m.what === "loaded")?.t ?? 0) / 1000;
  return timeline.filter((m) => m.what === "hero" || m.what.startsWith("screen")).map((m) => {
    const end = m.t / 1000, start = m.what === "hero" ? loaded : end - PAUSE_MS / 1000;
    return [Math.max(start, s.t0) - s.t0, Math.min(end, s.t1) - s.t0];
  }).filter(([a, b]) => b - a > 0.3).map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)} s`);
}

export function sectionPrompt({ s, total, url, height, timing, still = [] }) {
  return `This is part ${s.n} of ${total} of a landing page (${url}), from ${s.from}px to ${s.to}px of ${height}px, recorded while scrolling slowly and pausing on each screen. Describe its motion design for a designer who wants to rebuild it. The page is still (not scrolling) during ${still.join(", ") || "the pauses"} of this clip, and scrolling the rest of the time. While it scrolls, blur or a doubled look is the recording: ignore it. While it is still, every change is real motion, including text that looks doubled, glitchy or half-formed for a moment: that is usually a scramble, a decode or a word swap, so name it. Also describe motion tied to the scroll (parallax, pinning, scrubbing). Look closely: name a scramble, type-on, glitch, wipe, blur-in, 3D or path motion as exactly that, not as a fade.
The page itself reported these animations for this part (exact values): ${numbersText(timing)}. These cover only CSS and Web Animations. Motion drawn by JavaScript or WebGL (marquees and tickers, scrambling or typing text, canvas and 3D) never shows up in them, so look for it in the video, and do not force what you see onto these numbers.
Answer with JSON only:
{"summary": "<one sentence: what this part does>",
 "moves": ["<each element that moves, in order: how it enters or changes, what triggers it, what repeats or cycles>"],
 "borrow": ["<an idea worth reusing, as a relationship in time or space. No colours, typefaces or subject matter>"],
 "kinds": [<any of: ${MOTION_KINDS.filter((k) => k !== "none").join(", ")}>],
 "triggers": [<any of: ${TRIGGERS.filter((t) => t !== "none").join(", ")}>]}`;
}

/** One clip per section, watched by a model with the page's own numbers alongside. */
export async function readSections({ dir, url, height, animations, timeline, model, key }) {
  const sections = sectionsOf(timeline);
  let cost = 0;
  const out = [];
  for (const s of sections) {
    const clip = join(dir, `section-${String(s.n).padStart(2, "0")}.mp4`);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(s.t0), "-t", String(s.t1 - s.t0), "-i", join(dir, "video.mp4"),
      "-vf", `scale=720:-2,fps=${CLIP_FPS}`, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
    const mine = animations.filter((a) => a.scrollY >= s.from && a.scrollY <= s.to);
    const timing = timingOf(mine);
    const prompt = sectionPrompt({ s, total: sections.length, url, height, timing, still: stillWindows(timeline, s) });
    // Two reads, merged: one read catches most of a section, but not always the same most
    // (on one hero, 3 runs each missed a different one of: word scramble, marquee, opening shape).
    const reads = [];
    for (let k = 0; k < READS; k++) {
      const r = await see({ model, prompt, videos: [clip], key });
      cost += r.cost ?? 0;
      if (!r.ok) throw new Error(`section ${s.n}: ${r.error}`);
      const parsed = parseJson(r.text);
      if (parsed) reads.push(parsed);
    }
    let j = reads[0] ?? {};
    if (reads.length > 1) {
      const m = await see({ model, key, prompt: `Two people watched the same clip of part of a landing page and wrote these notes (JSON):
A: ${JSON.stringify(reads[0])}
B: ${JSON.stringify(reads[1])}
Merge them into one set of notes. Keep every distinct motion either of them saw, once. When they describe the same element differently, keep the more specific description (a named scramble, type-on, wipe, path or 3D motion beats a plain fade). Answer with JSON only, in the same shape: {"summary", "moves", "borrow", "kinds", "triggers"}.` });
      cost += m.cost ?? 0;
      j = (m.ok && parseJson(m.text)) || j;
    }
    out.push({ ...s, clip, timing, summary: String(j.summary ?? "").trim(), moves: clean(j.moves), borrow: clean(j.borrow),
      kinds: pick(j.kinds, MOTION_KINDS), triggers: pick(j.triggers, TRIGGERS) });
  }
  return { sections: out, cost };
}

/** What spans the page: motifs, bookends, a shared rhythm. Text only, over every section's notes. */
export async function readPage({ url, sections, timing, model, key }) {
  const notes = sections.map((s) => `Part ${s.n} (${s.from}-${s.to}px): ${s.summary}\n${s.moves.map((m) => `- ${m}`).join("\n")}`).join("\n\n");
  const prompt = `These are notes on each part of one landing page (${url}), top to bottom, written by someone watching it scroll.
Measured across the whole page: ${numbersText(timing)}.

${notes}

Say what spans the page as a whole: shapes or motifs that come back, bookends, a shared rhythm or easing, parts that move in sync, the order the story is told in. Answer with JSON only:
{"choreography": "<two or three sentences: how this page moves as a whole>",
 "signature": ["<a cross-page idea worth borrowing, as a relationship. No colours, typefaces or subject matter>"],
 "rhythm": "<the shared timing in one line, using the measured numbers when there are any>"}`;
  const r = await see({ model, prompt, key });
  if (!r.ok) throw new Error(`page: ${r.error}`);
  const j = parseJson(r.text) ?? {};
  return { choreography: String(j.choreography ?? "").trim(), signature: clean(j.signature), rhythm: String(j.rhythm ?? "").trim(), cost: r.cost ?? 0, raw: r.text };
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** The note that goes on the recording in Eagle: the page first, then each section by time. */
export function noteFor(c) {
  return [c.page.choreography,
    c.page.signature.length ? `Signature: ${c.page.signature.join(" ")}` : "",
    c.page.rhythm ? `Rhythm: ${c.page.rhythm}` : "",
    c.sections.map((s) => `${mmss(s.t0)} to ${mmss(s.t1)}: ${s.summary}`).join("\n")].filter(Boolean).join("\n\n");
}

/** A readable report: page, then per section the moves and the page's own numbers. */
export function reportFor(c) {
  const lib = Object.entries(c.libs).filter(([, v]) => v).map(([k, v]) => (v === true ? k : `${k} ${v}`)).join(", ") || "nothing detected";
  return `# ${c.url}

${c.page.choreography}

**Signature:** ${c.page.signature.join(" ") || "none named"}
**Rhythm:** ${c.page.rhythm || "n/a"}

Page ${c.height}px tall, ${c.seconds} s recorded. Built with: ${lib}. The page reported ${c.timing.reported} animations with real timing${c.libs.gsap || c.libs.lenis || c.libs.three ? "; JavaScript or WebGL motion is only in the video" : ""}.

${c.sections.map((s) => `## ${s.n}. ${mmss(s.t0)} to ${mmss(s.t1)} (${s.from} to ${s.to}px)

${s.summary}

${s.moves.map((m) => `- ${m}`).join("\n")}
${s.borrow.length ? `\nBorrow: ${s.borrow.join(" ")}\n` : ""}
Measured: ${numbersText(s.timing)}
`).join("\n")}`;
}

/** Record, read each section, read the page. Writes capture.json and report.md into `dir`. */
export async function capture(url, dir, { model = config().models.motion, key = process.env.OPENROUTER_API_KEY } = {}) {
  const rec = await record(url, dir);
  const { sections, cost } = await readSections({ dir, url, ...rec, model, key });
  const timing = timingOf(rec.animations);
  const page = await readPage({ url, sections, timing, model, key });
  const c = { url, at: new Date().toISOString(), model, height: rec.height, libs: rec.libs, seconds: +(rec.timeline.at(-1).t / 1000).toFixed(1),
    timing, sections: sections.map(({ clip, ...s }) => ({ ...s, clip: clip.split("/").pop() })), page: { ...page, cost: undefined }, cost: cost + page.cost };
  c.moveBanned = MOVE_BANNED.filter((b) => c.page.signature.join(" ").toLowerCase().split(/[^a-z-]+/).includes(b));
  writeFileSync(join(dir, "animations.json"), JSON.stringify({ url, animations: rec.animations, timeline: rec.timeline }, null, 2));
  writeFileSync(join(dir, "capture.json"), JSON.stringify(c, null, 2));
  writeFileSync(join(dir, "report.md"), reportFor(c));
  return c;
}
