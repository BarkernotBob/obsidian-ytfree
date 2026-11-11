/**
 * The settings tab is written once and drawn two ways (`src/settings-tab.ts`):
 * `getSettingDefinitions()` for Obsidian 1.13+, `display()` before it. These
 * tests hold the two to the same rows, and run every row's control against the
 * plugin's settings.
 *
 * `obsidian` and the hub are stubbed: a `Setting` here records what was asked
 * of it and hands each control a fake component whose `onChange` can be fired.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

const OBSIDIAN_STUB = `
const g = globalThis;
function el() {
  return {
    children: [],
    text: "",
    empty() { this.children = []; },
    createEl(tag, info) { const c = el(); c.tag = tag; c.text = (info && info.text) || ""; this.children.push(c); return c; },
    createDiv(info) { return this.createEl("div", info); },
    setText(t) { this.text = t; },
    addClass() {},
  };
}
function component(kind, setting) {
  const c = {
    kind,
    buttonEl: el(),
    setValue(v) { c.value = v; return c; },
    setPlaceholder() { return c; },
    setLimits(min, max, step) { c.limits = [min, max, step]; return c; },
    setDynamicTooltip() { return c; },
    addOption(v) { (c.options ??= []).push(v); return c; },
    setButtonText(t) { c.label = t; return c; },
    setWarning() { return c; },
    onChange(fn) { c.change = fn; return c; },
    onClick(fn) { c.click = fn; return c; },
  };
  setting.controls.push(c);
  return c;
}
export class Setting {
  constructor(host) {
    this.host = host; this.name = ""; this.desc = ""; this.heading = false; this.controls = [];
    this.descEl = el();
    g.__drawn.push(this);
  }
  setName(n) { this.name = n; return this; }
  setDesc(d) { this.desc = d; return this; }
  setHeading() { this.heading = true; return this; }
  addToggle(cb) { cb(component("toggle", this)); return this; }
  addSlider(cb) { cb(component("slider", this)); return this; }
  addText(cb) { cb(component("text", this)); return this; }
  addDropdown(cb) { cb(component("dropdown", this)); return this; }
  addButton(cb) { cb(component("button", this)); return this; }
}
export class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.containerEl = el(); }
}
export class Modal { constructor(app) { this.app = app; this.contentEl = el(); } open() { g.__opened.push(this); } close() {} setTitle() {} }
export class Notice { constructor(text) { g.__notices.push(text); } }
export const Platform = { get isDesktopApp() { return g.__desktop; } };
`;

const HUB_STUB = `
import { Modal } from "obsidian";
export class ImportSubscriptionsModal extends Modal {}
export class SearchBlocklistModal extends Modal {
  constructor(app, store, kind, done) { super(app); this.done = done; }
}
`;

interface FakeControl {
  kind: string;
  value?: unknown;
  limits?: [number, number, number];
  options?: string[];
  change?: (value: unknown) => unknown;
  click?: () => unknown;
}
interface FakeSetting {
  name: string;
  desc: string;
  heading: boolean;
  controls: FakeControl[];
}
interface Definition {
  type?: string;
  heading?: string;
  name?: string;
  desc?: string;
  searchable?: boolean;
  items?: Definition[];
  render?: (setting: unknown) => void;
}
interface Tab {
  display(): void;
  getSettingDefinitions(): Definition[];
}

const g = globalThis as unknown as {
  __drawn: FakeSetting[];
  __opened: Array<{ done?: () => void }>;
  __notices: string[];
  __desktop: boolean;
  __Setting: new (host: unknown) => FakeSetting;
};

async function loadTab(): Promise<new (app: unknown, plugin: unknown) => Tab> {
  const dir = mkdtempSync(join(tmpdir(), "ytfree-tab-"));
  const out = join(dir, "tab.mjs");
  await build({
    entryPoints: ["src/settings-tab.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "silent",
    plugins: [
      {
        name: "stubs",
        setup(b) {
          b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
          b.onResolve({ filter: /\/hub\.ts$/ }, () => ({ path: "hub", namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents: args.path === "obsidian" ? OBSIDIAN_STUB : HUB_STUB,
            loader: "js",
          }));
        },
      },
    ],
  });
  // The definitions path is handed a Setting by Obsidian; the tests need the stub's.
  writeFileSync(join(dir, "setting.mjs"), `${OBSIDIAN_STUB}\nglobalThis.__Setting = Setting;\n`);
  await import(pathToFileURL(join(dir, "setting.mjs")).href);
  const mod = (await import(pathToFileURL(out).href)) as { YtFreeSettingTab: new (app: unknown, plugin: unknown) => Tab };
  return mod.YtFreeSettingTab;
}

function fakePlugin() {
  const calls: string[] = [];
  const settings = { ...DEFAULT_SETTINGS };
  const note = (name: string) => () => void calls.push(name);
  return {
    calls,
    settings,
    saveSettings: async () => void calls.push("save"),
    refreshHub: note("refreshHub"),
    refreshPinnedPlayers: note("refreshPinnedPlayers"),
    refreshSmartSpeed: note("refreshSmartSpeed"),
    stopFollowingTranscript: note("stopFollowingTranscript"),
    resetResolver: note("resetResolver"),
    resetFfmpeg: note("resetFfmpeg"),
    vaultPath: () => "/vault",
    hubSettings: () => ({ notifications: { webhook: "", enabled: false, format: "json" } }),
    history: { clear: async () => void calls.push("clearHistory") },
    subscriptions: {
      removedSearchVideos: () => [1, 2],
      hiddenSearchChannels: () => [1],
      sendTestNotification: async () => ({ ok: false, reason: "disabled" }),
    },
  };
}

function reset(desktop: boolean): void {
  g.__drawn = [];
  g.__opened = [];
  g.__notices = [];
  g.__desktop = desktop;
}

/** Every row a definitions list holds, in order, flattened out of its groups. */
function rowsOf(defs: Definition[]): Definition[] {
  return defs.flatMap((d) => (d.type === "group" ? (d.items ?? []) : [d])).filter((d) => d.render);
}

const Tab = await loadTab();

for (const desktop of [true, false]) {
  const where = desktop ? "desktop" : "phone";

  test(`${where}: both ways of drawing the tab show the same rows, in the same order`, () => {
    reset(desktop);
    const tab = new Tab({}, fakePlugin());
    tab.display();
    const drawn = g.__drawn.filter((s) => !s.heading).map((s) => s.name);

    const defs = tab.getSettingDefinitions();
    const defined = rowsOf(defs).map((d) => d.name);
    assert.deepEqual(defined, drawn);
    assert.ok(drawn.length > 30, `only ${drawn.length} rows`);
    assert.equal(new Set(drawn).size, drawn.length, "a row name is used twice");
    for (const d of rowsOf(defs)) assert.ok(d.name, "a row without a name cannot be searched");
  });

  test(`${where}: a definition renders the same control display() draws`, () => {
    reset(desktop);
    const tab = new Tab({}, fakePlugin());
    tab.display();
    const drawn = g.__drawn.filter((s) => !s.heading);

    for (const def of rowsOf(tab.getSettingDefinitions())) {
      const setting = new g.__Setting(null);
      def.render?.(setting);
      const twin = drawn.find((s) => s.name === def.name);
      assert.ok(twin, `${def.name} is not drawn by display()`);
      assert.equal(setting.name, def.name);
      assert.equal(setting.desc, twin.desc);
      assert.deepEqual(
        setting.controls.map((c) => [c.kind, c.value, c.limits, c.options]),
        twin.controls.map((c) => [c.kind, c.value, c.limits, c.options]),
        `${def.name}`,
      );
    }
  });

  test(`${where}: every toggle and slider writes its own setting and saves`, async () => {
    reset(desktop);
    const plugin = fakePlugin();
    new Tab({}, plugin).display();
    let checked = 0;
    for (const setting of g.__drawn) {
      for (const control of setting.controls) {
        if (control.kind !== "toggle" && control.kind !== "slider") continue;
        if (setting.name === "Resume after") continue; // stored in ms, shown in seconds
        const before = { ...plugin.settings } as Record<string, unknown>;
        const next = control.kind === "toggle" ? !control.value : (control.limits?.[1] ?? 1);
        plugin.calls.length = 0;
        await control.change?.(next);
        const after = plugin.settings as unknown as Record<string, unknown>;
        const changed = Object.keys(after).filter((key) => after[key] !== before[key]);
        assert.equal(changed.length, 1, `${setting.name} changed ${changed.join(", ") || "nothing"}`);
        assert.equal(after[changed[0]], next, setting.name);
        assert.ok(plugin.calls.includes("save"), `${setting.name} did not save`);
        checked++;
      }
    }
    assert.ok(checked >= 20, `only ${checked} controls checked`);
  });
}

test("the optional desktop helpers are the last section, and only on desktop", () => {
  reset(true);
  const groups = new Tab({}, fakePlugin()).getSettingDefinitions().filter((d) => d.type === "group");
  const last = groups[groups.length - 1];
  assert.equal(last.heading, "Desktop helpers (optional)");
  assert.deepEqual(
    (last.items ?? []).filter((d) => d.render).map((d) => d.name),
    ["yt-dlp path", "ffmpeg path", "Download folder"],
  );

  reset(false);
  const phone = new Tab({}, fakePlugin()).getSettingDefinitions();
  assert.equal(phone.some((d) => d.heading === "Desktop helpers (optional)"), false);
  assert.equal(rowsOf(phone).some((d) => /yt-dlp|ffmpeg/.test(d.name ?? "")), false);
});

test("closing a search blocklist redraws the tab", () => {
  reset(true);
  const tab = new Tab({}, fakePlugin());
  tab.display();
  const row = g.__drawn.find((s) => s.name === "Removed from search");
  assert.match(row?.desc ?? "", /^2 videos\./);
  void row?.controls[0].click?.();
  const before = g.__drawn.length;
  g.__opened[0].done?.();
  assert.ok(g.__drawn.length > before, "nothing was drawn again");
});

test("the download folder warns when it is inside the vault", async () => {
  reset(true);
  const plugin = fakePlugin();
  new Tab({}, plugin).display();
  const row = g.__drawn.find((s) => s.name === "Download folder");
  assert.match(row?.desc ?? "", /^Where downloaded videos are kept/);
  await row?.controls[0].change?.("/vault/videos");
  assert.match(row?.desc ?? "", /inside your vault/);
});
