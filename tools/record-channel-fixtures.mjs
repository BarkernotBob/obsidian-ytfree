// Records raw InnerTube responses for the channel screen (045) and the collab
// catch (GitHub #2). Run on a machine that can reach youtube.com:
//   node tools/record-channel-fixtures.mjs
// Writes to tests/fixtures/raw-channel/ (not committed as-is; trimmed later).
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../tests/fixtures/raw-channel/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const CLIENTS = {
  web: { ctx: { clientName: "WEB", clientVersion: "2.20250101.00.00" },
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
  android: { ctx: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, osName: "Android", osVersion: "14" },
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip" },
};
async function call(endpoint, client, body) {
  const { ctx, ua } = CLIENTS[client];
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ua },
    body: JSON.stringify({ ...body, context: { client: { ...ctx, hl: "en", gl: "US" } } }),
  });
  const text = await res.text();
  return { status: res.status, json: (() => { try { return JSON.parse(text); } catch { return text; } })() };
}
function save(name, r) {
  writeFileSync(new URL(name, OUT), JSON.stringify(r.json, null, 1));
  console.log(name, r.status, JSON.stringify(r.json).length, "bytes");
}
function findAll(o, key, acc = []) {
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) { if (k === key) acc.push(v); findAll(v, key, acc); }
  }
  return acc;
}

const COLLAB = "-X4ZD3fisSs";
save("player-collab.json", await call("player", "android", { videoId: COLLAB, contentCheckOk: true, racyCheckOk: true }));
const next = await call("next", "web", { videoId: COLLAB });
save("next-collab-web.json", next);

// Ward on Words' channel id, via a channel-filtered search ("EgIQAg==" = type: channel).
const s = await call("search", "web", { query: "Ward on Words", params: "EgIQAg==" });
save("search-wardonwords-channels.json", s);
const channelIds = [...new Set(findAll(s.json, "channelId"))].slice(0, 3);
console.log("channel ids from search:", channelIds);
const resolved = await call("navigation/resolve_url", "web", { url: "https://www.youtube.com/@WardonWords" });
save("resolve-wardonwords.json", resolved);
const resolvedId = findAll(resolved.json, "browseId")[0];
const target = resolvedId || channelIds[0];
console.log("using channel", target);

const VIDEOS_TAB = "EgZ2aWRlb3PyBgQKAjoA";
for (const client of ["web", "android"]) {
  const page1 = await call("browse", client, { browseId: target, params: VIDEOS_TAB });
  save(`browse-videos-${client}.json`, page1);
  const tokens = findAll(page1.json, "token").filter((t) => typeof t === "string");
  console.log(client, "continuation tokens:", tokens.length);
  if (tokens.length) save(`browse-videos-${client}-continuation.json`, await call("browse", client, { continuation: tokens[tokens.length - 1] }));
  save(`browse-search-${client}.json`, await call("browse", client, { browseId: target, params: "EgZzZWFyY2jyBgQKAloA", query: "baptism" }));
}
// Does the collab show on the subscribed channel's Videos tab?
import { readFileSync, existsSync } from "node:fs";
for (const f of ["browse-videos-web.json", "browse-videos-web-continuation.json", "browse-videos-android.json", "browse-videos-android-continuation.json"]) {
  const u = new URL(f, OUT);
  if (existsSync(u)) console.log(f, "contains collab:", readFileSync(u, "utf8").includes(COLLAB));
}
