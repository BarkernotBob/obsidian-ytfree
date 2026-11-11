# V1 scope: harden the codebase for the store release

**Written:** 2026-11-10, from Isaiah's ask: review the project "to optimize, standardize, cleanup,
simplify, and harden the code to make it ready to ship to obsidian users."

**Status:** review done on main `f7472ea`. Batch 0 merged (PR #85). Batch 1 built 2026-11-10 after
Isaiah's answers (section 3); **manual test passed 2026-11-10** (Isaiah, Mac and phone: "All looks good"). Batches 2–3 are in #86 and #87.

**Ground rule:** no behaviour change without a test or a decision. Nothing here probes YouTube.

## 1. Where the code stands (measured 2026-11-10)

| Check | Result |
|---|---|
| `npm run lint` (Obsidian's rule set) | 0 errors, 105 warnings |
| `npm test` | 830 pass, 0 fail, 63 s |
| `tsc --strict` | 0 errors (was not switched on; Batch 0 switches it on) |
| Unused code (`noUnusedLocals/Parameters`) | 7 (removed in Batch 0) |
| `npm audit --omit=dev` (what ships) | 0 vulnerabilities |
| `npm audit` (dev tools) | 13 (12 moderate, 1 high), all under the `obsidian` typings package's `moment`; nothing ships |
| Bundle | 843 KB; hls.js is 519 KB of it |
| `innerHTML`, `fetch(`, `eval`, `console.log`, `as any`, `@ts-ignore`, TODO/FIXME | 0 of each |
| Child processes | `execFile`/`spawn` with argument arrays only, video id checked against `[\w-]{11}`; no shell |
| Hosted player messages | origin and source window both checked (`e.origin !== PLAYER_ORIGIN`) |
| Store files that fail to parse at load | survivable in every store (`synced-file.ts`, `silence-store.ts`) |

Inference: the code is in better shape than its size suggests. The risks are not sloppy code;
they are (a) things only a second user would hit, (b) three very large files, and (c) docs and
defaults written for one Mac.

## 2. Findings, by priority

### MVP-blocking (a store user hits it, or the scan may)

| # | Finding | Evidence | Fix |
|---|---|---|---|
| H1 | `minAppVersion` was too low. `App.loadLocalStorage` runs in `onload` and is typed `@since 1.8.7`; the manifest said 1.6.6 | `src/synced-file.ts:397`, `node_modules/obsidian/obsidian.d.ts:470` | **Batch 0:** manifest says 1.8.7 |
| H2 | Windows and Linux desktop were never considered. yt-dlp and ffmpeg were only looked for in four Unix paths; the spawned PATH was joined with `:` (corrupts a Windows PATH); downloads default to `~/Movies`; settings and errors say `brew` and "dock" | `src/desktop/resolver.ts:59`, `env.ts:36`, `download.ts:21`, `main.ts:5733` | **Batch 0:** PATH left alone on Windows, bare `yt-dlp`/`ffmpeg` tried last. **Batch 1:** per-OS download folder and wording. Untested on a real Windows machine: I have none |
| H3 | README is written for Isaiah's Mac: install is a `curl … | bash` that installs Homebrew; "Quality" describes the pre-#66 behaviour; it tells users `brew upgrade yt-dlp` (decided against, #80); tests and tooling sit above the privacy section | `README.md` | **Batch 1:** store README: what it is, install from Community plugins, use, privacy/network, optional yt-dlp, limitations. Developer material moves to `docs/DEVELOPING.md` |
| H4 | Defaults tuned for one person ship to everyone. The one with teeth: watched video notes with an empty Notes section are moved to the trash after 30 days, **on by default** | `src/tidy.ts:39`, `main.ts:441` | Decision D1 |
| H5 | Developer commands ship in the palette: "Diagnose the dock badge", "Self-test the dock badge (plays a tone)", "Show YouTube requests this session", and the hand-set `devOfflineHd` | `main.ts:1464`, `1800`, `1806` | **Batch 1:** show them only when *Debug logs* is on |
| H6 | 105 lint warnings. 52 are `prefer-active-doc` and 13 `prefer-window-timers` (pop-out windows), 14 deprecated calls (`setDynamicTooltip`, hls.js `timeout`), 19 `no-nodejs-modules` (all in `src/desktop/`, correct by design). I don't know whether Obsidian's scan fails a release on warnings; the errors it fails on are already 0 | `npm run lint` | **Batch 2:** fix the deprecated calls and timers (mechanical), then decide pop-out support (D3). Keep the 19 desktop ones, with the reason written in `eslint.config.mjs` |
| H7 | User-typed vault folders (`watchLaterFolder`) never pass through `normalizePath`; Obsidian's guidelines ask for it | 0 uses of `normalizePath` in `src/` | **Batch 1** |
| H8 | Settings loaded from `data.json` are merged unchecked: a wrong type from an old build or a hand edit flows straight into the player | `main.ts` `loadSettings` | **Batch 1:** one `sanitizeSettings` with tests (type and range per key, unknown keys dropped) |

### Should do before or just after the store release

| # | Finding | Fix |
|---|---|---|
| H9 | `onload` awaits four store loads, the subscriptions load, the legacy clean-up and the dock badge **before** registering the `ytfree` code block. A slow iCloud read delays every note | **Batch 2:** register processors and commands first, load stores after; measure load time before and after |
| H10 | `main.ts` 6,455 lines, `hub.ts` 4,274, `player.ts` 3,454. One class owns settings UI, commands, pinned players, transcript following, downloads, tidy and the dock badge. Every thread edits these three files, which is why PRs keep conflicting | **Batch 3**, one file move per PR, no logic change: settings tab → `settings-tab.ts`; then commands, downloads, transcript-follow out of `main.ts`. Only while no other PR is open |
| H11 | `styles.css` is 4,068 lines with 35 hard-coded colours and 5 `!important`; 14 inline `style.x =` writes in `player.ts`/`hub.ts` | **Batch 3:** colours to Obsidian variables where a theme should win; leave the player's deliberate blacks |
| H12 | `local_media` writes an absolute device path into a synced note's frontmatter | Backlog issue; not MVP |
| H13 | Release workflow publishes without build provenance; actions pinned by tag | **Batch 2:** `actions/attest-build-provenance`, Dependabot for actions and npm |

### Post-MVP

- hls.js is 62% of the bundle. The light build drops alternate audio, which HD needs, so no easy
  saving. Leave.
- Settings search (`getSettingDefinitions`, Obsidian 1.13+): one lint warning, new API.
- Repo tidy: `issues/` (49 files, 472 KB) and `docs/spikes/` are history; archive under `docs/archive/`.

## 3. Decisions (Isaiah, 2026-11-10)

| # | Question | Answer |
|---|---|---|
| D1 | Auto-trash watched, unwritten video notes after 30 days by default? | **Off for new installs.** Existing installs keep what they had |
| D2 | Other defaults a stranger gets | **Smart Speed off for new installs.** Open YouTube links here, transcript auto-fetch and hourly feed checks stay on |
| D3 | Pop-out windows in the MVP? | **No.** Post-MVP (#87) |
| D4 | yt-dlp, ffmpeg and `setup.sh` | **Hide them.** Nobody is asked to install anything; the settings sit in a folded "Desktop helpers (optional)" section and the instructions live in [DESKTOP-HELPERS](DESKTOP-HELPERS.md). Removing yt-dlp outright is revisited after launch |
| D5 | Settings search (Obsidian 1.13+) | **MVP.** Built in Batch 1 |

### Lint warnings: do they block? (checked 2026-11-10)

No. Obsidian's scanner downgrades almost every rule to an advisory warning; only errors stop a
plugin being installable, and there are none. Six rules stay errors (`no-eval`,
`no-implied-eval`, two `no-unsanitized` rules, `regex-lookbehind`, `no-forbidden-elements`).
The scanner ignores the repo's ESLint config, honours inline disable comments, and lints
everything outside its own exclusion list (which excludes `docs/`, tests, `*.mjs`, `scripts/`).
Sources: [scanner configuration](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md),
[submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin). How warnings
map to the public scorecard is not documented.

Of the 103 warnings on `f7472ea`: 52 `document` uses and 4 timers are real but only in pop-out
windows (#87); 19 Node imports in `src/desktop/` are by design; 13 deprecated Obsidian calls
have no replacement before 1.13 and stay while `minAppVersion` is 1.8.7; the rest are fixed or
harmless.

## 4. Batches

- **Batch 0 (PR #85, merged):** H1; H2's two code fixes; `strict`, `noUnusedLocals`,
  `noUnusedParameters`; 7 unused declarations removed; `package.json` corrected.
- **Batch 1 (built):** D1, D2, D4, D5; H3 store README, `docs/DEVELOPING.md`,
  `docs/DESKTOP-HELPERS.md`; H5 developer commands only with *Debug logs* on; H7
  `normalizePath` on the new-note folder; H8 `sanitizeSettings` (`src/settings.ts`, tested);
  settings tab moved to `src/settings-tab.ts` as data drawn two ways; the once-a-session
  "yt-dlp isn't installed" Notice removed; download folder is Videos on Windows and Linux;
  `spikes/` moved to `docs/spikes/` so the scanner skips it.
- **Batch 2 (#86):** rest of H6, H9, H13; move `tools/*.ts` where the scanner skips them.
- **Batch 3 (#87, after release):** H10, H11, pop-out windows.

## Manual test

Batch 1, on the Mac and the phone, after the next vault build. Your settings must not change.

1. Open **Settings → YT Free**. Expect the same settings as before, grouped under the same
   headings, and a new last section on the Mac: **Desktop helpers (optional)** holding yt-dlp
   path, ffmpeg path and Download folder.
2. Check two values you know: *Tidy empty notes after* still shows 30, and *Compress pauses*
   is as you left it (off in Isaiah's vault on 2026-11-10). New installs start at 0 and off.
3. Move one slider and flip one toggle, close settings, reopen. Expect both to have stuck.
   Put them back.
4. In the settings search box (Obsidian 1.13+), type `lookback`. Expect YT Free's *Lookback*
   row in the results.
5. Under *Subscriptions hub*, press **Show list…** on *Removed from search*, close it. Expect
   the settings page to redraw without errors.
6. Command palette: type `dock`. Expect no "Diagnose the dock badge". Turn on *Log what the
   player is doing*, look again: it is there. Turn the log back off.
7. Play a video on the Mac. Expect no "yt-dlp isn't installed" pop-up on any machine.
8. On the phone: open settings, expect the same rows as before and no Desktop helpers section.
