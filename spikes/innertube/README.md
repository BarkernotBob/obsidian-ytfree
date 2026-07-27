# Spike — InnerTube resolver

Not throwaway, unlike `../mobile-iframe`. Keep this: it is the standing check on the one
assumption [issue 004](../../issues/004-mobile-viewer.md) and
[issue 005](../../issues/005-mobile-full-quality.md) are both built on, and that assumption
is YouTube's to revoke at any time.

```bash
node spikes/innertube/probe.mjs
```

Exits non-zero if anything regressed. Run it **before** touching mobile code, and again
whenever mobile playback breaks in the field — it separates "YouTube changed" from "we broke
it", which is otherwise an afternoon of guessing.

## What it asserts, per video

| Check | Why it matters |
|---|---|
| `playabilityStatus === "OK"` | The client context is still accepted without login |
| zero `signatureCipher` formats | No `base.js` eval — the thing that made this cheap |
| itag 18 present with a plain `url` | The 360p muxed v1 path exists |
| that URL returns `206`/`200` for a range request | No PO-token attestation is being demanded yet |

It also reports `maxAdaptive` (the ceiling issue 005 is reaching for) and `iosHls` (which was
1/10 on 2026-07-27 — recorded so a future run can tell whether HLS is coming back or going
further away).

## Baseline

**2026-07-27 — 10/10 PASS.** Max adaptive 2160p on three of the ten, iOS HLS on one.
