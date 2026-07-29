#!/usr/bin/env node
/**
 * Spike: do YouTube's own search filters work on the ANDROID InnerTube client,
 * driven by a `params` protobuf we encode ourselves?
 *
 * The filter panel on youtube.com is not a set of query arguments. It is one
 * opaque `params` string, and that string is a base64url protobuf. If we can
 * encode it, the hub gets YouTube's filters for free; if we cannot, filtering
 * has to happen client-side over one page of results, which is a different and
 * much worse feature.
 *
 * This asserts on the *content* of the answers, not on HTTP 200 — a wrong
 * params string is ignored rather than rejected, so "it returned results" is
 * exactly the failure mode to guard against.
 *
 *   node spikes/search-filters/probe.mjs
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

// ------------------------------------------------------------------ protobuf

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

const FEATURE_FIELD = { hd: 4, subtitles: 5, creativeCommons: 6, live: 8, fourK: 14 };

function encodeParams({ sort = 0, uploadDate = 0, type = 0, duration = 0, features = {} } = {}) {
  const filter = [];
  if (uploadDate) filter.push(...vfield(1, uploadDate));
  if (type) filter.push(...vfield(2, type));
  if (duration) filter.push(...vfield(3, duration));
  for (const [name, on] of Object.entries(features)) {
    if (on) filter.push(...vfield(FEATURE_FIELD[name], 1));
  }
  const out = [];
  if (sort) out.push(...vfield(1, sort));
  if (filter.length) out.push(...mfield(2, filter));
  return b64url(out);
}

// -------------------------------------------------------------------- request

async function search(query, params) {
  const body = { query, ...(params ? { params } : {}) };
  const res = await fetch("https://www.youtube.com/youtubei/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ANDROID.ua },
    body: JSON.stringify({ ...body, context: { client: { ...ANDROID.ctx, hl: "en", gl: "US" } } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const sections = json.contents?.sectionListRenderer?.contents ?? [];
  const results = [];
  const kinds = new Set();
  for (const section of sections) {
    for (const entry of section.itemSectionRenderer?.contents ?? []) {
      kinds.add(Object.keys(entry)[0]);
      const v = entry.compactVideoRenderer;
      if (!v) continue;
      results.push({
        id: v.videoId,
        title: (v.title?.runs?.[0]?.text ?? v.title?.simpleText ?? "").slice(0, 44),
        length: v.lengthText?.simpleText ?? v.lengthText?.runs?.[0]?.text ?? "",
        age: v.publishedTimeText?.simpleText ?? v.publishedTimeText?.runs?.[0]?.text ?? "",
        views: Number((v.viewCountText?.simpleText ?? "").replace(/[^\d]/g, "")) || null,
      });
    }
  }
  return { results, kinds: [...kinds] };
}

const secs = (t) => {
  const p = t.split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : NaN;
};

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}
const sample = (rows, pick) => rows.slice(0, 5).map(pick).join(" | ");

const Q = "obsidian";

// 0. Baseline: no params at all, so the assertions below have something to be
//    different from.
const base = await search(Q, null);
console.log(`\nbaseline: ${base.results.length} videos; entry kinds: ${base.kinds.join(", ")}`);
console.log(`  lengths: ${sample(base.results, (r) => r.length)}`);
check("baseline returns videos", base.results.length > 0);

// 1. Duration — over 20 minutes. The clearest possible signal: every result
//    carries its own length, so the filter is either applied or it is not.
const long = await search(Q, encodeParams({ duration: 2 }));
console.log(`\nduration>20m (params=${encodeParams({ duration: 2 })}): ${long.results.length} videos`);
console.log(`  lengths: ${sample(long.results, (r) => r.length)}`);
check(
  "duration=long returns only videos over 20 minutes",
  long.results.length > 0 && long.results.every((r) => secs(r.length) > 1200),
  long.results.filter((r) => !(secs(r.length) > 1200)).map((r) => r.length).join(",") || "all long",
);

// 2. Duration — under 4 minutes.
const short = await search(Q, encodeParams({ duration: 1 }));
console.log(`\nduration<4m: ${short.results.length} videos`);
console.log(`  lengths: ${sample(short.results, (r) => r.length)}`);
check(
  "duration=short returns only videos under 4 minutes",
  short.results.length > 0 && short.results.every((r) => secs(r.length) < 240),
  short.results.filter((r) => !(secs(r.length) < 240)).map((r) => r.length).join(",") || "all short",
);

// 3. Upload date — this week.
const week = await search(Q, encodeParams({ uploadDate: 3 }));
console.log(`\nuploaded this week: ${week.results.length} videos`);
console.log(`  ages: ${sample(week.results, (r) => r.age)}`);
check(
  "uploadDate=week returns nothing older than a week",
  week.results.length > 0 &&
    week.results.every((r) => /second|minute|hour|day|week/.test(r.age) && !/month|year/.test(r.age)),
  week.results.filter((r) => /month|year/.test(r.age)).map((r) => r.age).join(",") || "all recent",
);

// 4. Sort by upload date. Not a content assertion — "newest first" is only
//    checkable against the same relative strings — so this checks the ordering
//    of the ages it does return, coarsely.
const newest = await search(Q, encodeParams({ sort: 2 }));
console.log(`\nsort=upload date: ${newest.results.length} videos`);
console.log(`  ages: ${sample(newest.results, (r) => r.age)}`);
check(
  "sort=upload date puts fresh videos at the top",
  newest.results.length > 0 &&
    /second|minute|hour|day/.test(newest.results[0]?.age ?? "") &&
    !/month|year/.test(newest.results.slice(0, 3).map((r) => r.age).join(" ")),
  newest.results.slice(0, 3).map((r) => r.age).join(","),
);

// 5. Sort by view count.
const popular = await search(Q, encodeParams({ sort: 3 }));
console.log(`\nsort=view count: ${popular.results.length} videos`);
console.log(`  views: ${sample(popular.results, (r) => r.views)}`);
const views = popular.results.map((r) => r.views).filter((v) => typeof v === "number");
check(
  "sort=view count is descending",
  views.length > 2 && views.every((v, i) => i === 0 || views[i - 1] >= v),
  views.slice(0, 5).join(","),
);

// 6. Type=video. The parser only understands videos, so this is the default the
//    hub should always send: it is what removes channel and playlist entries
//    from the response instead of from our reading of it.
const onlyVideos = await search(Q, encodeParams({ type: 1 }));
console.log(`\ntype=video: ${onlyVideos.results.length} videos; kinds: ${onlyVideos.kinds.join(", ")}`);
check(
  "type=video drops the channel/playlist renderers from the response",
  onlyVideos.results.length > 0 &&
    !onlyVideos.kinds.includes("compactPlaylistRenderer") &&
    !onlyVideos.kinds.includes("compactChannelRenderer"),
  onlyVideos.kinds.join(","),
);

// 7. Two filters at once — the combination is the thing that actually proves
//    the nested message is encoded correctly rather than accidentally matching.
const combo = encodeParams({ sort: 3, duration: 2, uploadDate: 5, type: 1 });
const both = await search(Q, combo);
console.log(`\ncombo (params=${combo}): ${both.results.length} videos`);
console.log(`  lengths: ${sample(both.results, (r) => r.length)}`);
console.log(`  ages: ${sample(both.results, (r) => r.age)}`);
check(
  "combined filters all apply at once",
  both.results.length > 0 &&
    both.results.every((r) => secs(r.length) > 1200) &&
    both.results.every((r) => !/year/.test(r.age)),
  both.results.filter((r) => !(secs(r.length) > 1200) || /year/.test(r.age)).length + " violations",
);

// 8. Live. A feature bool rather than a filter enum, so it exercises the other
//    half of the filter message.
const live = await search("news", encodeParams({ features: { live: true }, type: 1 }));
console.log(`\nlive: ${live.results.length} videos`);
console.log(`  lengths: ${sample(live.results, (r) => r.length || "(none)")}`);
console.log(`  ages: ${sample(live.results, (r) => r.age || "(none)")}`);
check(
  "features.live returns entries with no duration (a stream is not a length)",
  live.results.length > 0 && live.results.filter((r) => !r.length).length > live.results.length / 2,
  `${live.results.filter((r) => !r.length).length}/${live.results.length} without duration`,
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
