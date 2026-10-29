# eagle-refs

My [Eagle](https://eagle.cool) library, tagged as I save, and searchable from Claude Code.

My library was a mess. Years of saves: landing pages, app screens, posters, logos, type, photos,
GIFs. I save the way most designers do. I drag and grab, and I rarely stop to pick a folder or add
a tag. When I finally checked, half of my 3,783 saves had no tags at all. They never came up in a
search, so they might as well not have been there.

So I decided to fix it, and to give myself access to all of it through Claude Code. eagle-refs
looks at every save, tags it, writes a short note on why it works, and puts both back into Eagle.
Now when I'm designing, I ask Claude for references and it pulls from what I actually saved.

I'm sharing it in case your library looks like mine.

<!-- Video: zooming into the library -->

## What it does

For every item in my library:

- **Tags, sorted into Eagle's tag groups.** What it is (a hero, a paywall, a poster, a wordmark),
  where it lives (iOS, desktop web, print), light or dark, the style, the layout, the UI parts on
  screen and the industry. Every tag comes from one fixed list, so "paywall" always means the
  same thing.
- **Search by meaning.** Each save gets a fingerprint made from its image and its note together, so
  a plain-language brief like "warm food brand hero with a candid photo" finds it even when no tag
  says so. Tags still narrow the search and still count. "More like this" compares the pictures
  themselves, so pointing at one poster brings back posters that look like it. With no key or no
  network, search falls back to words.
- **A note on why it works.** One line describing the item, and one line on the idea worth
  borrowing. That second line never names a colour or a typeface, so it's an idea I can use in a
  different project, not a look to copy:

  > Move: One large headline anchors a dark field while a tall device and scattered chips
  > overlap its edge, then a fanned row of screens creates rhythm below.

- **Long page captures, section by section.** A full landing page is cut into screens and each
  one is tagged, so when I look for pricing sections I get the pricing part of every page I saved.
- **Motion, for GIFs and videos.** What moves, what triggers it, and the timing, measured from
  the frames rather than guessed.
- **Photos, described the way an art director would**: the light, the shot, the crop, the
  colour treatment.
- **Posts, read for their words.** A saved post, carousel, thread, thumbnail or reel keeps its
  text, its hook, how it is built and who wrote it. Search a line you half remember, or ask for
  "contrarian opener, story then lesson", or everything by one author.
- **Readable names** for saves called `IMG_4412` or "Image". The old name still finds the item.

And for a few places I save from all the time:

- **Live sites, with their motion.** Drop a save into a folder called **Capture motion** and it
  records the live page, reads how each section moves, and adds the recording next to the save.
- **Tweets become their media.** Save a tweet however you like. The video or the photos land in
  Eagle, and the leftover link or still goes to the Trash once my tags have moved over.
- **Code behind the save.** For sites that publish their source, like Email Love, search points
  at the code too, so Claude can read how it was built.

It never removes or renames a tag I added myself. Tags and notes can be undone with one command,
and anything it moves to the Trash stays there until I empty it.

## How I use it

I ask Claude for "dark fintech heroes with a device mockup" and it searches my library, reads
the notes, and opens the few images worth looking at. Here's what it got back, from a page I
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

"Live" is the site today. "As saved" is the page as it looked the day I saved it. When I paste an
Eagle link into the chat (Edit > Copy Link), Claude knows exactly which item I mean. It all works
with Eagle closed.

## Why I didn't just use Eagle's AI

Eagle 4 has AI Search, and its plugin center has AI tagging. I checked each one against this
problem in September 2026 before building anything:

- **AI Search reads words, not pictures.** Typed searches match an item's name, tags, notes and
  link. It can find "more like this" by look, but a save called `IMG_4412` with no tags never
  comes up when you type "pricing page".
- **Long captures get squashed.** Eagle's AI features see an image at 224 pixels, or as a thumbnail
  320 pixels wide. A full landing page becomes a smear.
- **The tagging plugins run when you click**, a few items at a time: about six hours of clicking
  for my library. They don't hold the model to a fixed list, so one idea ends up tagged five
  different ways.
- **Nothing tags as you save.** Eagle gives outside tools no signal that a new item arrived.
- **It only works inside Eagle.** My other AI tools couldn't search the library on their own.

eagle-refs doesn't replace AI Search. It does the part Eagle doesn't, then hands the result back:
once the tags and notes are in Eagle, Eagle's own search finds those items too.

## Capturing a site's motion

Eagle's web clipper saves a still. For a landing page with great choreography, the motion is the
part I wanted most, and a still loses all of it. So now I drop the save into an Eagle folder called
**Capture motion** and walk away. A few minutes later, two new items sit next to it:

- **A recording of the whole page**, scrolled slowly with a pause on every screen, and a note that
  walks through it: how the page moves as a whole, its shared rhythm, then each section by time.
- **A full-page image**, tagged section by section like any other page I save.

The note comes from three places, because each one catches what the others miss:

- **The page itself.** The browser lists every animation the site runs from CSS, with the real
  duration, delay and easing curve. That's how I know Melius runs nearly every entrance on one
  curve, `cubic-bezier(0.33, 1, 0.68, 1)`, with cards staggered 100 ms apart.
- **A model watching each section.** Plenty of motion never shows up in that list: text that
  scrambles or types itself out, marquees, 3D and canvas scenes. A model watches each section of
  the recording twice and the two reads are merged.
- **One read of the whole page.** Section by section, nobody notices that a page opens and closes
  on the same motif. A last pass over every section's notes names what spans the page.

Then I can search motion in plain words. "Wave of image cards along a curve" finds Melius, and
points at the section of the recording where it happens.

Each site costs 1 to 2 cents and takes about four minutes, on my Mac. It needs Google Chrome and
one extra install, `npm install playwright-core` in the eagle-refs folder (Claude Code can do it).
The notes catch most of a page, not all of it, so when I actually rebuild a motion I have Claude
look at the section clips, which are saved next to the report.

## Videos from X

Most launch videos I want get shared on X, and Eagle saves a tweet as a still or a bare link. Now
the background job checks every tweet I save and leaves me with the media: the video, or the
photos if I only saved the link. The leftover link or video frame goes to Eagle's Trash, after my
tags and folders move onto the media. I don't paste links anywhere.

## It runs by itself

I don't run anything anymore. Every time I save something to Eagle:

1. Eagle updates one small file inside the library, and macOS notices.
2. macOS starts eagle-refs, at most once a minute, so ten quick saves are one run.
3. It tags only what's new and writes the tags and notes onto those items in Eagle.
4. Then it quits. Nothing keeps running between saves.

A new save is tagged in Eagle a minute or two later. A run with nothing new takes a few seconds
and costs nothing. macOS gives it low priority, so it never competes with my work, and it also
runs once an hour to catch anything a save missed. If Eagle is closed, tagging still happens and
the tags go into Eagle the next time it's open.

It shows up as **eagle-refs** in System Settings > General > Login Items & Extensions.

```bash
eagle-refs background on       # start tagging as you save
eagle-refs background status   # is it on, and what did the last run do
eagle-refs background off      # stop; everything already tagged stays
```

## What it costs

eagle-refs uses AI models through [OpenRouter](https://openrouter.ai): one account that reaches
many models, so each job can use the best-value one. You pay OpenRouter directly, per use.

Tagging my whole library, about 6,000 items with every page section, cost about $6.50. A normal
week of saving costs me a few cents.

| | Cost |
|---|---|
| A new image | about $0.0005 |
| A photo, or a design built on one | about $0.002 |
| A saved post (its words and build) | about $0.0005 |
| A full-page capture | $0.003 to $0.006 |
| A GIF or video | about $0.0001 per second |
| A site capture | 1 to 2 cents |
| Search by meaning, per save | about $0.00013 (about $0.13 per 1,000) |

Search by meaning is a one-time pass over the whole library (about $2 for 15,000 records and
sections), then only what's new. `eagle-refs embed --dry-run` shows the price first.

You see the price before anything is charged: `eagle-refs tag --dry-run` counts what's new and
prices it without making a single call.

Two things I learned the hard way. Give your OpenRouter key a monthly spend limit of its own, and
know that auto top-up keeps your account funded but never lifts a key's limit. And keep at least
$1 of credit, because OpenRouter won't process video below that.

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

### Let Claude search it

eagle-refs comes with a skill for Claude Code that teaches it to search your library, open at
most ten images, and borrow an idea rather than copy a look. Copy `skill/SKILL.md` to
`~/.claude/skills/eagle-refs/SKILL.md`. Then ask for references the way you'd brief a designer:
"hard paywall whose hero is the user's own result, dark, no feature checklist".

## Is it any good?

Before settling on a model, I tested seven of them on the same 60 saves from my library, 40 of
which I'd already tagged by hand, and compared each against Claude Opus and against my tags.

- The default model gets **what kind of thing** an item is right about 9 times in 10, the exact
  screen or section type about 3 in 4, and the industry about 7 in 10. That's why search filters
  only on the reliable tags and uses the rest to rank.
- Against my own hand tags, the cheap default did as well as a model almost five times the price.
- Photos are the exception. Reading the light is what matters there, and a different model does
  it better (80% vs 70%), so the photo pass uses that one.
- For motion, the timing comes from the frames themselves. On one button animation, the frames
  said the expand takes 400 ms; three AI guesses said 350, 400 and 700.

Search by meaning got the same treatment. I ran ten real briefs from my projects, took the top 8
for each, and had every image graded 0 to 2 without the grader knowing which search made it.

- **Words and tags alone scored 49 of 160. With meaning, 54.** A real lift, not a big one.
  Briefs about a mood or a medium gained the most: photo heroes, poster families, food wordmarks.
- **"More like this" improved the most.** Pointed at a fintech hero, words alone mixed in an event
  agency and a hiking page. With meaning, all five results were fintech heroes with a photo.
- **Briefs about a structure still miss.** "Pain on the left, answer on the right" finds the right
  kind of page but not the move, with or without meaning. Search can't find what I never saved.

The full numbers are in [docs/reference.md](docs/reference.md#measured).

## Why you might not want it

- **Mac only.** Eagle runs on Windows; this doesn't.
- **It costs a little money**, and it needs an OpenRouter account.
- **Tags are good, not perfect.** About 1 in 10 is off on the basics. You'll still browse.
- **Meaning helps, but it isn't magic.** A layout you can only describe ("the question on the
  left, the answer on the right") comes back only if you saved one. Typed searches also need the
  network for the meaning part; without it they fall back to words.
- **One library at a time.** A second library needs its own setup.

## More

[docs/reference.md](docs/reference.md) has every command and option, the config file, how each
step works, the full test results, and the engineering notes. [CHANGELOG.md](CHANGELOG.md) has
what changed in each release.

MIT license. Made by [Jarrett Coger](https://jcoger.com) at [Dyno Labs](https://dynolabs.co).
Not affiliated with Eagle.
