#!/usr/bin/env node
/**
 * Record InnerTube *search* responses as test fixtures.
 *
 *   node spikes/search/record.mjs
 *
 * Same reasoning as `spikes/innertube/record.mjs`: the only thing that can
 * really break `src/search.ts` is YouTube changing the shape of the renderer
 * tree, and a fixture I wrote myself can only ever confirm my own idea of the
 * shape. So these are real captures.
 *
 * The raw response is 1.4 MB of tracking params, so it is trimmed before it
 * lands — but trimmed *structurally*: every entry of every section survives,
 * with the fields the parser reads kept verbatim and the payloads it never
 * looks at replaced by an empty object. That keeps the fixture a legible
 * diff while still containing the things the parser has to refuse: the ad and
 * channel `elementRenderer`s, the `horizontalCardListRenderer` shelves and
 * their `videoCardRenderer` videos, and `compactPlaylistRenderer`.
 *
 * Nothing here is signed or IP-bound — a search response carries no stream
 * URLs — so there is nothing to redact.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ANDROID = {
  ctx: {
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    androidSdkVersion: 34,
    osName: "Android",
    osVersion: "14",
  },
  ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip",
};

const OUT_DIR = join(process.cwd(), "tests", "fixtures");
const QUERY = "smarter every day";

async function callSearch(body) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ANDROID.ua },
    body: JSON.stringify({ ...body, context: { client: { ...ANDROID.ctx, hl: "en", gl: "US" } } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The fields `parseSearchResponse` reads, and nothing else. */
function trimVideo(video) {
  const byline = video.longBylineText?.runs?.[0];
  return {
    videoId: video.videoId,
    title: { runs: [{ text: video.title?.runs?.[0]?.text ?? video.title?.simpleText }] },
    longBylineText: {
      runs: [
        {
          text: byline?.text,
          navigationEndpoint: {
            browseEndpoint: {
              browseId: byline?.navigationEndpoint?.browseEndpoint?.browseId,
            },
          },
        },
      ],
    },
    publishedTimeText: video.publishedTimeText,
    viewCountText: video.viewCountText,
    shortViewCountText: video.shortViewCountText,
    lengthText: video.lengthText,
    thumbnail: video.thumbnail,
  };
}

/** One entry of an `itemSectionRenderer`, kept by kind. */
function trimEntry(entry) {
  const kind = Object.keys(entry)[0];
  if (kind === "compactVideoRenderer") {
    return { compactVideoRenderer: trimVideo(entry.compactVideoRenderer) };
  }
  if (kind === "horizontalCardListRenderer") {
    // A recommendation shelf. Its cards are kept — with their video IDs — so a
    // test can assert that none of them reach the results.
    return {
      horizontalCardListRenderer: {
        cards: (entry.horizontalCardListRenderer.cards ?? []).map((card) =>
          card.videoCardRenderer
            ? { videoCardRenderer: { videoId: card.videoCardRenderer.videoId } }
            : { [Object.keys(card)[0]]: {} },
        ),
      },
    };
  }
  if (kind === "elementRenderer") {
    // Ads and channel cards both arrive as this. The template URI is the only
    // part worth keeping: it says which one you are looking at.
    return {
      elementRenderer: {
        newElement: {
          type: {
            componentType: {
              templateConfig: {
                uriTemplateConfig: {
                  uri: entry.elementRenderer?.newElement?.type?.componentType?.templateConfig
                    ?.uriTemplateConfig?.uri,
                },
              },
            },
          },
        },
      },
    };
  }
  return { [kind]: {} };
}

function trimSections(sections) {
  return (sections ?? []).map((section) => {
    const items = section.itemSectionRenderer?.contents;
    if (!items) return { [Object.keys(section)[0]]: {} };
    return { itemSectionRenderer: { contents: items.map(trimEntry) } };
  });
}

function trimContinuations(continuations) {
  const token = continuations?.[0]?.nextContinuationData?.continuation;
  return token ? [{ nextContinuationData: { continuation: token } }] : undefined;
}

async function record(file, response, root) {
  await writeFile(join(OUT_DIR, file), JSON.stringify(response, null, 2) + "\n");
  const videos = JSON.stringify(response).split('"compactVideoRenderer"').length - 1;
  console.log(`${file}  ${videos} videos  continuation=${Boolean(root.continuations)}`);
}

await mkdir(OUT_DIR, { recursive: true });

// Page one.
const first = await callSearch({ query: QUERY });
const firstRoot = first.contents?.sectionListRenderer ?? {};
await record(
  "search-android.json",
  {
    contents: {
      sectionListRenderer: {
        contents: trimSections(firstRoot.contents),
        ...(trimContinuations(firstRoot.continuations)
          ? { continuations: trimContinuations(firstRoot.continuations) }
          : {}),
      },
    },
  },
  firstRoot,
);

// Page two. A continuation answers in a different envelope
// (`continuationContents.sectionListContinuation`), which is the only reason
// this second fixture exists.
const token = firstRoot.continuations?.[0]?.nextContinuationData?.continuation;
if (!token) {
  console.error("No continuation token in page one — paging fixture not written.");
  process.exitCode = 1;
} else {
  const next = await callSearch({ continuation: token });
  const nextRoot = next.continuationContents?.sectionListContinuation ?? {};
  await record(
    "search-android-continuation.json",
    {
      continuationContents: {
        sectionListContinuation: {
          contents: trimSections(nextRoot.contents),
          ...(trimContinuations(nextRoot.continuations)
            ? { continuations: trimContinuations(nextRoot.continuations) }
            : {}),
        },
      },
    },
    nextRoot,
  );
}
