# 049 — The Web Clipper template inserts a raw description and breaks the note

**Status:** **Built 2026-10-13** with option 1 (blockquote, plus `[[` written as `&#91;&#91;`, which reads as `[[` but never links; a backslash escape was avoided because the clipper's own escaping of `\` is undocumented). Isaiah confirmed the
clipper is still in use, so option 2 would have left clipped notes without a description.
Scoped 2026-09-01. Documented as "still open" in the
2026-07-30 HANDOFF entry that built the escaping, and never filed.

**Created:** 2026-09-01

## Problem

The plugin's own note writer escapes a YouTube description before inserting it.
`buildWatchLaterNote` is the only write path and it escapes before it linkifies,
handling every line shape that carries structure: ```` ``` ```` and `~~~` fences
(character by character, so no `~~` strikethrough pair is left behind), leading
`#`, setext `---` and `===`, `>`, and `[[`.

`templates/webclipper-ytfree.json` does none of that. Line 7 is:

```
"noteContentFormat": "# Notes\n\n\n# Video Description\n{{schema:@VideoObject:description}}\n"
```

A description containing a code fence, a leading `#`, a `>` or a `[[` therefore
lands in the note as markdown and takes the rest of the file with it — an
unclosed fence swallows everything below it, `[[` makes a broken wikilink, a
leading `#` becomes a heading that outranks `# Notes`. YouTube descriptions
contain all four routinely: timestamps lists, `#hashtags`, quoted text.

Two write paths, one escaped and one not, producing notes that are supposed to
be the same shape.

## Why it was left

The 2026-07-30 note is honest about the difficulty:

> the nearest fix there is a `|blockquote` filter, which changes how the
> description looks.

Obsidian Web Clipper's filter set is fixed — we cannot ship `escapeDescription`
into it. So this is a choice between imperfect options, not an implementation.

## What it should do

**Decide between three, and record the reason in the template or in this file:**

1. **`|blockquote`** — safe against every shape above, because a blockquoted
   line cannot open a fence or a heading. Changes the look: the description is
   indented and greyed. Honest and ugly.
2. **Drop the description from the template entirely** and let the plugin's own
   path be the only thing that writes one. The clipper's job becomes the
   frontmatter and the `# Notes` skeleton, which is the part it is actually good
   at. Least code, no visual compromise, loses a description on clipper-created
   notes until the plugin touches them.
3. **Keep it raw and document the hazard.** Only defensible if clipper-created
   notes are rare enough not to matter — which is a question about how BarkernotBob
   works, not about the code.

Recommendation: **2**, with 1 as the fallback if a clipper note is expected to
be readable on its own. The plugin already fetches and escapes descriptions
properly; duplicating that badly in a template is the actual problem.

**Existing notes are not rewritten** either way. Whatever landed has landed.

## Acceptance criteria

1. A clipped note whose description contains an unclosed code fence, a leading
   `#`, a `>` line and a `[[` does not break the note's structure.
2. `# Notes` remains the note's own heading and is not outranked by anything the
   description brought.
3. The choice made is written down where the next person will find it — in the
   template file's own repo docs, not only in this issue.
4. No existing note is modified.

## Manual test (for BarkernotBob)

1. In the Web Clipper settings, delete the old **YT Free video** template and import
   `templates/webclipper-ytfree.json` again.
2. Clip a video whose description has a `#hashtag` on its own line, a timestamp list, and
   ideally a line starting with `>`. A long sermon or lecture upload usually has all three.
3. Open the note. The description sits in one quoted block under `# Video Description`.
4. `# Notes` is still the first heading in the outline, and nothing below the description
   turned into a code block.
5. If the description contained `[[`, it reads as `[[` in reading view and is not a link
   (in the editor you will see `&#91;&#91;`).

## Notes

- Small, self-contained, and only bites if the Web Clipper is still part of the
  workflow. Worth confirming that before spending anything on it — if the
  clipper route is dead, deleting the template is the whole fix.
