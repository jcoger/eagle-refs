/**
 * Sites whose saves have real source code behind them. A screenshot shows how a reference
 * looks; the code holds the numbers (widths, breakpoints, font stacks, colours) to build from.
 * The index records where the code lives, and an agent opens it when it needs it.
 *
 * `browserOnly`: the site blocks scripted requests (Email Love sits behind Cloudflare, which
 * answers a plain fetch or a headless browser with "Sorry, you have been blocked"), so the code
 * is read in a normal browser, on demand. Never work around a site's bot protection.
 *
 * Add a site with one entry: which saved URLs match, and where their code is.
 */
export const CODE_SOURCES = [
  {
    // emaillove.com/email-inspiration-from-<brand>-<n>: the email shown in a frame loaded from the
    // same address with ?action=email-cleaned, its production HTML with tracking stripped.
    host: /(^|\.)emaillove\.com$/,
    path: /^\/email-inspiration-[\w-]+\/?$/,
    code: (u) => `${u.origin}${u.pathname.replace(/\/$/, "")}?action=email-cleaned`,
    what: "the email's HTML",
    browserOnly: true,
  },
];

/** Where a saved URL's source code lives: { url, what, browserOnly } or null. */
export function codeFor(saved) {
  let u;
  try { u = new URL(saved); } catch { return null; }
  const s = CODE_SOURCES.find((x) => x.host.test(u.hostname) && x.path.test(u.pathname));
  return s ? { url: s.code(u), what: s.what, browserOnly: Boolean(s.browserOnly) } : null;
}
