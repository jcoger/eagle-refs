# Changelog

## 0.3.0 (2026-10-29)

**Posts, read for their words.**

- Vocabulary v3: a `content` kind (text post, image post, carousel, thread, thumbnail, short
  video, newsletter). `social post` is gone from graphic: a designed graphic shared on social keeps
  its own surface.
- A content pass (`tags/content/`): format, author, network, the post's text, its hook and hook
  type, structure, close, and a topic-free line on how it is built. Images go at reading size, up to
  four tiles. The URL's author and network win; X saves use the tweet's own text.
- Config `content.folders`: items in those folders are always read as posts. `models.content`.
- `search --author`, `--hook-type`, `--structure`; a remembered line finds its post; filters alone
  list what matches; hits show the hook and author.
- `writeback --content`, and `writeback --retire` to take off tool tags no current answer gives.
- `tag --retag-surface`, `--retag-social`, `--retag-tag` re-run old answers and keep them.
- Posts are named `<author> · <hook>` with no model call.
- Measured: 10 of 10 hand-picked posts got the content kind, 0 of 10 shared designs did.

## 0.2.0 (2026-10-22)

**Search by meaning.**

- New `eagle-refs embed`: one vector per save and per page section, made from the image and its
  note together (OpenRouter, Gemini Embedding 2 by default). About $2 for a 15,000-record library,
  then about $0.13 per 1,000 new saves. `--dry-run` prices it first. `enrich` runs it after `index`.
- `search` adds a meaning score to the word and tag score, so a plain-language brief finds saves no
  tag describes. Results show `meaning 0.xx`. `--lexical` gives the old ranking exactly.
- `like` compares the pictures themselves and makes no network call.
- With no key or no network, search falls back to words and says so in one line.
- Guards: stops on a bad key or repeated failures, a lock against two runs, refuses wrong-size
  vectors, never drops more than 20% of stored vectors without `--prune`.
- Measured on ten real briefs, graded blind: 49 of 160 with words alone, 54 with meaning. "More
  like this" improved the most. Details in [docs/reference.md](docs/reference.md#measured).

## 0.1.0 (2026-10-16)

First public version.

- Tags every save against one fixed design vocabulary and writes the tags and a note into Eagle.
- Long page captures tagged section by section; GIFs and videos get measured motion; photos get
  an art-director read; readable names for `IMG_1234` saves.
- Live site capture with motion, tweets become their media, code links for sites that publish
  source.
- Runs in the background as you save. Searchable from Claude Code with the included skill.
