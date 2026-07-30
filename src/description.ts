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

/**
 * Make a YouTube description safe to paste into a note as markdown.
 *
 * A description is plain text that has never been markdown, and creators write
 * things in it that markdown reads as structure. The one that actually broke a
 * note: Smarter Every Day separates its sections with `~~~~~~~~` rules, and
 * three or more tildes at the start of a line open a fenced code block — so
 * everything from there to the next run of tildes rendered as code, and an odd
 * number of runs swallowed the rest of the note, headings and transcript
 * included.
 *
 * The other line shapes here are the same bug wearing different clothes:
 *
 * - ``` — the other fence character.
 * - `# ...` — a description's own "SECTION" line becomes a real heading, which
 *   lands in the outline and, worse, is what `sectionEnd` looks for: a `#` line
 *   inside the description ends the description section early, so folds and a
 *   transcript re-fetch aim at the wrong range.
 * - `---` / `===` under a text line — setext, i.e. a heading again. `---` alone
 *   is also a horizontal rule the creator never wrote.
 * - `>` — a blockquote.
 * - `- ` / `1. ` — a list. Left alone deliberately: creators do write lists, and
 *   rendering one as a list is the right answer.
 * - `[[` — an Obsidian wikilink, which makes a phantom note and shows up in the
 *   graph.
 *
 * Everything is escaped with a backslash rather than dropped, so the text still
 * reads exactly as written and copies back out clean.
 */
export function escapeDescription(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      // Leading whitespace is preserved; the escape goes on the first character
      // that carries meaning.
      const indent = line.slice(0, line.length - line.trimStart().length);
      const body = line.slice(indent.length);
      // A fence line is escaped character by character: one backslash on the
      // first tilde would leave `~~` pairs behind it, which is strikethrough —
      // a different piece of unasked-for formatting.
      const fence = /^([~`]{3,})/.exec(body);
      if (fence) {
        const escaped = fence[1].replace(/([~`])/g, "\\$1");
        return `${indent}${escaped}${body.slice(fence[1].length)}`;
      }
      if (/^(#{1,6}\s|>|-{3,}\s*$|={3,}\s*$)/.test(body)) {
        return `${indent}\\${body}`;
      }
      return line;
    })
    .join("\n")
    .replace(/\[\[/g, "\\[\\[");
}

/**
 * The `ytfree:` markdown link in `line` whose full `[text](url)` span covers
 * `offset`, or null.
 *
 * This is the Live Preview click path. There, links are CodeMirror spans with
 * no `href` in the DOM, so the URL has to be recovered from the document text
 * the same way Obsidian's own editor plugin does it.
 */
export function seekLinkAt(
  line: string,
  offset: number,
): { videoId: string; seconds: number; from: number; to: number } | null {
  const re = /\[[^\]\n]*\]\(ytfree:([A-Za-z0-9_-]+):(\d+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (offset < m.index) return null;
    if (offset > m.index + m[0].length) continue;
    return {
      videoId: m[1],
      seconds: Number(m[2]),
      from: m.index,
      to: m.index + m[0].length,
    };
  }
  return null;
}
