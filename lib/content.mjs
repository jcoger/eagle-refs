/**
 * The content pass: the WORDS and the BUILD of a saved post, which the main tags never
 * capture. The main pass keeps one headline (visible_text); what makes a post worth saving
 * is its hook, its structure and the turn, so those get a pass of their own.
 *
 * Runs on items the main pass put in the content kind, and on every item in a configured
 * content folder (config "content.folders"), whatever the main pass said. Its own prompt,
 * its own file per item (tags/content/<id>.json in the data folder); the main tags are
 * untouched. The image is sent at reading size (prepReading: 1024 wide, up to 4 tiles).
 *
 * What wins over the model's reading: the platform and author a URL carries
 * (lib/social.mjs), and for X saves the tweet's own text from X's embed endpoint
 * (lib/x.mjs). The model still answers hook, hook type, structure and shape.
 *
 * Model (bench 2026-10-29, 10 hand-picked posts: 3 tall phone screenshots, a carousel
 * cover, 2 thumbnails, 2 reels, 3 image posts): GLM (z-ai/glm-5.3-flash) and Gemini
 * (google/gemini-3.8-flash) gave the same hook on 9 of 10 and agreed on format on 9.
 * GLM kept the text to the post's own words where Gemini also copied the form fields
 * of a mockup inside the image, and cost about a tenth ($0.0002 vs $0.0025 a post).
 * GLM is the default; set models.content to change it.
 */
import { platformFromUrl, authorFromUrl } from "./social.mjs";
import { sourceOf } from "./library.mjs";
import { SURFACES_BY_KIND } from "./vocab.mjs";

export const CONTENT_FACETS = {
  format: { values: SURFACES_BY_KIND.content },
  platform_name: { values: ["linkedin", "x", "instagram", "threads", "tiktok", "youtube", "substack", "newsletter", "other", "unclear"] },
  hook_type: { values: ["question", "contrarian", "number", "story open", "confession", "how-to", "list promise", "bold claim", "quote", "news", "none"] },
  structure: { values: ["story then lesson", "list", "step by step", "before and after", "hot take", "case study", "breakdown", "single insight", "announcement", "behind the scenes", "comparison", "none"] },
};

/**
 * "model" when the main pass called it content, "folder" when it sits in a content folder
 * (that wins: a folder is the person saying so), else null.
 * @param folderIds  Set of Eagle folder ids configured as content folders
 */
export function contentTarget(item, tags, folderIds) {
  if (folderIds?.size && (item.folders ?? []).some((f) => folderIds.has(f))) return "folder";
  return tags?.kind === "content" ? "model" : null;
}

const MAX_TEXT = 3000;

/**
 * @param ctx.tiles      how many image tiles are attached, top to bottom
 * @param ctx.truncated  the image goes on past the last tile
 * @param ctx.tweet      { text, author } from X's embed endpoint, when there is one
 * @param ctx.folder     true when it is in a content folder (the person says it is content)
 */
export function buildContentPrompt(item, ctx = {}) {
  const net = platformFromUrl(item.url);
  const urlAuthor = authorFromUrl(item.url);
  const one = (k) => `ONE of ${JSON.stringify(CONTENT_FACETS[k].values)}`;
  const context = [
    `Saved from: ${sourceOf(item.url) || "unknown (screenshot or upload)"}${net ? ` (${net})` : ""}`,
    urlAuthor ? `The link says the author is: ${urlAuthor}` : null,
    ctx.tiles > 1 ? `The image is tall, so you get it in ${ctx.tiles} overlapping slices, top to bottom. Read across them as one post and do not repeat the overlap.` : null,
    ctx.truncated ? "The image goes on past the last slice. Transcribe what you can see." : null,
    ctx.tweet?.text ? `The post's own text, from the network (trust it over your reading of the image):\n"""\n${ctx.tweet.text}\n"""` : null,
    ctx.folder ? "It was filed as content on purpose: describe it as a post even if it looks like a design." : null,
  ].filter(Boolean).join("\n");

  return `You are reading one saved post for a writer's reference library. The writer saves posts whose words work, to study how they are built: the hook, the structure, the turn, the close.

${context}

Reply with one JSON object and nothing else:
{
  "format": ${one("format")},
  "platform_name": ${one("platform_name")},
  "author": the author's name or handle exactly as printed on the post, else "",
  "text": the post's own words, verbatim, in reading order, line breaks kept. Leave out comments, replies, UI chrome, buttons, counts and timestamps. For a carousel or thumbnail, the words on the slide or image. Max ${MAX_TEXT} characters,
  "hook": the opening line or lines that stop the scroll, verbatim from the text, max 30 words,
  "hook_type": ${one("hook_type")},
  "structure": ${one("structure")},
  "cta": the closing ask, verbatim, else "",
  "shape": one sentence, 25 words max: how the post is built, beat by beat ("a one-line confession, three short proofs, then a reversal that reframes the confession"). Name NO topic, product, person or number from the post, so the build could be reused on any subject
}

Rules:
- Use only the listed values, spelled exactly as written.
- "text post" is words only. "image post" is one image or graphic with a caption. "carousel" has several slides (a counter, dots, "1/8"). "thread" is a chain of posts by one author. "thumbnail" is a video thumbnail. "short video" is a reel, TikTok or Short. "newsletter" is a writer's email or Substack issue.
- Copy words exactly. Do not fix spelling, do not summarise, do not invent text you cannot read.
- "hook_type" is about the opening only; "structure" is about the whole post.`;
}

// Structural words a shape may use freely; a longer word shared with the hook is a topic leak.
const SHAPE_OK = new Set(["their", "there", "which", "while", "short", "opening", "single", "story", "lesson", "point", "claim", "proof", "proofs", "reversal", "question", "answer", "list", "steps", "step", "before", "after", "close", "closing", "turn", "line", "lines", "three", "short", "final", "first", "second", "third", "reader", "personal", "about", "never", "every", "thing", "things"]);
export function shapeLeaks(shape, hook) {
  const words = (s) => new Set((String(s).toLowerCase().match(/[a-z']{5,}/g) ?? []).filter((w) => !SHAPE_OK.has(w)));
  const h = words(hook);
  return [...words(shape)].filter((w) => h.has(w));
}

const clean = (v) => String(v ?? "").replace(/\r\n/g, "\n").trim();

export function parseContent(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < s) return { valid: false, error: "no json" };
  let j;
  try { j = JSON.parse(text.slice(s, e + 1)); } catch { return { valid: false, error: "bad json" }; }
  const out = {};
  const off = [];
  for (const [k, f] of Object.entries(CONTENT_FACETS)) {
    const v = j[k] == null ? null : String(Array.isArray(j[k]) ? j[k][0] : j[k]).toLowerCase().trim();
    if (v && !f.values.includes(v)) off.push(`${k}:${v}`);
    out[k] = v && f.values.includes(v) ? v : null;
  }
  out.platform_name ??= "unclear";
  out.hook_type ??= "none";
  out.structure ??= "none";
  out.author = clean(j.author).replace(/^@/, "");
  out.text = clean(j.text).slice(0, MAX_TEXT);
  out.hook = clean(j.hook).split(/\s+/).slice(0, 30).join(" ");
  out.cta = clean(j.cta);
  out.shape = clean(j.shape);
  return { valid: Boolean(out.format), content: out, shapeLeaks: shapeLeaks(out.shape, out.hook), off };
}

/**
 * The model's answer with what the URL and the network know laid over it.
 * @param tweet  { text, author } or null
 */
export function settle(item, parsed, tweet = null) {
  const c = { ...parsed.content };
  const net = platformFromUrl(item.url);
  if (net) c.platform_name = net;
  const urlAuthor = authorFromUrl(item.url);
  if (tweet?.author) c.author = tweet.author;
  else if (urlAuthor) c.author = urlAuthor;
  if (tweet?.text) c.text = tweet.text.slice(0, MAX_TEXT);
  return c;
}
