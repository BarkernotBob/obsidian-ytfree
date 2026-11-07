# V1 scope: halfway-point thumbnails

Asked by Isaiah on 2026-11-07: "I'd like my video thumbnails to be from the halfway point …
look into how HackerTube did this."

## How HackerTube does it

HackerTube (Karpathy, 2026) shows "the frame at the 50% point of the video" instead of the
uploaded thumbnail. The extension it inspired, honest-thumbnails, documents the mechanism:
YouTube already stores three stills of every video, at roughly 25%, 50% and 75%, at
`i.ytimg.com/vi/<id>/hq1.jpg`, `hq2.jpg`, `hq3.jpg` (480×360, every video) and
`maxres1–3.jpg` (1280×720, HD videos only). `2` is the halfway frame. No video has to be
loaded or seeked, and it costs no request YouTube's API sees: it is one image per card, the
same as today.

## v1

1. Every hub card (feed, search, channel screen) and the phone Preview's poster shows
   `hq2.jpg` instead of the uploader's thumbnail.
2. If the still is missing (404, or YouTube's 120×90 grey stand-in), the card falls back to the
   thumbnail it showed before. At most one extra image request per card, only on a miss.
3. Shorts keep the uploader's picture: a Short's still is a pillarboxed portrait frame, which
   a 16:9 card would crop to mostly black. A Short is a hub item with `isShort`, or any card
   whose stored thumbnail is a portrait (`oar…`) URL.
4. No setting. It is on for everyone.
5. Stored data is unchanged: the halfway URL is built at draw time from the video ID, so
   turning this off later is a one-line change.

## Not in v1

- `maxres2.jpg` (sharper on a big desktop card). It exists only for HD videos, so trying it
  first would cost a failed request on every non-HD card. GitHub issue filed.
- An on/off setting.
- The desktop note player shows no poster today, so there is nothing to change there.

## Code

`src/thumbnail.ts` (pure helpers plus `showThumbnail`), used by `buildCard` in `src/hub.ts`
and `deferMobileLoad` in `src/main.ts`. Tests: `tests/thumbnail.test.ts`.

## Manual test

1. Open the YT Free hub. Card pictures are now stills from the middle of each video: no big
   faces or text overlays, no black bars above or below.
2. Search for anything. Results show stills too.
3. Find a Short in the hub. It keeps its usual picture.
4. On the iPhone, open a video note. The poster before you tap play is the same middle still.
