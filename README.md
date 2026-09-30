# eagle-refs

Your [Eagle](https://eagle.cool) library, tagged as you save, and searchable by your AI tools.

Design references pile up faster than anyone tags them. In the library this was built for, half
of 3,783 saves had no tags at all, so they never came up in a search, in Eagle or anywhere else.
eagle-refs looks at every save, tags it, writes a short note on why it works, and puts both back
into Eagle. Then Claude, or any AI tool you work with, can search the whole library in plain words.

<!-- Screenshot to add: one Eagle item before (no tags, no note) and after. -->

## What you get

For every item in your library:

- **Tags, sorted into Eagle's tag groups.** What it is (a hero, a paywall, a poster, a wordmark),
  where it lives (iOS, desktop web, print), light or dark, the style, the layout, the UI parts on
  screen and the industry. Every tag comes from one fixed list, so "paywall" always means the
  same thing.
- **A note on why it works.** One line describing the item, and one line on the idea worth
  borrowing. That second line never names a colour or a typeface, so it's an idea you can use
  in a different project, not a look to copy:

  > Move: One large headline anchors a dark field while a tall device and scattered chips
  > overlap its edge, then a fanned row of screens creates rhythm below.

- **Long page captures, section by section.** A full landing page is cut into screens and each
  one is tagged, so a search for pricing sections finds the pricing part of every page you saved.
- **Motion, for GIFs and videos.** What moves, what triggers it, and the timing, measured from
  the frames rather than guessed.
- **Photos, described the way an art director would**: the light, the shot, the crop, the
  colour treatment.
- **Readable names** for saves called `IMG_4412` or "Image". The old name still finds the item.

It never removes or renames a tag you added yourself, and every change can be undone.

## Ask for references in plain words

Ask Claude for "dark fintech heroes with a device mockup" and it searches your library, reads
the notes, and opens the few images worth looking at. Here is what it gets back, from a page
saved three years ago with a title and nothing else:

```text
1. [site · hero · desktop web · dark · fintech] section 1/5 of "GamePlan  MoneyLion"  (moneylion.com, 2023-01-05)
   MoneyLion fintech landing page hero with dark background, left-aligned headline, teal CTA,
   phone mockup with goal chips, followed by a fan of app screens.
   Move: One large headline anchors a dark field while a tall device and scattered chips overlap
   its edge, then a fanned row of screens creates rhythm below.
   Also: minimal, photo-led, rounded, split layout, device mockup, overlapping layers, nav bar, card
   your tags: fintech
   Live: https://www.moneylion.com/GamePlan/   As saved: https://web.archive.org/web/20230105/...
```

"Live" is the site today. "As saved" is the page as it looked the day you saved it. Paste an
Eagle link (Edit > Copy Link) into the chat and Claude knows exactly which item you mean. It all
works with Eagle closed.

## Why not Eagle's built-in AI?

Eagle 4 has AI Search, and its plugin center has AI tagging. We checked each one against this
problem in September 2026 before building anything:

- **AI Search reads words, not pictures.** Typed searches match an item's name, tags, notes and
  link. It can find "more like this" by look, but a save called `IMG_4412` with no tags never
  comes up when you type "pricing page".
- **Long captures get squashed.** Eagle's AI features see an image at 224 pixels, or as a thumbnail
  320 pixels wide. A full landing page becomes a smear.
- **The tagging plugins run when you click**, a few items at a time: about six hours of clicking
  for a 6,000-item library. They don't hold the model to a fixed list, so one idea ends up
  tagged five different ways.
- **Nothing tags as you save.** Eagle gives outside tools no signal that a new item arrived.
- **It only works inside Eagle.** Your other AI tools can't search the library on their own.

eagle-refs doesn't replace AI Search. It does the part Eagle doesn't, then hands the result back:
once the tags and notes are in Eagle, Eagle's own search finds those items too.

## It runs by itself

Once it's set up, there's nothing to run. Every time you save something to Eagle:

1. Eagle updates one small file inside your library, and macOS notices.
2. macOS starts eagle-refs, at most once a minute, so ten quick saves are one run.
3. It tags only what's new and writes the tags and notes onto those items in Eagle.
4. Then it quits. Nothing keeps running between saves.

A new save is tagged in Eagle a minute or two later. A run with nothing new takes a few seconds
and costs nothing. macOS gives it low priority, so it never competes with your work. It also runs
once an hour, to catch anything a save missed. If Eagle is closed, tagging still happens and the
tags go into Eagle the next time it's open.

```bash
eagle-refs background on       # start tagging as you save
eagle-refs background status   # is it on, and what did the last run do
eagle-refs background off      # stop; everything already tagged stays
```

## What it costs

eagle-refs uses AI models through [OpenRouter](https://openrouter.ai): one account that reaches
many models, so each job can use the best-value one. You pay OpenRouter directly, per use.

| | Cost |
|---|---|
| Tagging a whole 6,000-item library, sections included | about $6.50, once |
| A new image | about $0.0005 |
| A photo, or a design built on one | about $0.002 |
| A full-page capture | $0.003 to $0.006 |
| A GIF or video | about $0.0001 per second |

A normal week of saving costs a few cents. You see the price before anything is charged:
`eagle-refs tag --dry-run` counts what's new and prices it without making a single call.

Two tips. Give your OpenRouter key a monthly spend limit of its own; auto top-up keeps your
account funded but never lifts a key's limit. And keep at least $1 of credit, because OpenRouter
won't process video below that.

## Set it up

You need a Mac, Eagle 4, and an OpenRouter account with a few dollars of credit. Create a key at
[openrouter.ai/keys](https://openrouter.ai/keys). The tool itself also needs Node 22 or newer,
and ffmpeg for GIFs and videos.

### The easy way: let Claude Code do it

Setup is a handful of terminal commands. If you use [Claude Code](https://claude.com/claude-code),
it can run them for you. Paste this, with the path to your library (in Finder, a folder whose
name ends in `.library`):

> Set up eagle-refs from https://github.com/jcoger/eagle-refs for my Eagle library at
> ~/Pictures/Design.library. Follow its README. Install anything that's missing, create the
> config, and make a .env file for my OpenRouter key, then tell me where it is so I can paste the
> key in myself. Run the price check and tell me what tagging will cost before anything is
> charged. Then tag a sample of 50 and open the contact sheet for me.

When the sample looks right:

> Tag the rest, write the tags into Eagle, turn on the background job, and install the
> eagle-refs skill so you can search my library.

### By hand

If you use [Homebrew](https://brew.sh), `brew install node ffmpeg` gets both tools. Then:

```bash
git clone https://github.com/jcoger/eagle-refs.git
cd eagle-refs
npm link                                                   # makes the `eagle-refs` command available
cp eagle-refs.config.example.json eagle-refs.config.json   # then set "library" to your library's path
cp .env.example .env                                       # then paste your OpenRouter key into it
```

Run these from the `eagle-refs` folder:

```bash
eagle-refs tag --dry-run      # 1. what it would tag, and the price. Nothing is charged.
eagle-refs tag --sample 50    # 2. 50 varied items, plus a contact sheet to judge by eye
eagle-refs tag                # 3. everything else. Safe to stop and restart.
eagle-refs motion             #    GIFs and videos
eagle-refs index              # 4. build the search
eagle-refs writeback          # 5. preview what goes into Eagle (keep your library open in Eagle)
eagle-refs writeback --run    #    then write it
eagle-refs background on      # 6. tag every new save from now on
```

The contact sheet from step 2 is `eagle-refs-data/tags/sample-sheet.html`. Open it in a browser.

### Let your AI tools search it

eagle-refs comes with a skill for Claude Code that teaches it to search your library, open at
most ten images, and borrow an idea rather than copy a look. Copy `skill/SKILL.md` to
`~/.claude/skills/eagle-refs/SKILL.md`. Then ask for references the way you'd brief a designer:
"hard paywall whose hero is the user's own result, dark, no feature checklist".

## Is it any good?

We tested seven AI models on the same 60 saves, 40 of them already tagged by hand, and compared
each against Claude Opus and against the hand tags.

- The default model gets **what kind of thing** an item is right about 9 times in 10, the exact
  screen or section type about 3 in 4, and the industry about 7 in 10. That's why search filters
  only on the reliable tags and uses the rest to rank.
- Against the hand tags, the cheap default did as well as a model almost five times the price.
- Photos are the exception. Reading the light is what matters there, and a different model does
  it better (80% vs 70%), so the photo pass uses that one.
- For motion, the timing comes from the frames themselves. On one button animation, the frames
  said the expand takes 400 ms; three AI guesses said 350, 400 and 700.

The full numbers are in [docs/reference.md](docs/reference.md#measured).

## Why you might not want it

- **Mac only.** Eagle runs on Windows; this doesn't.
- **It costs a little money**, and it needs an OpenRouter account.
- **Tags are good, not perfect.** About 1 in 10 is off on the basics. You'll still browse.
- **It searches words and tags, not shapes.** A layout you can only describe ("the question on
  the left, the answer on the right") matches only if the note happens to say so.
- **One library at a time.** A second library needs its own setup.

## More

[docs/reference.md](docs/reference.md) has every command and option, the config file, how each
step works, the full test results, and the engineering notes.

MIT license. Built at [Dyno Labs](https://dynolabs.co). Not affiliated with Eagle.
