# 020 — The line where you can see it, and a bar you can read

Status: **Built 2026-07-30 — awaiting manual test.**

Seven items off BarkernotBob's list. Two of them are 019 not working on the device it
was written for.

> 1. Purple Progress bar below video isn't working, at least on desktop.
> 2. Tilting phone to landscape did nothing.
> 3. Look at the centering and alignment of all video player buttons. Make sure
>    that they are reasonably grouped, aligned on both mobile and desktop, and
>    centered vertically and horizontally.
> 4. Rather than show smart speed as a per video action, put that in the pop out
>    menu. Make the menu icon turn purple with smart speed on, and no color with
>    smart speed off.
> 5. Add a button to the controls to toggle pinned video player, an action we
>    already have but currently have to use the command palette for.
> 6. Resume after needs to be in seconds, not milliseconds.
> 7. Pause while typing should be an option to toggle in the pop out menu.

---

## 1. The line was drawn, in the wrong box

019 said the desktop "now gets a bare `.ytfree-stage` that is exactly the
video's size". It didn't. The player was handed `mediaHost: media`, and on the
desktop `media` **is the whole wrapper** — so the stage was built around the
video *and* the Description / Transcript section links, and the line was drawn
along the bottom of all of it, three or four inches below the picture. On a
phone `media` is a real media box, which is why it looked right there.

The player already builds its own stage when no host is given. So the desktop
now passes `undefined` and gets the box it was promised; the phone still passes
its own. The harness measures the gap between the picture's bottom edge and the
line's: **0 pt on both shapes**, desktop and phone.

## 2. Rotating a phone is not a tap

iOS refuses `webkitEnterFullscreen` unless it is inside a user gesture, and a
rotation is not one. The call was made, WebKit dropped it on the floor, and
nothing happened — exactly what BarkernotBob saw. There is no flag that changes this.

So landscape no longer asks for fullscreen. It sets **immersive mode**: the
wrapper goes `position: fixed`, inset 0, above the note, picture letterboxed to
the full screen, controls on a dark strip at the foot, section links hidden.
It's CSS on the element that already holds the playing `<video>` — nothing is
reparented, so the buffer and the position survive — and being CSS, it cannot
be refused. Portrait puts it back. Escape leaves it (after closing the pop-out,
if that's open). Fullscreen from the button now falls back to the same mode
when WebKit ignores it, so the button works on a phone too.

Measured at 844×390 and 667×375: covers the screen exactly, picture spans the
full width, controls fully on screen, section links hidden.

## 3. The bar had a broken selector in it

`.ytfree-controls-side:last-child` stopped matching the right-hand group the
day the pop-out panel became the bar's last child. The right group had been
falling back to `flex-start` ever since: on the desktop the two sides carried
**110 pt and 16 pt** of slack. Positional selectors are a bad way to say
"left" and "right", so the groups are now named — `ytfree-controls-left` and
`ytfree-controls-right`, in the player, the base rules and the narrow-phone
rules alike.

With that fixed, and with Smart Speed off the bar (item 4) and the pin on it
(item 5), the harness reports across four widths: **overflow 0**, transport
group centred to the pixel horizontally (`playOffCentre` 0) and vertically
(`offCentreVertical` 0), smallest target 40 pt, smallest gap 8 pt, and no
control moving when the pop-out opens.

## 4. Smart Speed moved into the pop-out

It was a per-video setting living on the bar next to the transport controls,
which is the one place a per-video setting doesn't belong. The zap button is
gone; the switch in the pop-out is now the only place it is set, with the time
it has saved you next to its label instead of in a badge on the bar.

The pop-out's own button is the indicator: **purple when Smart Speed is on for
this video, plain when it's off**, and its tooltip says which. PiP and
Fullscreen moved to the left group to keep the sides balanced.

## 5. A pin on the bar

Same action as the command, same function underneath — the button and
**Toggle pinned video player** call one method. The button fills in purple when
the pinned player is on. Toggling it from the command palette repaints any bar
still on screen, so the pin never says the opposite of what is true.

The toggle is deferred a tick past the click, because switching the pinned
player tears down and rebuilds the player the button lives in.

## 6. Seconds

*Resume after* is a slider in seconds now — 0.25 s to 5 s, quarter-second
steps — and the description under it reads back what you chose in words. The
stored value is still milliseconds; only the dial changed, so nobody's setting
moves.

## 7. Pause while typing, in the pop-out

**Per video**, like everything else in that panel: "let this lecture run while
I write" is a decision about this lecture, and the footnote in the panel says
*This video only*. The global default stays in Settings, and the panel now has
a link straight to it.

The typing handler reads the per-video value first and falls back to the
setting, so a video you never touched behaves exactly as before.

---

## Acceptance criteria

- [x] The purple line sits on the bottom edge of the **picture** on the
      desktop, not under the section links — measured, 0 pt gap on both shapes.
- [x] Turning a phone sideways puts the video into an immersive full-screen
      view without needing a tap, and turning it back restores the note.
- [x] Immersive mode covers the screen, keeps the controls on screen, and does
      not interrupt playback.
- [x] Escape leaves immersive mode; the pop-out closes first if it is open.
- [x] Left and right control groups are balanced, and the transport group is
      centred both ways — measured at four widths.
- [x] The control row does not overflow a 375 pt phone.
- [x] Smart Speed is no longer a button on the bar; it is a switch in the
      pop-out, with its saved time beside it.
- [x] The pop-out's button is purple when Smart Speed is on for the video and
      plain when it is off.
- [x] A pin button toggles the pinned player, agrees with the command, and is
      repainted when the command is used instead.
- [x] *Resume after* is set in seconds.
- [x] *Pause while typing* can be turned off for one video from the pop-out,
      leaving the global setting alone.
- [x] Opening the pop-out still moves nothing — bar height unchanged, panel
      kept on screen (it scrolls if the phone is too short for it).
- [x] `npm run check` clean: 331 tests.

## Manual test (for BarkernotBob)

**The line (desktop first — this is the one that was broken)**

1. Open a video note on the Mac and play it. The purple line must be along the
   **bottom edge of the picture**, touching it — not floating below the
   Description / Transcript links.
2. Same on the phone: still on the picture's edge, unchanged from before.

**Landscape (phone only)**

3. Play a video and turn the phone sideways. The video should fill the screen
   within a moment — picture centred, controls in a dark strip at the bottom,
   the note gone. It should **keep playing**, from where it was.
4. Tap Play/Pause and the speed control down there. They should work normally.
5. Turn the phone back to portrait. You should be back in the note, still
   playing, in the same place.
6. In portrait, tap the **Fullscreen** button. Either iOS's own fullscreen
   opens (fine) or you get the same immersive view (also fine). Press Escape or
   turn to portrait to leave.

**The bar (both devices)**

7. Look at the row under the video. Left: PiP, Fullscreen. Middle: back 10,
   Play, forward 10, speed. Right: pin, pop-out. Nothing should look shoved to
   one side, and everything on the row should share one centre line.
8. On the phone, check the row in portrait at your usual width — nothing cut
   off, nothing wrapping oddly.

**Smart Speed and the pop-out**

9. The zap button is gone from the bar; that is intentional.
10. Open the pop-out. Flip **Smart Speed** on. The pop-out's own button should
    turn purple immediately. Flip it off — the colour goes.
11. With Smart Speed on and running, the time it has saved should appear next
    to the Smart Speed label in the panel.
12. Tap **All YT Free settings…** at the bottom of the panel. Obsidian's
    settings should open on YT Free's tab.

**The pin**

13. Tap the pin button. The pinned player should appear (or disappear) exactly
    as the command palette's **Toggle pinned video player** does, and the
    button should be purple while it is on.
14. Toggle it from the command palette instead, with a fenced player still on
    screen. That player's pin button must change colour to match.

**Resume after**

15. Settings → *Resume after*. The slider should read **seconds** (e.g.
    "1.5 s"), not milliseconds, and the line under it should describe what it
    does with your number in it.
16. Set it to something obvious like 3 s, type in a note over a playing video,
    stop typing, and count. It should resume around three seconds later.

**Pause while typing**

17. On a video, open the pop-out and turn **Pause while typing** off. Type in
    the note — the video should keep playing.
18. Open a *different* video note and type. That one should still pause, since
    the switch was for one video only.
19. Turn it back on for the first video and confirm it pauses again.
