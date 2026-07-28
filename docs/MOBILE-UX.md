# Mobile UX — menu structure and layout rules

Scope: Obsidian on a **phone** (`Platform.isPhone`). Tablets and desktop keep the
existing two-column hub and the floating pinned player.

Two surfaces: the **hub view** (`ytfree-hub`) and the **docked player** inside a
Watch Later note.

---

## 1. The hub — menu structure

One screen, three zones, and only one of them is a menu.

```
┌────────────────────────────────────────────────┐
│  [ New · All channels              ⌄ ] [ ⟳ ]   │  chrome — 40pt, fixed
├────────────────────────────────────────────────┤
│  12 of 340 videos · 41 channels · checked 2h   │  status — 1.8em, reserved
├────────────────────────────────────────────────┤
│                                                │
│   ┌──────┐  How Convection Currents Work…      │
│   │thumb │  Veritasium · 3d · 412K views       │  list — everything else
│   └──────┘                              [ × ]  │
│   ┌──────┐  The Problem With Capitalism        │
│   │  ✓   │  SmarterEveryDay · 1w · 1.2M        │
│   └──────┘                              [ × ]  │
│                                                │
└────────────────────────────────────────────────┘
```

### The disclosure button is the whole menu

There is exactly **one** menu control. Its label is the current selection, so the
menu is closed by default and the screen is a video list.

Tapping it opens one panel containing **both** sections:

```
┌────────────────────────────────────────────────┐
│  [ New · All channels              ⌃ ] [ ⟳ ]   │
├────────────────────────────────────────────────┤
│  SHOW                                          │
│  [   New   ] [   All   ] [   Kept   ]          │  three equal chips, one row
│  CHANNELS                                      │
│  All channels                             340  │
│  3Blue1Brown                                4  │  vertical scroll, 44pt rows
│  Veritasium                                 2  │
│  …                                             │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│  (dimmed video list — tap to dismiss)          │
└────────────────────────────────────────────────┘
```

### Rules

1. **Any selection closes the panel.** Picking a filter chip or a channel applies
   it and collapses the menu. That is the whole point: the menu is a detour, not
   a permanent column stealing half the screen.
2. **The panel is an overlay, not a row.** It is absolutely positioned over the
   list. Opening and closing it therefore resizes nothing and moves nothing in
   the list underneath.
3. **The panel has a fixed height** (62% of the body) whatever is in it, and
   scrolls internally. Switching sections can never resize it under your thumb.
4. **Nothing scrolls horizontally, anywhere.** The channel list is vertical. The
   filter chips are three `flex: 1` buttons on one row. The card is
   `thumb | title (flex, min-width:0) | dismiss`, so the title takes the slack
   instead of overflowing.
5. **The label never reflows the bar.** The disclosure button is `flex: 1` with
   `min-width: 0` and ellipsis, so a long channel name truncates rather than
   pushing the sync button off-screen.
6. **The state marker costs no width.** Kept/dismissed is a badge over the
   thumbnail's top-left corner, not a column. Marking an item Kept still moves
   nothing (existing rule, cheaper implementation).
7. Touch targets: 44pt for the dismiss button and the channel rows, 40pt for the
   chrome.

### Card anatomy (phone)

```
 104×58 thumb      title, 2-line clamp, always visible
 ┌────────┐        ────────────────────────────────   ┌────┐
 │  ✓     │        channel · age · views · Watch Later│ ×  │
 └────────┘        ────────────────────────────────   └────┘
      ↑ state badge, absolute                            ↑ 44×44
```

Fixed 74pt height. The title is the widest element and gets whatever the two
fixed columns do not use — on a 390pt phone that is ~210pt, which is two real
lines of title instead of the zero it had when a 200pt channel sidebar was
competing for the same row.

---

## 2. The docked player — clearing Obsidian's own chrome

On a phone Obsidian's view header (back, note title, `⋯`) is **`position: fixed`**
and floats over the top of `.view-content`:

```css
.is-phone.is-floating-nav      { --view-header-position: fixed; }
.is-phone … [data-type="markdown"] { --view-top-spacing: 0; }
.is-phone … .markdown-source-view > .cm-editor > .cm-scroller {
  padding-top: var(--view-top-spacing-markdown);
}
```

Markdown views zero the spacing on the container and re-apply it **inside** the
CodeMirror scroller. The docked player is prepended *before* that scroller, so it
inherited no spacing at all and sat underneath the floating header — and inside
the `--view-top-fade-mask` that dims the first few pixels of `.view-content`.

**Fix.** Two lines, no `!important`, no measuring:

- `.ytfree-docked` reserves `var(--view-top-spacing-markdown, 0px)` as top
  padding, so the video starts below the header and past the fade.
- The docked wrapper redefines `--view-top-spacing-markdown` on the following
  `.markdown-source-view`, so the scroller does **not** reserve the same ~100pt a
  second time and the note text starts directly under the video.

Both are reserved from mount, before anything is fetched, so nothing moves later.
When the player is closed the wrapper is removed and the scroller's own spacing
comes back on its own.

Where the variable is undefined (floating nav off, tablet, desktop) the fallback
is `0px` and the header is in normal flow — nothing to clear, nothing changes.

---

## 3. Watch Later note — the title

The note is opened from the hub with the video title as its filename and `title`
frontmatter, so the title shows in Obsidian's own header and inline title. No
plugin chrome duplicates it above the player: on a 390pt screen the video box is
already 220pt, and a second title line would push the note text below the fold.

---

## Manual test (for BarkernotBob)

Nothing here has been run on a real iPhone — it is reasoned from Obsidian's own
stylesheet, not observed. Steps 3 and 6 are the ones that prove it.

**On the Mac first (two minutes, proves nothing regressed):**

1. Quit Obsidian completely (⌘Q) and reopen it.
2. Open the YT Free hub. It should look exactly as it did: filter buttons top
   left, sync button top right, channel column down the left, video cards on the
   right. Click a channel, click New/All/Kept — all unchanged.
3. Open a Watch Later note. The player should sit at the top of the note as
   before, with no new gap above or below it.

**On the iPhone:**

4. Let the vault sync, then force-close Obsidian (swipe it out of the app
   switcher) and reopen it, so the new plugin files are picked up.
5. Open the YT Free hub. You should see **one** bar at the top reading
   something like `New · All channels` with a `⌄` on its right and the sync
   button beside it — no channel column, and nothing you can scroll sideways.
6. Look at a video card. **The title should be readable across two lines.**
   Thumbnail on the left, title and channel/age/views under it, an `×` on the
   right.
7. Tap the `New · All channels` bar. A panel should slide over the top of the
   list with "SHOW" (three equal buttons: New, All, Kept) and "CHANNELS" (your
   channel list, one per row).
8. Tap a channel. **The panel should close immediately** and the list should
   show only that channel. The bar should now read `New · <that channel>`.
9. Tap the bar again, tap "Kept". The panel should close again, and the bar
   should read `Kept · <that channel>`.
10. Open the panel and tap the dimmed list area below it (or the bar again).
    It should close without changing anything.
11. Watch the video list while you open and close the panel — **no card should
    move, and the list must not scroll or resize.**
12. Tap a video. It should create/open the note as before.
13. **The player.** In that note, look at the top: the video box should start
    *below* Obsidian's floating header (back arrow, note title, `⋯`) — the
    header must not sit on top of the video, and the top of the picture must
    not look faded out.
14. Scroll the note. The note text should begin right under the video, not a
    header's height below it. The video should stay put while the text scrolls.
15. Rotate to landscape and back. Nothing should overlap in either orientation.
16. Tap "Close" on the player. The note text should move up to fill the space in
    one step, and the top of the note should still clear the floating header.

**What to report:** the step number, and what you saw instead. For 13 and 16 a
screenshot is worth more than a description.
