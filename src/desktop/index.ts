/**
 * The desktop half of the plugin, behind one door.
 *
 * Every module under `src/desktop/` imports a Node builtin at the top level,
 * and on iOS that import throws at module load — before `onload` runs, so the
 * plugin dies rather than degrading. Guarding at the call site does not help;
 * the import itself is what fails.
 *
 * So there is exactly one way in: `await import("./desktop")`, inside a
 * `Platform.isDesktopApp` branch. esbuild keeps a dynamically-imported subgraph
 * in a lazily-initialised closure, which is what makes the `require` calls
 * happen on first use instead of at startup.
 *
 * The rule this file exists to enforce: nothing under `src/desktop/` may be
 * imported at the top of a file mobile loads.
 */

export * from "./account.ts";
export * from "./calibrate.ts";
export * from "./download.ts";
export * from "./resolver.ts";
export * from "./signin.ts";
export * from "./silencedetect.ts";
export * from "./transcript-fetch.ts";
