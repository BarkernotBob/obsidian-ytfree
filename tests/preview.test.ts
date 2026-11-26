import { test } from "node:test";
import assert from "node:assert/strict";
import { previewCloseAction, resolvePreviewChannel } from "../src/preview.ts";

test("dismissing a sheet whose video is in PiP keeps it playing", () => {
  assert.equal(
    previewCloseAction({ pictureInPicture: true, handingOver: false }),
    "keep-playing",
  );
});

test("dismissing a sheet whose video is inline stops it", () => {
  // Audio out of a window nobody can see is not a feature.
  assert.equal(previewCloseAction({ pictureInPicture: false, handingOver: false }), "destroy");
});

test("Watch and Remove always stop the preview, PiP or not", () => {
  // The contract from 024: one player at a time. The note's player is about to
  // mount for the same video, and the preview's teardown is what writes the
  // position that player resumes from.
  assert.equal(previewCloseAction({ pictureInPicture: true, handingOver: true }), "destroy");
  assert.equal(previewCloseAction({ pictureInPicture: false, handingOver: true }), "destroy");
});

test("handing over beats Picture-in-Picture, not the other way round", () => {
  // The regression this guards: reading PiP first would leave a floating window
  // playing the same video as the note that just opened, at a stale position.
  const states = [true, false].flatMap((pictureInPicture) =>
    [true, false].map((handingOver) => ({ pictureInPicture, handingOver })),
  );
  const keeps = states.filter((state) => previewCloseAction(state) === "keep-playing");
  assert.deepEqual(keeps, [{ pictureInPicture: true, handingOver: false }]);
});

test("Preview's channel name uses a known id without a lookup", async () => {
  let looked = 0;
  const found = await resolvePreviewChannel({ channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", channelTitle: "Mike" }, async () => {
    looked++;
    return { channelId: "", channelTitle: "" };
  });
  assert.deepEqual(found, { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", channelTitle: "Mike" });
  assert.equal(looked, 0);
});

test("Preview's channel name looks the id up when the card had none", async () => {
  const found = await resolvePreviewChannel({ channelId: "", channelTitle: "Mike" }, async () => ({
    channelId: "UCbbbbbbbbbbbbbbbbbbbbbb",
    channelTitle: "",
  }));
  assert.deepEqual(found, { channelId: "UCbbbbbbbbbbbbbbbbbbbbbb", channelTitle: "Mike" });
});

test("Preview's channel name has nowhere to go when YouTube won't say, or fails", async () => {
  assert.equal(await resolvePreviewChannel({ channelId: "", channelTitle: "M" }, async () => ({ channelId: "", channelTitle: "" })), null);
  assert.equal(await resolvePreviewChannel({ channelId: "", channelTitle: "M" }, () => Promise.reject(new Error("x"))), null);
});
