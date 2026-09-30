---
name: eagle-refs
description: Search the user's own visual reference library (an Eagle library tagged by eagle-refs, including sections cut from full-page captures) before designing anything. Use when building or critiquing a page section, app screen, graphic, logo or type system and references would help; on "find references", "pull inspiration", "what have I saved like this", "show me paywalls / heroes / pricing sections", "what does good look like for X"; or when a message holds Eagle item links (http://localhost:41595/item?id=...).
---

# eagle-refs

The default failure: designing from generic memory, or opening thirty images and copying the
look of one. This skill finds five to ten things the user chose, reads why they work, and
brings in a **move**, never a look.

Stay in lane: this skill finds and cites references. Designing is someone else's job. It never
writes to Eagle.

## Search

```bash
eagle-refs search "<one specific thing, in plain words>" \
  [--kind site|product|graphic|brand|type|motion|photo-art] [--platform ios|desktop web|...] \
  [--surface hero|pricing|paywall|onboarding|poster|logo|...] [--only item|section] [--limit 8]
eagle-refs show <id|Eagle link ...>          # what the user pointed at
eagle-refs like <id|Eagle link> [--any-kind] # more like this one
eagle-refs frames <id|Eagle link>            # on demand: frames + speed per measured move
eagle-refs stats                             # what the library holds
```

| Field | Use it as | Why |
|---|---|---|
| kind, platform | a **filter** | tagged right 85 to 90% of the time |
| surface | a filter **only** when the ask names an exact screen or section type | right about 75%; otherwise put it in the query |
| style, theme, industry, pattern, component | **words in the query** | fuzzy; they rank, they never exclude |

Write the query like the brief, not like tags: "hard paywall whose hero is the user's own
result, dark, serif headline, no feature checklist" beats "paywall dark". "no", "not",
"without" and "avoid" push a word down instead of matching it.

**Eagle links** (`http://localhost:41595/item?id=<ID>`, from Eagle's Edit > Copy Link;
`eagle://item/<ID>` and bare ids work too) ARE the reference. Run `show` on every link first: it
gives the image path, tags, description, move line, live URL and, for full pages, the sections
top to bottom. Then `like` on the one the user likes most for range.

**GIFs and videos** carry a `Motion:` line: what moves (a model watched the clip), the trigger,
and `Timing (measured)` from code. Trust the measured timing over any model's guess. To BUILD a
motion, run `frames` on it and read every frame sheet it prints before writing duration,
stagger and easing.

**Uses** (`--use "<name>"`) are what the user saved something FOR, when their config declares
any. They come from page titles, tags or folders, never from a model reading pixels.

## Read, then look

1. Read the text results first: tags, description, **Move**, the user's own tags.
2. Open the `Image:` path of the five to ten that fit. Never more than ten.
3. `§n of "Page"` results are crops of one section of a full-page capture; `--only section` for
   section studies. If a section-only search comes back thin, run it again without `--only`.
4. `Live:` is the real site, for motion, hover and CSS. `As saved:` is the Wayback snapshot from
   the day it was saved; sites change.
5. A move marked "(names a look, read with care)" slipped past the colour and typeface check.

## Output: REFERENCE PULL

```
REFERENCE PULL: <the ask, one line>
1. <id>: <why it fits, one line>. Move: <the relationship it lends, no colour/typeface/subject>. <image path>
... (5 to 10)
```

## Gates

- **A.** Ten images opened at most.
- **B.** Every cited reference states its move as a relationship (scale, position, rhythm,
  contrast, sequence).
- **C.** Nothing copied: no colour, typeface or subject lifted from a reference.

## Freshness

The background job (`eagle-refs enrich`) tags new saves and rebuilds the index within a minute
or two of a save, so a just-saved item may not show yet; `eagle-refs index` rebuilds it by hand
in seconds. Blank captures are excluded automatically.
