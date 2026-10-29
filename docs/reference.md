# eagle-refs reference

Everything the [README](../README.md) leaves out: commands, the config file, how each step works,
the full test results, and what was learned the hard way.

## Commands

Commands look for `eagle-refs.config.json` in the working folder. From anywhere else, pass
`--config <file>` or set `EAGLE_REFS_CONFIG`.

| Command | What it does |
|---|---|
| `tag` | Tags each item, each section of a full page, and runs the photo and content passes. `--dry-run`, `--sample N`, `--sections-only`, `--concurrency N`, `--model ID`, `--content-model ID`. Re-tag after a vocabulary change: `--retag-surface <surface>`, `--retag-social` (every save from a social host), `--retag-tag <Eagle tag>`; old answers are kept in `tags/items/.retag/`. |
| `motion` | Motion pass for GIFs and videos. `--dry-run`, `--sample N` |
| `names` | Readable names for items saved as `IMG_1234`, a hash, or one page title repeated. `--dry-run`, `--sample N` |
| `capture` | Records a live site's motion section by section: saves in the "Capture motion" folder, or one URL. `--dry-run`. See Site capture below. |
| `x` | Turns saved tweets into their media: adds the video, or the photos when only the link was saved, and moves the leftover bookmark or video frame to Eagle's Trash. `--dry-run`, `--sample N`. See Videos from X below. |
| `index` | Rebuilds the search index from the library and the tags |
| `writeback` | Puts tags and notes on the items in Eagle. Dry run unless `--run`. Scopes: `--photo`, `--content`, `--sections`, `--motion`, `--uses`, `--names`, `--retire`. `--undo` reverses; with a scope, only that scope. `--sample N` writes a spread of N first. |
| `embed` | One vector per index record, so search matches on meaning (below). `--dry-run`, `--limit N` |
| `search` | Finds references: `--kind`, `--surface`, `--platform`, `--theme`, `--only item\|section`, `--use`, `--limit`, `--lexical` (words only), `--json`. Saved posts: `--author`, `--hook-type`, `--structure`. Filters with no words list everything that matches. |
| `show` | Everything the index knows about items, by id or Eagle link (Edit > Copy Link) |
| `like` | More like one item, same kind unless `--any-kind`. Uses the item's stored vector when it has one; no network. |
| `frames` | For one clip: frame sheets and a speed row per measured move, to build the motion from |
| `stats` | What the library holds, by kind and surface |
| `enrich` | Every step in order: tag, capture, x, motion, index, embed, names, then each write-back scope if Eagle is open, `--retire` last. `--dry` previews the write-back. |
| `background` | `on`, `off`, `status`: runs `enrich` on every save (below) |

## Configuration

`eagle-refs.config.json`. Only `library` is required. Relative paths resolve from the file's
folder, and `~` is your home folder. A `.env` next to it supplies `OPENROUTER_API_KEY`; a key
already set in the environment wins.

```json
{
  "library": "~/Pictures/Design.library",
  "dataDir": "./eagle-refs-data",
  "models": { "tag": "z-ai/glm-5.3-flash", "photo": "google/gemini-3.8-flash", "embed": "google/gemini-embedding-2" },
  "embedDims": 768,
  "tagAliases": { "poster": "posters" },
  "content": { "folders": ["Content"] },
  "uses": {
    "sharing the work": {
      "titles": ["show(ing)?[ -]?off", "self[ -]?promo"],
      "folders": ["Sharing the work"],
      "queryWords": ["show off", "self promo"]
    }
  }
}
```

| Key | What it does |
|---|---|
| `library` | Path to your `.library` folder |
| `dataDir` | Where tags, the index, the image cache and the write-back ledger go. Default `./eagle-refs-data` |
| `models` | OpenRouter model per pass: `tag`, `photo`, `content`, `motion`, `names`, `embed`. Defaults are the ones below. |
| `embedDims` | Vector size for `embed`. Default 768. Changing it, or `models.embed`, re-embeds everything on the next run. |
| `tagAliases` | Your own spelling for a vocabulary value, used when writing to Eagle |
| `uses` | What you save things FOR (below) |
| `content.folders` | Eagle folders (`Parent/Child`, sub-folders included) whose items are read as posts by the content pass, whatever the main pass called them. Read from the library on disk, so it works with Eagle closed. Default none. |

**Uses.** A use is the purpose of a save, not its content, so no model assigns it. Asked "is this
someone presenting their own work?", a loose prompt flagged 40% of a library and a tight one
missed 17 of 31 real cases. Where a thing was clipped from carries the purpose instead, because
Eagle names a clip after the page title. An item has a use when it carries a tag with the use's
name, when its name or URL matches one of `titles` (case-insensitive regular expressions), or
when it sits in one of `folders` (`Parent/Child` paths). `queryWords` let a search say "show off"
and mean the use. Uses are written to Eagle as tags in the group "Use".

**Vocabulary.** The tag lists live in `lib/vocab.mjs`. Edit them to fit your library; the prompt
and the parser both read them. Client and project tags are deliberately absent: those stay yours.

## How it works

Models write, code measures, and a number decides what stays. Every step was kept only after a
measurement said it earned its place.

| Step | Who | What |
|---|---|---|
| Read | code | Eagle's library files, straight from disk and read-only. Eagle owns them. |
| Prepare | code | `sips` fits each image inside 1024 px. Pages taller than 2.5x their width are cut into 1024-px squares with 15% overlap. Transparent images are flattened onto mid-grey. |
| See | model | One call per image: tags from the vocabulary, a description, a move line, the app name if legible. The item's title goes along as context when it is a real title, not a filename. |
| Measure | code | Blank captures (a 32x32 check), motion timing (per-frame pixel change at 30 fps), live vs gallery links. |
| Write | code | Eagle's V2 API into the open library, after checking it is the configured one. Add-only, logged to a ledger, undoable. |
| Index | code | One JSONL file in the data folder: a record per item and per section. |
| Search | code | Hard filters only on reliable fields (kind, platform); everything else ranks. `no`, `not`, `without`, `avoid` push a word down. |

The model never sees your existing tags. It would parrot them, and they stay yours: the index
keeps them apart as `humanTags` and ranks on them too.

A failed model call is never recorded, so the item is tried again on the next run. The one
failure that is recorded is a clip ffmpeg ran on and could not read (`tags/motion/<id>.json`,
`"reason": "unreadable"`); delete that file to retry it.

### Search by meaning

`eagle-refs embed` sends each index record (an item or a section; not blank, and tagged or a
section) to OpenRouter's `/embeddings` as its image plus its words (description, move, and the
non-empty facet values). One vector per record, normalized, stored raw in `index/vectors.f32` with
a `vectors.json` beside it. Default model `google/gemini-embedding-2` at 768 dims; set
`models.embed` to `voyageai/voyage-multimodal-3.5` and `embedDims` to 1024 to use Voyage.

- **Incremental.** A record's key is its id, image mtime, model, size and a hash of its words. Only
  new or changed records are sent; rows for records that left the index are dropped. Progress is
  saved every few batches and on Ctrl-C, so a stopped run keeps what it paid for. `enrich` runs it
  after `index`; a missing key or a failed call is one log line, never a stop.
- **Guards.** A run saves and stops on a 401, 402 or 403, or after 5 failed batches in a row. A
  lock in the data folder keeps two runs from writing at once. A vector of the wrong size is
  refused. A run that would drop more than 20% of the stored rows refuses unless `--prune`.
  `vectors.json` is written last and records the byte size of `vectors.f32`, so a half-written
  pair is caught on load.
- **Cost.** Gemini about $0.13 per 1,000 records (~$1.90 for 14,600); Voyage about $0.63 per 1,000.
  `embed --dry-run` prints the count and projected price and sends nothing.
- **Search.** The query (after "not X" words are taken out) is embedded with an 8 s limit. Filters
  still gate the pool first. Cosine similarity to the query becomes a z-score within that pool
  (below 0 counts as 0) and is added to the word score, so a record no tag or word matches can
  still rank if it sits well above the pool and its cosine clears a floor. A record the words count
  against ("not X", the opposite theme) never gets lifted. `SEM_WEIGHT` (6), `SEM_MIN_Z` (1) and
  `SEM_MIN_COS` (0.45) at the top of `commands/refs.mjs` set how much. Below 95% of the pool
  embedded, search says so on stderr. Text output shows `meaning 0.xx` (raw cosine); `--json` keeps
  `score` and `matchedTags` and adds `semantic` (raw cosine) and `lexical` (the word score).
- **Fallback.** No vectors, no key, no network, or a slow reply: search ranks on words exactly as
  before and prints one line to stderr saying so. `--lexical` forces that path.
- **Like.** `like` ranks by cosine to the item's stored vector, fused the same way with the tag
  match. It makes no network call. An item with no vector gets the tag match alone.

### Content pass

Some saves are kept for their words: a post, a carousel, a thread, a video thumbnail, a reel, a
newsletter. What makes them worth keeping is the hook, the structure and the turn. The main pass
records one headline, so these get a pass of their own (`lib/content.mjs`).

The vocabulary has a `content` kind with seven surfaces: text post, image post, carousel, thread,
thumbnail, short video, newsletter. The main pass decides whether a save is a post. A designed
graphic shared on social keeps its own surface (poster, illustration, photo, ad). An item in one of
your `content.folders` is read as a post whatever the main pass said.

| Field | What |
|---|---|
| `format` | One of the seven surfaces. It becomes the item's surface. |
| `author` | The name or handle. The URL wins when its path carries one; for X, the tweet's own author. |
| `platformName` | linkedin, x, instagram, threads, tiktok, youtube, substack, newsletter, other. The URL wins. |
| `text` | The post's own words, verbatim, without comments, counts or UI. For X, the tweet's own text. |
| `hook` | The opening line or lines, verbatim |
| `hookType` | question, contrarian, number, story open, confession, how-to, list promise, bold claim, quote, news |
| `structure` | story then lesson, list, step by step, before and after, hot take, case study, breakdown, single insight, announcement, behind the scenes, comparison |
| `cta` | The closing ask |
| `shape` | How the post is built, beat by beat, naming no topic, so the build can be reused |

The image goes to the model at reading size: 1024 px wide, cut into up to four overlapping
tiles, so a phone screenshot's body text is legible. Anything longer is marked `truncated`. Long
posts are never cut into page sections. X saves get their text from X's embed endpoint, 500 ms
apart.

Measured on 20 hand-picked saves (10 posts: phone screenshots, a carousel cover, thumbnails,
reels, image posts; 10 shares that are not posts: art, photos, app store shots from X and
Instagram): 10 of 10 posts got the content kind and 0 of 10 shares did, on two runs. GLM and
Gemini gave the same hook on 9 of 10. GLM kept mockup UI out of the text where Gemini did not,
at about a tenth of the price, so it is the default.

In Eagle, the kind is written as the tag `posts` and the carousel surface as `carousel post`,
because `content` (a site section of body text) and `carousel` (a UI component) already mean
something there. Search uses the plain values. Hook type, structure and author go in tag groups
"Hook", "Structure" and "Author" as `hook: contrarian`, `structure: list`, `by: <handle>`.

**After a vocabulary change.** Write-back only adds, so an item re-tagged under new lists would
keep its old tag beside the new one. `writeback --retire` takes a tag off only when the ledger
shows this tool added it and no current answer of any scope still gives it. A tag you added is
never in the ledger. `--undo --retire` puts back what it took.

### Motion

The tagger sees one still frame, so before the motion pass, 196 of 207 clips in the reference
library were tagged as static screens. Code and a model now split the job:

- **When things move** comes from code, from per-frame pixel change on a 64x64 grey copy at 30 fps.
  On a button GIF it measured expand 400 ms, hold 0.9 s, collapse 470 ms. GLM-5.3 Flash, Gemini
  and an 8-frame strip guessed the same expand at 350, 400 and 700 ms. Timings in the index come
  from code, never from a model.
- **What moves** comes from a model watching an 8 fps, 480-px copy of the first 20 seconds.
  Watching beat the 8-frame strip, which missed a swipe between cards in a 15-second clip.

`eagle-refs frames <id>` goes further on demand: dense frames around each measured move and its
speed row, so an agent can write duration, stagger and easing from evidence.

### Background

`eagle-refs background on` writes a launch agent to `~/Library/LaunchAgents/com.eagle-refs.<library>.plist`
and loads it. The agent runs a tiny app, `~/Library/Application Support/eagle-refs/<library>/eagle-refs.app`,
whose only job is to start `enrich`. It exists so macOS names the job: a launch agent that runs
`node` or `zsh` directly shows as "Node.js Foundation" (node's signer) or "zsh" in Login Items and
in the "Background Items Added" alert. The app is signed locally (ad-hoc, no developer account)
and linked from the agent by `AssociatedBundleIdentifiers`, so it shows as "eagle-refs". It watches the library's `mtime.json`, which Eagle rewrites on every save, and runs
`enrich` at most once a minute, hourly as a backstop, and once when it is turned on or you log
in. It runs at background priority with low-priority disk access. The log is
`~/Library/Logs/eagle-refs-<library>.log`, trimmed to the last 2,000 lines. `enrich` adds
`/opt/homebrew/bin` and `/usr/local/bin` to PATH itself, because launchd's PATH has no Homebrew
and ffmpeg would not be found. The agent records the path to your `node`; after moving or
upgrading Node, run `background on` again.

The write-back touches `mtime.json` too, which causes one extra run a minute later. It finds
nothing new and does nothing, so there is no loop.

## Measured

A bake-off decided the models: the same prompt on 60 items (40 already tagged by hand, 17 full
pages), scored against Claude Opus 5 as a reference and against the owner's own tags. Prices are
OpenRouter's, September 2026. Seven models were tested in the first round; the two best went to
a second round with the current vocabulary:

| Model | Matches Opus | Kind | Surface | Industry | Component | Move clean | Items, no sections |
|---|---|---|---|---|---|---|---|
| google/gemini-3.8-flash | **89%** | **95%** | **83%** | **85%** | 75% | 95% | $9.03 |
| **z-ai/glm-5.3-flash** (default) | 82% | 90% | 75% | 70% | 71% | 95% | **$1.90** |
| anthropic/claude-opus-5 | reference | | | | | 90% | $81.42 |

"Move clean" is the share of move lines that name no colour or typeface, checked in code.

GLM-5.3 Flash is the default. Against the only human ground truth, the owner's own tags, it tied
Gemini (68% vs 66%). Gemini wins only on agreeing with Opus, and Opus is not truth. At about
$6.50 for a whole 6,000-item library with sections (Gemini: about $28), you can re-tag everything
whenever the vocabulary changes.

The photo pass uses Gemini, because light is the field that matters and Gemini reads it better:

| Photo pass, 40 photos | Light | Shot | People | Treatment | Framing |
|---|---|---|---|---|---|
| **google/gemini-3.8-flash** (default) | **80%** | 68% | 88% | 48% | **71%** |
| z-ai/glm-5.3-flash | 70% | 68% | 88% | 63% | 57% |

GLM called "direct flash" four times and was right twice; Gemini called it twice, right both
times. 60 and 40 items are small samples: gaps of a few points are noise. Re-run a bake-off
before a big pass, because the model catalog moves weekly.

Search by meaning, October 2026: ten real briefs from the owner's projects, top 8 each, every
image graded 0 to 2 by a blind grader (Claude Opus, looking at the images) against a written
"great result" line per brief. 160 points possible.

| `SEM_WEIGHT` | Score | Graded 2 | Graded 0 |
|---|---|---|---|
| 0 (words only, `--lexical`) | 49 | 7 | 38 |
| 3 | 51 | 9 | 38 |
| **6** (default) | **54** | 9 | **35** |
| 10 | 52 | 8 | 36 |

The weight matters little between 3 and 10; 6 scored best. Four of the ten briefs ask for a
structure (pain/answer pairs, two doors of unequal weight, a plan reveal, one dense first App
Store frame) and miss under every setting: the library holds the right surfaces but not those
moves. Model choice: Gemini Embedding 2 ($0.13 per 1,000) over Voyage multimodal 3.5 ($0.63);
both returned 768/1024-dim vectors for image plus text in one call. Voyage was not graded.

## Data folder

```
eagle-refs-data/
  tags/items/<id>.json      one answer per item
  tags/sections/<id>.json   one file per full page, every section in it
  tags/photo/ motion/ names/
  tags/content/<id>.json    a saved post's words and build (the content pass)
  tags/items/.retag/        answers replaced by a re-tag: move one back to undo
  tags/img/ clips/          prepared images and clips (a cache; safe to delete)
  x/<tweet id>.mp4          videos pulled from saved tweets (Eagle keeps its own copy)
  x/ledger.jsonl            every tweet checked, so none is asked about twice
  index/refs.jsonl          the search index
  index/vectors.f32         embeddings, raw Float32 rows (a cache; `embed` rebuilds it)
  index/vectors.json        their model, size, and the record id and key of each row
  writeback/ledger.jsonl    every write to Eagle, for --undo. Keep it.
```

## Known constraints

Learned the hard way, and handled in code:

- **`sips` crops.** `--cropOffset 0 0` crops the center, not the top: offsets start at 1. A crop
  that ends exactly on the bottom edge returns the whole image: crops stop 1 px short. Resized
  heights can differ from the computed height by a pixel: the file is measured, never computed.
- **Transparency.** `sips` flattens onto white, which erases white-on-transparent logos. Images
  with alpha are flattened onto mid-grey first (`lib/flatten.js`, JXA + Core Image).
- **Blank captures.** Eagle's web clipper sometimes renders only the top of a page and leaves
  the rest black. Those get one tag, "incomplete capture", and stay out of search. A looser 8x8
  check wrongly flagged 55 of 63 minimal designs; the current rule is 32x32 with no pixel 12 or
  more from the mean.
- **Tags echo back.** Once written, the model's tags look like your own to Eagle's API. The index
  subtracts every tag in the write-back ledger so they never count twice.
- **Eagle's API writes only to the open library.** Every write checks the open library is the
  configured one first.
- **Keep the library out of iCloud Drive.** iCloud made conflict copies of Eagle's tag files and
  evicted images to placeholders.

## Site capture

```bash
eagle-refs capture             # every save in the "Capture motion" folder not captured yet
eagle-refs capture --dry-run   # what is waiting, zero calls
eagle-refs capture <url>       # one site, report only, nothing goes into Eagle
```

Any save whose link is a live site, dropped into an Eagle folder named "Capture motion" (at any
depth; `"capture": { "folder": "..." }` in the config renames it), is captured on the next run of
`enrich`. The save itself is never changed. Needs `npm install playwright-core` in the eagle-refs
folder, and a browser it can drive: its own Chromium if installed (`npx playwright-core install
chromium`), otherwise Google Chrome.

**Recording.** A 1440x900 window loads the page, waits 2.5 s for the hero, then scrolls 85% of a
screen at a time with the mouse wheel (smooth-scroll libraries ignore programmatic scrolling) at
900 px/s and pauses 1.4 s on each screen so entrances finish. A cookie banner gets a "decline" or
"necessary only" click if it has one; nothing is ever accepted. Output: `video.mp4` and a full-page
`page.jpg`. Scroll-linked motion plays at 900 px/s on every site, so it compares across sites.

**What the page reports.** Before any of the site's scripts run, a probe polls
`document.getAnimations()` every 50 ms and logs each new animation once: type, target element,
duration, delay, easing, iterations, keyframes, and the scroll position it fired at. This covers
CSS animations, CSS transitions and Web Animations (Framer Motion uses these for transform and
opacity). Springs compiled to CSS `linear()` are reported as "spring, overshoots N%". It misses
motion drawn frame by frame in JavaScript or WebGL (GSAP, Lenis-driven scrubbing, three.js,
canvas): on one tested site the page reported only hover colours while the whole story moved.

**Sections.** Screens are grouped into sections of at least 8 s. Each becomes a 720-px, 15 fps
clip (at 8 fps a ~100 ms glitch wipe read as a crossfade). The model is told exactly when the
page is still inside the clip: ghosting while scrolling is the recording, but any change while it
is still is real motion, including text that looks doubled for a moment (a scramble). It also gets
the section's measured numbers, with a warning that JavaScript motion is never in them. Two reads
per section are merged by a text-only call that keeps every distinct motion either saw.

Measured on one hero section, three runs each: one read caught the type-on every time but missed
the word scramble, the marquee or the opening shape in turn; Gemini 3.8 Flash cost 4x and was less
consistent. Two merged reads of GLM-5.3 Flash is the default (`models.motion`).

**The page pass.** One text-only call over every section's notes plus the page-wide numbers:
`choreography`, `signature` (ideas that span the page, like an opening and a closing that share a
motif) and `rhythm`.

**In Eagle.** Two items join the save's folder, both tagged `site capture`: the recording (its note
is the page read, then each section by time) and the full-page image. `tag` skips the recording
(its first frame is the page before it loads) and tags the full page. `capture` writes the
recording's motion record itself, so the motion pass skips it and `writeback --motion` tags it.

**In search.** Each section is scored on its own: query words that land together in one section
count 1.5x, and the hit names the section and its time in the recording. `show` prints the page
read and every section with its measured timing. `--kind motion` includes captures.

**Files** (`<data>/capture/<save id>/`): `video.mp4`, `page.jpg`, `section-NN.mp4`,
`animations.json` (every animation and the scroll timeline), `capture.json`, `report.md`.
`<data>/capture/ledger.jsonl` lists every capture; a failed site is not recorded and is tried
again next run. One capture runs at a time (`<data>/capture/.lock`), because a capture's own
adds to Eagle trigger the background job again.

**Limits.** About four minutes and 1 to 2 cents a site. Login walls, bot checks and cookie banners
without a decline button can block or cover a page. The notes catch most motion, not all; rebuild
from the section clips, not the summary alone.

## Saves with code behind them

Some sites publish the source of what they show. For a save from one of them, the index records
where its code lives and `show` and `search` print a `Code:` line. The list is `lib/sources.mjs`;
adding a site is one entry (which saved URLs match, and where their code is).

| Site | Saves that match | Code |
|---|---|---|
| Email Love | `emaillove.com/email-inspiration-*` | the email's production HTML, tracking stripped: the same address with `?action=email-cleaned` |

Email Love sits behind Cloudflare, which blocks scripted requests and headless browsers, so its
code is read on demand in a normal browser (the agent skill says so), not fetched by the
background job. Don't work around a site's bot protection. Links can rot or move behind a login
later; the save's screenshot stays either way.

Save these with Eagle's area capture around the email, not a full-page capture: a full page also
captures the gallery's "similar emails" grid, and the tagger would describe that too.

## Videos from X

Launch videos get shared on X, and Eagle saves a tweet as a still (the clipper) or as a bookmark
with no media at all ("Save URL"). In my library, 2 of 273 saved tweets were videos. The `x` step
reads every save whose link is a tweet, asks X what the tweet holds, and leaves you with the media:

| You saved | Tweet has | You end up with |
|---|---|---|
| A still (clipper, paste-link) | a video or GIF | the video, next to it. If the still is just the video's frame, it goes to the Trash |
| A still | photos | your still, unchanged |
| A bookmark ("Save URL") | a video or GIF | the video. The bookmark goes to the Trash |
| A bookmark | photos | each photo at its original size. The bookmark goes to the Trash |
| A bookmark | only words | the bookmark, unchanged |

New media is named `@author · the tweet's words` (Eagle drops colons from names), links to the
tweet, carries the tweet's full text in its note, and gets the tag "from: X". Before anything
moves to the Trash, your own tags, star, folders and note move onto the media. The tool's tags
and notes don't move; the media gets its own. The motion pass then reads a video like any other clip.

A still counts as the video's frame when it has the video's shape and no photo in the tweet has
that shape. A tweet with three photos and a GIF keeps all three photos.

Nothing to set up: save a tweet the way you already do. The background job picks it up on the
next run.

- **Trash, not delete.** Everything moved is in Eagle's Trash until you empty it, and
  `x/ledger.jsonl` lists each one by id and name. `--dry-run` shows what would move first.
- **The endpoint.** It reads X's embed endpoint, `cdn.syndication.twimg.com/tweet-result`, the one
  embedded tweets on other sites use. No login, no API key. It is not a documented API and can
  change without notice. A failed call is not recorded, so a breakage pauses the step and the
  next run tries again; nothing is lost and nothing moves to the Trash.
- **Checked once.** A tweet with no media, or one X says is deleted or private, goes in
  `x/ledger.jsonl` and is never asked about again. Calls are half a second apart.
- **Only the tweet's own media.** A quoted tweet's video belongs to someone else's post, so it is
  skipped. Save the quoted tweet itself to get it.
- **The motion pass watches the first 20 seconds.** Launch videos often run 30 to 90 seconds; the
  whole file is in Eagle, but the note describes the opening.

First run on my library: 268 tweets checked in 2.5 minutes, 5 videos added, 260 were images,
6 were gone. Then 4 stills that were just video frames went to the Trash. The real value is going
forward: a launch video I save today lands as a video, and the save it came from cleans itself up.
