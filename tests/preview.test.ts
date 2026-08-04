import { test } from "node:test";
import assert from "node:assert/strict";
import { previewCloseAction } from "../src/preview.ts";

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
