#!/usr/bin/env node
/**
 * names: readable names for items saved with junk ones. In one 6,294-item library, 2,010 (32%)
 * were camera or screenshot filenames, hash IDs, or one page title repeated ("Image" x128,
 * "Slide from the presentation" x75), which says nothing in Eagle's grid, in Eagle's search,
 * or in a search result. A model writes a 3-7 word name from what the tagger already knows
 * (text only, ~$0.00013 each). Results: tags/names/<id>.json. writeback --names puts them on
 * the items in Eagle; the old name is kept there for undo and in the index as `savedAs`, so a
 * search for the old name still finds the item.
 *
 * Only junk or repeated names: a readable, unique name stays, so a name you typed is never
 * touched. An item is named once; if you rename it afterwards, that stays.
 *
 *   eagle-refs names --dry-run | --sample 20 | (all)
 *   eagle-refs names --recredit   # put makers' credits back on names already generated
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, data } from "../lib/config.mjs";
import { meaningfulTitle } from "../lib/prompt.mjs";
import { see, shortError } from "../lib/openrouter.mjs";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const MODEL = config().models.names;
const OUT = data("tags/names");
mkdirSync(OUT, { recursive: true });

// Where something was saved from is never its brand (an early sample named "Are.na poetry notebook").
const SOURCES = ["are.na", "arena", "pinterest", "dribbble", "behance", "instagram", "muzli", "savee", "land-book", "landbook", "twitter", "x.com", "medium", "fontsinuse", "fonts in use"];
const COLOURS = ["red", "blue", "green", "yellow", "orange", "purple", "pink", "black", "white", "grey", "gray", "teal", "beige", "cream", "gold", "silver", "neon", "pastel", "navy", "mint", "brown"];

export const isJunkName = (name, count) => !meaningfulTitle(name) || count >= 3;

const recs = readFileSync(data("index/refs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.record === "item");
const count = new Map();
for (const r of recs) count.set(r.name, (count.get(r.name) ?? 0) + 1);
let todo = recs.filter((r) => r.tagged && !r.blank && r.description && !existsSync(join(OUT, `${r.id}.json`)) && isJunkName(r.name, count.get(r.name)));
if (flag("sample")) todo = todo.slice(0, Number(flag("sample")));
if (has("dry-run")) { console.log(`names: ${todo.length} items to name, ~$${(todo.length * 0.00013).toFixed(2)}`); process.exit(0); }
const key = process.env.OPENROUTER_API_KEY;
if (!key && todo.length) { console.error("names: OPENROUTER_API_KEY missing (put it in a .env next to eagle-refs.config.json)"); process.exit(1); }

const prompt = (r, extra = "") => `Name this saved design reference so it reads well in a library grid. 3 to 7 words.
Lead with the brand, product, studio or maker when the item shows one, then say exactly what it is: "Syrupy poster series", "Mr. Baffo mobile landing page", "Spruce type-in-use breakdown", "Hungryroot plan picker screen".
Where it was saved from (Are.na, Pinterest, Dribbble, Behance, Instagram, Muzli, Savee and the like) is never the brand. A headline or slogan is not a name either: describe the thing instead.
No quotes, no "image of", no dates, no colours.${meaningfulTitle(r.name) ? CREDIT : ""}${extra}
Known: brand or headline read off the image: ${r.visibleText || "none"} | app: ${r.app || "none"} | what it is: ${r.kind} / ${r.surface} | saved from: ${r.source || "unknown"} | old name: "${r.name}"
Description: ${r.description}
Answer with the name only.`;

// Readable old names often credit the maker; a rename must not drop that ("Simple as Milk", a
// studio, became "Plum logo lockup" in the first run). Roundup and article titles do not count.
const CREDIT = `\nThe old name is readable. If it names a studio, designer or project, keep that name in the new one ("Plum logo lockup by Simple as Milk"). If it is an article or roundup title ("15 Creative UI Concepts", "Made with Studio 17 - Muzli"), ignore it.`;

// Who made or posted it, from the old name ("Photo by Donato Smith on May 28", "Media posts by
// Tracy Tang @tracytangtt"). The model dropped it in 143 of 192 renames, so code puts it back.
export const creditOf = (original) => /\bby ([A-Z][\w.&'-]+(?: [A-Z][\w.&'-]+){0,3})/.exec(original ?? "")?.[1] ?? null;
const withCredit = (name, original) => {
  const c = creditOf(original);
  return c && name && !name.toLowerCase().includes(c.split(" ")[0].toLowerCase()) ? `${name} by ${c}` : name;
};

// --recredit: put credits back on names already generated, no model calls.
if (has("recredit")) {
  let n = 0;
  for (const f of readdirSync(OUT)) {
    const d = JSON.parse(readFileSync(join(OUT, f), "utf8"));
    const fixed = withCredit(d.name, d.original);
    if (d.name && fixed !== d.name) { d.modelName ??= d.name; d.name = fixed; writeFileSync(join(OUT, f), JSON.stringify(d, null, 2)); n++; }
  }
  console.log(`names: credit added back to ${n} names`);
  process.exit(0);
}

const clean = (t) => String(t ?? "").split("\n")[0].replace(/^["'“]+|["'”.]+$/g, "").replace(/\s+/g, " ").trim();
const problem = (n) => {
  const words = n.toLowerCase().match(/[a-z0-9.-]+/g) ?? [];
  if (words.length < 2 || words.length > 9 || n.length > 64) return "length";
  if (SOURCES.some((s) => words.slice(0, 2).join(" ").includes(s))) return "source";
  if (words.some((w) => COLOURS.includes(w))) return "colour";
  return null;
};

let calls = 0, spend = 0, flagged = 0, errors = 0, done = 0, firstError = null;
const queue = [...todo];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const r = queue.shift();
    let name = "", why = null, cost = 0;
    // One retry when the name breaks a rule, naming the rule it broke.
    for (let attempt = 0; attempt < 2; attempt++) {
      const extra = why === "source" ? "\nThe last try used the site it was saved from as the brand. Do not." : why === "colour" ? "\nThe last try named a colour. Leave colours out." : why === "length" ? "\nThe last try was the wrong length: 3 to 7 words." : "";
      const res = await see({ model: MODEL, prompt: prompt(r, extra), key });
      calls++; cost += res.cost ?? 0;
      if (!res.ok) { why = "error"; firstError ??= res.error; break; }
      name = clean(res.text);
      why = problem(name);
      if (!why) break;
    }
    spend += cost;
    // A failed call is not recorded: it is not the item's fault (a spent key, an outage), so it goes
    // again next run, as in tag.mjs.
    if (why === "error") errors++;
    else {
      if (why) flagged++;
      // A name still breaking a rule is not written: the item keeps its old name.
      writeFileSync(join(OUT, `${r.id}.json`), JSON.stringify({ id: r.id, original: r.name, name: why ? null : withCredit(name, r.name), rejected: why ? { name, why } : undefined, model: MODEL, cost, at: new Date().toISOString() }, null, 2));
    }
    done++;
    process.stdout.write(`\r  names ${done}/${todo.length}   `);
  }
}));
if (todo.length) console.log();
console.log(`names: ${todo.length} items, calls ${calls}, kept old name ${flagged}${errors ? `, errors ${errors} (retried next run; first: ${shortError(firstError)})` : ""}, spend this run $${spend.toFixed(3)}`);
