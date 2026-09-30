#!/usr/bin/env node
/**
 * motion: the motion pass for GIFs and videos. The main tagger sees one still frame, so
 * before this pass 196 of 207 clips in the reference library were tagged as static screens.
 * Code measures WHEN things move; a model watches the clip and says WHAT moves
 * (lib/motion.mjs has the measurements behind that split). Results: tags/motion/<id>.json.
 * Needs ffmpeg and ffprobe on PATH.
 *
 *   eagle-refs motion --dry-run            # count + price, zero calls
 *   eagle-refs motion --sample 5           # a few, to read before the rest
 *   eagle-refs motion [--concurrency 6]    # everything not done yet (resumable)
 *
 * The background job runs it after tag, so a new GIF or video gets it within a minute or two.
 * The detailed spec (easing, stagger, springiness) stays on demand: eagle-refs frames <id>.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, data } from "../lib/config.mjs";
import { readLibrary } from "../lib/library.mjs";
import { meaningfulTitle } from "../lib/prompt.mjs";
import { see, shortError } from "../lib/openrouter.mjs";
import { MOTION_EXT, CLIP_MAX_S, seconds, measure, prepClip, buildMotionPrompt, parseMotion, failureReason, missingTools } from "../lib/motion.mjs";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const MODEL = config().models.motion;
const RATE_PER_S = 0.00011; // GLM-5.3 Flash, measured: $0.0003 for a 3 s clip, $0.0019 for 17.5 s
const OUT = data("tags/motion");
const CLIPS = data("tags/clips");
mkdirSync(OUT, { recursive: true });

const { items } = readLibrary();
let todo = items.filter((it) => MOTION_EXT.has(it.ext) && it.filePath && !existsSync(join(OUT, `${it.id}.json`)));
if (flag("sample")) todo = todo.slice(0, Number(flag("sample")));

// Without ffmpeg nothing can be measured and every clip would fail. Say so in the log and touch nothing.
const missing = todo.length ? missingTools() : [];
if (missing.length) {
  console.error(`motion: ${missing.join(" and ")} not found on PATH (${process.env.PATH}); ${todo.length} clips wait, nothing recorded`);
  process.exit(1);
}

if (has("dry-run")) {
  const secs = todo.reduce((s, it) => { try { return s + Math.min(seconds(it.filePath), CLIP_MAX_S); } catch { return s; } }, 0);
  console.log(`motion: ${todo.length} clips to do, ~${Math.round(secs)} s of video to watch, ~$${(secs * RATE_PER_S).toFixed(2)}`);
  process.exit(0);
}
const key = process.env.OPENROUTER_API_KEY;
if (!key && todo.length) { console.error("motion: OPENROUTER_API_KEY missing (put it in a .env next to eagle-refs.config.json)"); process.exit(1); }

let calls = 0, errors = 0, retry = 0, spend = 0, still = 0, done = 0, firstError = null;
const queue = [...todo];
await Promise.all(Array.from({ length: Number(flag("concurrency", 6)) }, async () => {
  while (queue.length) {
    const it = queue.shift();
    const file = join(OUT, `${it.id}.json`);
    try {
      const m = measure(it.filePath);
      // A still saved as a GIF: nothing to watch, nothing to pay for.
      if (!m.moves.length) {
        still++;
        writeFileSync(file, JSON.stringify({ id: it.id, at: new Date().toISOString(), cost: 0, measured: m, parsed: { valid: true, kind: "none", trigger: "none", whatMoves: "", move: "", moveBanned: [] } }, null, 2));
        continue;
      }
      const clip = prepClip(it, CLIPS);
      let parsed = { valid: false }, cost = 0;
      // One retry for an unreadable answer, never more.
      for (let attempt = 0; attempt < 2 && !parsed.valid; attempt++) {
        const r = await see({ model: MODEL, prompt: buildMotionPrompt(it, m, meaningfulTitle(it.name)), videos: [clip], key });
        calls++; cost += r.cost ?? 0;
        if (!r.ok) throw new Error(r.error);
        parsed = parseMotion(r.text);
      }
      spend += cost;
      writeFileSync(file, JSON.stringify({ id: it.id, model: MODEL, at: new Date().toISOString(), cost, measured: m, parsed }, null, 2));
      if (!parsed.valid) errors++;
    } catch (e) {
      errors++;
      // Only a clip ffmpeg ran on and could not read is recorded, so it is not retried every run
      // (delete the file to retry). Anything else is not the clip's fault (a spent key, an outage,
      // ffmpeg missing): nothing is recorded and it goes again next run, as in tag.mjs.
      const reason = failureReason(e);
      if (reason === "unreadable") writeFileSync(file, JSON.stringify({ id: it.id, at: new Date().toISOString(), failed: true, reason, error: String(e.message ?? e).slice(0, 300) }, null, 2));
      else { retry++; firstError ??= e.message; }
    }
    done++;
    process.stdout.write(`\r  motion ${done}/${todo.length}   `);
  }
}));
if (todo.length) console.log();
console.log(`motion: ${todo.length} clips, ${still} with nothing moving, calls ${calls}, errors ${errors}${retry ? ` (${retry} retried next run; first: ${shortError(firstError)})` : ""}, spend this run $${spend.toFixed(3)}`);
