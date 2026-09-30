/**
 * Eagle's V2 web API (Build 21+), local only, no token needed on localhost.
 * Writes go through here and nowhere else: never edit library files directly.
 * The API only ever acts on the library that is OPEN in Eagle.
 */
const BASE = "http://localhost:41595/api";

async function call(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const j = await r.json().catch(() => ({ status: "error", message: `HTTP ${r.status}, not JSON` }));
  if (j.status !== "success") throw new Error(`${path}: ${j.message ?? JSON.stringify(j).slice(0, 200)}`);
  return j.data;
}

/** Path of the open library. Every write checks this first. */
export const openLibrary = async () => (await call("/library/info")).library.path;

export async function folderTree() {
  const data = await call("/v2/folder/get", {});
  return Array.isArray(data) ? data : data.data ?? [];
}

export const createFolder = (name, parent) => call("/v2/folder/create", { name, ...(parent ? { parent } : {}) });

/** Up to 1,000 per call. Each item: { path|url, name, website, tags, annotation, folders, id? }. */
export const addItems = (items) => call("/v2/item/add", { items });

export const updateItem = (fields) => call("/v2/item/update", fields);

export const getItems = (body) => call("/v2/item/get", body);
