# eagle-refs reference

Everything the [README](../README.md) leaves out: commands, the config file, how each step works,
the full test results, and what was learned the hard way.

## Commands

Commands look for `eagle-refs.config.json` in the working folder. From anywhere else, pass
`--config <file>` or set `EAGLE_REFS_CONFIG`.

| Command | What it does |
|---|---|
| `tag` | Tags each item, each section of a full page, and runs the photo pass. `--dry-run`, `--sample N`, `--sections-only`, `--concurrency N`, `--model ID` |
| `motion` | Motion pass for GIFs and videos. `--dry-run`, `--sample N` |
| `names` | Readable names for items saved as `IMG_1234`, a hash, or one page title repeated. `--dry-run`, `--sample N` |
| `index` | Rebuilds the search index from the library and the tags |
| `writeback` | Puts tags and notes on the items in Eagle. Dry run unless `--run`. Scopes: `--photo`, `--sections`, `--motion`, `--uses`, `--names`. `--undo` reverses; with a scope, only that scope. `--sample N` writes a spread of N first. |
| `search` | Finds references: `--kind`, `--surface`, `--platform`, `--theme`, `--only item\|section`, `--use`, `--limit`, `--json` |
| `show` | Everything the index knows about items, by id or Eagle link (Edit > Copy Link) |
| `like` | More like one item, same kind unless `--any-kind` |
| `frames` | For one clip: frame sheets and a speed row per measured move, to build the motion from |
| `stats` | What the library holds, by kind and surface |
| `enrich` | Every step in order: tag, motion, index, names, then each write-back scope if Eagle is open. `--dry` previews the write-back. |
| `background` | `on`, `off`, `status`: runs `enrich` on every save (below) |

## Configuration

`eagle-refs.config.json`. Only `library` is required. Relative paths resolve from the file's
folder, and `~` is your home folder. A `.env` next to it supplies `OPENROUTER_API_KEY`; a key
already set in the environment wins.

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
| `models` | OpenRouter model per pass: `tag`, `photo`, `motion`, `names`. Defaults are the ones below. |
| `tagAliases` | Your own spelling for a vocabulary value, used when writing to Eagle |
| `uses` | What you save things FOR (below) |

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

## Data folder

```
eagle-refs-data/
  tags/items/<id>.json      one answer per item
  tags/sections/<id>.json   one file per full page, every section in it
  tags/photo/ motion/ names/
  tags/img/ clips/          prepared images and clips (a cache; safe to delete)
  index/refs.jsonl          the search index
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
