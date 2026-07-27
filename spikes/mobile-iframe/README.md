# Spike — can Obsidian mobile host a YouTube iframe?

Throwaway. Delete once [issue 004](../../issues/004-mobile-viewer.md) is answered.

Plain JS, no build step, `isDesktopOnly: false`. Separate plugin id (`ytfree-spike`) so it
cannot disturb the real plugin, which stays desktop-only until this comes back positive.

## What it answers

| | Question | How it proves it |
|---|---|---|
| Q1 | Does the webview render a plugin-injected iframe to youtube-nocookie.com? | `load` event fires **and** you see a video |
| Q2 | Does the `enablejsapi` channel work with **no** `origin` parameter? | a `postMessage` comes back from the frame |
| Q3 | Does `seekTo` move the playhead? | the frame reports a `currentTime` within 3s of what was asked |
| Q4 | Does a `ytfree:` link get intercepted? | tapping the in-modal link logs `Q4 PASS` |

Q2 is the one that is genuinely uncertain. Obsidian's webview origin is not a normal
`https://` origin, and the YouTube JS API normally wants `origin` set to the host page —
passing a wrong value breaks the API outright, so this passes none at all and checks
whether that works.

Both hosts are testable: **Mount (nocookie)** and **Mount (youtube.com)**. If nocookie
fails and youtube.com works, the fix is a one-line host change, not a dead issue.

## Install

Already copied into the MyVault vault at `.obsidian/plugins/ytfree-spike/`, so it syncs to
the phone on its own. To re-copy after an edit:

```bash
cp ~/Projects/obsidian-ytfree/spikes/mobile-iframe/{main.js,manifest.json} "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyVault/.obsidian/plugins/ytfree-spike/"
```

## Reading the result

- **Q1 fails** → option B is dead. Mobile playback needs the local-file route (option C)
  or nothing.
- **Q1 passes, Q2 fails** → video plays but timestamps cannot seek it. Fallback would be
  remounting the frame with `?start=` on every tap: it works, but it reloads the player
  and replays the ad each time. Ugly, not fatal.
- **Q1–Q4 pass** → build issue 004 as scoped.
