/**
 * OpenRouter calls for the "see" step. One key reaches every vision model, so
 * the model is a string, not an integration.
 *
 * Reasoning: non-Anthropic models get `reasoning: { effort: "low" }` and a
 * budget that fits thought plus answer. Measured: at default effort some models
 * think until max_tokens and return JSON cut mid-field.
 */
import { readFileSync } from "node:fs";

const BASE = "https://openrouter.ai/api/v1";

/** Live prices, never a stale constant: the catalog moves weekly. */
export async function catalog() {
  const r = await fetch(`${BASE}/models`);
  const { data } = await r.json();
  return new Map(data.map((m) => [m.id, {
    in: Number(m.pricing.prompt),
    out: Number(m.pricing.completion),
    image: (m.architecture?.input_modalities ?? []).includes("image"),
  }]));
}

export async function see({ model, prompt, images = [], videos = [], key }) {
  const anthropic = model.startsWith("anthropic/");
  const body = {
    model,
    max_tokens: 4096,
    usage: { include: true },
    // Claude 5-family models reject sampling params; everyone else gets temperature 0.
    ...(anthropic ? {} : { temperature: 0, reasoning: { effort: "low" } }),
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...images.map((p) => ({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${readFileSync(p).toString("base64")}` },
        })),
        // Video (mp4). OpenRouter refuses video unless the account holds at least $1.00 of credit.
        ...videos.map((p) => ({
          type: "video_url",
          video_url: { url: `data:video/mp4;base64,${readFileSync(p).toString("base64")}` },
        })),
      ],
    }],
  };

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const j = await r.json();
      return {
        ok: true,
        text: j.choices?.[0]?.message?.content ?? "",
        finish: j.choices?.[0]?.finish_reason ?? null,
        usage: j.usage ?? null,
        cost: j.usage?.cost ?? null,
        provider: j.provider ?? null,
        ms: Date.now() - t0,
      };
    } catch (e) {
      lastErr = e;
      // A 4xx other than rate limiting is our request and will not fix itself.
      if (/HTTP 4(?!29)\d\d/.test(String(e.message))) break;
      await new Promise((res) => setTimeout(res, attempt * 2000));
    }
  }
  return { ok: false, error: String(lastErr?.message ?? lastErr) };
}

/** A failed call's error, short enough for a log line: "HTTP 403: Key limit exceeded (monthly limit)". */
export function shortError(error = "") {
  const s = String(error);
  const status = /^HTTP (\d+)/.exec(s)?.[1];
  const message = /"message"\s*:\s*"([^"]+)"/.exec(s)?.[1] ?? s.replace(/^HTTP \d+:\s*/, "");
  return `${status ? `HTTP ${status}: ` : ""}${message.split(". ")[0].slice(0, 80)}`;
}
