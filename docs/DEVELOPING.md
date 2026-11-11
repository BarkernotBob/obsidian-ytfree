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

## Where things are

- `src/settings.ts`, `src/settings-tab.ts`: settings, their defaults, the load-time check, the tab.
- `src/desktop/`: the only code that may import Node. Reached through `await import()` on desktop.
- `docs/V1-SCOPE-*.md`: one scope per feature, each ending in its manual test.
- `docs/spikes/`: throwaway experiments kept for reference.
