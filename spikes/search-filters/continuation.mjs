#!/usr/bin/env node
/**
 * Fifth spike, and the one the "More results" button depends on: does a
 * continuation token carry the filters of the search that produced it?
 *
 * If it does, page two needs the token and nothing else. If it does not, the
 * second page of a "over 20 minutes" search is unfiltered — which would look
 * exactly like a bug and would have to be fixed by re-sending `params` with the
 * token, or by filtering page two ourselves.
 *
 *   node spikes/search-filters/continuation.mjs
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

// Over 20 minutes, videos only — the filter whose violations are unmissable.
const PARAMS = b64url([...mfield(2, [...vfield(2, 1), ...vfield(3, 2)])]);

const t = (x) => x?.simpleText ?? x?.runs?.map((r) => r.text).join("") ?? "";
const secs = (s) => {
  const p = s.split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : NaN;
};

async function call(body) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ANDROID.ua },
    body: JSON.stringify({ ...body, context: { client: { ...ANDROID.ctx, hl: "en", gl: "US" } } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const root =
    json.contents?.sectionListRenderer ?? json.continuationContents?.sectionListContinuation ?? {};
  const lengths = [];
  for (const section of root.contents ?? []) {
    for (const entry of section.itemSectionRenderer?.contents ?? []) {
      if (entry.compactVideoRenderer) lengths.push(t(entry.compactVideoRenderer.lengthText));
    }
  }
  return { lengths, token: root.continuations?.[0]?.nextContinuationData?.continuation ?? null };
}

const report = (label, lengths) => {
  const bad = lengths.filter((l) => !(secs(l) > 1200));
  console.log(
    `${bad.length === 0 ? "PASS" : "FAIL"}  ${label}: ${lengths.length} videos, ${bad.length} under 20 min` +
      `${bad.length ? `  → ${bad.join(", ")}` : ""}`,
  );
  console.log(`      ${lengths.slice(0, 8).join("  ")}`);
  return bad.length === 0;
};

console.log(`params = ${PARAMS}  (type=video, duration>20min)\n`);

const page1 = await call({ query: "obsidian", params: PARAMS });
let ok = report("page 1", page1.lengths);

if (!page1.token) {
  console.log("\nNo continuation token on page one — cannot test paging.");
  process.exitCode = 1;
} else {
  // Token alone, the way `searchYouTube` sends it today.
  const page2 = await call({ continuation: page1.token });
  ok = report("page 2 — token only", page2.lengths) && ok;

  // And with the params re-sent, to see whether it makes any difference.
  const page2b = await call({ continuation: page1.token, params: PARAMS });
  ok = report("page 2 — token + params", page2b.lengths) && ok;

  console.log(`\n${ok ? "Filters survive paging." : "Filters do NOT survive paging."}`);
  process.exitCode = ok ? 0 : 1;
}
