# eagle-refs

Tag your [Eagle](https://eagle.cool) library with vision models, write the tags back into
Eagle, and search it from any coding agent.

Design references pile up faster than anyone tags them. In the library this was built on, half
of 3,783 saves had no tags at all, so neither Eagle's search nor an agent could find them.
eagle-refs reads every item, tags it from a fixed vocabulary, writes one line on the idea worth
borrowing, and gives your agent a command to search all of it in plain words.

```text
$ eagle-refs search "dark fintech hero with a device mockup" --limit 1

1. [site · hero · desktop web · dark · fintech] section 1/5 of "GamePlan  MoneyLion"  (moneylion.com, 2023-01-05)
   MoneyLion fintech landing page hero with dark background, left-aligned headline, teal CTA,
   phone mockup with goal chips, followed by a fan of app screens.
   Move: One large headline anchors a dark field while a tall device and scattered chips overlap
   its edge, then a fanned row of screens creates rhythm below.
   Also: minimal, photo-led, rounded, split layout, device mockup, overlapping layers, nav bar, card
   your tags: fintech
   Image: eagle-refs-data/tags/img/LCJ7HWL0H35JT-sec01.jpg
   Live: https://www.moneylion.com/GamePlan/   As saved: https://web.archive.org/web/20230105/...
```

That result is the first of five sections cut from one full-page capture. The page was saved
three years ago with a title and nothing else.

## Highlights

- **Tags from a fixed vocabulary**, not free text: 7 kinds, 69 surfaces (hero, paywall, poster,
  wordmark...), platform, theme, typeface, 21 styles, 13 layout patterns, 31 UI components and
  26 industries. A value outside the list is dropped, so `paywall` always means one thing.
- **A move line on every item**: the transferable idea, as a relationship in scale, position,
  rhythm or sequence. Code rejects any move that names a colour or a typeface.
- **Full-page captures become sections.** Each long page is cut into overlapping screens and each
  one is tagged, so "pricing sections" returns the pricing part of every landing page you saved.
- **Motion measured by code, described by a model.** For GIFs and videos, code measures when
  things move from per-frame pixel change at 30 fps. The model only says what moves.
- **A photo pass** for photographs: light, shot, treatment, framing and people.
- **Written back into Eagle, add-only.** Tags land in tag groups, notes are only filled where
  empty, every write is logged, and `--undo` takes any of it back. Dry run by default.
- **Search from anywhere.** Agents search a local index with Eagle open or closed. A skill for
  Claude Code ships in `skill/`.
- **Tags as you save.** A launchd job watches the library and tags a new save within a minute.
- **About $6.50 for a 6,000-item library**, sections included. Zero dependencies: Node 22 and
  tools that ship with macOS, plus ffmpeg for the motion pass.

## Quick start

You need macOS, Node 22+, [Eagle](https://eagle.cool) 4 and an
[OpenRouter](https://openrouter.ai/keys) key. The motion pass also needs ffmpeg
(`brew install ffmpeg`).

```bash
git clone https://github.com/jcoger/eagle-refs.git
cd eagle-refs
npm link                                                   # puts `eagle-refs` on your PATH
cp eagle-refs.config.example.json eagle-refs.config.json   # set "library" to your .library folder
cp .env.example .env                                       # add OPENROUTER_API_KEY
```

Then, from that folder:

```bash
eagle-refs tag --dry-run      # how many items and sections, and the price. No calls.
eagle-refs tag --sample 50    # 50 varied items + tags/sample-sheet.html to judge by eye
eagle-refs tag                # everything else (resumable: a re-run only pays for what's missing)
eagle-refs motion             # GIFs and videos
eagle-refs index              # build the search index (seconds)
eagle-refs search "hard paywall whose hero is the user's own result, dark"
```

When the search results read right, put the tags on the items in Eagle. Keep the library open
in Eagle; its API only writes to the open library, and eagle-refs checks it is the configured one.

```bash
eagle-refs writeback                     # dry run: what would change
eagle-refs writeback --run --sample 20   # 20 varied items, to look at in Eagle first
eagle-refs writeback --run               # the rest
```

Commands look for `eagle-refs.config.json` in the working folder. From anywhere else, pass
`--config <file>` or set `EAGLE_REFS_CONFIG`.

## Commands

| Command | What it does |
|---|---|
| `tag` | Tags each item, each section of a full page, and runs the photo pass. `--dry-run`, `--sample N`, `--sections-only`, `--concurrency N`, `--model ID` |
| `motion` | Motion pass for GIFs and videos. `--dry-run`, `--sample N` |
| `names` | Readable names for items saved as `IMG_1234`, a hash, or one page title repeated. The old name stays searchable. |
| `index` | Rebuilds the search index from the library and the tags |
| `writeback` | Puts tags and notes on the items in Eagle. Dry run unless `--run`. Scopes: `--photo`, `--sections`, `--motion`, `--uses`, `--names`. `--undo` reverses, per scope. |
| `search` | Finds references: `--kind`, `--surface`, `--platform`, `--theme`, `--only item\|section`, `--use`, `--limit`, `--json` |
| `show` | Everything the index knows about items, by id or Eagle link (Edit > Copy Link) |
| `like` | More like one item, same kind unless `--any-kind` |
| `frames` | For one clip: frame sheets and a speed row per measured move, to build the motion from |
| `stats` | What the library holds, by kind and surface |
| `enrich` | All of the above in order; what the background job runs. `--dry` previews the write-back. |

## How it works

Models write, code measures, and a number decides what stays. Every layer was kept only after
a measurement said it earned its place.

| Layer | Who | What |
|---|---|---|
| Read | code | Eagle's library files, straight from disk and read-only. Eagle owns them. |
| Prepare | code | `sips` fits each image inside 1024 px. Pages taller than 2.5x their width are cut into 1024-px squares with 15% overlap. Transparent images are flattened onto mid-grey. |
| See | vision model | One call per image: tags from the vocabulary, a description, a move line, the app name if legible. The item's title goes along as context when it is a real title. |
| Measure | code | Blank captures (a 32x32 check), motion timing (per-frame pixel change), live vs gallery links. |
| Write | code | Eagle's V2 API. Add-only, logged to a ledger, undoable. Your own tags are never removed or renamed. |
| Index | code | One JSONL file: a record per item and per section. |
| Search | code | Hard filters only on reliable fields (kind, platform); everything else ranks. `no`, `not`, `without` push a word down. |

The model never sees your existing tags. It would parrot them, and your tags stay yours: the
index keeps them apart as `humanTags` and ranks on them too.

### Motion

The tagger sees one still frame. Before the motion pass, 196 of 207 clips in the reference
library were tagged as static screens. Now code and a model split the job:

- **When things move** comes from code. On a button GIF it measured expand 400 ms, hold 0.9 s,
  collapse 470 ms. Three approaches guessed the same expand at 350, 400 and 700 ms. Timings in the
  index come from code, never from a model.
- **What moves** comes from a model watching an 8 fps copy of the clip. Watching beat an 8-frame
  strip, which missed a swipe between cards in a 15-second clip.

```text
Motion: transition, tap. A product grid overlay slides in over live video, then a tapped product
detail panel replaces it, with the product image sliding horizontally as color variants cycle.
Timing (measured): 13 moves from 0.03 s to 2.87 s, most 100-167 ms (median 100 ms)
```

`eagle-refs frames <id>` goes further on demand: dense frames around each move and its speed
curve, so an agent can write duration, stagger and easing from evidence.

## Measured

Model choice came from a bake-off: the same prompt on 60 items (40 already tagged by hand,
17 full pages), scored against Claude Opus 5 as a reference and against the owner's own tags.
Prices are OpenRouter's, September 2026.

| Model | Matches Opus | Kind | Surface | Industry | Component | Move clean | Items, no sections |
|---|---|---|---|---|---|---|---|
| google/gemini-3.8-flash | **89%** | **95%** | **83%** | **85%** | 75% | 95% | $9.03 |
| **z-ai/glm-5.3-flash** (default) | 82% | 90% | 75% | 70% | 71% | 95% | **$1.90** |
| anthropic/claude-opus-5 | reference | | | | | 90% | $81.42 |

GLM-5.3 Flash is the default. Against the only human ground truth, the owner's own tags, it tied
Gemini (68% vs 66%). Gemini wins only on agreeing with Opus, and Opus is not truth. At about $6.50
for a whole 6,000-item library with sections, you can re-tag everything whenever the vocabulary
changes. Search leans on what is reliable: kind (90%) filters, surface and industry rank.

The photo pass is the exception. Light is the field that matters, and Gemini reads it better:

| Photo pass, 40 photos | Light | Shot | People | Treatment | Framing |
|---|---|---|---|---|---|
| **google/gemini-3.8-flash** (default) | **80%** | 68% | 88% | 48% | **71%** |
| z-ai/glm-5.3-flash | 70% | 68% | 88% | 63% | 57% |

GLM called "direct flash" four times and was right twice; Gemini called it twice, right both
times. 60 and 40 items are small samples: gaps of a few points are noise. Re-run a bake-off
before a big pass, because the model catalog moves weekly.

### What a save costs

| New save | Cost |
|---|---|
| Image | ~$0.0005 |
| Photo, or a design built on one | ~$0.002 (adds the photo pass) |
| Full-page capture | ~$0.003 to $0.006 (one call per section) |
| GIF or video | + ~$0.0001 per second watched |
| Junk name | + ~$0.00005 |

A run with nothing new costs nothing and takes a few seconds. A model call that fails is never
recorded, so the item is simply tried again on the next run.

## Configuration

`eagle-refs.config.json`. Only `library` is required. Relative paths resolve from the file's
folder. A `.env` next to it supplies `OPENROUTER_API_KEY`.

```json
{
  "library": "~/Pictures/Design.library",
  "dataDir": "./eagle-refs-data",
  "models": { "tag": "z-ai/glm-5.3-flash", "photo": "google/gemini-3.8-flash" },
  "tagAliases": { "poster": "posters" },
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
| `models` | OpenRouter model per pass: `tag`, `photo`, `motion`, `names` |
| `tagAliases` | Your own spelling for a vocabulary value, used when writing to Eagle |
| `uses` | What you save things FOR, which is not in the pixels (below) |

**Uses.** A use is the purpose of a save, not its content, so no model assigns it. Asked "is this
someone presenting their own work?", a loose prompt flagged 40% of a library and a tight one
missed 17 of 31 real cases. The place a thing was clipped from carries it instead: Eagle names a
clip after the page title. A use matches your own tag with its name, a title or URL pattern, or a
folder. `queryWords` let a search say "show off" and mean it.

The vocabulary lives in `lib/vocab.mjs`. Edit the lists to fit your library; the prompt and the
parser both read them.

## Background job

`launchd/eagle-refs.plist` runs `eagle-refs enrich` whenever Eagle changes the library. Eagle has
no "item added" event, but it rewrites the library's `mtime.json` on every save; launchd watches
that file, at most once a minute. The file has install steps at the top.

`enrich` runs tag, motion, index and names, then every write-back scope if Eagle is open, and
logs one line per step. If Eagle is closed, tagging still happens and the write-back catches up
next time.

## For agents

Copy `skill/SKILL.md` to `~/.claude/skills/eagle-refs/SKILL.md` (Claude Code) or wherever your
agent reads skills. It teaches the agent to search, open at most ten images, and cite a move
instead of copying a look. Agents understand Eagle links: paste one from Edit > Copy Link.

## Why you might not want it

- **macOS only.** Image prep uses `sips` and `osascript`, the job uses launchd. Eagle runs on
  Windows; this doesn't.
- **It costs money.** Cents per day of saving, a few dollars for a first pass. Give the OpenRouter
  key a monthly limit of its own. Auto top-up keeps an account funded but never lifts a key's cap.
- **Tags are good, not perfect.** Kind is right about 90% of the time, surface about 75%, industry
  about 70%. That's why search filters only on the reliable fields.
- **Search is words and tags, not embeddings.** Structure described in words ("the question on
  the left, the answer on the right") has no tag, so it only matches on description and move.
- **One library at a time**, per config.

## Known constraints

Learned the hard way, and handled in code:

- **`sips` crops.** `--cropOffset 0 0` crops the center, not the top: offsets start at 1. A crop
  that ends exactly on the bottom edge returns the whole image: crops stop 1 px short. Resized
  heights can differ from the computed height by a pixel: the file is measured, never computed.
- **Transparency.** `sips` flattens onto white, which erases white-on-transparent logos. Images
  with alpha are flattened onto mid-grey first (`lib/flatten.js`, JXA + Core Image).
- **Blank captures.** Eagle's web clipper sometimes renders only the top of a page and leaves the
  rest black. Those are flagged "incomplete capture" and kept out of search. A looser 8x8 check
  wrongly flagged 55 of 63 minimal designs; the current rule is 32x32 with no pixel 12+ from the mean.
- **Tags echo back.** Once written, the model's tags look like your own to Eagle's API. The index
  subtracts every tag in the write-back ledger so they never count twice.
- **launchd's PATH has no Homebrew.** `enrich` adds `/opt/homebrew/bin` and `/usr/local/bin` so
  ffmpeg is found. Without it every clip failed.
- **Keep the library out of iCloud Drive.** iCloud made conflict copies of Eagle's tag files and
  evicted images to placeholders.

## License

MIT. Built at [Dyno Labs](https://dynolabs.co). Not affiliated with Eagle.
