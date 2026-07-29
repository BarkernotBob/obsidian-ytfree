#!/usr/bin/env node
/**
 * Follow-up spike: `probe.mjs` showed the filter fields working on ANDROID and
 * the *sort* field apparently ignored. Two candidate explanations, and they
 * lead to different features:
 *
 *   a) our encoding of the sort field is wrong  → fixable, sort ships
 *   b) the ANDROID client ignores sort_by       → sort cannot ship on this
 *      client, and the honest answer is not to offer it
 *
 * So this sends the *same* params to ANDROID and to WEB and compares. WEB is
 * the client youtube.com itself uses, where `&sp=CAI%3D` is known to sort by
 * upload date; if WEB sorts and ANDROID does not, the encoding is right and (b)
 * is the answer.
 *
 *   node spikes/search-filters/sort.mjs
 */

const CLIENTS = {
  android: {
    ctx: {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      androidSdkVersion: 34,
      osName: "Android",
      osVersion: "14",
    },
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip",
    // ANDROID answers with the compact renderers.
    renderer: "compactVideoRenderer",
  },
  web: {
    ctx: { clientName: "WEB", clientVersion: "2.20250101.00.00" },
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
    renderer: "videoRenderer",
  },
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
const b64url = (bytes) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** sort first, then the nested filter message. */
function params({ sort = 0, uploadDate = 0, type = 0, duration = 0 } = {}) {
  const filter = [];
  if (uploadDate) filter.push(...vfield(1, uploadDate));
  if (type) filter.push(...vfield(2, type));
  if (duration) filter.push(...vfield(3, duration));
  const out = [];
  if (sort) out.push(...vfield(1, sort));
  if (filter.length) out.push(...mfield(2, filter));
  return b64url(out);
}

/** The other field order, in case the top-level message is the other way round. */
function paramsFilterFirst({ sort = 0, type = 0 } = {}) {
  const filter = type ? vfield(2, type) : [];
  const out = [];
  if (filter.length) out.push(...mfield(2, filter));
  if (sort) out.push(...vfield(1, sort));
  return b64url(out);
}

async function search(client, query, sp) {
  const { ctx, ua, renderer } = CLIENTS[client];
  const res = await fetch("https://www.youtube.com/youtubei/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ua },
    body: JSON.stringify({
      query,
      ...(sp ? { params: sp } : {}),
      context: { client: { ...ctx, hl: "en", gl: "US" } },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const sections =
    json.contents?.sectionListRenderer?.contents ??
    json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ??
    [];
  const rows = [];
  for (const section of sections) {
    for (const entry of section.itemSectionRenderer?.contents ?? []) {
      const v = entry[renderer];
      if (!v) continue;
      const t = (x) => x?.simpleText ?? x?.runs?.map((r) => r.text).join("") ?? "";
      rows.push({
        id: v.videoId,
        title: t(v.title).slice(0, 40),
        age: t(v.publishedTimeText),
        views: t(v.viewCountText) || t(v.shortViewCountText),
      });
    }
  }
  return rows;
}

const Q = "obsidian";
const show = (rows) =>
  rows.slice(0, 6).map((r) => `${r.age || "—"} (${r.views || "—"})`).join("  |  ");

for (const client of ["android", "web"]) {
  console.log(`\n=== ${client.toUpperCase()} ===`);
  const base = await search(client, Q, null);
  console.log(`relevance      ${base.length} rows: ${show(base)}`);

  const byDate = await search(client, Q, params({ sort: 2 }));
  console.log(`sort=date CAI  ${byDate.length} rows: ${show(byDate)}`);

  const byViews = await search(client, Q, params({ sort: 3 }));
  console.log(`sort=views CAM ${byViews.length} rows: ${show(byViews)}`);

  const dateTyped = await search(client, Q, params({ sort: 2, type: 1 }));
  console.log(`sort=date+video ${dateTyped.length} rows: ${show(dateTyped)}`);

  const other = await search(client, Q, paramsFilterFirst({ sort: 2, type: 1 }));
  console.log(`filter-first    ${other.length} rows: ${show(other)}`);

  // The decisive comparison: if sorting changed nothing, the top IDs are the
  // same list in the same order as relevance.
  const same = (a, b) => a.slice(0, 8).map((r) => r.id).join() === b.slice(0, 8).map((r) => r.id).join();
  console.log(`identical to relevance?  date=${same(base, byDate)}  views=${same(base, byViews)}`);
}
