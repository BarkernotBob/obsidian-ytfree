# V1 scope — phone settings menu clipped (#52)

**Status (2026-11-07):** built on `claude/project-thread-u7o0uu`, not yet device-tested.

## The problem

On a phone, the ⋯ menu under a video gets cut off, so some of its buttons cannot be
reached. Every row must be reachable on any screen: either the whole menu fits, or it
scrolls.

## Root cause (measured against Obsidian 1.12.7 `app.css`, not guessed)

The menu is `position: fixed` and placed from the button's viewport rect. That only
means "the viewport" when no ancestor is a containing block for fixed elements. In a
note on a phone, two are:

- `.workspace-leaf { contain: strict !important }` — every note pane.
- `.markdown-source-view.mod-cm6 .cm-content > [contenteditable=false] { contain: paint !important }`
  — every embed widget in Live Preview, which is where the player lives.

`contain: paint`/`strict` makes the element the containing block for fixed
descendants **and** clips them to its box. So the menu was positioned relative to the
player's own widget (offset wrong) and cut at its edges. The Preview modal sits outside
the workspace, which is why the earlier modal harness never saw it. Phone floating-nav
also puts `mask-image` on `.mod-root` and `.view-content`, which fades anything inside
near the bottom of the screen.

## v1

1. While the menu is open on a phone, it (and its tap-catcher) live on `document.body`,
   outside every pane, embed and mask. On close they go back to the control bar, so
   nothing leaks if the player is torn down.
2. It stacks at Obsidian's menu layer (`--layer-menu`, 65), above the Preview modal
   (50) and the immersive view (50).
3. Placement subtracts the phone's safe areas (status bar/notch on top, home bar at
   the bottom) and follows the *visible* viewport including its offset, so the
   keyboard or a scrolled visual viewport cannot push rows off screen.
4. When the menu is taller than the room on the bigger side, it is capped to that
   room and scrolls (unchanged rule, now measured against the right box).

Out of scope: redesigning the menu, the desktop popover, tablets (they keep the docked
popover).

## Manual test (phone)

1. Open a note with a YT Free video, Live Preview mode. Tap ⋯ under the video.
   Expect: the whole menu shows, nothing cut at its top or bottom, last row
   "All YT Free settings…" visible or reachable by scrolling inside the menu.
2. Scroll the note so the video sits near the top of the screen, open ⋯.
   Expect: menu opens below the button, fully visible or scrollable.
3. Same with the video near the bottom of the screen. Expect: menu opens upward,
   not under the status bar.
4. Rotate to landscape, open ⋯. Expect: menu scrolls inside itself; every row reachable.
5. Reading view, and the Preview window from the hub: repeat step 1.
6. Tap outside the menu. Expect: it closes and the note/Preview stays where it was.
