/**
 * Plain timestamps as links in Live Preview (GitHub #72).
 *
 * Reading view links a bare `3:55` with a markdown post-processor, which
 * Obsidian never runs in Live Preview. This draws the same link there as a
 * CodeMirror mark: the text is untouched, only styled and tagged with the
 * video and second it seeks to. The tap itself goes through the plugin's
 * existing Live Preview seek handling (`editorSeekLinkAt`), which reads the tag.
 */

import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { noteTimestamps } from "./description";

/** Class on every drawn timestamp; `editorSeekLinkAt` finds taps by it. */
export const LIVE_TIMESTAMP_CLASS = "ytfree-lp-timestamp";

/** The seek a drawn timestamp stands for, read back off its element. */
export function liveTimestampAt(
  el: Element | null,
  view: EditorView,
): { videoId: string; seconds: number; from: number; to: number } | null {
  const mark = el?.closest?.(`.${LIVE_TIMESTAMP_CLASS}`);
  // `instanceOf`, not `instanceof`: in a popout window the element belongs to that
  // window's HTMLElement.
  if (!mark?.instanceOf(HTMLElement) || !view.contentDOM.contains(mark)) return null;
  const videoId = mark.dataset.ytfreeVideo;
  const seconds = Number(mark.dataset.ytfreeSeconds);
  if (!videoId || !Number.isFinite(seconds)) return null;
  const from = view.posAtDOM(mark, 0);
  return { videoId, seconds, from, to: from + (mark.textContent?.length ?? 0) };
}

/**
 * The editor extension. `videoFor` answers which video this editor's note
 * names, or null to draw nothing (no video, Source mode, setting off).
 */
export function liveTimestamps(videoFor: (view: EditorView) => string | null) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private videoId: string | null;

      constructor(view: EditorView) {
        this.videoId = videoFor(view);
        this.decorations = build(view, this.videoId);
      }

      update(update: ViewUpdate): void {
        // Asked on every update, not only on edits: the note's frontmatter can
        // gain a video, and switching to Source mode is a state change with no
        // edit in it. The answer is a cache lookup.
        const videoId = videoFor(update.view);
        if (update.docChanged || videoId !== this.videoId) {
          this.videoId = videoId;
          this.decorations = build(update.view, videoId);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function build(view: EditorView, videoId: string | null): DecorationSet {
  if (!videoId) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const stamp of noteTimestamps(view.state.doc.toString())) {
    builder.add(
      stamp.from,
      stamp.to,
      Decoration.mark({
        class: `ytfree-timestamp-link ${LIVE_TIMESTAMP_CLASS}`,
        attributes: { "data-ytfree-video": videoId, "data-ytfree-seconds": String(stamp.seconds) },
      }),
    );
  }
  return builder.finish();
}
