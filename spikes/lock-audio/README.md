# Spike — does a track transition survive a locked phone?

The music hub auto-advances within an album or playlist. Track one ends while
the phone is locked, and something has to call `play()` on track two from an
`ended` handler, which is not a user gesture. WebKit may refuse that.

- **If it plays** → the queue reuses one element and swaps `src`. Small build.
- **If it is refused** → the queue may never pause between tracks, which means
  appending track two into the same MediaSource buffer. Much bigger build, and
  it drags issue 005 in with it.

Nothing else in the music scope depends on an answer this cheap to get, so it
runs before any of it is designed.

## Running it

Its own plugin, sharing no code and no state with YT Free — installing it
cannot disturb whatever is half-built in `src/`.

```
cp -R spikes/lock-audio "$VAULT/.obsidian/plugins/ytfree-lockspike"
```

Then enable **YT Free Spike (lock audio)** under Community plugins, on the
phone, and run `Lock spike: same element` from the command palette.

1. Tap **Start** — track one plays, seeked to its last 20 seconds.
2. Lock the phone immediately.
3. If the audio stopped, press play on the lock screen. It should resume.
4. Stay locked through the end of track one.
5. Unlock and read the log.

Then run `Lock spike: new element` — the variant that builds a second element
rather than reusing the first — to find out whether reuse is what matters.

## Reading the answer

The line that matters is `*** track two play() RESOLVED ***` or
`*** track two play() REJECTED ***`. `RESOLVED` alone is not a pass: the
`track two: advancing` lines a few seconds later are what separate "the promise
settled" from "audio is actually moving".

Every line is also appended to `log.txt` in the plugin folder, so it survives a
webview reload and syncs back to the Mac instead of being read off a phone.

## Delete when answered

`rm -rf "$VAULT/.obsidian/plugins/ytfree-lockspike"`, and disable it first if
Obsidian is open.
