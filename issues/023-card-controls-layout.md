# 023 — Four buttons on every card, and the layout that fits them

Status: **Built 2026-07-30 — awaiting manual test.**

Stage one of [docs/V1-SCOPE-CARD-CONTROLS.md](../docs/V1-SCOPE-CARD-CONTROLS.md):
the card and grid rewrite, four working buttons, an info-only Preview, and
paging. Stages two (the persistent search blocklist and Hide channel) and three
(real playback inside Preview) are not in this issue.

## The problem

A hub card and a search result card each had exactly one interaction: the whole
card was a click target. On the hub that meant "make a note and open it"; on
search it meant "add to the hub". Every other decision — is this even worth a
note? Inbox or straight to Kept? — had no control to express it, so the only way
to find out what a video was, was to create a note for it. That is where the
note spam came from.

## What was built

**Four actions per card, the same four positions in both lists.**

| | Search | Hub |
|---|---|---|
| **Preview** | modal: full info | same |
| **Watch** | add to the hub, create the note, open it | create the note, open it |
| **Save** | add to the Inbox | create the note, do not open it |
| **Remove** | drop from these results | move to Hidden |

Tapping the **card body** is Preview — the safe, reversible action gets the
largest target, and the three consequential ones need their own button.

**`openItem` split in two.** `SubscriptionsStore.createNote` makes the note and
answers the file; `saveItem` is that alone, `openItem` is that plus the open.
Kept keeps its meaning — a note exists — and there is no fourth item state.

**Mobile: a two-up grid, 2×2 buttons with icon and text.** ~178px card at 390pt.
This is a rewrite of `.ytfree-phone .ytfree-hub-card`, not a tweak: the dismiss
column, the 112×63 thumbnail and the byline geometry are gone. The price, stated
plainly: a ~250px card, about four per screen.

**Desktop: the buttons in a row under the meta text**, which grows the card from
90px to about 130 — seven cards visible instead of ten — and buys left-to-right
scanning consistent with the rest of the card.

**Nothing reflows on click.** Every button state — idle, working, done — is a
layer stacked in one grid cell and swapped with `visibility`; the border is
present in all of them, the font never changes weight, and done states are a
checkmark with no label.

**State lives in the buttons.** The marker column and the phone's thumbnail
badge are deleted. Watch and Save carry the checkmark; how far you got is a line
along the foot of the thumbnail, read live from the progress store.

**Paging.** The first render draws 40 cards and an IntersectionObserver sentinel
appends the next 40 at the bottom. Safe precisely because Preview is a modal:
the list never unmounts, so there is no scroll position to restore.

## Deviations from the scope, and why

- **Hidden is still a list of text rows, not cards.** A hidden item is a
  tombstone with no thumbnail stored (see `hideItem`), so a card for one would
  be a 160px hole and a fetch per row, and Restore is its only action. The
  scope's "in Hidden, Remove becomes Restore" is therefore not implemented;
  the existing restore button does that job.
- **Save drops the card out of the Inbox at once**, the same as Remove and
  Watch: saving makes a video Kept, so it no longer belongs in that list, and a
  card left behind misstates what the list holds. On Kept the item still
  matches the filter, so it stays put.
- **Preview shows no player.** Stage three. It shows the full title, channel,
  length, views, age and the whole description, with three of the four buttons
  at the foot (Preview is what you are already looking at).

## Acceptance criteria

1. Every hub card and every search result card carries the same four buttons in
   the same four positions.
2. Pressing any button changes nothing about the size or position of that
   button, its card, or any card beside it.
3. On a phone the hub is two cards across; on a desktop it is a row per card
   with the buttons under the text.
4. Save creates the note and does not open it. Watch creates it and opens it.
   Neither ever overwrites an existing note.
5. A Kept video's third button reads **Open note** and opens the existing note.
6. Remove on the hub hides the video (it appears under Hidden). Remove on a
   search result collapses that card to a same-height "Removed — Undo" strip,
   and Undo puts the card back in the same place.
7. Tapping a card body opens Preview; Preview shows the whole description and
   can Watch, Save or Remove without dismissing first.
8. A list of more than 40 videos keeps loading as you scroll to the bottom.
9. A partly-watched video shows a red line along the foot of its thumbnail.

## Manual test (for BarkernotBob)

**On the desktop, in the hub**

1. Open the YT Free hub. Every card should now be: picture on the left, title
   and one line of facts beside it, and four buttons — **Preview, Watch, Save,
   Remove** — on a row underneath the text.
2. Press **Save** on a card. Watch the cards above and below it: nothing may
   move, jump, or resize. The button should show a spinner for a moment, then a
   checkmark, and its label should change to **Open note**.
3. Check your Watch Later folder — a note for that video should exist, and it
   should *not* have opened.
4. Press **Open note** on that same card. The note you just made should open.
5. On a different card, press **Watch**. It should create the note and open it.
6. Go back to the hub, switch to **Kept**. Both videos should be there, both
   showing checkmarks on Watch and **Open note** in the third slot.
7. Back on **Inbox**, press **Remove** on a card. That card should disappear;
   switch to **Hidden** and it should be listed there with a way back.
8. Scroll the Inbox to the bottom. If you have more than 40 videos, more should
   keep loading as you go — no "More" button to press.

**Preview**

9. Click a card anywhere that is *not* a button. A window should open with the
   full title, the channel, length/views/age, and the **whole** description.
10. Press **Save** inside that window. It should tick, and the window should
    stay open.
11. Press **Watch** inside it. The window should close and the note should open.

**Search**

12. Press the YouTube button, search for something. Results should be the same
    cards with the same four buttons.
13. Press **Save** on a result. It should tick and read **In your hub**. Go back
    to the hub Inbox — the video should be there, with no note made.
14. Press **Remove** on a result. That card should collapse in place to a strip
    saying **Removed** with an **Undo** — and, importantly, the results below it
    must not jump up.
15. Press **Undo**. The card should come back in the same position.
16. Run a new search. The removed one is allowed to come back — that is expected
    at this stage; the permanent blocklist is the next piece of work.

**On the phone**

17. Open the hub on the iPhone. Cards should be **two across**, each with a full
    width picture, two lines of title, the channel and age, and a **2×2 block of
    four buttons** with readable words on them.
18. Check the labels are not clipped — you should read "Preview", "Watch",
    "Save", "Remove" in full, not "Prev / Watc".
19. Press each button in turn and watch the card *next to it* and *below it*.
    Nothing may shift by a pixel.
20. Every button should be comfortable to hit with a thumb.
21. Tap a card's picture or title (not a button) — Preview should open.
22. Play something you have partly watched, then come back to the hub. That
    card's thumbnail should have a red line along the bottom, roughly as far
    across as you got.
