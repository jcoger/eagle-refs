/**
 * Config: where the library is, where results go, which models run. One JSON file,
 * eagle-refs.config.json, found in this order:
 *   1. $EAGLE_REFS_CONFIG (the eagle-refs command sets it from --config)
 *   2. eagle-refs.config.json in the working directory
 *   3. eagle-refs.config.json next to the script that was run
 * Relative paths in it resolve from the file's own folder, and "~" is your home folder.
 * A .env next to it is loaded too (OPENROUTER_API_KEY); a key already set in the
 * environment wins.
 *
 * Loaded on first use, never at import, so `eagle-refs help` works without a config.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export const CONFIG_NAME = "eagle-refs.config.json";

// Measured on a 60-image bake-off (README, "Model choice"). Override per pass in the config.
const DEFAULT_MODELS = {
  tag: "z-ai/glm-5.3-flash",
  photo: "google/gemini-3.8-flash",
  motion: "z-ai/glm-5.3-flash",
  names: "z-ai/glm-5.3-flash",
};

const expand = (p, base) => resolve(base, String(p).replace(/^~(?=$|\/)/, homedir()));

function find() {
  const script = process.argv[1] ? join(dirname(resolve(process.argv[1])), CONFIG_NAME) : null;
  return [process.env.EAGLE_REFS_CONFIG, join(process.cwd(), CONFIG_NAME), script].filter(Boolean).find((p) => existsSync(p));
}

let cached;
export function config() {
  if (cached) return cached;
  const file = find();
  if (!file) {
    throw new Error(`No ${CONFIG_NAME} in this folder. Run eagle-refs from the folder that has it, or add --config <path>. ` +
      `First time? Copy eagle-refs.config.example.json to ${CONFIG_NAME} and set "library".`);
  }
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const base = dirname(file);
  if (!raw.library) throw new Error(`${file}: "library" is required (the path to your .library folder)`);
  const env = join(base, ".env");
  if (existsSync(env) && !process.env.OPENROUTER_API_KEY) process.loadEnvFile(env);
  cached = {
    file,
    library: expand(raw.library, base),
    dataDir: expand(raw.dataDir ?? "./eagle-refs-data", base),
    models: { ...DEFAULT_MODELS, ...(raw.models ?? {}) },
    // Your own spelling for a vocabulary value, used when tags are written to Eagle.
    tagAliases: raw.tagAliases ?? {},
    // What you save things FOR (lib/uses.mjs). None by default.
    uses: raw.uses ?? {},
  };
  return cached;
}

export const libraryPath = () => config().library;
/** "References" for ".../References.library". */
export const libraryName = () => basename(config().library).replace(/\.library$/, "");
/** A path inside the data folder (tags, index, write-back ledger, image cache). */
export const data = (...parts) => join(config().dataDir, ...parts);
