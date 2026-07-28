/**
 * Signing in to YouTube, inside Obsidian.
 *
 * The shape here is not a preference — it is the result of the spike on
 * `prototype/signin-spike`, and every part of it is load-bearing:
 *
 *   - a `<webview>` in a Modal, **not** an Electron `BrowserWindow`;
 *   - the user agent **left completely alone**. Spoofing Chrome is the one
 *     change that demonstrably produced Google's "this browser or app may not
 *     be secure" block: Electron's `Sec-CH-UA` client hints name Electron and
 *     omit the high-entropy hints real Chrome sends (electron#34762), so a
 *     Chrome UA over those headers is a visible mismatch. Do not add
 *     client-hint rewriting either; it was built during the spike, never
 *     needed, and only exists to paper over a spoof we are not doing;
 *   - pointed at `youtube.com`, **never** at `accounts.google.com/ServiceLogin`.
 *     You sign in from YouTube's own avatar menu. ServiceLogin is the endpoint
 *     with the embedded-browser check bolted to it.
 *
 * If sign-in ever starts failing, this comment is the first thing to read and
 * the UA is the first thing to check. The Takeout CSV import stays as the
 * documented fallback precisely because Google can change this at any time.
 *
 * What this file deliberately does not do: read, log, intercept or store
 * anything typed into the window. There is no input handler anywhere in it. The
 * page is asked exactly one fixed question, for a display name, and URLs are
 * stripped of their query strings before being logged because Google puts
 * account identifiers there.
 */

import { App, Modal, Notice } from "obsidian";
import { hasCompleteSession, missingAuthCookies, SessionCookie } from "../account.ts";

/**
 * Its own session store, shared with nothing. Two reasons: reading cookies out
 * of a live session can invalidate it, and this keeps that away from anything
 * else Obsidian does. It is also the only thing "Sign out" has to erase.
 */
export const SIGNIN_PARTITION = "persist:ytfree-account";

const YOUTUBE_URL = "https://www.youtube.com/";

/** Everything after `?` can carry an account identifier. Log the shape only. */
function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return "(unparseable)";
  }
}

/**
 * The display name, for the one line settings shows. Cosmetic: a null answer
 * means the status reads "Signed in" instead of "Signed in as …", and nothing
 * else changes. Written as a fixed extraction of two known fields rather than
 * anything that reads page text, because page text on a sign-in page contains
 * whatever was typed into it.
 */
const NAME_PROBE = `(() => {
  const html = document.documentElement ? document.documentElement.innerHTML : "";
  const m = html.match(/"accountName":\\{"simpleText":"([^"]{1,64})"/)
    || html.match(/"channelHandle":\\{"simpleText":"(@[^"]{1,64})"/);
  return m ? m[1] : null;
})()`;

interface WebviewEl extends HTMLElement {
  src: string;
  executeJavaScript(code: string): Promise<unknown>;
  getWebContentsId(): number;
  goBack(): void;
  reload(): void;
}

interface RemoteApi {
  session: {
    fromPartition(partition: string): {
      cookies: { get(filter: Record<string, unknown>): Promise<SessionCookie[]> };
      clearStorageData(): Promise<void>;
    };
  };
  webContents: {
    fromId(
      id: number,
    ): { setWindowOpenHandler(handler: (details: { url: string }) => unknown): void } | null;
  };
}

/**
 * `@electron/remote` is external to the bundle (see `esbuild.config.mjs`) and
 * required at runtime, the same way the spike reached it. It exists only in the
 * desktop renderer, which is why this whole file lives under `src/desktop/`.
 */
function getRemote(): RemoteApi | null {
  try {
    const remote = require("@electron/remote") as RemoteApi | undefined;
    if (remote?.session) return remote;
  } catch {
    /* fall through to the older name */
  }
  try {
    const electron = require("electron") as { remote?: RemoteApi };
    return electron?.remote ?? null;
  } catch {
    return null;
  }
}

export async function readSessionCookies(): Promise<SessionCookie[]> {
  const remote = getRemote();
  if (!remote) return [];
  return remote.session.fromPartition(SIGNIN_PARTITION).cookies.get({});
}

/** Sign out locally: the partition, and with it the session, ceases to exist. */
export async function clearSignInPartition(): Promise<void> {
  const remote = getRemote();
  if (!remote) return;
  await remote.session.fromPartition(SIGNIN_PARTITION).clearStorageData();
}

export interface SignInResult {
  cookies: SessionCookie[];
  name: string | null;
}

export class SignInModal extends Modal {
  private view: WebviewEl | null = null;
  private poller: number | null = null;
  private statusEl!: HTMLElement;
  private finished = false;

  constructor(
    app: App,
    private onSignedIn: (result: SignInResult) => void | Promise<void>,
  ) {
    super(app);
    this.modalEl.addClass("ytfree-signin-modal");
  }

  onOpen(): void {
    this.titleEl.setText("Sign in to YouTube");

    // Reserved height: this line changes three times during a sign-in and must
    // never move the window under the pointer while it does.
    this.statusEl = this.contentEl.createDiv({ cls: "ytfree-signin-status" });
    this.setStatus("Sign in with the avatar in the top right, as you would on the web.");

    const nav = this.contentEl.createDiv({ cls: "ytfree-signin-nav" });
    const back = nav.createEl("button", { text: "←", cls: "ytfree-signin-navbutton" });
    back.setAttribute("aria-label", "Back");
    const reload = nav.createEl("button", { text: "⟳", cls: "ytfree-signin-navbutton" });
    reload.setAttribute("aria-label", "Reload");
    nav.createSpan({ cls: "ytfree-signin-url", text: "youtube.com" });

    const view = document.createElement("webview") as WebviewEl;
    view.setAttribute("partition", SIGNIN_PARTITION);
    view.setAttribute("allowpopups", "");
    // No `useragent` attribute. See the header of this file — that omission is
    // the single most important line in it.
    view.setAttribute("src", YOUTUBE_URL);
    view.addClass("ytfree-signin-view");
    this.contentEl.appendChild(view);
    this.view = view;

    back.addEventListener("click", () => {
      try {
        view.goBack();
      } catch {
        /* nothing to go back to */
      }
    });
    reload.addEventListener("click", () => {
      try {
        view.reload();
      } catch {
        /* not loaded yet */
      }
    });

    view.addEventListener("did-navigate", (evt) => {
      console.log("YT Free: sign-in → " + safeUrl((evt as unknown as { url: string }).url));
    });

    view.addEventListener("dom-ready", () => {
      // Google opens account pickers and passkey prompts in popups. Keep them
      // in this same view rather than losing them to a window nobody can see.
      try {
        const remote = getRemote();
        const contents = remote?.webContents.fromId(view.getWebContentsId());
        contents?.setWindowOpenHandler(({ url }: { url: string }) => {
          view.setAttribute("src", url);
          return { action: "deny" };
        });
      } catch {
        /* popups will open in their own window; not fatal */
      }
    });

    // Polling rather than watching navigation: the session lands when Google
    // says so, which may be several redirects after the page that mattered.
    this.poller = window.setInterval(() => void this.check(), 2000);
  }

  private setStatus(text: string): void {
    this.statusEl.setText(text);
  }

  private async check(): Promise<void> {
    if (this.finished) return;
    let cookies: SessionCookie[];
    try {
      cookies = await readSessionCookies();
    } catch {
      return;
    }
    if (!hasCompleteSession(cookies)) {
      const missing = missingAuthCookies(cookies);
      if (cookies.length > 0 && missing.length < 4) this.setStatus("Finishing sign-in…");
      return;
    }

    this.finished = true;
    this.stopPolling();
    this.setStatus("Signed in. Saving the session…");

    let name: string | null = null;
    try {
      name = (await this.view?.executeJavaScript(NAME_PROBE)) as string | null;
    } catch {
      // Cosmetic only — the session is what matters and it is already in hand.
    }

    await this.onSignedIn({ cookies, name });
    new Notice(name ? `YT Free: signed in as ${name}.` : "YT Free: signed in.");
    this.close();
  }

  private stopPolling(): void {
    if (this.poller !== null) window.clearInterval(this.poller);
    this.poller = null;
  }

  onClose(): void {
    this.stopPolling();
    this.view = null;
    this.contentEl.empty();
  }
}
