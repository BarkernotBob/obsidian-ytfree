#!/usr/bin/env node
/**
 * Fourth spike: with `sort=view count`, the main item section comes back mostly
 * descending but with a small cluster of low-view, very recent videos wedged
 * into it. Same cluster shows up under `sort=upload date`. That looks like an
 * injection — YouTube putting fresh videos in front of you regardless of what
 * you asked for — and it is the same class of thing as the shelves the parser
 * already refuses.
 *
 * The question this answers: is an injected entry *distinguishable* from a real
 * result by any field on the renderer? If yes, sort can ship clean. If no, sort
 * either ships approximate or does not ship.
 *
 *   node spikes/search-filters/injected.mjs
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
const params = ({ sort = 0, type = 0 }) => {
  const filter = type ? vfield(2, type) : [];
  const out = [];
  if (sort) out.push(...vfield(1, sort));
  if (filter.length) out.push(...mfield(2, filter));
  return b64url(out);
};

const t = (x) => x?.simpleText ?? x?.runs?.map((r) => r.text).join("") ?? "";

const res = await fetch("https://www.youtube.com/youtubei/v1/search", {
  method: "POST",
  headers: { "Content-Type": "application/json", "User-Agent": ANDROID.ua },
  body: JSON.stringify({
    query: "obsidian",
    params: params({ sort: 3, type: 1 }),
    context: { client: { ...ANDROID.ctx, hl: "en", gl: "US" } },
  }),
});
const json = await res.json();

const sections = json.contents?.sectionListRenderer?.contents ?? [];
const videos = [];
sections.forEach((section, si) => {
  (section.itemSectionRenderer?.contents ?? []).forEach((entry, ei) => {
    if (entry.compactVideoRenderer) videos.push({ si, ei, v: entry.compactVideoRenderer });
  });
});

// Anything that breaks the descending run is a suspect.
let previous = Infinity;
const rows = videos.map(({ si, ei, v }) => {
  const views = Number(t(v.viewCountText).replace(/[^\d]/g, "")) || 0;
  const outOfOrder = views > previous;
  if (!outOfOrder) previous = views;
  return { si, ei, v, views, outOfOrder, age: t(v.publishedTimeText) };
});

// A low-view entry sitting among millions is the injected one; flag by a gap
// rather than by strict monotonicity, which the first entry can never break.
const median = [...rows].map((r) => r.views).sort((a, b) => b - a)[Math.floor(rows.length / 2)];
console.log(`median views = ${median}\n`);

for (const row of rows) {
  const suspect = row.views < median / 100;
  console.log(
    `${suspect ? "SUSPECT" : "       "} [${row.si}.${row.ei}] ${String(row.views).padStart(10)}  ${row.age.padEnd(18)}  ${t(row.v.title).slice(0, 40)}`,
  );
}

console.log("\n--- field key comparison ---");
const suspects = rows.filter((r) => r.views < median / 100);
const normals = rows.filter((r) => r.views >= median / 100);
const keysOf = (set) => {
  const counts = new Map();
  for (const r of set) for (const k of Object.keys(r.v)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return counts;
};
const sKeys = keysOf(suspects);
const nKeys = keysOf(normals);
const all = [...new Set([...sKeys.keys(), ...nKeys.keys()])].sort();
for (const k of all) {
  const s = sKeys.get(k) ?? 0;
  const n = nKeys.get(k) ?? 0;
  const marker = (s === suspects.length && n === 0) || (n === normals.length && s === 0) ? "  <== DISCRIMINATES" : "";
  console.log(`  ${k.padEnd(40)} suspects ${s}/${suspects.length}   normals ${n}/${normals.length}${marker}`);
}

// Badges are the most likely carrier ("New", "Recently uploaded").
console.log("\n--- badges ---");
for (const r of rows.slice(0, 24)) {
  const badges = (r.v.badges ?? []).map((b) => t(b.metadataBadgeRenderer?.label) || Object.keys(b)[0]);
  const owner = (r.v.ownerBadges ?? []).map((b) => Object.keys(b)[0]);
  if (badges.length || owner.length) {
    console.log(`  [${r.si}.${r.ei}] views=${r.views} badges=${badges.join(",")} owner=${owner.join(",")}`);
  }
}
