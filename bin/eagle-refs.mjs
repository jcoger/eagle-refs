#!/usr/bin/env node
/**
 * eagle-refs: one entry point for every step. Each command is a script in commands/;
 * this file only routes to it. `--config <file>` anywhere picks the config.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const COMMANDS = {
  tag: ["tag.mjs", [], "tag new items: the item, each section of a full page, and a photo pass"],
  motion: ["motion.mjs", [], "motion pass for GIFs and videos (needs ffmpeg)"],
  names: ["names.mjs", [], "readable names for items saved as IMG_1234 and the like"],
  index: ["build-index.mjs", [], "rebuild the search index from the library and the tags"],
  writeback: ["writeback.mjs", [], "put tags and notes onto items in Eagle (dry run unless --run)"],
  search: ["refs.mjs", ["search"], "find references in plain words"],
  show: ["refs.mjs", ["show"], "print what the index knows about items (ids or Eagle links)"],
  like: ["refs.mjs", ["like"], "more like this item"],
  frames: ["refs.mjs", ["motion"], "frame sheets + speed per measured move, for building a motion"],
  stats: ["refs.mjs", ["stats"], "what the library holds, by kind and surface"],
  enrich: ["enrich.mjs", [], "all of the above in order; what the background job runs"],
};

const args = process.argv.slice(2);
const c = args.indexOf("--config");
if (c !== -1) {
  if (!args[c + 1]) { console.error("--config needs a path"); process.exit(1); }
  process.env.EAGLE_REFS_CONFIG = resolve(args[c + 1]);
  args.splice(c, 2);
}
const [cmd, ...rest] = args;
const entry = COMMANDS[cmd];
if (!entry) {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  console.log(`eagle-refs: tag an Eagle library with vision models and search it from any agent.

usage: eagle-refs <command> [options] [--config <eagle-refs.config.json>]

${Object.entries(COMMANDS).map(([k, [, , about]]) => `  ${k.padEnd(width)}  ${about}`).join("\n")}

Most commands take --dry-run (tag, motion, names) or run dry unless --run (writeback).`);
  process.exit(cmd && cmd !== "help" && cmd !== "--help" ? 1 : 0);
}

const [file, pre] = entry;
const script = join(ROOT, "commands", file);
process.argv = [process.argv[0], script, ...pre, ...rest];
await import(pathToFileURL(script).href);
