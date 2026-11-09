/**
 * Feed torture test (GitHub #66): how hard can YT Free hit YouTube's RSS
 * feeds before anything refuses, and does a feed burst make the next video
 * lookup get bot-checked? Isaiah, 2026-11-09: "planning around the real world,
 * not a phantom."
 *
 *   node tools/feed-torture.ts --state "<vault>/.obsidian/plugins/ytfree/subscriptions.json"
 *   node tools/feed-torture.ts --channels ids.txt        (one channel ID per line)
 *   node tools/feed-torture.ts --gather 300              (a big import, see below)
 *
 * `--gather N` stands in for a Takeout import of N channels: yt-dlp searches a
 * spread of everyday topics (flat, no video pages; about 1 request per 20
 * results) until it has N distinct channel IDs, saves them to
 * ~/.cache/ytfree/torture-channels-N.txt, and reuses that file next time.
 *
 * LIVE and deliberately heavy: run it only from a network you are willing to
 * see flagged for a few hours (Isaiah chose where). Once a day per machine
 * (`--force` overrides). Writes every request, with its time, status and
 * latency, to ~/.cache/ytfree/feed-torture-<time>.json and prints a summary.
 *
 * Scenarios, in order, with a 2-minute rest between them:
 *   1. today       every channel, 5 at a time (what an hourly poll does now)
 *   2. at-once     every channel at the same moment
 *   3. import      every channel at once, three times back to back
 *   4. sustained   every channel at once, every 5 minutes, for 30 minutes
 *   5. hammer      one channel's feed 100 times, 20 at a time
 * After each, one video lookup (the ANDROID player call Play makes) shows
 * whether video playback is now refused. A bot check there stops the run at
 * once: that is the answer, and more requests would only deepen the flag.
 * A scenario also stops early if more than half of its last 20 feeds failed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { liveGuard } from "./live-budget.mjs";
import { CLIENTS, PLAYER_URL, playerBody } from "../src/innertube-context.ts";
import { feedUrl } from "../src/subscriptions.ts";
import { isBotCheckPlayability } from "../src/bot-check.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const TOPICS = [
  "cooking", "woodworking", "guitar lesson", "chess", "history documentary", "physics", "gardening",
  "car review", "travel vlog", "piano", "drawing tutorial", "math", "fitness", "home repair", "bikes",
  "photography", "astronomy", "baking", "language learning", "board games", "fishing", "camping",
  "electronics", "knitting", "coffee", "podcast", "news analysis", "philosophy", "birds", "running",
];

function gather(n: number, budget: { ytDlp: () => void }): string[] {
  const dir = join(homedir(), ".cache", "ytfree");
  const file = join(dir, `torture-channels-${n}.txt`);
  if (existsSync(file)) {
    const kept = readFileSync(file, "utf8").split(/\s+/).filter((l) => /^UC[\w-]{22}$/.test(l));
    if (kept.length >= n) return kept.slice(0, n);
  }
  const bin = ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp"].find((p) => existsSync(p)) ?? "yt-dlp";
  const ids = new Set<string>();
  for (const topic of TOPICS) {
    if (ids.size >= n) break;
    budget.ytDlp();
    const out = execFileSync(
      bin,
      ["--flat-playlist", "--no-warnings", "--print", "%(channel_id)s", `ytsearch40:${topic}`],
      { encoding: "utf8", maxBuffer: 8 << 20 },
    );
    for (const id of out.split(/\s+/)) if (/^UC[\w-]{22}$/.test(id)) ids.add(id);
    console.log(`  gathered ${ids.size} channels (${topic})`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, [...ids].join("\n") + "\n");
  return [...ids].slice(0, n);
}

function loadChannels(budget: { ytDlp: () => void }): string[] {
  const want = Number(flag("--gather"));
  if (want > 0) return gather(want, budget);
  const state = flag("--state");
  if (state) {
    const parsed = JSON.parse(readFileSync(state, "utf8")) as { channels?: Array<{ id?: string }> };
    return (parsed.channels ?? []).map((c) => c.id).filter((id): id is string => !!id);
  }
  const list = flag("--channels");
  if (list) return readFileSync(list, "utf8").split(/\s+/).filter((l) => /^UC[\w-]{22}$/.test(l));
  console.log("usage: node tools/feed-torture.ts --state <subscriptions.json> | --channels <file> | --gather <N>");
  process.exit(1);
}

const budget = liveGuard("feed-torture", process.argv);
const channels = [...new Set(loadChannels(budget))];
if (channels.length < 10) {
  console.log(`Only ${channels.length} channels; need at least 10 for a meaningful test.`);
  process.exit(1);
}

// The UA Obsidian's requestUrl sends on a Mac, near enough.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) obsidian/1.10.3 Chrome/138.0.0.0 Electron/37.0.0 Safari/537.36";
const CHECK_VIDEO = "aqz-KE-bpKQ";
const started = Date.now();
const since = () => ((Date.now() - started) / 1000).toFixed(1);

interface Row { scenario: string; kind: "feed" | "player"; at: number; ms: number; status: number | string; note?: string }
const log: Row[] = [];
let stopAll = false;

async function feed(scenario: string, id: string): Promise<boolean> {
  const t = Date.now();
  try {
    const res = await fetch(feedUrl(id), { headers: { "User-Agent": UA } });
    const body = await res.text();
    const ok = res.ok && body.includes("<feed");
    log.push({ scenario, kind: "feed", at: (t - started) / 1000, ms: Date.now() - t, status: res.status,
      ...(ok ? {} : { note: body.slice(0, 120).replace(/\s+/g, " ") }) });
    return ok;
  } catch (err) {
    log.push({ scenario, kind: "feed", at: (t - started) / 1000, ms: Date.now() - t, status: "error", note: String(err) });
    return false;
  }
}

async function playerCheck(scenario: string): Promise<void> {
  const t = Date.now();
  const { ctx, ua } = CLIENTS.android;
  try {
    const res = await fetch(PLAYER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": ua },
      body: JSON.stringify({ ...playerBody(CHECK_VIDEO), context: { client: { ...ctx, hl: "en", gl: "US" } } }),
    });
    const json = (await res.json()) as { playabilityStatus?: { status?: string; reason?: string } };
    const s = json.playabilityStatus ?? {};
    const bot = isBotCheckPlayability(s.status, s.reason);
    log.push({ scenario, kind: "player", at: (t - started) / 1000, ms: Date.now() - t, status: res.status,
      note: `${s.status ?? "?"}${s.reason ? `: ${s.reason}` : ""}` });
    console.log(`  [${since()}s] video lookup after ${scenario}: ${s.status}${bot ? " (BOT CHECK, stopping)" : ""}`);
    if (bot) stopAll = true;
  } catch (err) {
    log.push({ scenario, kind: "player", at: (t - started) / 1000, ms: Date.now() - t, status: "error", note: String(err) });
  }
}

/** Run `ids` with `limit` at once; false if it stopped early. */
async function burst(scenario: string, ids: string[], limit: number): Promise<boolean> {
  const recent: boolean[] = [];
  let next = 0;
  let broke = false;
  const worker = async () => {
    while (!broke && !stopAll && next < ids.length) {
      const ok = await feed(scenario, ids[next++]);
      recent.push(ok);
      if (recent.length > 20) recent.shift();
      if (recent.length === 20 && recent.filter((r) => !r).length > 10) {
        if (!broke) console.log(`  [${since()}s] ${scenario}: over half of the last 20 feeds failed, stopping it`);
        broke = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
  return !broke;
}

const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));

function report(name: string, from: number): void {
  const rows = log.slice(from).filter((r) => r.kind === "feed");
  const fails = rows.filter((r) => r.status !== 200);
  const first = fails[0];
  const statuses = [...new Set(fails.map((r) => r.status))].join(", ");
  console.log(
    `  ${name}: ${rows.length} feeds, ${fails.length} failed` +
      (first ? ` (first at ${first.at}s, statuses ${statuses})` : "") +
      `, slowest ${Math.max(...rows.map((r) => r.ms))} ms`,
  );
}

const scenarios: Array<[string, () => Promise<unknown>]> = [
  ["today", () => burst("today", channels, 5)],
  ["at-once", () => burst("at-once", channels, channels.length)],
  ["import", async () => {
    for (let i = 0; i < 3 && !stopAll; i++) await burst("import", channels, channels.length);
  }],
  ["sustained", async () => {
    for (let i = 0; i < 6 && !stopAll; i++) {
      await burst("sustained", channels, channels.length);
      if (i < 5) await rest(5 * 60_000);
    }
  }],
  ["hammer", () => burst("hammer", Array(100).fill(channels[0]), 20)],
];

console.log(`Feed torture test: ${channels.length} channels.`);
await playerCheck("baseline");
for (const [name, run] of scenarios) {
  if (stopAll) break;
  console.log(`[${since()}s] ${name}…`);
  const from = log.length;
  await run();
  report(name, from);
  await playerCheck(name);
  if (!stopAll && name !== "hammer") await rest(2 * 60_000);
}

const dir = join(homedir(), ".cache", "ytfree");
mkdirSync(dir, { recursive: true });
const out = join(dir, `feed-torture-${new Date(started).toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify({ channels: channels.length, started: new Date(started).toISOString(), log }, null, 1));
console.log(`\n${stopAll ? "STOPPED on a bot check." : "Finished."} Every request is in ${out}`);
