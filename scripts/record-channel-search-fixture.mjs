// Records the one fixture behind the Add channel sheet's channel search
// (GitHub #108): a WEB search with the type pinned to channel.
//
//   node scripts/record-channel-search-fixture.mjs              # one live request
//   node scripts/record-channel-search-fixture.mjs --from raw.json   # trim a saved response
//
// One request, once a day per machine (GitHub #39). The 2026-11-13 recording
// went to youtubei.googleapis.com (YTFREE_INNERTUBE_HOST), the same InnerTube
// API the plugin reaches at www.youtube.com, from a network that could not
// reach youtube.com itself.
//
// The response is trimmed structurally: every channelRenderer survives with
// the fields `src/channel-search.ts` reads, and nothing else. A search
// response carries no signed or IP-bound URLs, so there is nothing to redact.
import { readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("../tests/fixtures/channel-search-results-web.json", import.meta.url);
const QUERY = "smarter every day";
const CHANNEL_PARAMS = "EgIQAg"; // type = channel; youtube.com's &sp=EgIQAg%3D%3D

const WEB = {
  ctx: { clientName: "WEB", clientVersion: "2.20250101.00.00" },
  ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/131.0.0.0 Safari/537.36",
};

async function live() {
  const { liveGuard } = await import("./live-budget.mjs");
  liveGuard("record-channel-search-fixture");
  const host = process.env.YTFREE_INNERTUBE_HOST || "www.youtube.com";
  const res = await fetch(`https://${host}/youtubei/v1/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": WEB.ua },
    body: JSON.stringify({
      query: QUERY,
      params: CHANNEL_PARAMS,
      context: { client: { ...WEB.ctx, hl: "en", gl: "US" } },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const keepText = (value) => (value ? { ...("simpleText" in value ? { simpleText: value.simpleText } : { runs: value.runs?.map((r) => ({ text: r.text })) }) } : undefined);

function trimChannel(c) {
  return {
    channelId: c.channelId,
    title: keepText(c.title),
    navigationEndpoint: {
      browseEndpoint: {
        browseId: c.navigationEndpoint?.browseEndpoint?.browseId,
        canonicalBaseUrl: c.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl,
      },
    },
    thumbnail: { thumbnails: c.thumbnail?.thumbnails },
    ...(c.videoCountText ? { videoCountText: keepText(c.videoCountText) } : {}),
    ...(c.subscriberCountText ? { subscriberCountText: keepText(c.subscriberCountText) } : {}),
  };
}

function trim(response) {
  const list = response.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer;
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: (list?.contents ?? []).map((section) => {
              const items = section.itemSectionRenderer?.contents;
              if (!items) return { [Object.keys(section)[0]]: {} };
              return {
                itemSectionRenderer: {
                  contents: items.map((entry) =>
                    entry.channelRenderer
                      ? { channelRenderer: trimChannel(entry.channelRenderer) }
                      : { [Object.keys(entry)[0]]: {} },
                  ),
                },
              };
            }),
          },
        },
      },
    },
  };
}

const from = process.argv.indexOf("--from");
const raw = from > 0 ? JSON.parse(readFileSync(process.argv[from + 1], "utf8")) : await live();
const trimmed = trim(raw);
writeFileSync(OUT, JSON.stringify(trimmed, null, 2) + "\n");
console.log(`wrote ${OUT.pathname}: ${JSON.stringify(trimmed).split('"channelRenderer"').length - 1} channels`);
