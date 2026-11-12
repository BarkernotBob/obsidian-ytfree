# Developing YT Free

## Build and install from source

```bash
npm ci --legacy-peer-deps
echo "/path/to/your/vault" > .vault   # once per machine; gitignored
./install.sh                           # runs the checks, builds, copies into the vault
```

Then in Obsidian: Settings → Community plugins → reload → enable **YT Free**.

## Checks

```bash
npm run lint     # Obsidian's own rule set; CI fails on errors
npm test         # unit tests, no network
npm run check    # tests, type check and production build
```

## Tests

```bash
npm test
```

Unit tests — URL parsing, expiry parsing, cache expiry. Fast, no network.

```bash
npm run smoke
```

A live canary against YouTube: one yt-dlp resolve and one byte read, about 5 requests.
**Run this when playback breaks**: it tells you whether YouTube changed extraction. It runs at most once per 24 hours per machine
(`npm run smoke -- --force` overrides), because bursts of live requests got a home network
bot-flagged once. The old full live suite is parked as `npm run smoke:full`.

## Releasing

On a clean main: `npm version X.Y.Z && git push --follow-tags`. See [HANDOFF.md](../HANDOFF.md).

**No-ads check (GitHub #91).** Before a release that touches YouTube's player (the hosted
page, `src/youtube-player.ts`, `src/mobile/youtube-embed.ts`), run the
[device test](RESEARCH-EMBED-ADS.md#device-test): iPhone Safari baseline first, then 10
Obsidian runs on the iPhone, then read `youtube-player-log.txt`. Any `ad seen` line means
YouTube now serves ads inside Obsidian. Run it once on desktop Obsidian too, when the desktop
YouTube player exists. Never add anything that hides, skips or blocks ads.

## Hosted player page

GitHub Pages serves the YouTube player page from the **`gh-pages` branch**
(`player/index.html`), not from main's `docs/`. `docs/player/index.html` is the source. After
changing it, copy it over:

```sh
git fetch origin gh-pages && git worktree add /tmp/gh-pages origin/gh-pages
cp docs/player/index.html /tmp/gh-pages/player/index.html
cd /tmp/gh-pages && git commit -am "Player page: <what changed> (from main docs/player)" \
  && git push origin HEAD:gh-pages && cd - && git worktree remove /tmp/gh-pages
```

`npm run check` (so CI) fails while the gh-pages copy matches neither your branch's
`docs/player/index.html` nor main's (`scripts/check-pages.mjs`). Offline on the Mac it warns
and passes.

## Where things are

- `src/settings.ts`, `src/settings-tab.ts`: settings, their defaults, the load-time check, the tab.
- `src/desktop/`: the only code that may import Node. Reached through `await import()` on desktop.
- `docs/V1-SCOPE-*.md`: one scope per feature, each ending in its manual test.
- `docs/spikes/`: throwaway experiments kept for reference.
