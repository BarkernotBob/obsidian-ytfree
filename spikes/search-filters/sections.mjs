#!/usr/bin/env node
/**
 * Third spike: `sort.mjs` showed sort changing the result set but not producing
 * a monotonic order once flattened. The suspicion is that the response is not
 * one list — `sectionListRenderer.contents` holds several `itemSectionRenderer`
 * sections, and only the first is the answer to the query; the rest are
 * "people also watched" / "related to your search" material that no sort or
 * filter applies to.
 *
 * If that is what is happening it matters well beyond sort: `src/search.ts`
 * flattens every section, so those secondary results are already in the hub's
 * search list today, unsorted and unfiltered.
 *
 *   node spikes/search-filters/sections.mjs
 */

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

const varint = (n) => {
  const out = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n >>>= 7;
  }
  out.push(n);
  return out;
};
const key = (num, wire) => varint((num << 3) | wire);
const vfield = (num, value) => [...key(num, 0), ...varint(value)];
const mfield = (num, bytes) => [...key(num, 2), ...varint(bytes.length), ...bytes];
const b64url = (b) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function params({ sort = 0, type = 0, duration = 0, uploadDate = 0 } = {}) {
  const filter = [];
  if (uploadDate) filter.push(...vfield(1, uploadDate));
  if (type) filter.push(...vfield(2, type));
  if (duration) filter.push(...vfield(3, duration));
  const out = [];
  if (sort) out.push(...vfield(1, sort));
  if (filter.length) out.push(...mfield(2, filter));
  return b64url(out);
}

const t = (x) => x?.simpleText ?? x?.runs?.map((r) => r.text).join("") ?? "";

async function raw(query, sp) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ANDROID.ua },
    body: JSON.stringify({
      query,
      ...(sp ? { params: sp } : {}),
      context: { client: { ...ANDROID.ctx, hl: "en", gl: "US" } },
    }),
  });
  return res.json();
}

async function describe(label, sp) {
  const json = await raw("obsidian", sp);
  const sections = json.contents?.sectionListRenderer?.contents ?? [];
  console.log(`\n=== ${label} — ${sections.length} sections ===`);
  sections.forEach((section, i) => {
    const item = section.itemSectionRenderer;
    if (!item) {
      console.log(`  [${i}] ${Object.keys(section)[0]}`);
      return;
    }
    // A secondary section usually announces itself with a header/title.
    const header =
      t(item.header?.itemSectionHeaderRenderer?.title) ||
      t(item.contents?.[0]?.shelfRenderer?.title) ||
      "";
    const videos = (item.contents ?? []).filter((e) => e.compactVideoRenderer);
    const kinds = [...new Set((item.contents ?? []).map((e) => Object.keys(e)[0]))];
    console.log(
      `  [${i}] ${videos.length} videos  header="${header}"  targetId=${item.targetId ?? "—"}  kinds=${kinds.join(",")}`,
    );
    if (videos.length) {
      const rows = videos.map((e) => e.compactVideoRenderer);
      console.log(
        `        ${rows
          .slice(0, 8)
          .map((v) => `${t(v.publishedTimeText) || "—"}/${(t(v.viewCountText).replace(/[^\d]/g, "") || "—")}`)
          .join("  ")}`,
      );
    }
  });
}

await describe("relevance (no params)", null);
await describe("sort=upload date", params({ sort: 2 }));
await describe("sort=view count", params({ sort: 3 }));
await describe("sort=view count + type=video", params({ sort: 3, type: 1 }));
