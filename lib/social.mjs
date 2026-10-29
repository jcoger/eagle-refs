/**
 * What a social URL says on its own: which network, and whose post. The content pass
 * (lib/content.mjs) trusts these over a model's reading of the image, because a URL
 * cannot misread a handle.
 */
import { sourceOf } from "./library.mjs";

/** Hosts whose saves are posts or shares of someone's work, never the live thing itself. */
export const SOCIAL_HOSTS = new Set(["x.com", "twitter.com", "instagram.com", "linkedin.com", "youtube.com", "tiktok.com", "threads.net", "threads.com", "facebook.com"]);

const NETWORK = {
  "linkedin.com": "linkedin", "x.com": "x", "twitter.com": "x", "mobile.twitter.com": "x",
  "instagram.com": "instagram", "threads.net": "threads", "threads.com": "threads",
  "tiktok.com": "tiktok", "youtube.com": "youtube", "youtu.be": "youtube", "m.youtube.com": "youtube",
};

/** The network a URL belongs to, or null. Substack publications live on <name>.substack.com. */
export function platformFromUrl(url = "") {
  const host = sourceOf(url);
  if (!host) return null;
  if (NETWORK[host]) return NETWORK[host];
  if (/(^|\.)substack\.com$/.test(host)) return "substack";
  return null;
}

// Paths that look like a handle but are a page of the network itself.
const NOT_HANDLE = new Set(["i", "home", "explore", "search", "hashtag", "intent", "share", "settings", "watch", "shorts", "results", "feed", "p", "reel", "reels", "stories"]);

/**
 * The author's handle when the path carries it, else null. Instagram post links and
 * YouTube watch links carry no author, so the model's reading stands there.
 */
export function authorFromUrl(url = "") {
  let u;
  try { u = new URL(url); } catch { return null; }
  const net = platformFromUrl(url);
  const path = decodeURIComponent(u.pathname);
  const pick = (re) => { const h = re.exec(path)?.[1]; return h && !NOT_HANDLE.has(h.toLowerCase()) ? h : null; };
  switch (net) {
    // /posts/<handle>_<slug>-activity-..., /in/<handle>
    case "linkedin": return pick(/^\/posts\/([^/_]+)_/) ?? pick(/^\/in\/([^/]+)/);
    case "x": return pick(/^\/([^/]+)\/status(?:es)?\/\d+/);
    case "threads": return pick(/^\/@([^/]+)/);
    case "tiktok": return pick(/^\/@([^/]+)/);
    case "youtube": return pick(/^\/@([^/]+)/);
    case "substack": { const sub = /^([^.]+)\.substack\.com$/.exec(sourceOf(url))?.[1]; return sub && sub !== "www" ? sub : null; }
    default: return null;
  }
}
