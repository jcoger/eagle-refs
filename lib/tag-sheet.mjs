/**
 * Contact sheet for a tagging sample: each item with the tags, description and
 * move GLM gave it, and, for full-page captures, a strip of its section crops
 * labelled with what each section was tagged as. Self-contained HTML.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { sourceOf } from "./library.mjs";
import { SINGLE, MULTI } from "./vocab.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const b64 = (p) => (p && existsSync(p) ? `data:image/jpeg;base64,${readFileSync(p).toString("base64")}` : "");

function smallCrop(path, imgDir) {
  const out = join(imgDir, path.split("/").pop().replace(/\.jpg$/, "-mini.jpg"));
  if (!existsSync(out)) execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "65", "-Z", "260", path, "--out", out], { stdio: "pipe" });
  return out;
}

const chips = (t) => [
  ...SINGLE.map((f) => (t[f] ? `<span class="chip${f === "kind" ? " kind" : ""}">${esc(t[f])}</span>` : `<span class="chip miss">${f}?</span>`)),
  `<span class="sep"></span>`,
  ...MULTI.flatMap((f) => (t[f] ?? []).filter((v) => v !== "none").map((v) => `<span class="chip soft">${esc(v)}</span>`)),
].join("");

export function renderTagSheet({ rows, model, imgDir }) {
  const ok = rows.filter((r) => r.result?.parsed?.valid);
  const count = (f) => { const c = {}; for (const r of ok) { const v = r.result.parsed.tags[f]; c[v] = (c[v] ?? 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const moves = ok.map((r) => r.result.parsed).filter((p) => p.move?.trim());
  const clean = moves.filter((p) => !p.moveBanned?.length).length;
  const secCount = rows.reduce((s, r) => s + (r.sections?.sections?.length ?? 0), 0);
  const spend = rows.reduce((s, r) => s + (r.result?.cost ?? 0) + (r.sections?.sections ?? []).reduce((a, x) => a + (x.cost ?? 0), 0), 0);

  const cards = rows.map(({ it, thumb, result, sections }) => {
    const p = result?.parsed;
    const body = !result ? `<div class="err">not tagged (error; retried on the next run)</div>`
      : !p ? `<div class="err">${esc(result.error ?? "no answer")}</div>`
      : `<div class="tags">${chips(p.tags)}</div>
         <div class="desc">${esc(p.description)}</div>
         ${p.move ? `<div class="move${p.moveBanned?.length ? " bad" : ""}"><b>Move</b> ${esc(p.move)}${p.moveBanned?.length ? ` <span class="err">(names ${esc(p.moveBanned.join(", "))})</span>` : ""}</div>` : ""}
         ${p.app ? `<div class="desc"><b>App</b> ${esc(p.app)}</div>` : ""}`;
    const strip = sections?.sections?.length ? `<div class="strip">${sections.sections.map((s) => `
        <figure title="${esc(s.parsed?.description ?? "")}">
          <img src="${b64(smallCrop(s.crop, imgDir))}" alt="section ${s.n}" loading="lazy">
          <figcaption>${esc(s.parsed?.tags?.surface ?? "?")}<span>${s.n}/${s.total}</span></figcaption>
        </figure>`).join("")}</div>` : "";
    const from = it.tags.find((t) => t.startsWith("from: "));
    return `<article class="card">
      <div class="shot"><img src="${b64(thumb)}" alt="${esc(it.name)}" loading="lazy"></div>
      <div class="meta">
        <div class="name">${esc(it.name)}</div>
        <div class="sub">${esc(sourceOf(it.url) || "no source")} · ${it.width}×${it.height} · ${esc(it.ext)}${from ? ` · ${esc(from)}` : ""}${it.tags.filter((t) => !t.startsWith("from: ")).length ? ` · yours: ${esc(it.tags.filter((t) => !t.startsWith("from: ")).join(", "))}` : ""}</div>
        ${body}
      </div>
      ${strip}
    </article>`;
  }).join("\n");

  const dist = (f) => count(f).map(([v, n]) => `${esc(v)} ${n}`).join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tagging Sample</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#1c1b19;--muted:#76726b;--line:#e4e1da;--chip:#efede8;--kind:#e6edf9;--err:#b42318}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141413;--card:#1d1c1a;--ink:#ecebe8;--muted:#9a968e;--line:#2e2c29;--chip:#2a2926;--kind:#1c2636;--err:#ff8a80}}
:root[data-theme="dark"]{--bg:#141413;--card:#1d1c1a;--ink:#ecebe8;--muted:#9a968e;--line:#2e2c29;--chip:#2a2926;--kind:#1c2636;--err:#ff8a80}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Inter",sans-serif}
main{max-width:1280px;margin:0 auto;padding:32px 16px}h1{font-size:24px;margin:0 0 4px}
.lede,.stats{color:var(--muted);margin:0 0 8px}.stats{font-size:13px;margin-bottom:24px}
.card{display:grid;grid-template-columns:220px 1fr;gap:16px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 14px}
.shot img{width:100%;border-radius:6px;display:block;background:var(--chip)}
.name{font-weight:600}.sub{color:var(--muted);font-size:12px;margin:2px 0 10px}
.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:1px 8px;margin:0 4px 4px 0;font-size:12px}
.chip.kind{background:var(--kind);font-weight:600}.chip.soft{opacity:.8}.chip.miss{color:var(--err)}.sep{display:inline-block;width:8px}
.desc{font-size:13px;margin-top:4px}.move{font-size:13px;margin-top:4px}.move.bad{color:var(--muted)}.err{color:var(--err);font-size:12px}
.strip{grid-column:1/-1;display:flex;gap:8px;overflow-x:auto;padding-top:6px;border-top:1px solid var(--line)}
.strip figure{margin:0;flex:0 0 130px}.strip img{width:130px;border-radius:4px;display:block}
.strip figcaption{font-size:11px;display:flex;justify-content:space-between;color:var(--ink)}.strip figcaption span{color:var(--muted)}
@media (max-width:720px){.card{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Tagging sample</h1>
<p class="lede">${rows.length} items tagged by ${esc(model)}, plus ${secCount} sections cut from full-page captures. Nothing here is in Eagle yet.</p>
<p class="stats">Valid ${ok.length}/${rows.length} · moves clean ${clean}/${moves.length} · spend $${spend.toFixed(3)}<br>
Kind: ${dist("kind")}<br>Surface: ${dist("surface")}</p>
${cards}
</main></body></html>`;
}
