// Obsidian always has `window`, and the plugin's timers go through it
// (`window.setTimeout`) so they belong to the right window. Node has none.
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
