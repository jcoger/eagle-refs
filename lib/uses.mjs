/**
 * Uses: what you saved something FOR, as opposed to what it is. The model tags what it is;
 * code reads what it is for from the context of the save. Declared in the config under
 * "uses"; writeback --uses puts them on the items (tag group "Use").
 *
 * Why not ask the model: purpose is not in the pixels. Tested on 31 known "sharing the
 * work" saves plus 40 random items, a loose "is this a presentation of work" prompt flagged
 * 40% of the library (every staged Dribbble shot) and a tight one missed 17 of the 31.
 * What does carry it is WHERE a thing was clipped from: Eagle names a clip after the page
 * title, and a title pattern matched those saves and nothing else in 6,271 items.
 * So a use comes from, in order: your own tag, the page title or URL, or a folder.
 *
 *   "uses": {
 *     "sharing the work": {
 *       "titles": ["show(ing)?[ -]?off", "self[ -]?promo"],   // regex, case-insensitive, on name + URL
 *       "folders": ["Sharing the work"],                      // folder paths, "Parent/Child"
 *       "queryWords": ["show off", "self promo"]              // search words that mean this use
 *     }
 *   }
 */
import { config } from "./config.mjs";

let rules;
const compiled = () => (rules ??= Object.entries(config().uses).map(([use, r]) => ({
  use,
  titles: (r.titles ?? []).map((t) => new RegExp(t, "i")),
  folders: r.folders ?? [],
})));

/** Uses of one item: { name, url, tags, folderPaths } -> ["sharing the work", ...]. */
export function usesOf({ name = "", url = "", tags = [], folderPaths = [] }) {
  return compiled().filter((r) =>
    tags.includes(r.use) ||
    r.titles.some((re) => re.test(`${name} ${url}`)) ||
    r.folders.some((f) => folderPaths.includes(f))).map((r) => r.use);
}

/** Search words that stand for a use: { "show off": "sharing the work", ... }. */
export const useQueryWords = () => Object.fromEntries(Object.entries(config().uses)
  .flatMap(([use, r]) => (r.queryWords ?? []).map((w) => [w, use])));
