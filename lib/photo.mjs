/**
 * The photo pass: HOW a photograph was made, which the main tags never capture.
 * Found 2026-09-23: across 453 photos the main descriptions said "flash" twice and
 * "natural light" once. Art direction lives in light, crop, staging and treatment.
 *
 * Runs on photos (kind photo-art, surface photo) and on the main photograph inside
 * photo-led designs (heroes, campaigns, posts). Its own prompt and its own file per
 * item (tags/photo/<id>.json in the data folder); the main tags are untouched.
 *
 * Values that would collide with existing tags are renamed: "product shot" (not
 * "product", which is the app-screen kind), "food shot", "fashion shot", "detail shot".
 */
import { isTall } from "./library.mjs";

export const PHOTO_FACETS = {
  shot: { pick: "one", values: ["portrait", "candid", "group", "still life", "product shot", "food shot", "interior", "architecture", "landscape", "street", "fashion shot", "event", "detail shot", "abstract", "none"] },
  light: { pick: "one", values: ["direct flash", "window light", "golden hour", "soft studio", "hard sun", "overcast", "night", "practical lights", "unclear"] },
  treatment: { pick: "many", max: 2, values: ["warm", "cool", "muted", "saturated", "film", "black and white", "high contrast", "faded", "grain", "clean digital"] },
  framing: { pick: "many", max: 3, values: ["close crop", "cut by frame", "centered", "wide", "overhead", "low angle", "eye level", "negative space", "motion blur", "layered depth", "symmetrical"] },
  people: { pick: "one", values: ["none", "solo", "pair", "small group", "crowd"] },
};

const PHOTO_ITEM = (r) => r.kind === "photo-art" && r.surface === "photo";
const PHOTO_LED = (r) => r.kind !== "photo-art" && ((r.style ?? []).includes("photo-led") || (r.pattern ?? []).includes("full-bleed photo"));
export const photoTarget = (r) => (PHOTO_ITEM(r) ? "photo" : PHOTO_LED(r) ? "photo-led" : null);

export function buildPhotoPrompt(item, target) {
  const lines = Object.entries(PHOTO_FACETS).map(([k, f]) =>
    `  "${k}": ${f.pick === "one" ? "ONE of" : `up to ${f.max} from`} ${JSON.stringify(f.values)}`).join(",\n");
  const what = target === "photo"
    ? "This is a photograph."
    : `This is a design${isTall(item) ? " (the top of a full page)" : ""} built on photography. Judge ONLY its main photograph; ignore the layout, text and UI.`;
  return `You are describing how a photograph was made, for an art director's reference library. ${what}

Reply with one JSON object and nothing else:
{
  "photo_note": one sentence, 25 words max, on how it is shot: the light (its direction and hardness), the crop, the staging and the colour treatment. Say what makes it feel the way it does. No praise words,
${lines}
}

Rules:
- Light is the most important field. "direct flash" means a hard frontal flash: bright faces, hard shadow behind the subject, dark falloff. "window light" is soft and directional from one side. Use "unclear" rather than guess.
- "cut by frame" means a head, face or body is deliberately cropped by the edge.
- If there is no real photograph, set "shot" to "none".`;
}

export function parsePhoto(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < s) return { valid: false, error: "no json" };
  let j;
  try { j = JSON.parse(text.slice(s, e + 1)); } catch { return { valid: false, error: "bad json" }; }
  const out = {};
  const off = [];
  for (const [k, f] of Object.entries(PHOTO_FACETS)) {
    const arr = (Array.isArray(j[k]) ? j[k] : j[k] == null ? [] : [j[k]]).map((v) => String(v).toLowerCase().trim());
    const ok = arr.filter((v) => f.values.includes(v));
    off.push(...arr.filter((v) => !f.values.includes(v)).map((v) => `${k}:${v}`));
    out[k] = f.pick === "one" ? (ok[0] ?? null) : ok.slice(0, f.max);
  }
  out.light ??= "unclear";
  return { valid: Boolean(out.shot && out.people), photo: out, note: String(j.photo_note ?? ""), off };
}
