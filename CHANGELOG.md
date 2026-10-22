# Changelog

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
