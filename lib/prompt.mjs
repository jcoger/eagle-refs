/**
 * The "see" prompt and its parser. One prompt for every model so the bake-off
 * compares models, not prompts. The parser is strict on purpose: a value not
 * in the vocabulary is dropped and counted, and a missing single-choice facet
 * makes the answer invalid. A model that cannot follow the list is disqualified
 * by its own numbers.
 */
import { FACETS, SINGLE, SURFACES_BY_KIND, SECTION_SURFACES, KIND_OF, MOVE_BANNED } from "./vocab.mjs";
import { sourceOf, isTall } from "./library.mjs";

/**
 * A saved item's name, when it is a real title ("Aguas de Ibiza Hotel Landing
 * Page", "Giftful - Wishlist & Registry · 03") and not a filename the OS made up.
 */
export function meaningfulTitle(name = "") {
  const n = name.trim().replace(/^\(\d+\)\s*/, "");
  if (n.length < 4) return null;
  if (/^(image|img[ _-]?\d*|untitled|photo|download|screen ?shot|screenshot|screen recording|cleanshot|capture)\b/i.test(n)) return null;
  // Hash-like names, but only single tokens: a long title with spaces is a real title.
  const token = !/\s/.test(n);
  if (token && (/^[0-9a-f-]{12,}$/i.test(n) || /^\d+$/.test(n) || (/^[A-Za-z0-9]{16,}$/.test(n) && /\d/.test(n)))) return null;
  // Platform image ids (X's "DC9emJSWsAEgT62"): one token, letters and digits mixed.
  if (token && /^[A-Za-z0-9_-]{10,20}$/.test(n) && /\d/.test(n) && /[A-Z]/.test(n) && /[a-z]/.test(n)) return null;
  // Social post wrappers name the POST, not the image: tested 2026-09-23, "Media posts
  // by ... / X" and "... on Instagram" pulled illustrations and art to "social post".
  if (/media posts by|\bon (instagram|dribbble|behance|x|twitter|pinterest|tiktok|threads)\b|\/ x$|- youtube$|\| (x|instagram|pinterest)$/i.test(n)) return null;
  return n;
}

/**
 * @param section  null for a whole item; for one section of a full-page capture,
 *                 { n, total, y0, y1 } in original pixels.
 * @param opts.title  include the item's name as context when it is a real title
 */
export function buildPrompt(item, sliceCount, section = null, opts = {}) {
  const surfaceGroups = Object.entries(SURFACES_BY_KIND)
    .map(([kind, list]) => `      ${kind}: ${JSON.stringify(list)}`).join("\n");
  const facetLines = Object.entries(FACETS).map(([name, f]) => {
    if (name === "surface" && section) return `  "surface": ONE of ${JSON.stringify(SECTION_SURFACES)}  (the section type that fills most of this part; "content" for plain body text)`;
    if (name === "surface") return `  "surface": ONE value from these groups (${f.hint}):\n${surfaceGroups}`;
    const how = f.pick === "one" ? "ONE of" : `up to ${f.max}, most important first, from`;
    return `  "${name}": ${how} ${JSON.stringify(f.values)}  (${f.hint})`;
  }).join(",\n");

  const src = sourceOf(item.url);
  const title = opts.title ? meaningfulTitle(item.name) : null;
  const context = [
    title ? `Saved with the title: "${title}" (a hint for brand, product and industry; tag what the image shows)` : null,
    `Saved from: ${src || "unknown (screenshot or upload)"}`,
    `Original size: ${item.width}x${item.height}px`,
    section
      ? `This is part ${section.n} of ${section.total} of a full-page scroll capture (pixels ${section.y0} to ${section.y1} of ${item.height} tall). Tag only what this part shows: "surface" is the section type that fills most of it.`
      : isTall(item) && sliceCount > 1
        ? "This is a full-page scroll capture. You get two slices: the top of the page, then the middle."
        : null,
  ].filter(Boolean).join("\n");

  return `You are tagging one image from a designer's reference library. Coding agents will search these tags to find references, for example "dark fintech hero with a device mockup".

${context}

Reply with one JSON object and nothing else:
{
  "description": one factual sentence, 25 words max: what it is, the layout, the type, the color. No opinions or praise words,
  "move": one sentence, 25 words max, naming the transferable idea that makes it work: how elements relate in scale, position, rhythm, contrast or sequence. Name NO colour, NO typeface and NO subject matter, so the idea could be reused in a completely different project,
  "visible_text": the brand name or main headline if legible, else "",
  "app": the app or product name if this is an app screen or app store listing and you can read it, else "",
${facetLines}
}

Rules:
- Use only the listed values, spelled exactly as written.
- Tag what is visible. Do not guess an industry from style alone; use "unclear".
- A full website page is "landing page"; a single section of one is that section's type.
- The move describes structure, not appearance. Form only, not content to copy: "one oversized element against a field of small, evenly spaced text, so scale alone sets the order".`;
}

const moveViolations = (move) => {
  const words = move.toLowerCase().match(/[a-z-]+/g) ?? [];
  return MOVE_BANNED.filter((b) => words.includes(b));
};

/** @param opts.surfaces  restrict surface to this list (sections use SECTION_SURFACES) */
export function parseAnswer(text, opts = {}) {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < s) return { valid: false, error: "no json" };
  let j;
  try { j = JSON.parse(text.slice(s, e + 1)); } catch { return { valid: false, error: "bad json" }; }

  const tags = {};
  const off = [];
  for (const [name, f] of Object.entries(FACETS)) {
    const raw = j[name];
    const arr = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map((v) => String(v).toLowerCase().trim());
    const allowed = name === "surface" && opts.surfaces ? opts.surfaces : f.values;
    const ok = arr.filter((v) => allowed.includes(v));
    off.push(...arr.filter((v) => !allowed.includes(v)).map((v) => `${name}:${v}`));
    tags[name] = f.pick === "one" ? (ok[0] ?? null) : ok.slice(0, f.max);
  }
  // Industry only ranks, never filters: an off-list answer means "unclear", not a lost item.
  if (!tags.industry) tags.industry = "unclear";
  tags.kind = tags.surface ? KIND_OF[tags.surface] : null;
  const missing = SINGLE.filter((f) => !tags[f]);
  const move = String(j.move ?? "");
  return {
    valid: missing.length === 0,
    tags,
    description: String(j.description ?? ""),
    move,
    moveBanned: moveViolations(move),
    app: String(j.app ?? ""),
    visibleText: String(j.visible_text ?? ""),
    off,
    missing,
  };
}
