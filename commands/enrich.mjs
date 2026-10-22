#!/usr/bin/env node
/**
 * enrich: every step in order. Tag what is new, site captures, the motion pass, the index, vectors, readable names,
 * then the write-back into Eagle. What the background job runs (eagle-refs background on) on
 * every change to the library; safe to run by hand any time.
 *
 *   eagle-refs enrich          # write back for real (add-only)
 *   eagle-refs enrich --dry    # everything except the write-back, which only previews
 *
 * Every step skips work already done, so a run with nothing new costs nothing and takes a
 * few seconds. Each step prints one summary line; a failed step never stops the others,
 * and anything not done (a model call that failed, Eagle closed) is picked up next run.
 * If Eagle is closed, tagging and the index still update and the write-back catches up.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, data } from "../lib/config.mjs";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "eagle-refs.mjs");
const DRY = process.argv.includes("--dry");
const cfg = config();

// launchd and other schedulers start jobs with PATH=/usr/bin:/bin:/usr/sbin:/sbin, which has no
// Homebrew, so ffmpeg is not found. Every other tool used here ships with macOS.
const env = { ...process.env, EAGLE_REFS_CONFIG: cfg.file, PATH: ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].filter(Boolean).join(":") };

const stamp = () => new Date().toLocaleString("sv-SE").slice(0, 19);
const log = (line) => console.log(`${stamp()} ${line}`);

// One run at a time. A lock older than two hours is from a run that was killed: take it.
const LOCK = data(".enrich.lock");
mkdirSync(cfg.dataDir, { recursive: true });
try { if (Date.now() - statSync(LOCK).mtimeMs > 2 * 3600_000) rmSync(LOCK, { recursive: true }); } catch {}
try { mkdirSync(LOCK); } catch { log("skipped: another run is going"); process.exit(0); }
const unlock = () => { try { rmSync(LOCK, { recursive: true }); } catch {} };
process.on("exit", unlock);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

/** Run one command; return its last line matching `pattern` (progress lines use \r). */
function step(args, pattern) {
  const r = spawnSync(process.execPath, [BIN, ...args], { env, encoding: "utf8", maxBuffer: 1 << 26 });
  const lines = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split(/[\r\n]+/).filter((l) => pattern.test(l));
  return lines.at(-1)?.trim() ?? (r.status ? `exited ${r.status}` : "no output");
}

log(`tag: ${step(["tag", "--concurrency", "8"], /calls|OPENROUTER|Error/)}`);
// Sites dropped into the "Capture motion" folder: recorded, read, added to Eagle. Optional: needs Playwright.
log(step(["capture"], /capture:|Error/));
// Saved tweets: the video behind each one, added next to the save, before the motion pass reads it.
log(step(["x"], /x:|Error/));
log(step(["motion"], /motion:|OPENROUTER|Error/));
log(`index: ${step(["index"], /index:/).replace(/^index: /, "")}`);
// Vectors for search by meaning. No key or a failed call is one line here, never a stop: search falls back to words.
log(step(["embed"], /embed:|OPENROUTER|Error/));
log(step(["names"], /names:|OPENROUTER|Error/));

const eagleOpen = await fetch("http://localhost:41595/api/application/info", { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
if (!eagleOpen) {
  log("writeback: Eagle is closed; will catch up next run");
} else {
  const WB = /verified|Open library|nothing written|FAILED|items to write/;
  const run = DRY ? [] : ["--run"];
  // Main tags and notes first: the photo, sections and motion lines append to that note.
  // Names last, after the use tags: a page title that set a use is replaced only once the tag is on.
  const scopes = [[], ["--photo"], ["--sections"], ["--motion"], ...(Object.keys(cfg.uses).length ? [["--uses"]] : []), ["--names"]];
  for (const s of scopes) log(`writeback${s.length ? ` ${s[0].slice(2)}` : ""}: ${step(["writeback", ...s, ...run], WB)}`);
}

// Under `background on`, launchd appends this run's lines to a log. Keep it to the last 2,000.
const LOGFILE = process.env.EAGLE_REFS_LOG;
if (LOGFILE && existsSync(LOGFILE)) {
  const lines = readFileSync(LOGFILE, "utf8").split("\n");
  if (lines.length > 3000) writeFileSync(LOGFILE, lines.slice(-2000).join("\n"));
}
