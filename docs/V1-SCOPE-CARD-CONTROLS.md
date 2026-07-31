# V1 scope — card controls

Settled by grilling on 2026-07-30, with the button layout decided against a
throwaway prototype (`prototypes/card-controls/`, branch
`prototype/card-controls`, never merged).

## The problem

A hub card and a search result card each have exactly one interaction: the whole
card is a click target. On the hub that means "make a note and open it", on
search it means "add to the hub". Every other decision — is this even worth a
note? does it belong in the Inbox or straight into Kept? — has no control to
express it, so the only way to find out what a video is, is to create a note for
it. That is where the note spam comes from.

The fix is four actions per card, the same four on both views, plus enough width
per card to draw them: a two-up grid on the phone.

## The four actions

Same four buttons, same four positions, on every card in both views.

| | Search | Hub |
|---|---|---|
| **Preview** | modal: full info + ad-free playback | same |
| **Watch** | add to hub as kept, create the note, open it | create the note, open it |
| **Save** | add to Inbox | create the note, do not open it |
| **Remove** | hide from future search results | move to Hidden |

Tapping the **card body** is Preview — the safe, reversible action gets the
largest target on the screen; the three consequential ones require their own
button.

### Preview

A modal, not an inline expansion and not a second pane. The modal is what keeps
the hub's scroll position: the list never unmounts, so previewing eight results
in a row costs no re-scroll. That is also what makes infinite scroll safe below.

It shows full title, channel, duration, views, age, the whole description, and a
player. The same four buttons repeat at the bottom, so a decision can be made
from inside the preview without dismissing first.

**Playback is the full engine minus the note-coupled features.** Smart speed,
silence skipping, seek and speed control all work. Transcript pane, timestamp
capture and pinning do not — those are the reasons to make a note, and
withholding them is what makes Watch worth pressing.

**Preview writes progress.** `progress-store` keys by `videoId`, not by note
path, so a preview and a later watch are the same session in different
containers. Pressing Watch during a preview closes the modal and opens the note
with the player already at position — never two players alive at once. Preview
never sets `watched`: the alternative punishes previewing, and a hub that
punishes previewing is a hub where you Watch everything, which is the thing this
is trying to stop.

One video per modal. No stepping between results — dismiss to move on.

### Watch and Save

`openItem` splits into create and create-and-open. Save is the create half;
Watch is both. This means `kept` keeps its existing meaning — a note exists —
and no fourth state is needed.

Watch on a card whose note already exists opens it, and reads as already-done
before you press it.

### Remove

On the hub, `store.hide()` unchanged — a tombstone, for the sync reason in
issue 014.

On search, a **separate blocklist**, deliberately not surfaced under the Hidden
filter: things you have never collected should not fill the drawer you visit to
undo hub mistakes. Two ways back:

- at the moment of the action, the card collapses in place to a same-height
  "Removed — Undo" strip, until the next search;
- later, a list in Settings.

**Hide channel** ships in v1, as a `⋯` chip in the thumbnail's top corner on
search cards only (scrimmed, so it survives a light thumbnail). It opens a menu
whose only item today is "Hide this channel", which gives later secondary
actions somewhere to go without becoming a fifth equal button.

Hidden channels filter search results only, and are a list separate from
subscriptions. Subscribing to a hidden channel wins: the hide is dropped, with a
notice.

## Layout

**Mobile: two-up grid, 2×2 buttons with icon and text.** ~178px card at 390px.
The prototype settled this — at that width four buttons across gives ~40px each,
which is a legal tap target but not a legible label; even abbreviated, text in a
row clips to "Prev / Watc / Save / Rem". The ≥40px target plus "all four buttons
equal" admits exactly two shapes, 2×2 or 1×4, and 1×4 cannot carry readable
labels. The price, stated plainly: a ~250px card, about four per phone screen.

This is a rewrite of `.ytfree-phone .ytfree-hub-card`, not a tweak. The dismiss
column, the 112×63 thumbnail and the byline geometry all go.

**Desktop: buttons in a row under the meta text.** Chosen knowingly over a
trailing 2×2 block that would have kept the existing 90px card: this grows it to
~132px, about seven cards visible instead of ten, and buys left-to-right
scanning consistent with the rest of the card.

**Nothing reflows on click.** Every button state — idle, spinner, done,
disabled — is a stacked layer in one grid cell, with the border present in all
of them and `overflow: hidden` on the button. The prototype found the one trap:
a done-state label wider than the idle label pushes anyway, so done states are
checkmark-only.

**State lives in the buttons.** Watch carries a checkmark when a note exists,
Save when the video is in the hub. The separate marker column and badge are
deleted. Watched progress is a bar along the bottom edge of the thumbnail —
YouTube's own convention, zero layout cost, legible at 178px.

Icons, all Lucide: Preview `eye`, Watch `play`, Save `bookmark-plus` →
`bookmark-check`, Remove `x`. `plus` and `check` are deliberately not idle
icons, because they now mean done.

**Per-filter slot meanings.** The four positions never move; two of them change
meaning where the default would be a no-op — in Kept, Save becomes Open note; in
Hidden, Remove becomes Restore. Disabling them instead would waste a quarter of
the control area in half the filters.

## Rendering

`renderList` builds every card in one pass today. A two-up grid roughly triples
the cards on screen, so the initial render caps at 40 and an IntersectionObserver
sentinel loads the next 40 at the bottom. Infinite scroll is safe here precisely
because Preview is a modal — the list is never unmounted and there is no scroll
position to restore.

## Shipping order

1. **Card and grid rewrite.** Two-up mobile grid, desktop row, four working
   buttons, infinite scroll. Preview opens an info-only sheet. Search's Remove is
   session-only at this stage, so the button is never a stub.
2. **Search blocklist and hide channel.** Persistence, the undo strip, the
   Settings lists.
3. **Standalone player.** Preview gains real ad-free playback: `YtFreePlayer`
   lifts out of the markdown code-block path, and progress carry-over lands with
   it.

Each of the three is usable on its own.

## Out of scope

- Stepping between videos inside the Preview modal.
- Channel muting anywhere other than search.
- Transcript, timestamp capture or pinning inside Preview.
