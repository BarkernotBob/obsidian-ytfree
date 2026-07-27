/**
 * Turning the bare timestamps in a pasted YouTube description into seek links.
 *
 * The Web Clipper can copy a description into a note but cannot rewrite text, so
 * the chapter list arrives as plain `0:00 Intro` lines. Rather than ask the
 * clipper for something it can't do, the plugin linkifies at render time — which
 * also fixes every note that was clipped before this existed.
 */

/**
 * `mm:ss` or `h:mm:ss`, and nothing that merely contains those digits.
 *
 * The guards matter more than the shape: `(?<![\d:.])` and `(?![\d:.])` keep the
 * match off the tail of a longer clock (`1:02:03` must not also yield `02:03`)
 * and off decimals like `1.5:30`. Hours are allowed up to three digits so a
 * 100-hour livestream VOD still matches.
 */
const TIMESTAMP_RE = /(?<![\d:.])(?:(\d{1,3}):)?([0-5]?\d):([0-5]\d)(?![\d:.])/g;

/** Markdown inline links — `[text](target)` — so we never link inside one. */
const MARKDOWN_LINK_RE = /\[[^\]\n]*\]\([^)\n]*\)/g;

/** A fresh matcher — the global regex above carries `lastIndex` between calls. */
export function timestampPattern(): RegExp {
  return new RegExp(TIMESTAMP_RE.source, "g");
}

export interface TimestampMatch {
  /** Character offset of the timestamp in the source string. */
  index: number;
  /** The matched text, e.g. `1:02:03`. */
  text: string;
  /** Position in the video, in seconds. */
  seconds: number;
}

/**
 * Every timestamp in `text`, left to right.
 *
 * Timestamps already sitting inside a markdown link are skipped: flow capture
 * writes real links, and wrapping one again produces nested brackets rather
 * than a second link.
 */
export function findTimestamps(text: string): TimestampMatch[] {
  const links: Array<[number, number]> = [];
  const linkRe = new RegExp(MARKDOWN_LINK_RE.source, "g");
  for (let m = linkRe.exec(text); m; m = linkRe.exec(text)) {
    links.push([m.index, m.index + m[0].length]);
  }

  const found: TimestampMatch[] = [];
  const re = timestampPattern();
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (links.some(([start, end]) => m.index >= start && m.index < end)) continue;
    const hours = m[1] ? Number(m[1]) : 0;
    const seconds = hours * 3600 + Number(m[2]) * 60 + Number(m[3]);
    found.push({ index: m.index, text: m[0], seconds });
  }
  return found;
}

/**
 * Rewrite bare timestamps in `text` as markdown seek links.
 *
 * Used by the Templater template, which writes real links into the file. The
 * render-time path in the plugin builds DOM instead, so nothing here touches
 * Obsidian.
 */
export function linkifyTimestamps(text: string, videoId: string): string {
  const matches = findTimestamps(text);
  if (matches.length === 0) return text;

  let out = "";
  let cursor = 0;
  for (const match of matches) {
    out += text.slice(cursor, match.index);
    out += `[${match.text}](ytfree:${videoId}:${match.seconds})`;
    cursor = match.index + match.text.length;
  }
  return out + text.slice(cursor);
}
