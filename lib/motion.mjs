/**
 * Motion: how a saved GIF or video moves. Two halves, because they are good at different things
 * (measured 2026-09-24 on 3 clips):
 * - CODE measures WHEN things move, from per-frame pixel change on a 64x64 grey copy. On a button
 *   GIF it found expand 400 ms, hold 0.9 s, collapse 470 ms. GLM, Gemini and a frame strip guessed
 *   350, 400 and 700 ms for the same move. Timings in the index come from here, never a model.
 * - THE MODEL (GLM-5.3 Flash watching the clip) says WHAT moves and the idea worth borrowing.
 *   Watching beat an 8-frame strip: the strip missed a swipe between cards in a 15 s clip.
 * The detailed spec (easing curve, stagger, springiness) is on demand: refs.mjs motion <link>.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MOVE_BANNED } from "./vocab.mjs";

export const MOTION_EXT = new Set(["gif", "mp4", "mov", "m4v", "webm"]);
export const MOTION_KINDS = ["transition", "micro-interaction", "reveal", "loop", "scroll", "gesture", "loading",
  "data viz", "type animation", "3d", "live action", "none"];
export const TRIGGERS = ["tap", "swipe", "scroll", "hover", "drag", "load", "auto loop", "none", "unclear"];
export const CLIP_MAX_S = 20; // what the model watches; long case-study videos are cut here
const FPS = 30; // measurement rate: 33 ms per frame (15 fps read the button's 400 ms expand as 533)
const GRID = 64;

/** Why a clip failed. "unreadable": ffmpeg or ffprobe ran and could not read the clip. "tool missing":
 *  they could not be started (not on PATH). "other": anything else, such as a failed model call. */
export const failureReason = (e) =>
  e?.code === "ENOENT" && String(e.syscall ?? "").startsWith("spawn") ? "tool missing" : e?.status != null || e?.signal ? "unreadable" : "other";

/** ffmpeg and ffprobe are Homebrew installs (/opt/homebrew/bin); launchd's PATH leaves them out. */
export const missingTools = () =>
  ["ffmpeg", "ffprobe"].filter((t) => { try { execFileSync(t, ["-version"], { stdio: "ignore" }); return false; } catch (e) { return failureReason(e) === "tool missing"; } });

export const seconds = (path) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" }).trim()) || 0;

/** Per-frame change (0-255 mean absolute difference) at FPS, first `maxS` seconds. */
export function changeCurve(path, maxS = 60) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-t", String(maxS), "-i", path, "-vf", `fps=${FPS},scale=${GRID}:${GRID},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  const size = GRID * GRID, n = Math.floor(raw.length / size), d = [0];
  for (let i = 1; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < size; k++) sum += Math.abs(raw[i * size + k] - raw[(i - 1) * size + k]);
    d.push(sum / size);
  }
  return d;
}

/** How a move's speed is distributed, read from where its pixel change peaks. A proxy, not a curve. */
function feelOf(run) {
  if (run.length < 3) return "instant";
  const peak = run.indexOf(Math.max(...run)) / (run.length - 1);
  const mean = run.reduce((s, v) => s + v, 0) / run.length;
  const cv = Math.sqrt(run.reduce((s, v) => s + (v - mean) ** 2, 0) / run.length) / (mean || 1);
  if (cv < 0.25) return "even speed";
  if (peak < 0.34) return "fast start, settles";
  if (peak > 0.66) return "builds, ends fast";
  return "eases in and out";
}

/** When things move: [{ start, end, ms, feel }] in seconds, plus how much of the clip is moving. */
export function measure(path) {
  const d = changeCurve(path);
  const peak = Math.max(0, ...d);
  const floor = Math.max(0.3, peak * 0.12); // below this is compression noise or a cursor blip
  const on = d.map((v) => v > floor);
  // Close one-frame gaps (33 ms): one move with a slow middle frame is still one move. Wider
  // bridging swallowed a settle blip into the button's expand.
  for (let i = 1; i < on.length - 1; i++) if (!on[i] && on[i - 1] && on[i + 1]) on[i] = true;
  const moves = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i]) continue;
    let j = i;
    while (j + 1 < on.length && on[j + 1]) j++;
    const run = d.slice(i, j + 1);
    if (run.length >= 3 || Math.max(...run) > floor * 3) { // under 100 ms and faint: a blip
      const start = Math.max(0, (i - 1) / FPS), end = j / FPS;
      moves.push({ start: +start.toFixed(2), end: +end.toFixed(2), ms: Math.round((end - start) * 1000), feel: feelOf(run) });
    }
    i = j;
  }
  const movingShare = on.filter(Boolean).length / Math.max(1, on.length);
  return { seconds: +(d.length / FPS).toFixed(2), moves: moves.slice(0, 24), repeat: repeatOf(moves), movingShare: +movingShare.toFixed(2), continuous: movingShare > 0.8 };
}

/** A loop that does the same thing on a beat: "a ~200 ms move every 1.3 s", not twelve lines. */
function repeatOf(moves) {
  if (moves.length < 4) return null;
  const gaps = moves.slice(1).map((m, i) => m.start - moves[i].start);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const cv = (a) => Math.sqrt(avg(a.map((v) => (v - avg(a)) ** 2))) / (avg(a) || 1);
  if (cv(gaps) > 0.3) return null;
  return { everyS: +avg(gaps).toFixed(2), ms: Math.round(avg(moves.map((m) => m.ms))), times: moves.length };
}

/** One line a person or a model can read. */
export function timeline(m) {
  if (!m.moves.length) return "nothing measurable moves";
  if (m.continuous) return `moves almost the whole time (${Math.round(m.movingShare * 100)}% of frames): footage or a constant loop`;
  if (m.repeat) return `repeats: a ~${m.repeat.ms} ms move every ${m.repeat.everyS} s (${m.repeat.times} times)`;
  if (m.moves.length > 3) {
    // Busy clips split into many short moves; the per-move list stays in the record for refs motion.
    const ms = m.moves.map((x) => x.ms).sort((p, q) => p - q);
    return `${m.moves.length} moves from ${m.moves[0].start} s to ${m.moves.at(-1).end} s, most ${ms[Math.floor(ms.length * 0.25)]}-${ms[Math.floor(ms.length * 0.75)]} ms (median ${ms[Math.floor(ms.length / 2)]} ms)`;
  }
  return m.moves.map((x) => `${x.start}-${x.end} s: ${x.ms} ms, ${x.feel}`).join("; ");
}

/** The clip the model watches: mp4, 480 wide, 8 fps, at most CLIP_MAX_S, no sound. */
export function prepClip(item, dir) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${item.id}-clip.mp4`);
  if (!existsSync(p)) execFileSync("ffmpeg", ["-y", "-v", "error", "-t", String(CLIP_MAX_S), "-i", item.filePath,
    "-vf", "scale=480:-2:flags=lanczos,fps=8", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", p]);
  return p;
}

export function buildMotionPrompt(item, m, title) {
  const long = m.seconds > CLIP_MAX_S ? ` (you see the first ${CLIP_MAX_S} s)` : "";
  return `This is a saved motion reference: an animation or video clip, ${m.seconds} s long${long}.${title ? ` Its title: "${title}".` : ""}
Code measured when things move: ${timeline(m)}.
Describe HOW IT MOVES, not what one still frame looks like. Answer with JSON only:
{"what_moves": "<one sentence: which elements move, in what order, and what each does>",
 "motion_kind": "<one of: ${MOTION_KINDS.join(", ")}>",
 "trigger": "<one of: ${TRIGGERS.join(", ")}>",
 "move": "<one sentence: the motion idea worth borrowing, as a relationship in time: what leads and what follows, direction, scale change, continuity between states. No colours, typefaces or subject matter.>"}
Use "none" for motion_kind when nothing meaningful moves (a still saved as a GIF, or unrelated images cycling).`;
}

export function parseMotion(text) {
  const raw = /\{[\s\S]*\}/.exec(text ?? "")?.[0];
  let j;
  try { j = JSON.parse(raw); } catch { return { valid: false }; }
  const pick = (v, list, d) => (list.includes(String(v ?? "").toLowerCase().trim()) ? String(v).toLowerCase().trim() : d);
  const move = String(j.move ?? "").trim();
  const words = move.toLowerCase().match(/[a-z-]+/g) ?? [];
  return {
    valid: Boolean(j.what_moves),
    whatMoves: String(j.what_moves ?? "").trim(),
    kind: pick(j.motion_kind, MOTION_KINDS, "none"),
    trigger: pick(j.trigger, TRIGGERS, "unclear"),
    move,
    moveBanned: MOVE_BANNED.filter((b) => words.includes(b)),
  };
}
