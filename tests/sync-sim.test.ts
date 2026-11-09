/**
 * Two devices, one synced folder, and a sync service that behaves like the real
 * ones on a bad day (docs/V1-SCOPE-SYNC.md).
 *
 * The service replaces whole files. Uploads and downloads arrive late; when two
 * devices' copies cross in flight, the newer write wins and the other is lost
 * (iCloud) or set aside as a conflict copy (Drive, Dropbox, Syncthing). Reads
 * sometimes fail, the way a file caught mid-download does. And the phone gets
 * killed.
 *
 * Every scenario is Isaiah's expectation as a test: with edits at least ten
 * seconds apart, nothing removed comes back, and both devices end up holding
 * exactly the same thing once the service has delivered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { HubItem, SubscriptionsState } from "../src/subscriptions.ts";
import {
  emptyState,
  hideItem,
  keepItem,
  mergeStates,
  normalizeState,
  restoreItem,
} from "../src/subscriptions.ts";
import type { ProgressState } from "../src/progress.ts";
import {
  emptyProgress,
  mergeProgress,
  normalizeProgress,
  recordPosition,
  resumePoint,
} from "../src/progress.ts";
import type { LocalCopy, SyncCodec, SyncDisk } from "../src/synced-file.ts";
import { SyncedFile, canonical, conflictCopies } from "../src/synced-file.ts";

const FOLDER = ".obsidian/plugins/ytfree";
const SUBS = `${FOLDER}/subscriptions.json`;
const PROGRESS = `${FOLDER}/progress.json`;
const CHANNEL = "UC6107grRI4m0o2-emgoDnAA";
const T0 = Date.parse("2026-11-09T12:00:00.000Z");
const POLL_ROUND_MS = 5 * 60_000;

// ------------------------------------------------------------ randomness

/** Seeded, so a failing run can be replayed exactly. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------ the service

interface Version {
  text: string;
  /** When the device that wrote it wrote it. The newest write wins a collision. */
  writtenAt: number;
}

type Mode = "newest-wins" | "conflict-copy";

/**
 * The cloud, and every device's local folder.
 *
 * Time is virtual: `clock.now` only moves when a scenario moves it, and every
 * delivery is an event scheduled against it.
 */
class Service {
  cloud = new Map<string, Version>();
  devices: Device[] = [];
  private events: Array<{ at: number; run: () => void }> = [];
  lost = 0;
  copies = 0;

  readonly clock: { now: number };
  readonly random: () => number;
  readonly mode: Mode;
  /** Longest delay one way, in ms. */
  readonly maxDelay: number;

  constructor(clock: { now: number }, random: () => number, mode: Mode, maxDelay: number) {
    this.clock = clock;
    this.random = random;
    this.mode = mode;
    this.maxDelay = maxDelay;
  }

  private delay(): number {
    return 500 + Math.floor(this.random() * this.maxDelay);
  }

  private seq = 0;

  /** A file time with millisecond precision, like a real one. */
  stamp(): number {
    this.seq = (this.seq + 1) % 1000;
    return this.clock.now + this.seq;
  }

  schedule(after: number, run: () => void): void {
    this.events.push({ at: this.clock.now + after, run });
  }

  /** A device wrote a file: it heads for the cloud. */
  upload(from: Device, path: string, version: Version): void {
    this.schedule(from.uploadDelay ?? this.delay(), () => this.arrive(from, path, version));
  }

  private arrive(from: Device, path: string, version: Version): void {
    from.pending.delete(path);
    const current = this.cloud.get(path);
    if (current && current.writtenAt > version.writtenAt) {
      // Crossed in flight with a newer write.
      if (this.mode === "conflict-copy") {
        this.copies += 1;
        const dot = path.lastIndexOf(".");
        const copy = `${path.slice(0, dot)} (${this.copies}).json`;
        this.cloud.set(copy, version);
        this.fanOut(copy, version, null);
      } else {
        this.lost += 1;
      }
      // Either way the device that lost is handed the copy that won.
      this.schedule(this.delay(), () => from.receive(path, current));
      return;
    }
    if (current && from.basedOn.get(path) !== current.writtenAt && this.mode === "conflict-copy") {
      // This device wrote without having seen the current cloud copy: the
      // service keeps the newer and sets the other aside.
      this.copies += 1;
      const dot = path.lastIndexOf(".");
      const copy = `${path.slice(0, dot)} (${this.copies}).json`;
      this.cloud.set(copy, current);
      this.fanOut(copy, current, null);
    } else if (current && from.basedOn.get(path) !== current.writtenAt) {
      // iCloud: the newer write wins, and the one it replaced is gone.
      this.lost += 1;
    }
    this.cloud.set(path, version);
    this.fanOut(path, version, from);
  }

  private fanOut(path: string, version: Version, except: Device | null): void {
    for (const device of this.devices) {
      if (device === except) {
        device.basedOn.set(path, version.writtenAt);
        continue;
      }
      this.schedule(this.delay(), () => device.receive(path, version));
    }
  }

  /** A device deleted a file. Deletes reach the cloud late too. */
  removeFile(path: string): void {
    this.schedule(this.delay(), () => {
      this.cloud.delete(path);
      for (const device of this.devices) {
        this.schedule(this.delay(), () => device.files.delete(path));
      }
    });
  }

  /** Run everything due by now. */
  deliver(): void {
    for (;;) {
      this.events.sort((a, b) => a.at - b.at);
      const next = this.events[0];
      if (!next || next.at > this.clock.now) return;
      this.events.shift();
      next.run();
    }
  }

  idle(): boolean {
    return this.events.length === 0;
  }
}

/** One device's folder: what `SyncDisk` sees. */
class Device implements SyncDisk {
  files = new Map<string, { text: string; mtime: number }>();
  /** Paths written here and not yet in the cloud. */
  pending = new Set<string>();
  /** The cloud version each local file was last in step with. */
  basedOn = new Map<string, number>();
  /** Device-local storage, which survives a kill. */
  storage = new Map<string, string>();
  failReads = 0;
  /** Fixed upload delay, for a phone whose upload the OS holds back. */
  uploadDelay: number | null = null;

  readonly name: string;
  private service: Service;
  private random: () => number;
  private readFailRate: number;

  constructor(name: string, service: Service, random: () => number, readFailRate: number) {
    this.name = name;
    this.service = service;
    this.random = random;
    this.readFailRate = readFailRate;
  }

  receive(path: string, version: Version): void {
    // A file written here and still uploading is not replaced: its own upload
    // competes in the cloud instead.
    if (this.pending.has(path)) return;
    // Deliveries can cross in flight; a service never installs an older copy
    // over a newer one it already delivered.
    if (version.writtenAt < (this.basedOn.get(path) ?? -Infinity)) return;
    this.files.set(path, { text: version.text, mtime: this.service.stamp() });
    this.basedOn.set(path, version.writtenAt);
  }

  local(key: string): LocalCopy {
    return {
      read: () => this.storage.get(key) ?? null,
      write: (value) => this.storage.set(key, value),
    };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    if (this.random() < this.readFailRate) {
      this.failReads += 1;
      throw new Error("mid-download");
    }
    const file = this.files.get(path);
    if (!file) throw new Error("ENOENT");
    return file.text;
  }

  async write(path: string, data: string): Promise<void> {
    const now = this.service.clock.now;
    this.files.set(path, { text: data, mtime: this.service.stamp() });
    this.pending.add(path);
    this.service.upload(this, path, { text: data, writtenAt: now });
  }

  async stat(path: string): Promise<{ mtime: number } | null> {
    const file = this.files.get(path);
    return file ? { mtime: file.mtime, size: file.text.length } : null;
  }

  async list(): Promise<{ files: string[] }> {
    return { files: [...this.files.keys()] };
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.service.removeFile(path);
  }
}

// ------------------------------------------------------------ fixtures

const VIDEOS = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd", "eeeeeeeeeee", "fffffffffff"];

function item(videoId: string): HubItem {
  return {
    videoId,
    channelId: CHANNEL,
    channelTitle: "A channel",
    title: `Video ${videoId}`,
    published: "2026-11-01T00:00:00.000Z",
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    description: "words",
    views: 100,
    isShort: false,
    state: "new",
    seenAt: "2026-11-01T00:00:00.000Z",
    origin: "feed",
  };
}

function startingState(): SubscriptionsState {
  return {
    ...emptyState(),
    channels: [{ id: CHANNEL, title: "A channel", addedAt: "2026-06-01T00:00:00.000Z", error: null }],
    items: VIDEOS.map(item),
  };
}

const subsCodec: SyncCodec<SubscriptionsState> = {
  empty: emptyState,
  parse: normalizeState,
  merge: mergeStates,
};

const progressCodec: SyncCodec<ProgressState> = {
  empty: emptyProgress,
  parse: normalizeProgress,
  merge: mergeProgress,
};

interface Options {
  seed: number;
  mode?: Mode;
  maxDelay?: number;
  readFailRate?: number;
  /** Chance per action that the acting phone is killed straight after it. */
  killRate?: number;
  /** The fix switched off — for the test that proves this reproduces the bug. */
  unfixed?: boolean;
  actions?: number;
}

interface Handle {
  device: Device;
  subs: SyncedFile<SubscriptionsState>;
  progress: SyncedFile<ProgressState>;
}

/**
 * Run one randomized afternoon and report what each device ended up with.
 *
 * Actions are at least ten seconds apart and alternate devices at random. The
 * Mac also saves on a poll round every minute, which is what collides with the
 * phone's writes in real life. Both devices refresh every five seconds, as an
 * open hub does.
 */
async function afternoon(options: Options) {
  const random = rng(options.seed);
  const clock = { now: T0 };
  const service = new Service(clock, random, options.mode ?? "newest-wins", options.maxDelay ?? 8000);
  const readFailRate = options.readFailRate ?? 0.05;
  const mac = new Device("mac", service, random, readFailRate);
  const phone = new Device("phone", service, random, readFailRate);
  service.devices = [mac, phone];

  // Both start in step with the same file.
  const seed: Version = { text: JSON.stringify(startingState()), writtenAt: T0 - 60_000 };
  service.cloud.set(SUBS, seed);
  for (const device of service.devices) device.receive(SUBS, seed);

  const sleep = async (): Promise<void> => {};
  const now = (): number => clock.now;
  const open = async (device: Device): Promise<Handle> => {
    const local = (key: string) => (options.unfixed ? null : device.local(key));
    const subs = new SyncedFile(device, SUBS, subsCodec, local("subs"), { sleep, now, random, writeBack: !options.unfixed });
    const progress = new SyncedFile(device, PROGRESS, progressCodec, local("progress"), { sleep, now, random, writeBack: !options.unfixed });
    if (await subs.load()) void subs.save();
    if (await progress.load()) void progress.save();
    return { device, subs, progress };
  };
  const handles = new Map<Device, Handle>();
  handles.set(mac, await open(mac));
  handles.set(phone, await open(phone));

  /** The last decision per video, and per video's position — the oracle. */
  const expectedState = new Map<string, HubItem["state"]>(VIDEOS.map((v) => [v, "new"]));
  const expectedPosition = new Map<string, number>();
  /** Per device and video, the newest decision time ever held — must never go back. */
  const seenDecision = new Map<string, number>();
  const regressions: string[] = [];
  /**
   * Every hub action, and how long until both devices showed it. A later action
   * on the same video settles the earlier one's question, so it stops counting.
   */
  const actions: Array<{ videoId: string; state: HubItem["state"]; at: number; seenBoth: number | null; superseded: boolean }> = [];

  const checkActions = (): void => {
    for (const action of actions) {
      if (action.seenBoth !== null || action.superseded) continue;
      const shown = [...handles.values()].every(
        (handle) => handle.subs.state.items.find((i) => i.videoId === action.videoId)?.state === action.state,
      );
      if (shown) action.seenBoth = clock.now - action.at;
    }
  };

  const checkMonotonic = (): void => {
    for (const [device, handle] of handles) {
      for (const it of handle.subs.state.items) {
        const key = `${device.name}:${it.videoId}`;
        const at = Date.parse(it.decidedAt ?? "") || 0;
        const before = seenDecision.get(key) ?? 0;
        if (at < before) regressions.push(`${key} went back from ${before - T0} to ${at - T0}`);
        else seenDecision.set(key, at);
      }
    }
  };

  const tick = async (ms: number): Promise<void> => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      clock.now += 1000;
      service.deliver();
      if ((clock.now - T0) % 5000 === 0) {
        for (const handle of handles.values()) {
          await handle.subs.refresh();
          await handle.progress.refresh();
        }
      }
      if ((clock.now - T0) % POLL_ROUND_MS === 0) {
        // The Mac's poll round: a save whether or not a video arrived. Rounds
        // are never closer than five minutes (GitHub #66).
        const macSubs = handles.get(mac)!.subs;
        macSubs.state.lastPolledAt = new Date(clock.now).toISOString();
        macSubs.state.lastPolledBy = "desktop";
        await macSubs.save();
      }
      checkMonotonic();
      checkActions();
    }
  };

  const total = options.actions ?? 40;
  for (let n = 0; n < total; n += 1) {
    const device = random() < 0.5 ? mac : phone;
    const handle = handles.get(device)!;
    const videoId = VIDEOS[Math.floor(random() * VIDEOS.length)];
    const at = new Date(clock.now);
    const roll = random();
    if (roll < 0.6) {
      const live = handle.subs.state.items.find((i) => i.videoId === videoId);
      // Not on this screen yet — a load that caught the file mid-download
      // starts empty until the next refresh. Nothing to tap.
      if (!live) {
        await tick(10_000);
        continue;
      }
      if (roll < 0.35) {
        hideItem(live, at);
        expectedState.set(videoId, "dismissed");
      } else if (roll < 0.47) {
        restoreItem(live, at);
        expectedState.set(videoId, "new");
      } else {
        keepItem(live, `Videos/${videoId}.md`, at);
        expectedState.set(videoId, "kept");
      }
      for (const earlier of actions) if (earlier.videoId === videoId) earlier.superseded = true;
      actions.push({ videoId, state: live.state, at: clock.now, seenBoth: null, superseded: false });
      await handle.subs.save();
    } else {
      const seconds = roll < 0.8 ? 30 + Math.floor(random() * 600) : 999;
      recordPosition(handle.progress.state, videoId, seconds, 1000, at);
      expectedPosition.set(videoId, seconds >= 970 ? 0 : seconds);
      await handle.progress.save();
    }

    if (device === phone && random() < (options.killRate ?? 0.15)) {
      // Swiped away. Memory is gone; the folder and local storage are not.
      await tick(1000);
      handles.set(phone, await open(phone));
    }
    await tick(10_000 + Math.floor(random() * 20_000));
  }

  // Leave both alone: fifteen minutes, then until nothing is in flight.
  await tick(15 * 60_000);
  for (let quiet = 0; quiet < 60 && !service.idle(); quiet += 1) await tick(15_000);

  // Seconds until both devices showed each action, for actions nothing later
  // overrode; null for one that never showed on both.
  const latencies = actions
    .filter((a) => !a.superseded || a.seenBoth !== null)
    .map((a) => (a.seenBoth === null ? null : a.seenBoth / 1000));
  return { handles, mac, phone, service, expectedState, expectedPosition, regressions, latencies };
}

function decisions(state: SubscriptionsState): Record<string, string> {
  return Object.fromEntries(state.items.map((i) => [i.videoId, i.state]));
}

// ------------------------------------------------------------ tests

/** How long a Remove may take to show on both devices, with up to 8.5 s each way and collisions. */
const SHOWN_WITHIN_S = 120;

/**
 * Isaiah's report, step by step: Remove on the phone, put the phone down, use
 * the Mac. The phone's upload is held back two minutes, the Mac's poll round
 * saves in the meantime, and the Mac's newer copy wins — the Remove is lost
 * from the file. Then the phone is opened again (or killed and relaunched).
 */
async function putThePhoneDown(fixed: boolean, killPhone: boolean) {
  const clock = { now: T0 };
  const service = new Service(clock, rng(9), "newest-wins", 2000);
  const mac = new Device("mac", service, () => 1, 0);
  const phone = new Device("phone", service, () => 1, 0);
  service.devices = [mac, phone];
  const seed: Version = { text: JSON.stringify(startingState()), writtenAt: T0 - 60_000 };
  service.cloud.set(SUBS, seed);
  mac.receive(SUBS, seed);
  phone.receive(SUBS, seed);
  const open = async (device: Device) => {
    const file = new SyncedFile(device, SUBS, subsCodec, fixed ? device.local("subs") : null, {
      sleep: async () => {},
      now: () => clock.now,
      writeBack: fixed,
    });
    if (await file.load()) void file.save();
    return file;
  };
  const onMac = await open(mac);
  let onPhone = await open(phone);
  const run = async (seconds: number, phoneAwake: boolean) => {
    for (let n = 0; n < seconds; n += 1) {
      clock.now += 1000;
      service.deliver();
      if (n % 5 === 0) {
        await onMac.refresh();
        if (phoneAwake) await onPhone.refresh();
      }
    }
  };

  phone.uploadDelay = 120_000;
  hideItem(onPhone.state.items[0], new Date(clock.now));
  await onPhone.save();
  phone.uploadDelay = null;
  await run(60, false);
  onMac.state.lastPolledAt = new Date(clock.now).toISOString();
  await onMac.save(); // the poll round
  await run(300, false);
  const macBeforePhoneOpens = onMac.state.items[0].state;
  if (killPhone) onPhone = await open(phone);
  await run(120, true);
  return {
    macBeforePhoneOpens,
    mac: onMac.state.items[0].state,
    phone: onPhone.state.items[0].state,
    lost: service.lost,
  };
}

test("put the phone down: the unfixed code loses the Remove; the fix re-sends it", async () => {
  const unfixed = await putThePhoneDown(false, false);
  assert.equal(unfixed.lost, 1, "the phone's write lost the collision");
  assert.equal(unfixed.mac, "new", "unfixed: the Mac keeps showing it, even with the phone open");

  const unfixedKilled = await putThePhoneDown(false, true);
  assert.equal(unfixedKilled.phone, "new", "unfixed: it comes back on the phone too");

  for (const kill of [false, true]) {
    const fixed = await putThePhoneDown(true, kill);
    assert.equal(fixed.macBeforePhoneOpens, "new", "nothing can reach the Mac while the phone is down");
    assert.equal(fixed.mac, "dismissed", `fixed${kill ? ", phone killed" : ""}: reaches the Mac`);
    assert.equal(fixed.phone, "dismissed", `fixed${kill ? ", phone killed" : ""}: stays removed on the phone`);
  }
});

for (const mode of ["newest-wins", "conflict-copy"] as const) {
  test(`${mode}: edits ten seconds apart end identical, with nothing coming back`, async () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const run = await afternoon({ seed, mode });
      const mac = run.handles.get(run.mac)!;
      const phone = run.handles.get(run.phone)!;
      const want = Object.fromEntries(run.expectedState);
      const context = `seed ${seed}, ${run.service.lost} lost writes, ${run.service.copies} copies`;

      assert.deepEqual(decisions(mac.subs.state), want, `mac, ${context}`);
      assert.deepEqual(decisions(phone.subs.state), want, `phone, ${context}`);
      const file = normalizeState(JSON.parse(run.service.cloud.get(SUBS)!.text));
      assert.deepEqual(decisions(file), want, `file, ${context}`);
      assert.equal(canonical(mac.subs.state.items), canonical(phone.subs.state.items), context);
      assert.deepEqual(run.regressions, [], `nothing goes back to an older decision, ${context}`);
      const late = run.latencies.filter((s) => s === null || s > SHOWN_WITHIN_S);
      assert.deepEqual(late, [], `every action shows on both devices within ${SHOWN_WITHIN_S} s, ${context}`);

      for (const [videoId, seconds] of run.expectedPosition) {
        assert.equal(resumePoint(mac.progress.state, videoId), seconds, `mac ${videoId}, ${context}`);
        assert.equal(resumePoint(phone.progress.state, videoId), seconds, `phone ${videoId}, ${context}`);
      }
      // Conflict copies are folded in and cleaned up.
      const leftovers = conflictCopies(SUBS, [...run.service.cloud.keys()]);
      assert.deepEqual(leftovers, [], `conflict copies cleaned up, ${context}`);
    }
  });
}

test("slow phone: thirty-second deliveries still converge", async () => {
  for (let seed = 100; seed <= 120; seed += 1) {
    const run = await afternoon({ seed, maxDelay: 30_000 });
    const want = Object.fromEntries(run.expectedState);
    assert.deepEqual(decisions(run.handles.get(run.mac)!.subs.state), want, `seed ${seed}`);
    assert.deepEqual(decisions(run.handles.get(run.phone)!.subs.state), want, `seed ${seed}`);
    assert.deepEqual(run.regressions, [], `seed ${seed}`);
  }
});

test("a quiet pair of devices stops writing", async () => {
  const run = await afternoon({ seed: 7, actions: 6, readFailRate: 0 });
  const writesBefore = [...run.service.cloud.values()].length;
  const mac = run.handles.get(run.mac)!;
  const phone = run.handles.get(run.phone)!;
  const before = run.mac.files.get(SUBS)!.mtime;
  for (let n = 0; n < 12; n += 1) {
    await phone.subs.refresh();
    await mac.subs.refresh();
  }
  assert.equal(run.mac.files.get(SUBS)!.mtime, before, "no write-back ping-pong");
  assert.equal([...run.service.cloud.values()].length, writesBefore);
  assert.equal(run.phone.pending.size, 0);
});

// ------------------------------------------------------------ the merges

/** Random states built from the same few videos, for merge properties. */
function randomState(random: () => number): SubscriptionsState {
  const state = startingState();
  for (const it of state.items) {
    const roll = random();
    const at = new Date(T0 + Math.floor(random() * 5) * 1000);
    if (roll < 0.3) hideItem(it, at);
    else if (roll < 0.5) keepItem(it, `Videos/${it.videoId}.md`, at);
    else if (roll < 0.6) restoreItem(it, at);
    if (random() < 0.3) it.views = Math.floor(random() * 3);
    if (random() < 0.3) it.title = `Title ${Math.floor(random() * 3)}`;
  }
  if (random() < 0.5) state.channels[0].error = "feed failed";
  if (random() < 0.5) state.channels[0].title = "Renamed";
  state.lastPolledAt = new Date(T0 + Math.floor(random() * 3) * 1000).toISOString();
  state.lastPolledBy = random() < 0.5 ? "desktop" : "mobile";
  state.deletedVideos = [{ id: "zzzzzzzzzzz", at: new Date(T0 + Math.floor(random() * 3)).toISOString() }];
  return state;
}

test("mergeStates means the same whichever device runs it", () => {
  const random = rng(42);
  for (let n = 0; n < 500; n += 1) {
    const a = randomState(random);
    const b = randomState(random);
    assert.equal(
      canonical(mergeStates(structuredClone(a), structuredClone(b))),
      canonical(mergeStates(structuredClone(b), structuredClone(a))),
      `run ${n}`,
    );
  }
});

test("mergeProgress means the same whichever device runs it", () => {
  const random = rng(43);
  const randomProgress = (): ProgressState => {
    const state = emptyProgress();
    for (const videoId of VIDEOS) {
      const at = new Date(T0 + Math.floor(random() * 4) * 1000);
      const roll = random();
      if (roll < 0.4) recordPosition(state, videoId, 30 + Math.floor(random() * 3), 1000, at);
      else if (roll < 0.6) {
        recordPosition(state, videoId, 300, 1000, new Date(T0 - 1000));
        recordPosition(state, videoId, 999, 1000, at);
      }
    }
    return state;
  };
  for (let n = 0; n < 500; n += 1) {
    const a = randomProgress();
    const b = randomProgress();
    assert.equal(
      canonical(mergeProgress(structuredClone(a), structuredClone(b))),
      canonical(mergeProgress(structuredClone(b), structuredClone(a))),
      `run ${n}`,
    );
  }
});

test("a finished video's clear crosses devices", () => {
  const mac = emptyProgress();
  const phone = emptyProgress();
  recordPosition(mac, VIDEOS[0], 180, 1000, new Date(T0));
  Object.assign(phone, structuredClone(mac));
  recordPosition(phone, VIDEOS[0], 995, 1000, new Date(T0 + 60_000));
  assert.equal(resumePoint(mergeProgress(mac, phone), VIDEOS[0]), 0);
  assert.equal(resumePoint(mergeProgress(phone, mac), VIDEOS[0]), 0);
  // And watching it again afterwards beats the clear.
  recordPosition(mac, VIDEOS[0], 40, 1000, new Date(T0 + 120_000));
  assert.equal(resumePoint(mergeProgress(phone, mac), VIDEOS[0]), 40);
});

test("conflict copies: the patterns sync services use, and nothing else", () => {
  const files = [
    `${FOLDER}/subscriptions.json`,
    `${FOLDER}/subscriptions 2.json`,
    `${FOLDER}/subscriptions (1).json`,
    `${FOLDER}/subscriptions (Isaiah's MacBook's conflicted copy 2026-11-09).json`,
    `${FOLDER}/subscriptions.sync-conflict-20261109-101010-ABCDEFG.json`,
    `${FOLDER}/subscriptions-backup.json`,
    `${FOLDER}/subscriptions 2.json.bak`,
    `${FOLDER}/progress 2.json`,
    `other/subscriptions 2.json`,
  ];
  assert.deepEqual(conflictCopies(SUBS, files), files.slice(1, 5));
});

test("an unreadable file is never written over", async () => {
  const random = rng(5);
  const clock = { now: T0 };
  const service = new Service(clock, random, "newest-wins", 1000);
  const device = new Device("mac", service, () => 0, 1);
  service.devices = [device];
  device.files.set(SUBS, { text: "{}", mtime: 1 });
  const file = new SyncedFile(device, SUBS, subsCodec, null, { sleep: async () => {}, now: () => clock.now });
  const outcome = await file.save();
  assert.equal(outcome.landed, false);
  assert.equal(device.pending.size, 0);
});
