/**
 * Record the search responses behind #46, once (docs/V1-SCOPE-SEARCH.md, D2).
 *
 *   node scripts/record-search-fixtures.ts
 *
 * Six requests, all ANDROID search, the same client, body and `params` the
 * plugin sends: plain, sorted by upload date, sorted by view count, uploaded
 * this week, and "More results" on the last two. Paced a few seconds apart,
 * like a person changing a filter. Guarded like the smoke canary: once a day
 * per machine (`--force` overrides), and it prints what it sent.
 *
 * Writes raw responses to tests/fixtures/raw-search/ (gitignored); the
 * committed fixtures are trimmed copies. Also prints each response's sections
 * (video count, ages, views) so the filter check can be read off the console.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { CLIENTS, SEARCH_URL } from "../src/innertube-context.ts";
import { defaultFilters, encodeSearchParams } from "../src/search-params.ts";
import type { SearchFilters } from "../src/search-params.ts";
import { liveGuard } from "./live-budget.mjs";

liveGuard("record-search-fixtures");

const QUERY = "smarter every day";
const OUT = new URL("../tests/fixtures/raw-search/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function search(body: Record<string, unknown>): Promise<unknown> {
  const { ctx, ua } = CLIENTS.android;
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ua },
    body: JSON.stringify({ ...body, context: { client: { ...ctx, hl: "en", gl: "US" } } }),
  });
  if (!res.ok) throw new Error(`search answered HTTP ${res.status}`);
  return res.json();
}

type Json = Record<string, unknown>;
const t = (x: unknown): string => {
  const o = x as { simpleText?: string; runs?: Array<{ text: string }> } | undefined;
  return o?.simpleText ?? o?.runs?.map((r) => r.text).join("") ?? "";
};

function sectionsOf(json: unknown): Json[] {
  const j = json as Json;
  const root =
    ((j.contents as Json | undefined)?.sectionListRenderer as Json | undefined) ??
    ((j.continuationContents as Json | undefined)?.sectionListContinuation as Json | undefined);
  return ((root?.contents as Json[] | undefined) ?? []);
}

function tokenOf(json: unknown): string | null {
  const j = json as Json;
  const root =
    ((j.contents as Json | undefined)?.sectionListRenderer as Json | undefined) ??
    ((j.continuationContents as Json | undefined)?.sectionListContinuation as Json | undefined);
  const c = (root?.continuations as Json[] | undefined)?.[0]?.nextContinuationData as Json | undefined;
  return typeof c?.continuation === "string" ? c.continuation : null;
}

function describe(name: string, json: unknown): void {
  console.log(`\n=== ${name} ===`);
  sectionsOf(json).forEach((section, i) => {
    const entries = ((section.itemSectionRenderer as Json | undefined)?.contents as Json[] | undefined) ?? [];
    const kinds = [...new Set(entries.map((e) => Object.keys(e)[0]))].join(",");
    const videos = entries.map((e) => e.compactVideoRenderer as Json | undefined).filter(Boolean) as Json[];
    console.log(`  [${i}] ${videos.length} videos  kinds=${kinds}`);
    for (const v of videos) {
      const views = t(v.viewCountText).replace(/[^\d]/g, "");
      console.log(`        ${t(v.publishedTimeText) || "—"} | ${views || "—"} | ${t(v.title).slice(0, 50)}`);
    }
  });
  console.log(`  continuation: ${tokenOf(json) ? "yes" : "no"}`);
}

function save(name: string, json: unknown): void {
  writeFileSync(new URL(`${name}.json`, OUT), JSON.stringify(json, null, 1));
  describe(name, json);
}

const runs: Array<[string, Partial<SearchFilters>, boolean]> = [
  ["plain", {}, false],
  ["sort-date", { sort: "date" }, true],
  ["sort-views", { sort: "views" }, false],
  ["week", { uploadDate: "week" }, true],
];

for (const [name, change, follow] of runs) {
  const params = encodeSearchParams({ ...defaultFilters(), ...change });
  const page = await search({ query: QUERY, params });
  save(name, page);
  await sleep(3000 + Math.random() * 2000);
  const token = follow ? tokenOf(page) : null;
  if (token) {
    save(`${name}-continuation`, await search({ continuation: token }));
    await sleep(3000 + Math.random() * 2000);
  }
}
