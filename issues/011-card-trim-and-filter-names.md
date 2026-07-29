# 011 — No blurb, a bigger target, and lists that say what they are

Status: **Built 2026-07-29 — awaiting manual test.**

Three asks from BarkernotBob, all phone, all in the hub. Two of them undo parts of
[010](010-cards-controls-sections.md), which is fine: 010 was a guess about
what a card should carry and this is the answer.

---

## 1. The description comes off the card

010 bought card height to put three clamped lines of description on it. Wrong
purchase. A YouTube description is written to sell the video, and `cardBlurb`
could throw out the chapter list and the link farm but not the marketing — three
lines of prose from a channel is three lines of a channel talking about itself.
The title and the channel are what a decision is actually made on.

So the card is the height of its picture again: **92px**, seven to a screen and
part of an eighth at 390×844. What 010 got right is kept — the 128×72 thumbnail,
the length badge on it, and a title with room to be read.

`cardBlurb()` is deleted rather than left unused, along with its two tests. It
was the only caller's only reason to exist; a description is still cached on
every item and still goes into the note.

## 2. The × column is twice as wide

56px → **112px**, a quarter of the screen, full card height.

That width comes out of the title, and the cost was measured rather than
eyeballed — 200 real titles out of the live hub, rendered at 390pt:

| × column | Title column | Titles cut off (2 lines) | Titles cut off (3 lines) |
|---|---|---|---|
| 56px (before) | 187px | 24% | 10% |
| 80px | 163px | 40% | 14% |
| 96px | 147px | 50% | 18% |
| **112px (now)** | **131px** | **58%** | **25%** |

58% was not acceptable, and the fix was already lying around: the card row is as
tall as the 72px thumbnail beside it, and a two-line title plus a byline only
used 49 of those. **The phone title takes three lines now**, which puts the
cut-off share at 25% — level with what it was before the column doubled. The
wider target costs no legibility; it spends slack.

If titles still read clipped, 80px is the number to try next: it is the row in
that table where the target is still noticeably bigger and the title is nearly
whole.

## 3. New and All are now Inbox, Kept, Hidden, Everything

The complaint was exact: *"it's just all videos I haven't either kept or hidden,
so it's 'new videos'"*. That is precisely what New was, and All differed by two
clauses no one could see — it also holds **Kept** items, and it shows items
YouTube says you **already watched**, which New hides.

Two one-word labels cannot carry a difference that is a clause, so:

- **The labels are the states.** A video is undecided, kept, or hidden. Those
  are the first three chips: **Inbox**, **Kept**, **Hidden**. **Everything** is
  the first two in one list and is now named as such rather than as a fourth
  peer.
- **The status line states the rule of the list you are on**, under the chips,
  in place of `42 of 264 videos`:
  - Inbox — `221 videos · not opened, not hidden`
  - Kept — `18 videos · opened — a note exists`
  - Hidden — `6 videos · you removed these · put one back with the arrow`
  - Everything — `239 videos · inbox + kept, including already-watched`

  The count is of the list in front of you, which is the other half of the fix:
  `42 of 264` read as an arbitrary slice of something.
- The chips carry the same sentence as a tooltip on the desktop.

**Everything was kept rather than deleted**, against the "one menu would do"
reading, for one reason worth stating: it is the only list where a video you
watched on YouTube still appears, and the only place one search covers both kept
and undecided videos. If neither turns out to matter, it is four lines to remove.

---

## Acceptance criteria

- [x] No description on a phone hub card.
- [x] Card is 92px; every card the same height; nothing overflows.
- [x] The × column is 112px, full card height.
- [x] The share of real titles that get cut off is no worse than before the
      column doubled — measured, 24% → 25%.
- [x] Filters read Inbox / Kept / Hidden / Everything and all four fit one row
      at 390pt.
- [x] The status line states the current list's rule.
- [x] `npm run check` clean: 192 tests, build clean.

## Manual test (for BarkernotBob)

Phone. Force-download the vault and fully relaunch Obsidian first.

1. Open the hub. Cards should have **no description** — thumbnail, title,
   `channel · age`, and that is all. About **seven** fit the screen.
2. Titles should now run to **three lines** before they cut off. Find one of
   your longest and check it reads.
3. The × column should be **about a quarter of the screen wide**, running the
   full height of the card. Tap one with your thumb without aiming.
4. Tapping × should remove that row and move nothing else.
5. Open the menu (the label at the top left). The chips should read **Inbox ·
   Kept · Hidden · Everything**, all four on one row, none clipped.
6. Tap each one and read the grey line under the search box. It should say how
   many videos and what the list means — e.g. `221 videos · not opened, not
   hidden`.
7. On **Inbox**, open a video. Come back and switch to **Kept**: it should be
   there. Switch to **Everything**: it should be there too, alongside the ones
   you have not opened. That difference is what the two lists are for.
8. On the Mac, hover a chip — the same sentence should appear as a tooltip.
