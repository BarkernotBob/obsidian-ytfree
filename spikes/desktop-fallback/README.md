# Spike — the desktop fallback when yt-dlp is fully dead

Throwaway. Delete once issue 025 is answered.

Two halves. The first is already run and has an answer; the second needs Obsidian and a
pair of eyes.

## Half 1 — `origin-probe.mjs` (done, 2026-07-31)

Answers: does a YouTube `/embed` iframe work when the host page is not on an http(s)
origin? It brackets `app://obsidian.md`, which a plain Chromium cannot open, with a
control that must pass and a subject that stands in for it.

```bash
node origin-probe.mjs
```

| Origin | Channel | Result |
|---|---|---|
| `http://127.0.0.1` (control) | open in 1.8s | **PLAYS** — playerState 1, currentTime advancing |
| `file://` (subject) | open in 1.1s | **error 153**, never played |

The `postMessage` channel opens either way — as it did on iOS — and the player then
refuses to configure itself. This is the same failure as issue 004's, from a different
non-http origin, so **the iframe is not the fallback on desktop any more than on mobile.**
Not proof about `app://` specifically; a strong enough prior that the in-Obsidian half
tests `<webview>` instead of re-testing the iframe.

Uses the Chrome for Testing already in `~/Library/Caches/ms-playwright/chromium-1208`
rather than installing a browser.

## Half 2 — the plugin (not yet run)

`<webview>` has no origin to satisfy: it *is* youtube.com, top level, exactly like the
sign-in modal in `src/desktop/signin.ts`. So the questions are not about playback.

| | Question | How it proves it |
|---|---|---|
| W1 | Does the view play YouTube inside a note? | you see a video |
| W2 | Can `executeJavaScript` read `video.currentTime`? | "Read time now" logs an actual value |
| W3 | Does writing `currentTime` seek? | `seek → PASS`, landed within 3s |
| W4 | Do play/pause/rate work? | the buttons do what they say |
| W5 | Can a **synchronous** `currentTime` be faked? | drift line stays well under a second |
| W6 | **Does the note still take keystrokes?** | type under the block after clicking the video |
| W7 | Is an ad distinguishable from the video? | `AD SHOWING` appears during a pre-roll |

**W5 and W6 are the ones that decide the feature.** `executeJavaScript` is async and the
stamp handler runs on a keystroke ([capture.ts](../../src/capture.ts)), so the position
has to be polled and dead-reckoned between ticks; the spike reports its own error rather
than assuming it is small. And if clicking the video hands the keyboard to the webview,
there is nothing to stamp into — that outcome kills the in-note route and leaves "stop and
offer a button", which is what issue 025 does mid-stream anyway.

W7 matters because an ad's `currentTime` is the *ad's*. Stamping during one would write a
link to 0:07 of a car commercial.

### Install (not done — deliberately)

Nothing has been copied into the vault; the vault has ~70 uncommitted changes and this can
wait for a quiet moment. When you want it:

```bash
mkdir -p "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyVault/.obsidian/plugins/ytfree-fallback-spike" && cp ~/Projects/obsidian-ytfree/spikes/desktop-fallback/{main.js,manifest.json} "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyVault/.obsidian/plugins/ytfree-fallback-spike/"
```

Then enable **YT Free — desktop fallback spike** in Community plugins, and put this in a
scratch note:

````
```ytfree-spike
h0EGCnBjTVk watch
```
````

Second word is `watch` or `embed` — the full page, or the bare player inside the view.
Try `watch` first; `embed` is the tidier picture and is only worth having if it also plays.

Remove the folder and reload when you are done.
