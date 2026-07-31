# 029 — Share a video's URL, and share it at the current timestamp

Status: **Built 2026-07-31 — awaiting manual test.**

## The problem

Everything this plugin does with a video assumed you were keeping it. There was
no way to hand one to someone else — not the video, and certainly not the
ninety seconds of it that were worth their time. Getting a link meant knowing
that `media_link` was in the frontmatter, opening the properties, and copying it
by hand; getting a link *at a moment* meant doing that and then doing
arithmetic.

## What was built

**One Share button on the player's control bar**, and it opens a menu with the
two answers rather than the bar carrying two buttons. Two buttons would be two
thumb-sized targets for one decision, and the second of them — "share at
12:04" — would be a control whose meaning changed every second it went
unpressed. In a menu the time is read once, at the moment you asked.

**A Share in the Preview sheet's action row**, which is now four across like the
card that opened it. It is not a card slot: it changes nothing about the video,
so it has no busy state and no done tick, and it is deliberately drawn as the
same kind of button anyway — a control that looks different for no reason reads
as a control that does something different in kind. It offers the preview
player's own position, so "this bit" works before the video is ever a note.

**Two commands**, not one that asks a question: **Share this video** and
**Share this video at the current time**. A command you have to answer a prompt
after is a command you cannot put on a hotkey, and the two are different
messages — "watch this" and "listen to this bit". The plain one reads the note's
frontmatter first and falls back to whatever is playing; the timed one needs a
player, and says so when there isn't one.

**The phone shares, the desktop copies.** `navigator.share` is the right answer
on iOS and the wrong one on a desktop, where it is either absent or a browser
dialog nobody asked for. A share the reader *cancels* is not a failure and does
not fall through to the clipboard: dismissing the sheet means "never mind", and
quietly overwriting what they had copied is the opposite of that. Any other
failure does fall through, because the clipboard always works.

**`https://youtu.be/<id>` and `?t=<seconds>`.** The short form is what YouTube's
own share sheet produces and it survives being pasted into anything; `?t=` in
whole seconds is the only timestamp form every YouTube client agrees on —
`#t=`, `&start=` and `1h2m3s` are each understood by some and dropped by others.
Zero is never written: sharing from the beginning is sharing the video, and
`?t=0` is a link that looks deliberate and says nothing.

**Both menu items are always offered**, including at 0:00 where they produce the
same URL. Hiding one there would make the menu change shape depending on how
long you had been watching, and a menu whose items move is a menu you have to
read every time.

**No Share on the hub cards.** They stay at four buttons. Sharing something you
have not watched a second of is not a thing anyone does, and the row has no
fifth place to put it that would not cost the other four their width.

## Acceptance criteria

- A **Share** button sits on the player control bar in a note; clicking it opens
  a menu with a plain link and a link at the current time.
- The same menu is reachable from the Preview sheet's action row.
- On the desktop both items copy to the clipboard and say so.
- On iOS both items open the system share sheet; cancelling it copies nothing.
- Command palette carries **Share this video** and **Share this video at the
  current time**.
- Links are `https://youtu.be/<id>`, with `?t=<whole seconds>` on the timed one.
- At 0:00 both items are still offered and both give the plain link.
- Nothing on the control bar or in Preview moves when Share is pressed.

## Manual test (for BarkernotBob)

1. Open a video note and press play. Let it run a minute.
2. Press **Share** on the control bar (the arrow-out-of-a-box icon, near the
   pin). A menu opens with **Copy link** and **Copy link at 1:0x**.
3. Choose **Copy link** and paste somewhere — it should read
   `https://youtu.be/…` with no `?t=`.
4. Press Share again, choose the timed one, and paste — same link with
   `?t=` and roughly the seconds you were at. Open it in a browser and check it
   starts there.
5. Watch the control bar as you press Share: nothing should shift or resize.
6. Open the command palette and run **Share this video at the current time** —
   same result, no button pressed.
7. Run **Share this video** in a note with no player started at all. It should
   still copy the link, from the note's own properties.
8. Open the hub, press **Preview** on anything, let it play a few seconds, and
   press **Share** in the row at the foot. Same menu, same two answers.
9. On the iPhone: repeat steps 2 and 8. The iOS share sheet should come up
   instead of a clipboard message. Swipe it away — whatever you had copied
   before should still be on the clipboard.
