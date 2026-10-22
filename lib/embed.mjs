/**
 * Embeddings: one vector per index record, from OpenRouter's /embeddings. A record's
 * vector reads its image and its words together, so a brief in plain words can find a
 * look no tag names. One key, one string for the model, same as lib/openrouter.mjs.
 *
 * Vectors come back L2-normalized, so cosine similarity is a plain dot product.
 * Measured 2026-10-22: google/gemini-embedding-2 at 768 dims, ~$0.00013 a record;
 * voyageai/voyage-multimodal-3.5 at 1024 dims, ~$0.00063 a record.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname } from "node:path";

const BASE = "https://openrouter.ai/api/v1";
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** What one record costs, by model, for the dry run. Measured; the real cost is read from each response. */
export const PRICE_PER_RECORD = { "google/gemini-embedding-2": 0.00013, "voyageai/voyage-multimodal-3.5": 0.00063 };
export const priceFor = (model) => PRICE_PER_RECORD[model] ?? PRICE_PER_RECORD["google/gemini-embedding-2"];

const norm = (v) => {
  const out = Float32Array.from(v);
  let sum = 0;
  for (const x of out) sum += x * x;
  const len = Math.sqrt(sum) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= len;
  return out;
};

/**
 * Embed a list. Each input is a string (text only) or an array of content parts
 * ({type:"text"}, {type:"image_url"}) for one multimodal item.
 * Returns { ok, vectors: Float32Array[], cost } or { ok: false, error }.
 * `attempts` and `timeoutMs` let a search give up fast where an index run can wait.
 */
export async function embed(inputs, { model, dimensions, key, attempts = 3, timeoutMs = 120_000 }) {
  const body = { model, dimensions, input: inputs.map((x) => (typeof x === "string" ? x : { content: x })) };
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const r = await fetch(`${BASE}/embeddings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const j = await r.json();
      const rows = [...(j.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (rows.length !== inputs.length || rows.some((x) => !x.embedding?.length)) throw new Error(`HTTP 200: got ${rows.length} vectors for ${inputs.length} inputs`);
      return { ok: true, vectors: rows.map((x) => norm(x.embedding)), cost: j.usage?.cost ?? 0 };
    } catch (e) {
      lastErr = e;
      // A 4xx other than rate limiting is our request and will not fix itself.
      if (/HTTP 4(?!29)\d\d/.test(String(e.message))) break;
      if (attempt < attempts) await new Promise((res) => setTimeout(res, attempt * 2000));
    }
  }
  return { ok: false, error: String(lastErr?.message ?? lastErr) };
}

/** The words a record is embedded with: what it is, the idea in it, and its facet values. */
export function recordText(r) {
  const facets = ["kind", "surface", "platform", "theme", "industry", "style", "pattern", "component", "type", "shot", "light", "treatment", "framing"]
    .flatMap((f) => (Array.isArray(r[f]) ? r[f] : [r[f]]))
    .filter((v) => v && v !== "none" && v !== "unclear");
  return [r.description, r.move, facets.join(", ")].filter(Boolean).join("\n");
}

/** The content parts for one record: its words, then its image when the file is there. */
export function recordInput(r) {
  const parts = [{ type: "text", text: recordText(r) || String(r.name ?? "") }];
  if (r.image && existsSync(r.image)) {
    const mime = MIME[extname(r.image).toLowerCase()] ?? "image/jpeg";
    parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${readFileSync(r.image).toString("base64")}` } });
  }
  return parts;
}

/** Changes when anything that shapes the vector changes: the record, its image, the model, the size. */
export function recordKey(r, { model, dimensions }) {
  const mtime = r.image && existsSync(r.image) ? statSync(r.image).mtimeMs : 0;
  const text = createHash("sha1").update(recordText(r)).digest("hex").slice(0, 12);
  return `${r.id}|${mtime}|${model}|${dimensions}|${text}`;
}
