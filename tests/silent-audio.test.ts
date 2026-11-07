import { test } from "node:test";
import assert from "node:assert/strict";
import { silentWav } from "../src/silent-audio.ts";

test("the silent WAV has a valid header and only silence after it", () => {
  const wav = silentWav(1, 8000);
  const text = (from: number, to: number) => String.fromCharCode(...wav.slice(from, to));
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 16), "WAVEfmt ");
  assert.equal(text(36, 40), "data");
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint32(4, true), wav.length - 8);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint32(40, true), 8000);
  assert.equal(wav.length, 44 + 8000);
  assert.ok(wav.slice(44).every((b) => b === 128));
});
