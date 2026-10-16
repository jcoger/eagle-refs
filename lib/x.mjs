/**
 * X (Twitter): the video behind a saved tweet. Launch videos are shared on X, and Eagle's
 * web clipper saves a tweet as a still: in one library, 2 of 308 X saves were videos.
 *
 * This reads X's embed endpoint (cdn.syndication.twimg.com/tweet-result), the one X's own
 * embedded tweets on other websites use. No login and no API key, and it returns the tweet's
 * text, author and every video variant as a direct mp4. It is not a documented API and can change
 * without notice; a failed call is never recorded, so a breakage pauses saves instead of losing them.
 */

/** The tweet id in any x.com / twitter.com status link, including ".../status/<id>/video/1". */
export const tweetIdOf = (url = "") => /(?:^|\/\/)(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/?#]+\/status(?:es)?\/(\d+)/i.exec(url)?.[1] ?? null;

/** The token the embed endpoint asks for, derived from the id (the formula X's embed script uses). */
const tokenFor = (id) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");

/**
 * The tweet, or { unavailable } when X says it is gone or private. Throws on anything else
 * (a network error or a 5xx), so the caller retries next run.
 */
export async function fetchTweet(id) {
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${tokenFor(id)}&lang=en`, { signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return { unavailable: "not found (deleted, or the account is private)" };
  if (!res.ok) throw new Error(`embed endpoint: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim() || text.trim() === "{}") return { unavailable: "empty (private, age-gated or removed)" };
  const j = JSON.parse(text);
  if (j.__typename === "TweetTombstone") return { unavailable: "tombstoned" };
  return j;
}

/**
 * The tweet's OWN videos (never a quoted tweet's: that video belongs to someone else's post),
 * each as its highest-bitrate mp4. GIFs on X are mp4s too.
 */
export function videosOf(tweet) {
  return (tweet.mediaDetails ?? [])
    .filter((m) => m.type === "video" || m.type === "animated_gif")
    .map((m) => {
      const best = (m.video_info?.variants ?? []).filter((v) => v.content_type === "video/mp4").sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      return best && { url: best.url, kind: m.type === "animated_gif" ? "gif" : "video", seconds: m.video_info?.duration_millis ? +(m.video_info.duration_millis / 1000).toFixed(1) : null,
        width: m.original_info?.width ?? null, height: m.original_info?.height ?? null };
    })
    .filter(Boolean);
}

/** The tweet's words without the t.co links X appends for its own media. */
export const tweetText = (tweet) => String(tweet.text ?? "").replace(/\s*https:\/\/t\.co\/\w+/g, "").trim();
